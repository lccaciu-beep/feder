// Zoom-Fenster: ein vergrößerter Ausschnitt der Seite am unteren Rand.
// Geschrieben wird im Fenster, die Striche landen in Originalgröße auf der
// Seite. Nach rechts wird automatisch weitergeschoben, am Zeilenende geht es
// in die nächste Zeile.

import type { AppSettings } from '../model/settings';
import type { Id, Item, PressureMode, Rect } from '../model/types';
import type { NotebookDoc } from './doc/NotebookDoc';
import { renderPdfRegion } from '../pdf/pdfjs';
import { drawPaper } from '../templates/draw';
import { drawItems } from './render/items';
import { LiveLayer } from './render/LiveLayer';
import { EraserTool } from './tools/EraserTool';
import { InkTool } from './tools/InkTool';
import type { Sample, Tool, ToolHost } from './tools/types';
import { Camera, type PageBox } from './view/camera';
import { intersects } from './geometry/rect';
import { tiltToAngles } from './ink/capture';

export interface ZoomHost {
  readonly doc: NotebookDoc;
  readonly settings: AppSettings;
  pressureMode(pointerType: string): PressureMode;
  pageBox(pageId: Id): PageBox | undefined;
  preview(pageId: Id, hidden: ReadonlySet<Id>, extra: readonly Item[], region: Rect): void;
  readonly toolName: string;
  onZoomRectChanged(): void;
}

export class ZoomWindow implements ToolHost {
  readonly camera = new Camera();
  readonly live: LiveLayer;
  readonly el: HTMLDivElement;
  private bg: HTMLCanvasElement;
  private ink: HTMLCanvasElement;
  private tools: { pen: InkTool; highlighter: InkTool; eraser: EraserTool };
  private tool: Tool | null = null;
  private pointer: number | null = null;
  private frameReq = 0;
  private bgJob: AbortController | null = null;
  private dpr = 1;
  private w = 1;
  private h = 1;
  pageId: Id = '';
  rect: Rect = { x: 0, y: 0, w: 100, h: 40 };
  private unsub: () => void;

  constructor(
    private readonly host: ZoomHost,
    container: HTMLElement,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'feder-zoom';
    this.bg = document.createElement('canvas');
    this.ink = document.createElement('canvas');
    for (const c of [this.bg, this.ink]) {
      c.className = 'feder-zoom-layer';
      this.el.appendChild(c);
    }
    container.appendChild(this.el);
    this.live = new LiveLayer(this.el);
    this.tools = {
      pen: new InkTool(this, 'pen'),
      highlighter: new InkTool(this, 'highlighter'),
      eraser: new EraserTool(this),
    };
    this.el.addEventListener('pointerdown', this.down);
    this.el.addEventListener('pointermove', this.move);
    this.el.addEventListener('pointerup', this.up);
    this.el.addEventListener('pointercancel', this.up);
    this.el.addEventListener('touchstart', prevent, { passive: false });
    this.el.addEventListener('touchmove', prevent, { passive: false });
    this.unsub = host.doc.on((c) => {
      if (c.items.has(this.pageId)) this.renderInk();
      if (c.pages.has(this.pageId)) this.renderBackground();
    });
  }

  get doc() {
    return this.host.doc;
  }
  get settings() {
    return this.host.settings;
  }
  pressureMode(t: string) {
    return this.host.pressureMode(t);
  }
  pageBox(id: Id) {
    return this.host.pageBox(id);
  }
  preview(pageId: Id, hidden: ReadonlySet<Id>, extra: readonly Item[], region: Rect) {
    this.host.preview(pageId, hidden, extra, region);
    if (pageId === this.pageId) this.renderInk(hidden, extra);
  }

  /** Größe des Fensters (CSS-px) setzen. */
  resize(width: number, height: number, dpr: number) {
    this.w = Math.max(1, width);
    this.h = Math.max(1, height);
    this.dpr = dpr;
    for (const c of [this.bg, this.ink]) {
      c.width = Math.round(this.w * dpr);
      c.height = Math.round(this.h * dpr);
      c.style.width = `${this.w}px`;
      c.style.height = `${this.h}px`;
    }
    this.live.resize(this.w, this.h, dpr);
    // Ausschnitt-Höhe an das Seitenverhältnis des Fensters anpassen
    this.rect = { ...this.rect, h: (this.rect.w * this.h) / this.w };
    this.update();
  }

  /** Ausschnitt setzen (Seitenkoordinaten); Breite bestimmt den Zoom. */
  setRect(pageId: Id, rect: Rect) {
    const box = this.host.pageBox(pageId);
    if (!box) return;
    const w = Math.max(40, Math.min(rect.w, box.w));
    const h = (w * this.h) / this.w;
    this.pageId = pageId;
    this.rect = {
      x: Math.max(0, Math.min(rect.x, box.w - w)),
      y: Math.max(0, Math.min(rect.y, box.h - h)),
      w,
      h,
    };
    this.update();
  }

  private update() {
    const box = this.host.pageBox(this.pageId);
    if (!box) return;
    const k = this.w / this.rect.w;
    this.camera.scale = k;
    this.camera.tx = -(box.x + this.rect.x) * k;
    this.camera.ty = -(box.y + this.rect.y) * k;
    this.camera.vw = this.w;
    this.camera.vh = this.h;
    this.renderBackground();
    this.renderInk();
    this.host.onZoomRectChanged();
  }

