// Seitenlayout (Welt-Koordinaten in pt) und Kamera (Zoom/Pan).
// Bildschirm = Welt * scale + (tx, ty)

import type { Id, Rect } from '../../model/types';
import type { ScrollDirection } from '../../model/settings';

export interface PageBox extends Rect {
  id: Id;
  index: number;
}

export interface Layout {
  boxes: PageBox[];
  width: number;
  height: number;
  maxPageW: number;
  maxPageH: number;
}

export const PAGE_GAP = 20;

export function layoutPages(
  pages: readonly { id: Id; paper: { width: number; height: number } }[],
  dir: ScrollDirection,
  gap = PAGE_GAP,
): Layout {
  let maxW = 0;
  let maxH = 0;
  for (const p of pages) {
    maxW = Math.max(maxW, p.paper.width);
    maxH = Math.max(maxH, p.paper.height);
  }
  const boxes: PageBox[] = [];
  let cursor = 0;
  pages.forEach((p, index) => {
    const { width: w, height: h } = p.paper;
    if (dir === 'vertical') {
      boxes.push({ id: p.id, index, x: (maxW - w) / 2, y: cursor, w, h });
      cursor += h + gap;
    } else {
      boxes.push({ id: p.id, index, x: cursor, y: (maxH - h) / 2, w, h });
      cursor += w + gap;
    }
  });
  const extent = Math.max(0, cursor - gap);
  return dir === 'vertical'
    ? { boxes, width: maxW, height: extent, maxPageW: maxW, maxPageH: maxH }
    : { boxes, width: extent, height: maxH, maxPageW: maxW, maxPageH: maxH };
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface CameraState {
  scale: number;
  tx: number;
  ty: number;
}

const MARGIN = 16;

export class Camera implements CameraState {
  scale = 1;
  tx = 0;
  ty = 0;
  vw = 1;
  vh = 1;
  insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  fitScale = 1;
  dir: ScrollDirection = 'vertical';
  private layout: Layout = { boxes: [], width: 0, height: 0, maxPageW: 1, maxPageH: 1 };

  get minScale(): number {
    return this.fitScale * (this.dir === 'vertical' ? 0.5 : 0.8);
  }

  get maxScale(): number {
    return Math.max(this.fitScale * 6, 4);
  }

  /** Zoom relativ zur Seitenbreite (1 = Seite passt). */
  get zoom(): number {
    return this.scale / this.fitScale;
  }

  setLayout(layout: Layout, dir: ScrollDirection) {
    this.layout = layout;
    this.dir = dir;
    this.computeFit();
  }

  setViewport(w: number, h: number, insets: Insets) {
    this.vw = Math.max(1, w);
    this.vh = Math.max(1, h);
    this.insets = insets;
    this.computeFit();
  }

  private computeFit() {
    const availW = this.vw - this.insets.left - this.insets.right - 2 * MARGIN;
    const availH = this.vh - this.insets.top - this.insets.bottom - 2 * MARGIN;
    const byW = availW / Math.max(1, this.layout.maxPageW);
    const byH = availH / Math.max(1, this.layout.maxPageH);
    this.fitScale = Math.max(0.05, this.dir === 'vertical' ? byW : Math.min(byW, byH));
  }

  snapshot(): CameraState {
    return { scale: this.scale, tx: this.tx, ty: this.ty };
  }

  restore(s: CameraState) {
    this.scale = s.scale;
    this.tx = s.tx;
    this.ty = s.ty;
  }

  /** Begrenzt die Verschiebung so, dass der Inhalt erreichbar bleibt. */
  clamp() {
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, this.scale));
    const { top, right, bottom, left } = this.insets;
    const cw = this.layout.width * this.scale;
    const ch = this.layout.height * this.scale;
    const availW = this.vw - left - right;
    const availH = this.vh - top - bottom;
    if (cw + 2 * MARGIN <= availW) this.tx = left + (availW - cw) / 2;
    else this.tx = Math.min(left + MARGIN, Math.max(this.vw - right - MARGIN - cw, this.tx));
    if (ch + 2 * MARGIN <= availH) {
      this.ty = this.dir === 'vertical' ? top + MARGIN : top + (availH - ch) / 2;
    } else {
      this.ty = Math.min(top + MARGIN, Math.max(this.vh - bottom - MARGIN - ch, this.ty));
    }
  }

  zoomAt(factor: number, sx: number, sy: number) {
    const next = Math.min(this.maxScale, Math.max(this.minScale, this.scale * factor));
    const k = next / this.scale;
    this.tx = sx - (sx - this.tx) * k;
    this.ty = sy - (sy - this.ty) * k;
    this.scale = next;
  }

  panBy(dx: number, dy: number) {
    this.tx += dx;
    this.ty += dy;
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.tx) / this.scale, (sy - this.ty) / this.scale];
  }

  toScreen(wx: number, wy: number): [number, number] {
    return [wx * this.scale + this.tx, wy * this.scale + this.ty];
  }

  /** Sichtbarer Bereich in Welt-Koordinaten. */
  visibleWorld(): Rect {
    const [x0, y0] = this.toWorld(0, 0);
    return { x: x0, y: y0, w: this.vw / this.scale, h: this.vh / this.scale };
  }

  /** Kameraposition, bei der eine Seite oben bzw. mittig erscheint. */
  targetForPage(box: PageBox, scale = this.scale): CameraState {
    const { top, left, right, bottom } = this.insets;
    if (this.dir === 'vertical') {
      return { scale, tx: this.tx, ty: top + MARGIN - box.y * scale };
    }
    const availW = this.vw - left - right;
    const availH = this.vh - top - bottom;
    return {
      scale,
      tx: left + (availW - box.w * scale) / 2 - box.x * scale,
      ty: top + (availH - box.h * scale) / 2 - box.y * scale,
    };
  }

  /** Seitenbreite einpassen und an den Anfang springen. */
  fit() {
    this.scale = this.fitScale;
    this.tx = this.insets.left + MARGIN;
    this.ty = this.insets.top + MARGIN;
    this.clamp();
  }
}
