// Formerkennung aus einem freihändigen Strich: Linie, Pfeil, Dreieck,
// Rechteck, Polygon, Ellipse. Arbeitet nur mit x/y-Koordinaten (pt).

import type { ShapeKind } from '../../model/types';
import { distToSegmentSq } from './hit';

export interface Recognized {
  shape: ShapeKind;
  vertices: number[];
  rotation: number;
}

type P = [number, number];

function toPoints(points: ArrayLike<number>, stride: number): P[] {
  const out: P[] = [];
  for (let i = 0; i + 1 < points.length; i += stride) out.push([points[i]!, points[i + 1]!]);
  return out;
}

function dist(a: P, b: P) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function length(pts: P[]) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1]!, pts[i]!);
  return l;
}

/** Ramer-Douglas-Peucker-Vereinfachung. */
export function rdp(pts: P[], eps: number): P[] {
  if (pts.length < 3) return pts.slice();
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  let maxD = -1;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSegmentSq(pts[i]![0], pts[i]![1], a[0], a[1], b[0], b[1]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (Math.sqrt(maxD) <= eps) return [a, b];
  const left = rdp(pts.slice(0, idx + 1), eps);
  const right = rdp(pts.slice(idx), eps);
  return [...left.slice(0, -1), ...right];
}

function angleAt(prev: P, cur: P, next: P): number {
  const ax = prev[0] - cur[0];
  const ay = prev[1] - cur[1];
  const bx = next[0] - cur[0];
  const by = next[1] - cur[1];
  const d = Math.hypot(ax, ay) * Math.hypot(bx, by) || 1;
  return Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / d)));
}

function polygonArea(pts: P[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

const deg = (d: number) => (d * Math.PI) / 180;

/** Winkel nahe 0°/90° auf die Achse einrasten. */
function snapAngle(a: number): number {
  const q = Math.PI / 2;
  const r = Math.round(a / q) * q;
  return Math.abs(a - r) < deg(8) ? r : a;
}

function fitEllipse(pts: P[]): Recognized {
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p[0];
    cy += p[1];
  }
  cx /= pts.length;
  cy /= pts.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of pts) {
    sxx += (x - cx) ** 2;
    syy += (y - cy) ** 2;
    sxy += (x - cx) * (y - cy);
  }
  let angle = snapAngle(0.5 * Math.atan2(2 * sxy, sxx - syy));
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const [x, y] of pts) {
    const u = (x - cx) * c + (y - cy) * s;
    const v = -(x - cx) * s + (y - cy) * c;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const mu = (minU + maxU) / 2;
  const mv = (minV + maxV) / 2;
  const ex = cx + mu * c - mv * s;
  const ey = cy + mu * s + mv * c;
  let rx = (maxU - minU) / 2;
  let ry = (maxV - minV) / 2;
  // fast runde Ellipsen werden zum Kreis
  if (Math.abs(rx - ry) / Math.max(rx, ry) < 0.12) rx = ry = (rx + ry) / 2;
  if (rx === ry) angle = 0;
  return { shape: 'ellipse', vertices: [ex, ey, rx, ry], rotation: angle };
}

/** Mittlere relative Abweichung der Punkte von der Ellipse (0 = perfekt). */
function ellipseError(pts: P[], e: Recognized): number {
  const [cx, cy, rx, ry] = e.vertices as [number, number, number, number];
  if (!rx || !ry) return Infinity;
  const c = Math.cos(e.rotation);
  const s = Math.sin(e.rotation);
  let sum = 0;
  for (const [x, y] of pts) {
    const u = (x - cx) * c + (y - cy) * s;
    const v = -(x - cx) * s + (y - cy) * c;
    sum += Math.abs(Math.hypot(u / rx, v / ry) - 1);
  }
  return sum / pts.length;
}

function fitRect(corners: P[]): Recognized {
  const a = corners[0]!;
  const b = corners[1]!;
  const angle = snapAngle(Math.atan2(b[1] - a[1], b[0] - a[0]));
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const [x, y] of corners) {
    const u = x * c + y * s;
    const v = -x * s + y * c;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const back = (u: number, v: number): P => [u * c - v * s, u * s + v * c];
  const pts = [back(minU, minV), back(maxU, minV), back(maxU, maxV), back(minU, maxV)];
  return { shape: 'rect', vertices: pts.flat(), rotation: 0 };
}

/** Versucht, aus einem Strich eine Form zu erkennen. `null` = keine Form. */
export function recognizeShape(points: ArrayLike<number>, stride: number): Recognized | null {
  const pts = toPoints(points, stride);
  if (pts.length < 3) return null;
  const total = length(pts);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  if (total < 8 || diag < 6) return null;
  const start = pts[0]!;
  const end = pts[pts.length - 1]!;
  const closed = dist(start, end) < Math.max(diag * 0.22, 6);

  if (!closed) {
    const chord = dist(start, end);
    let maxDev = 0;
    for (const p of pts)
      maxDev = Math.max(maxDev, Math.sqrt(distToSegmentSq(p[0], p[1], start[0], start[1], end[0], end[1])));
    if (maxDev < Math.max(chord * 0.07, 2.5) && total < chord * 1.25) {
      return { shape: 'line', vertices: [...start, ...end], rotation: 0 };
    }
    // Pfeil: lange Linie und kurze Spitze, die zum Ende der Linie zurückführt
    const v = rdp(pts, diag * 0.08);
    if (v.length >= 3 && v.length <= 5) {
      const main = dist(v[0]!, v[1]!);
      const tip = v[1]!;
      const rest = length(v.slice(1));
      if (main > total * 0.5 && rest < main * 0.8 && dist(end, tip) < main * 0.4) {
        return { shape: 'arrow', vertices: [...v[0]!, ...tip], rotation: 0 };
      }
    }
    return null;
  }

  const area = polygonArea(pts);
  const circularity = (4 * Math.PI * area) / (total * total);
  let corners = rdp(pts, total * 0.035);
  if (dist(corners[0]!, corners[corners.length - 1]!) < total * 0.08) corners = corners.slice(0, -1);
  // fast gerade Zwischenpunkte entfernen (z. B. Startpunkt mitten auf einer Kante)
  let changed = true;
  while (changed && corners.length > 3) {
    changed = false;
    for (let i = 0; i < corners.length; i++) {
      const prev = corners[(i - 1 + corners.length) % corners.length]!;
      const next = corners[(i + 1) % corners.length]!;
      if (angleAt(prev, corners[i]!, next) > deg(150)) {
        corners.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  const n = corners.length;
  const ellipse = fitEllipse(pts);
  if (circularity > 0.82 || ellipseError(pts, ellipse) < 0.07 || (n > 6 && circularity > 0.68))
    return ellipse;
  if (n === 3) return { shape: 'triangle', vertices: corners.flat(), rotation: 0 };
  if (n === 4) {
    const rightish = corners.every((c, i) => {
      const a = angleAt(corners[(i + 3) % 4]!, c, corners[(i + 1) % 4]!);
      return Math.abs(a - Math.PI / 2) < deg(22);
    });
    if (rightish) return fitRect(corners);
    return { shape: 'polygon', vertices: corners.flat(), rotation: 0 };
  }
  if (n >= 5 && n <= 8) return { shape: 'polygon', vertices: corners.flat(), rotation: 0 };
  if (circularity > 0.6) return ellipse;
  return null;
}
