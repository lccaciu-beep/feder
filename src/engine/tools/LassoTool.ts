// Lasso: Bereich frei oder als Rechteck umfahren, Auswahl verschieben,
// skalieren, drehen und bei einzelnen Formen die Eckpunkte bearbeiten.

import type { Id, Item, Rect, ShapeItem } from '../../model/types';
import { union } from '../geometry/rect';
import {
  IDENTITY,
  about,
  itemBBox,
  itemInPolygon,
  transformItem,
  translate,
  type Sim,
} from '../geometry/transform';
import type { PageBox } from '../view/camera';
import { toPage, type Sample, type Tool, type ToolHost } from './types';

type Mode =
  | { kind: 'lasso' }
  | { kind: 'move' }
  | { kind: 'scale'; anchor: [number, number]; startDist: number }
  | { kind: 'rotate'; center: [number, number]; startAngle: number }
  | { kind: 'vertex'; index: number; shape: ShapeItem };

const SNAP = Math.PI / 2;

export function selectionBounds(items: readonly Item[], t: Sim | null = null): Rect | null {
  let r: Rect | null = null;
  for (const it of items) r = union(r, itemBBox(t ? transformItem(it, t) : it));
  return r;
}

export class LassoTool implements Tool {
  private pageId: Id | null = null;
  private box: PageBox | null = null;
  private mode: Mode | null = null;
  private path: number[] = [];
  private start: [number, number] = [0, 0];
  private current: [number, number] = [0, 0];
  private originals: Item[] = [];
  private lastRegion: Rect | null = null;
  private moved = false;
  private dirty = false;
  private startScreen = { sx: 0, sy: 0 };

  constructor(private readonly host: ToolHost) {}

  get active(): boolean {
    return this.mode !== null;
  }

  private selectedItems(): Item[] {
    const sel = this.host.selection;
    if (!sel) return [];
    return (this.host.doc.getItems(sel.pageId) ?? []).filter((it) => sel.ids.has(it.id));
  }

  begin(s: Sample, pageId: Id): void {
    const sel = this.host.selection;
    const handle = sel && sel.pageId === pageId ? this.host.selectionHandleAt?.(s.sx, s.sy) : null;
    this.box = this.host.pageBox(sel && handle ? sel.pageId : pageId) ?? null;
    if (!this.box) return;
    this.pageId = this.box.id;
    const p = toPage(this.host, this.box, s);
    this.start = p;
    this.current = p;
    this.startScreen = { sx: s.sx, sy: s.sy };
    this.moved = false;
    this.lastRegion = null;

    if (handle) {
      this.originals = this.selectedItems();
      const b = selectionBounds(this.originals)!;
      if (handle.kind === 'scale') {
        const anchor: [number, number] = [b.x, b.y];
        this.mode = {
          kind: 'scale',
          anchor,
          startDist: Math.max(1, Math.hypot(p[0] - anchor[0], p[1] - anchor[1])),
        };
      } else if (handle.kind === 'rotate') {
        const center: [number, number] = [b.x + b.w / 2, b.y + b.h / 2];
        this.mode = { kind: 'rotate', center, startAngle: Math.atan2(p[1] - center[1], p[0] - center[0]) };
      } else if (handle.kind === 'vertex' && this.originals[0]?.type === 'shape') {
        this.mode = { kind: 'vertex', index: handle.index, shape: this.originals[0] };
      } else this.mode = { kind: 'move' };
      return;
    }
    this.host.clearSelection?.();
    this.mode = { kind: 'lasso' };
    this.path = [p[0], p[1]];
  }

  move(samples: Sample[]): void {
    if (!this.mode || !this.box) return;
    for (const s of samples) {
      const p = toPage(this.host, this.box, s);
      this.current = p;
      if (Math.hypot(s.sx - this.startScreen.sx, s.sy - this.startScreen.sy) > 4) this.moved = true;
      if (this.mode.kind === 'lasso') this.path.push(p[0], p[1]);
    }
    this.dirty = true;
  }

  private transform(m: Mode): Sim {
    const [x, y] = this.current;
    switch (m.kind) {
      case 'move':
        return translate(x - this.start[0], y - this.start[1]);
      case 'scale': {
        const d = Math.hypot(x - m.anchor[0], y - m.anchor[1]);
        return about(m.anchor[0], m.anchor[1], Math.max(0.05, d / m.startDist), 0);
      }
      case 'rotate': {
        let a = Math.atan2(y - m.center[1], x - m.center[0]) - m.startAngle;
        const snapped = Math.round(a / SNAP) * SNAP;
        if (Math.abs(a - snapped) < 0.06) a = snapped;
        return about(m.center[0], m.center[1], 1, a);
      }
      default:
        return IDENTITY;
    }
  }

