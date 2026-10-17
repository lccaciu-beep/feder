// Ähnlichkeitstransformationen (Verschieben, gleichmäßig Skalieren, Drehen)
// für alle Elementtypen sowie Bounding Boxes und Treffertests.

import type { Item, Rect, ShapeItem, StrokeItem, TapeItem } from '../../model/types';
import { pointsBBox, rectFromBounds } from './rect';
import { distToSegmentSq } from './hit';

/** x' = a·x − b·y + tx,  y' = b·x + a·y + ty  (a = s·cos θ, b = s·sin θ) */
export interface Sim {
  a: number;
  b: number;
  tx: number;
  ty: number;
}

export const IDENTITY: Sim = { a: 1, b: 0, tx: 0, ty: 0 };

export function translate(dx: number, dy: number): Sim {
  return { a: 1, b: 0, tx: dx, ty: dy };
}

/** Skalieren um `scale` und Drehen um `angle` um den Punkt (cx, cy). */
export function about(cx: number, cy: number, scale: number, angle: number): Sim {
  const a = scale * Math.cos(angle);
  const b = scale * Math.sin(angle);
  return { a, b, tx: cx - a * cx + b * cy, ty: cy - b * cx - a * cy };
}

/** Erst `n`, dann `m`. */
export function chain(n: Sim, m: Sim): Sim {
  return {
    a: m.a * n.a - m.b * n.b,
    b: m.b * n.a + m.a * n.b,
    tx: m.a * n.tx - m.b * n.ty + m.tx,
    ty: m.b * n.tx + m.a * n.ty + m.ty,
  };
}

export function applyTo(t: Sim, x: number, y: number): [number, number] {
  return [t.a * x - t.b * y + t.tx, t.b * x + t.a * y + t.ty];
}

export const simScale = (t: Sim) => Math.hypot(t.a, t.b);
export const simAngle = (t: Sim) => Math.atan2(t.b, t.a);

function rotatedCorners(box: Rect, rotation: number): number[] {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const out: number[] = [];
  for (const [x, y] of [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x + box.w, box.y + box.h],
    [box.x, box.y + box.h],
  ] as const) {
    const dx = x - cx;
    const dy = y - cy;
    out.push(cx + dx * c - dy * s, cy + dx * s + dy * c);
  }
  return out;
}

function shapeBBox(s: ShapeItem): Rect {
  const pad = s.width / 2 + 1;
  if (s.shape === 'ellipse') {
    const [cx, cy, rx, ry] = s.vertices as [number, number, number, number];
    const c = Math.cos(s.rotation);
    const sn = Math.sin(s.rotation);
    const hx = Math.sqrt(rx * rx * c * c + ry * ry * sn * sn);
    const hy = Math.sqrt(rx * rx * sn * sn + ry * ry * c * c);
    return rectFromBounds(cx - hx - pad, cy - hy - pad, cx + hx + pad, cy + hy + pad);
  }
  const extra = s.shape === 'arrow' ? Math.max(8, s.width * 5) : 0;
  return pointsBBox(s.vertices, 2, pad + extra);
}

export function tapeCorners(t: TapeItem): number[] {
  const [x0, y0, x1, y1] = t.path as [number, number, number, number];
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = (-(y1 - y0) / len) * (t.width / 2);
  const ny = ((x1 - x0) / len) * (t.width / 2);
  return [x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny];
}

/** Achsenparallele Bounding Box eines Elements. */
export function itemBBox(it: Item): Rect {
  switch (it.type) {
    case 'stroke':
      return pointsBBox(it.points, it.stride, it.width * (it.tool === 'pencil' ? 2.2 : 0.75) + 1);
    case 'shape':
      return shapeBBox(it);
    case 'text':
    case 'image':
      return pointsBBox(rotatedCorners(it.box, it.rotation), 2, 1);
    case 'tape':
      return pointsBBox(tapeCorners(it), 2, 1);
    case 'link':
      return it.bbox;
  }
}