  /** Nach rechts weiterschieben bzw. in die nächste Zeile springen. */
  advance() {
    const box = this.host.pageBox(this.pageId);
    if (!box) return;
    const margin = box.w * 0.06;
    const x = this.rect.x + this.rect.w * 0.6;
    if (x + this.rect.w > box.w - margin * 0.5) return this.newLine();
    this.setRect(this.pageId, { ...this.rect, x });
  }

  newLine() {
    const box = this.host.pageBox(this.pageId);
    if (!box) return;
    const page = this.host.doc.pages.get(this.pageId);
    const t = page?.paper.template;
    const spacing = t?.kind === 'builtin' && t.params.spacing ? t.params.spacing : this.rect.h * 0.7;
    this.setRect(this.pageId, { ...this.rect, x: box.w * 0.06, y: this.rect.y + spacing });
  }

  private renderBackground() {
    const page = this.host.doc.pages.get(this.pageId);
    if (!page) return;
    const k = (this.w / this.rect.w) * this.dpr;
    const ctx = this.bg.getContext('2d')!;
    ctx.setTransform(k, 0, 0, k, -this.rect.x * k, -this.rect.y * k);
    drawPaper(ctx, page.paper, k);
    const t = page.paper.template;
    this.bgJob?.abort();
    if (t.kind !== 'pdf') return;
    const job = (this.bgJob = new AbortController());
    void renderPdfRegion(t.blobId, t.pageIndex, this.rect, k, job.signal).then((img) => {
      if (!img || job.signal.aborted) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(img, 0, 0, this.bg.width, this.bg.height);
      img.width = img.height = 0;
    });
  }

  private renderInk(hidden?: ReadonlySet<Id>, extra: readonly Item[] = []) {
    const k = (this.w / this.rect.w) * this.dpr;
    const ctx = this.ink.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.ink.width, this.ink.height);
    ctx.setTransform(k, 0, 0, k, -this.rect.x * k, -this.rect.y * k);
    let items = this.host.doc.getItems(this.pageId) ?? [];
    if (hidden?.size || extra.length) {
      items = items.filter((it) => !hidden?.has(it.id)).concat(extra);
      items = [...items].sort((a, b) => a.z - b.z);
    }
    drawItems(ctx, items, (it) => intersects(it.bbox, this.rect));
  }

  // ---------- Eingabe ----------

  private sample(e: PointerEvent): Sample {
    const r = this.el.getBoundingClientRect();
    const angles = e.pointerType === 'pen' ? tiltToAngles(e.tiltX || 0, e.tiltY || 0) : {};
    return {
      sx: e.clientX - r.left,
      sy: e.clientY - r.top,
      pressure: e.pressure,
      t: e.timeStamp,
      pointerType: e.pointerType,
      ...angles,
    };
  }

  private pickTool(): Tool {
    const name = this.host.toolName;
    if (name === 'highlighter') return this.tools.highlighter;
    if (name === 'eraser') return this.tools.eraser;
    return this.tools.pen;
  }

  private down = (e: PointerEvent) => {
    e.stopPropagation();
    if (this.pointer !== null) return;
    if (e.pointerType === 'touch' && !this.host.settings.fingerDrawing) return;
    this.pointer = e.pointerId;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* synthetisch */
    }
    this.tool = this.pickTool();
    this.tool.begin(this.sample(e), this.pageId);
    this.loop();
  };

  private move = (e: PointerEvent) => {
    e.stopPropagation();
    if (e.pointerId !== this.pointer || !this.tool) return;
    const list = e.getCoalescedEvents?.() ?? [];
    this.tool.move(
      (list.length ? list : [e]).map((ev) => this.sample(ev)),
      [],
    );
  };

  private up = (e: PointerEvent) => {
    e.stopPropagation();
    if (e.pointerId !== this.pointer || !this.tool) return;
    const tool = this.tool;
    this.pointer = null;
    this.tool = null;
    const before = this.host.doc.getItems(this.pageId)?.length ?? 0;
    tool.end();
    // Wurde rechts im Fenster geschrieben, automatisch weiterschieben.
    const items = this.host.doc.getItems(this.pageId) ?? [];
    const last = items.length > before ? items[items.length - 1] : null;
    if (last && tool !== this.tools.eraser && last.bbox.x + last.bbox.w > this.rect.x + this.rect.w * 0.8)
      this.advance();
  };

  private loop() {
    if (this.frameReq) return;
    const step = (t: number) => {
      this.frameReq = 0;
      if (!this.tool) return;
      this.tool.frame(t);
      this.frameReq = requestAnimationFrame(step);
    };
    this.frameReq = requestAnimationFrame(step);
  }

  destroy() {
    this.unsub();
    cancelAnimationFrame(this.frameReq);
    this.bgJob?.abort();
    this.live.destroy();
    for (const c of [this.bg, this.ink]) c.width = c.height = 0;
    this.el.remove();
  }
}

function prevent(e: Event) {
  e.preventDefault();
}
