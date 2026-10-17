// Darstellung einer Seite: Hintergrund-Canvas (Papier, Vorlage oder PDF),
// Ink-Canvas (fertige Striche, gecacht) und bei starkem Zoom ein
// Detail-Paar (Hintergrund + Tinte), das nur den sichtbaren Ausschnitt scharf zeigt.
//
// Das Element liegt in Seitenkoordinaten (1 CSS-px = 1 pt) und wird per
// CSS-Transform auf die Bildschirmposition und den Zoom gebracht.
// PDF-Hintergründe werden asynchron im pdf.js-Worker gerendert.

import type { Item, Page, Rect } from '../../model/types';
import { drawPaper } from '../../templates/draw';
import { hasFileBackground, renderFileBackground } from './background';
import { drawItems } from './items';
import { intersects } from '../geometry/rect';

export { chooseLevel, MAX_CANVAS_PIXELS } from './levels';

type Filter = ((it: Item) => boolean) | undefined;

function sizeCanvas(c: HTMLCanvasElement, w: number, h: number) {
  const bw = Math.max(1, Math.round(w));
  const bh = Math.max(1, Math.round(h));
  if (c.width !== bw) c.width = bw;
  if (c.height !== bh) c.height = bh;
}

/** Kontext, der in Seitenkoordinaten (pt) auf einen Ausschnitt `r` zeichnet. */
function regionCtx(c: HTMLCanvasElement, r: Rect): CanvasRenderingContext2D {
  const ctx = c.getContext('2d')!;
  const kx = c.width / r.w;
  const ky = c.height / r.h;
  ctx.setTransform(kx, 0, 0, ky, -r.x * kx, -r.y * ky);
  return ctx;
}

export class PageView {
  readonly el: HTMLDivElement;
  private bg: HTMLCanvasElement;
  private ink: HTMLCanvasElement;
  private detailBg: HTMLCanvasElement;
  private detailInk: HTMLCanvasElement;
  private bgJob: AbortController | null = null;
  private detailJob: AbortController | null = null;
  level = 0;
  /** Ausschnitt (pt) und Auflösung der Detail-Ebenen, falls aktiv. */
  detailRect: Rect | null = null;
  detailLevel = 0;

  constructor(
    public page: Page,
    container: HTMLElement,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'feder-page';
    this.el.dataset.pageId = page.id;
    this.bg = this.makeCanvas('bg');
    this.ink = this.makeCanvas('ink');
    this.detailBg = this.makeCanvas('detail');
    this.detailInk = this.makeCanvas('detail');
    this.showDetail(false);
    this.applySize();
    container.appendChild(this.el);
  }