/** Wendet eine Ähnlichkeitstransformation an (ID bleibt gleich). */
export function transformItem<T extends Item>(it: T, t: Sim): T {
  const s = simScale(t);
  const ang = simAngle(t);
  const mapFlat = (v: readonly number[]) => {
    const out: number[] = [];
    for (let i = 0; i + 1 < v.length; i += 2) out.push(...applyTo(t, v[i]!, v[i + 1]!));
    return out;
  };
  const mapBox = (box: Rect): Rect => {
    const [cx, cy] = applyTo(t, box.x + box.w / 2, box.y + box.h / 2);
    const w = box.w * s;
    const h = box.h * s;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  };
  let next: Item;
  switch (it.type) {
    case 'stroke': {
      const src = it.points;
      const pts = new Float32Array(src.length);
      for (let i = 0; i < src.length; i += it.stride) {
        const [x, y] = applyTo(t, src[i]!, src[i + 1]!);
        pts[i] = x;
        pts[i + 1] = y;
        for (let c = 2; c < it.stride; c++) pts[i + c] = src[i + c]!;
        if (it.stride === 6) pts[i + 4] = src[i + 4]! + ang;
      }
      next = { ...it, points: pts, width: it.width * s } satisfies StrokeItem;
      break;
    }
    case 'shape':
      if (it.shape === 'ellipse') {
        const [cx, cy, rx, ry] = it.vertices as [number, number, number, number];
        const [nx, ny] = applyTo(t, cx, cy);
        next = {
          ...it,
          vertices: [nx, ny, rx * s, ry * s],
          rotation: it.rotation + ang,
          width: it.width * s,
        };
      } else next = { ...it, vertices: mapFlat(it.vertices), width: it.width * s };
      break;
    case 'text':
      next = {
        ...it,
        box: mapBox(it.box),
        rotation: it.rotation + ang,
        style: { ...it.style, size: it.style.size * s },
      };
      break;
    case 'image':
      next = { ...it, box: mapBox(it.box), rotation: it.rotation + ang };
      break;
    case 'tape':
      next = { ...it, path: mapFlat(it.path), width: it.width * s };
      break;
    case 'link':
      next = { ...it, bbox: mapBox(it.bbox) };
      break;
  }
  next.bbox = itemBBox(next);
  return next as T;
}

// ---------- Treffer ----------

export function pointInPolygon(x: number, y: number, poly: ArrayLike<number>): boolean {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2]!;
    const yi = poly[i * 2 + 1]!;
    const xj = poly[j * 2]!;
    const yj = poly[j * 2 + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Liegt ein Element in der Lasso-Fläche? Striche: Mehrheit der Punkte, sonst Mittelpunkt. */
export function itemInPolygon(it: Item, poly: ArrayLike<number>): boolean {
  if (it.type === 'stroke') {
    const n = Math.floor(it.points.length / it.stride);
    const step = Math.max(1, Math.floor(n / 40));
    let inside = 0;
    let total = 0;
    for (let i = 0; i < n; i += step) {
      total++;
      if (pointInPolygon(it.points[i * it.stride]!, it.points[i * it.stride + 1]!, poly)) inside++;
    }
    return total > 0 && inside / total >= 0.5;
  }
  const b = it.bbox;
  return pointInPolygon(b.x + b.w / 2, b.y + b.h / 2, poly);
}

/** Trifft der Punkt (x, y) das Element (Toleranz `tol` in pt)? */
export function itemHitPoint(it: Item, x: number, y: number, tol: number): boolean {
  const b = it.bbox;
  if (x < b.x - tol || x > b.x + b.w + tol || y < b.y - tol || y > b.y + b.h + tol) return false;
  switch (it.type) {
    case 'stroke': {
      const r = (tol + it.width / 2) ** 2;
      const p = it.points;
      const st = it.stride;
      if (p.length < st * 2) return distToSegmentSq(x, y, p[0]!, p[1]!, p[0]!, p[1]!) <= r;
      for (let i = 0; i + st + 1 < p.length; i += st) {
        if (distToSegmentSq(x, y, p[i]!, p[i + 1]!, p[i + st]!, p[i + st + 1]!) <= r) return true;
      }
      return false;
    }
    case 'text':
    case 'image':
      return pointInPolygon(x, y, rotatedCorners(it.box, it.rotation));
    case 'tape':
      return pointInPolygon(x, y, tapeCorners(it));
    default:
      return true;
  }
}

export function boxCorners(box: Rect, rotation: number): number[] {
  return rotatedCorners(box, rotation);
}
