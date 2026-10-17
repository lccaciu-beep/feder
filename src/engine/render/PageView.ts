// Darstellung einer Seite: Hintergrund-Canvas (Papier/Vorlage),
// Ink-Canvas (fertige Striche, gecacht) und bei starkem Zoom ein
// Detail-Canvas, der nur den sichtbaren Ausschnitt scharf zeigt.
//
// Das Element liegt in Seitenkoordinaten (1 CSS-px = 1 pt) und wird per
// CSS-Transform auf die Bildschirmposition und den Zoom gebracht.

import type { Item, Page, Rect } from '../../model/types';
import { drawPaper } from '../../templates/draw';
import { drawItems } from '../ink/brushes';
import { intersects } from '../geometry/rect';

/** Höchstzahl an Pixeln pro Canvas (Speichergrenze von Safari auf dem iPad). */
export const MAX_CANVAS_PIXELS = 8_000_000;

const LEVELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 12, 16];

/** Wählt eine Auflösungsstufe (Gerätepixel pro pt) für eine Seite. */
export function chooseLevel(target: number, pageW: number, pageH: number): number {
  const cap = Math.sqrt(MAX_CANVAS_PIXELS / (pageW * pageH));
  const wanted = LEVELS.find((l) => l >= target * 0.98) ?? LEVELS[LEVELS.length - 1]!;
  return Math.min(wanted, cap);
}

type Filter = ((it: Item) => boolean) | undefined;

function sizeCanvas(c: HTMLCanvasElement, w: number, h: number) {
  const bw = Math.max(1, Math.round(w));
  const bh = Math.max(1, Math.round(h));
  if (c.width !== bw) c.width = bw;
  if (c.height !== bh) c.height = bh;
}

export class PageView {
  readonly el: HTMLDivElement;
  private bg: HTMLCanvasElement;
  private ink: HTMLCanvasElement;
  private detail: HTMLCanvasElement;
  level = 0;
  /** Ausschnitt (pt) und Auflösung des Detail-Canvas, falls aktiv. */
  detailRect: Rect | null = null;
  detailLevel = 0;
  itemsReady = false;

  constructor(
    public page: Page,
    container: HTMLElement,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'feder-page';
    this.el.dataset.pageId = page.id;
    this.bg = this.makeCanvas('bg');
    this.ink = this.makeCanvas('ink');
    this.detail = this.makeCanvas('detail');
    this.detail.style.display = 'none';
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
    // Auf Gerätepixel runden, damit der Detail-Canvas 1:1 abgebildet wird.
    const rx = Math.round(sx * dpr) / dpr;
    const ry = Math.round(sy * dpr) / dpr;
    this.el.style.transform = `translate3d(${rx}px, ${ry}px, 0) scale(${scale})`;
  }

  private pageCtx(c: HTMLCanvasElement) {
    const ctx = c.getContext('2d')!;
    ctx.setTransform(c.width / this.page.paper.width, 0, 0, c.height / this.page.paper.height, 0, 0);
    return ctx;
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

  renderBackground() {
    if (!this.level) return;
    const ctx = this.pageCtx(this.bg);
    drawPaper(ctx, this.page.paper, this.level);
  }

  renderInk(items: readonly Item[] | undefined, filter?: Filter) {
    if (!this.level) return;
    const ctx = this.pageCtx(this.ink);
    ctx.clearRect(0, 0, this.page.paper.width, this.page.paper.height);
    if (items) {
      this.itemsReady = true;
      drawItems(ctx, items, filter);
    }
    if (this.detailRect) this.renderDetail(this.detailRect, this.detailLevel, items, filter);
  }

  /** Zeichnet einen Bereich (pt) neu – z. B. nach dem Radieren. */
  redrawRegion(region: Rect, items: readonly Item[], filter?: Filter) {
    if (!this.level) return;
    const draw = (ctx: CanvasRenderingContext2D) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(region.x, region.y, region.w, region.h);
      ctx.clip();
      ctx.clearRect(region.x, region.y, region.w, region.h);
      drawItems(ctx, items, (it) => intersects(it.bbox, region) && (!filter || filter(it)));
      ctx.restore();
    };
    draw(this.pageCtx(this.ink));
    if (this.detailRect && intersects(region, this.detailRect)) {
      const ctx = this.detailCtx();
      ctx.save();
      ctx.beginPath();
      ctx.rect(region.x, region.y, region.w, region.h);
      ctx.clip();
      drawPaper(ctx, this.page.paper, this.detailLevel);
      drawItems(ctx, items, (it) => intersects(it.bbox, region) && (!filter || filter(it)));
      ctx.restore();
    }
  }

  /** Zeichnet neue Striche obenauf, ohne den Rest neu zu zeichnen. */
  drawOnTop(items: readonly Item[]) {
    if (!this.level) return;
    drawItems(this.pageCtx(this.ink), items);
    if (this.detailRect) drawItems(this.detailCtx(), items);
  }

  private detailCtx() {
    const c = this.detail;
    const r = this.detailRect!;
    const ctx = c.getContext('2d')!;
    const k = c.width / r.w;
    ctx.setTransform(k, 0, 0, c.height / r.h, -r.x * k, (-r.y * c.height) / r.h);
    return ctx;
  }

  /** Scharfer Ausschnitt bei starkem Zoom. `rect` in pt, `level` in Gerätepixel/pt. */
  renderDetail(rect: Rect, level: number, items: readonly Item[] | undefined, filter?: Filter) {
    this.detailRect = rect;
    this.detailLevel = level;
    const c = this.detail;
    sizeCanvas(c, rect.w * level, rect.h * level);
    c.style.left = `${rect.x}px`;
    c.style.top = `${rect.y}px`;
    c.style.width = `${rect.w}px`;
    c.style.height = `${rect.h}px`;
    c.style.display = 'block';
    const ctx = this.detailCtx();
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    drawPaper(ctx, this.page.paper, level);
    if (items) drawItems(ctx, items, (it) => intersects(it.bbox, rect) && (!filter || filter(it)));
    ctx.restore();
  }

  hideDetail() {
    if (!this.detailRect) return;
    this.detailRect = null;
    this.detail.style.display = 'none';
    this.detail.width = this.detail.height = 0;
  }

  /** Gibt den Canvas-Speicher frei (WebKit gibt ihn bei 0×0 sofort zurück). */
  destroy() {
    for (const c of [this.bg, this.ink, this.detail]) c.width = c.height = 0;
    this.el.remove();
  }
}