  private makeCanvas(kind: string): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.className = `feder-layer feder-${kind}`;
    this.el.appendChild(c);
    return c;
  }

  private applySize() {
    this.el.style.width = `${this.page.paper.width}px`;
    this.el.style.height = `${this.page.paper.height}px`;
  }

  private get fullRect(): Rect {
    return { x: 0, y: 0, w: this.page.paper.width, h: this.page.paper.height };
  }

  setPage(page: Page) {
    const sizeChanged =
      page.paper.width !== this.page.paper.width || page.paper.height !== this.page.paper.height;
    this.page = page;
    if (sizeChanged) {
      this.applySize();
      this.level = 0;
    }
  }

  setTransform(sx: number, sy: number, scale: number, dpr: number) {
    // Auf Gerätepixel runden, damit die Detail-Ebenen 1:1 abgebildet werden.
    const rx = Math.round(sx * dpr) / dpr;
    const ry = Math.round(sy * dpr) / dpr;
    this.el.style.transform = `translate3d(${rx}px, ${ry}px, 0) scale(${scale})`;
  }

  /** Setzt Hintergrund- und Ink-Canvas auf eine neue Auflösung und zeichnet neu. */
  setLevel(level: number, items: readonly Item[] | undefined, filter?: Filter) {
    this.level = level;
    const { width, height } = this.page.paper;
    sizeCanvas(this.bg, width * level, height * level);
    sizeCanvas(this.ink, width * level, height * level);
    this.renderBackground();
    this.renderInk(items, filter);
  }

  /**
   * Zeichnet einen Hintergrund-Ausschnitt: Papier/Vorlage sofort, ein PDF
   * asynchron. Bis das PDF fertig ist, bleibt der vorherige Inhalt sichtbar.
   */
  private paintBackground(c: HTMLCanvasElement, rect: Rect, level: number, job: AbortController) {
    if (!hasFileBackground(this.page.paper)) {
      const ctx = regionCtx(c, rect);
      drawPaper(ctx, this.page.paper, level);
      return;
    }
    void renderFileBackground(this.page.paper, rect, level, job.signal)
      .then((img) => {
        if (!img || job.signal.aborted) return;
        const ctx = c.getContext('2d')!;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        img.width = img.height = 0;
      })
      .catch((err) => console.warn('Hintergrund konnte nicht gerendert werden', err));
  }

  renderBackground() {
    if (!this.level) return;
    this.bgJob?.abort();
    this.bgJob = new AbortController();
    if (hasFileBackground(this.page.paper)) {
      // Platzhalter, solange PDF bzw. Bild noch nicht gerendert ist
      const ctx = regionCtx(this.bg, this.fullRect);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, this.page.paper.width, this.page.paper.height);
    }
    this.paintBackground(this.bg, this.fullRect, this.level, this.bgJob);
    if (this.detailRect) this.renderDetailBackground();
  }

  renderInk(items: readonly Item[] | undefined, filter?: Filter) {
    if (!this.level) return;
    const ctx = regionCtx(this.ink, this.fullRect);
    ctx.clearRect(0, 0, this.page.paper.width, this.page.paper.height);
    if (items) drawItems(ctx, items, filter);
    if (this.detailRect) this.renderDetailInk(items, filter);
  }

  /** Zeichnet einen Bereich (pt) der Tinte neu – z. B. nach dem Radieren. */
  redrawRegion(region: Rect, items: readonly Item[], filter?: Filter) {
    if (!this.level) return;
    const redraw = (ctx: CanvasRenderingContext2D) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(region.x, region.y, region.w, region.h);
      ctx.clip();
      ctx.clearRect(region.x, region.y, region.w, region.h);
      drawItems(ctx, items, (it) => intersects(it.bbox, region) && (!filter || filter(it)));
      ctx.restore();
    };
    redraw(regionCtx(this.ink, this.fullRect));
    if (this.detailRect && intersects(region, this.detailRect)) {
      redraw(regionCtx(this.detailInk, this.detailRect));
    }
  }

  /** Zeichnet neue Striche obenauf, ohne den Rest neu zu zeichnen. */
  drawOnTop(items: readonly Item[]) {
    if (!this.level) return;
    drawItems(regionCtx(this.ink, this.fullRect), items);
    if (this.detailRect) drawItems(regionCtx(this.detailInk, this.detailRect), items);
  }

  private showDetail(on: boolean) {
    for (const c of [this.detailBg, this.detailInk]) c.style.display = on ? 'block' : 'none';
  }

  /** Scharfer Ausschnitt bei starkem Zoom. `rect` in pt, `level` in Gerätepixel/pt. */
  renderDetail(rect: Rect, level: number, items: readonly Item[] | undefined, filter?: Filter) {
    this.detailRect = rect;
    this.detailLevel = level;
    for (const c of [this.detailBg, this.detailInk]) {
      sizeCanvas(c, rect.w * level, rect.h * level);
      c.style.left = `${rect.x}px`;
      c.style.top = `${rect.y}px`;
      c.style.width = `${rect.w}px`;
      c.style.height = `${rect.h}px`;
    }
    this.showDetail(true);
    this.renderDetailBackground();
    this.renderDetailInk(items, filter);
  }

  private renderDetailBackground() {
    const rect = this.detailRect!;
    this.detailJob?.abort();
    this.detailJob = new AbortController();
    // Neu dimensionierte Canvases sind leer; der gröbere Hintergrund scheint durch,
    // bis das scharfe PDF fertig ist.
    this.paintBackground(this.detailBg, rect, this.detailLevel, this.detailJob);
  }

  private renderDetailInk(items: readonly Item[] | undefined, filter?: Filter) {
    const rect = this.detailRect!;
    const ctx = regionCtx(this.detailInk, rect);
    ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
    if (items) drawItems(ctx, items, (it) => intersects(it.bbox, rect) && (!filter || filter(it)));
  }

  hideDetail() {
    if (!this.detailRect) return;
    this.detailJob?.abort();
    this.detailRect = null;
    this.showDetail(false);
    this.detailBg.width = this.detailBg.height = 0;
    this.detailInk.width = this.detailInk.height = 0;
  }

  /** Gibt den Canvas-Speicher frei (WebKit gibt ihn bei 0×0 sofort zurück). */
  destroy() {
    this.bgJob?.abort();
    this.detailJob?.abort();
    for (const c of [this.bg, this.ink, this.detailBg, this.detailInk]) c.width = c.height = 0;
    this.el.remove();
  }
}
