import type { Rect } from '../../model/types';

export function rectFromBounds(minX: number, minY: number, maxX: number, maxY: number): Rect {
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

export function intersection(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x0 && y1 > y0 ? rectFromBounds(x0, y0, x1, y1) : null;
}

export function union(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b };
  return rectFromBounds(
    Math.min(a.x, b.x),
    Math.min(a.y, b.y),
    Math.max(a.x + a.w, b.x + b.w),
    Math.max(a.y + a.h, b.y + b.h),
  );
}

export function expand(r: Rect, d: number): Rect {
  return { x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d };
}

export function containsPoint(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** Bounding Box verschachtelter Punktdaten, erweitert um `pad`. */
export function pointsBBox(points: ArrayLike<number>, stride: number, pad: number): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < points.length; i += stride) {
    const x = points[i]!;
    const y = points[i + 1]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (minX === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return rectFromBounds(minX - pad, minY - pad, maxX + pad, maxY + pad);
}
