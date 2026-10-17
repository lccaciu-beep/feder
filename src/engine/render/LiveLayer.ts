// Live-Ebene für den gerade entstehenden Strich. Ein einziger Canvas über
// dem ganzen Viewport, gezeichnet in Bildschirmkoordinaten. Es wird nur der
// zuletzt bemalte Bereich gelöscht, nicht der ganze Canvas.

import type { Rect } from '../../model/types';

export class LiveLayer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dirty: Rect | null = null;
  private dpr = 1;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'feder-live';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d', { desynchronized: true } as CanvasRenderingContext2DSettings)!;
  }

  resize(w: number, h: number, dpr: number) {
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.dirty = null;
  }

  setBlend(mode: 'normal' | 'multiply') {
    this.canvas.style.mixBlendMode = mode;
  }

  /** Löscht den zuletzt bemalten Bereich. */
  clear() {
    if (!this.dirty) return;
    const d = this.dirty;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(
      Math.floor(d.x * this.dpr) - 2,
      Math.floor(d.y * this.dpr) - 2,
      Math.ceil(d.w * this.dpr) + 4,
      Math.ceil(d.h * this.dpr) + 4,
    );
    this.dirty = null;
  }

  /**
   * Liefert einen Kontext, der in Seitenkoordinaten zeichnet. `screenBox`
   * ist der Bildschirmbereich, den die Zeichnung belegt (für das Löschen).
   */
  begin(originX: number, originY: number, scale: number, screenBox: Rect): CanvasRenderingContext2D {
    const d = this.dpr;
    this.ctx.setTransform(scale * d, 0, 0, scale * d, originX * d, originY * d);
    this.markDirty(screenBox);
    return this.ctx;
  }

  /** Kontext in Bildschirmkoordinaten (CSS-px). */
  screen(screenBox: Rect): CanvasRenderingContext2D {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.markDirty(screenBox);
    return this.ctx;
  }

  private markDirty(r: Rect) {
    if (!this.dirty) {
      this.dirty = { ...r };
      return;
    }
    const x0 = Math.min(this.dirty.x, r.x);
    const y0 = Math.min(this.dirty.y, r.y);
    const x1 = Math.max(this.dirty.x + this.dirty.w, r.x + r.w);
    const y1 = Math.max(this.dirty.y + this.dirty.h, r.y + r.h);
    this.dirty = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  destroy() {
    this.canvas.width = this.canvas.height = 0;
    this.canvas.remove();
  }
}