  private transformed(m: Mode = this.mode!): Item[] {
    if (m.kind === 'vertex') {
      const v = [...m.shape.vertices];
      v[m.index * 2] = this.current[0];
      v[m.index * 2 + 1] = this.current[1];
      const next: ShapeItem = { ...m.shape, vertices: v };
      next.bbox = itemBBox(next);
      return [next];
    }
    const t = this.transform(m);
    this.host.setSelectionPreview?.(t);
    return this.originals.map((it) => transformItem(it, t));
  }

  frame(): void {
    if (!this.mode || !this.dirty || !this.box) return;
    this.dirty = false;
    const { live, camera } = this.host;
    if (this.mode.kind === 'lasso') {
      live.clear();
      const pts = this.polygon();
      if (pts.length < 4) return;
      const [ox, oy] = camera.toScreen(this.box.x, this.box.y);
      const s = camera.scale;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < pts.length; i += 2) {
        minX = Math.min(minX, pts[i]!);
        maxX = Math.max(maxX, pts[i]!);
        minY = Math.min(minY, pts[i + 1]!);
        maxY = Math.max(maxY, pts[i + 1]!);
      }
      const ctx = live.begin(ox, oy, s, {
        x: ox + minX * s - 4,
        y: oy + minY * s - 4,
        w: (maxX - minX) * s + 8,
        h: (maxY - minY) * s + 8,
      });
      ctx.beginPath();
      ctx.moveTo(pts[0]!, pts[1]!);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
      if (this.host.settings.lasso.mode === 'rect') ctx.closePath();
      ctx.lineWidth = 1.5 / s;
      ctx.setLineDash([6 / s, 4 / s]);
      ctx.strokeStyle = '#2747c9';
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(39,71,201,0.06)';
      ctx.fill();
      return;
    }
    if (!this.moved) return;
    const next = this.transformed();
    const hidden = new Set(this.originals.map((it) => it.id));
    let region = this.lastRegion;
    for (const it of [...this.originals, ...next]) region = union(region, it.bbox);
    if (region) this.host.preview(this.pageId!, hidden, next, region);
    this.lastRegion = selectionBounds(next);
  }

  private polygon(): number[] {
    if (this.host.settings.lasso.mode !== 'rect') return this.path;
    const [x0, y0] = this.start;
    const [x1, y1] = this.current;
    return [x0, y0, x1, y0, x1, y1, x0, y1];
  }

  end(): void {
    const mode = this.mode;
    const pageId = this.pageId;
    if (!mode || !pageId) return;
    this.mode = null;
    this.host.live.clear();
    if (mode.kind === 'lasso') {
      if (!this.moved) {
        this.host.clearSelection?.();
        return;
      }
      const poly = this.polygon();
      const items = (this.host.doc.getItems(pageId) ?? []).filter((it) => itemInPolygon(it, poly));
      if (items.length)
        this.host.setSelection?.(
          pageId,
          items.map((it) => it.id),
        );
      return;
    }
    this.host.setSelectionPreview?.(null);
    if (!this.moved) return;
    const next = this.transformed(mode);
    this.host.setSelectionPreview?.(null);
    const before = mode.kind === 'vertex' ? [mode.shape] : this.originals;
    this.host.doc.execute({
      label:
        mode.kind === 'move'
          ? 'Verschieben'
          : mode.kind === 'scale'
            ? 'Skalieren'
            : mode.kind === 'rotate'
              ? 'Drehen'
              : 'Form bearbeiten',
      items: before.map((b, i) => ({ before: b, after: next[i]! })),
      pages: [],
    });
    this.originals = [];
  }

  cancel(): void {
    const pageId = this.pageId;
    const region = this.lastRegion;
    const originals = this.originals;
    this.mode = null;
    this.originals = [];
    this.host.live.clear();
    this.host.setSelectionPreview?.(null);
    if (pageId && region) {
      let r: Rect | null = region;
      for (const it of originals) r = union(r, it.bbox);
      this.host.preview(pageId, new Set(), [], r!);
    }
  }
}

/** Versatz für duplizierte/eingefügte Inhalte. */
export function offsetItems(items: Item[], dx: number, dy: number): Item[] {
  const t = translate(dx, dy);
  return items.map((it) => transformItem(it, t));
}
