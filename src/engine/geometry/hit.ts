// Geometrie für Radierer, Zickzack-Löschen und gerade Linien.
// Alle Koordinaten in pt (Seitenraum).

import type { StrokeItem } from '../../model/types';
import { intersects, pointsBBox } from './rect';

export function distToSegmentSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len > 0 ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

function segmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Quadrat des Abstands zweier Strecken. */
export function segSegDistSq(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): number {
  if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(
    distToSegmentSq(ax, ay, cx, cy, dx, dy),
    distToSegmentSq(bx, by, cx, cy, dx, dy),
    distToSegmentSq(cx, cy, ax, ay, bx, by),
    distToSegmentSq(dx, dy, ax, ay, bx, by),
  );
}

/**
 * Prüft, ob ein Strich die „Kapsel“ trifft, die ein Radierer mit Radius r
 * von (ax,ay) nach (bx,by) überstreicht. Die Strichbreite zählt mit.
 */
export function strokeHitsCapsule(
  s: StrokeItem,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: number,
): boolean {
  const reach = r + s.width / 2;
  const box = {
    x: Math.min(ax, bx) - reach,
    y: Math.min(ay, by) - reach,
    w: Math.abs(bx - ax) + 2 * reach,
    h: Math.abs(by - ay) + 2 * reach,
  };
  if (!intersects(box, s.bbox)) return false;
  const p = s.points;
  const st = s.stride;
  const reachSq = reach * reach;
  if (p.length < st * 2) return segSegDistSq(p[0]!, p[1]!, p[0]!, p[1]!, ax, ay, bx, by) <= reachSq;
  for (let i = 0; i + st + 1 < p.length; i += st) {
    if (segSegDistSq(p[i]!, p[i + 1]!, p[i + st]!, p[i + st + 1]!, ax, ay, bx, by) <= reachSq) return true;
  }
  return false;
}

/** Feiner abtasten, damit der Präzisionsradierer saubere Schnittkanten erzeugt. */
export function resample(points: Float32Array, stride: number, maxStep: number): Float32Array {
  const out: number[] = [];
  const n = Math.floor(points.length / stride);
  for (let i = 0; i < n; i++) {
    const o = i * stride;
    if (i > 0) {
      const po = o - stride;
      const dx = points[o]! - points[po]!;
      const dy = points[o + 1]! - points[po + 1]!;
      const steps = Math.floor(Math.hypot(dx, dy) / maxStep);
      for (let k = 1; k <= steps; k++) {
        const t = k / (steps + 1);
        for (let c = 0; c < stride; c++) out.push(points[po + c]! + (points[o + c]! - points[po + c]!) * t);
      }
    }
    for (let c = 0; c < stride; c++) out.push(points[o + c]!);
  }
  return new Float32Array(out);
}

/**
 * Präzisionsradierer: entfernt die Punkte innerhalb der Kapsel und gibt die
 * verbleibenden Teilstücke zurück. `null` = Strich nicht getroffen,
 * leeres Array = Strich komplett gelöscht.
 */
export function eraseFromStroke(
  s: StrokeItem,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: number,
): Float32Array[] | null {
  if (!strokeHitsCapsule(s, ax, ay, bx, by, r)) return null;
  const st = s.stride;
  const fine = resample(s.points, st, Math.max(0.25, r * 0.4));
  const cut = r + s.width * 0.35;
  const cutSq = cut * cut;
  const pieces: Float32Array[] = [];
  let run: number[] = [];
  let removed = false;
  for (let i = 0; i + 1 < fine.length; i += st) {
    const inside = distToSegmentSq(fine[i]!, fine[i + 1]!, ax, ay, bx, by) <= cutSq;
    if (inside) {
      removed = true;
      if (run.length >= st * 2) pieces.push(new Float32Array(run));
      run = [];
    } else {
      for (let c = 0; c < st; c++) run.push(fine[i + c]!);
    }
  }
  if (run.length >= st * 2) pieces.push(new Float32Array(run));
  if (!removed) return null;
  // Die Zeit-Spalte (dt) bleibt relativ zu t0 erhalten, Audio-Sync funktioniert weiter.
  return pieces;
}

/** Länge eines Linienzugs. */
export function pathLength(points: ArrayLike<number>, stride: number): number {
  let len = 0;
  for (let i = stride; i + 1 < points.length; i += stride) {
    len += Math.hypot(points[i]! - points[i - stride]!, points[i + 1]! - points[i + 1 - stride]!);
  }
  return len;
}

/**
 * Erkennt eine Zickzack-Kritzelei (mindestens 4 Richtungswechsel entlang
 * der Hauptachse mit deutlicher Amplitude).
 */
export function isZigzag(points: ArrayLike<number>, stride: number): boolean {
  const n = Math.floor(points.length / stride);
  if (n < 8) return false;
  const box = pointsBBox(points, stride, 0);
  const horizontal = box.w >= box.h;
  const extent = horizontal ? box.w : box.h;
  if (extent < 6) return false;
  const len = pathLength(points, stride);
  if (len < extent * 3) return false;
  const axis = horizontal ? 0 : 1;
  const hysteresis = Math.max(3, extent * 0.3);
  let reversals = 0;
  let dir = 0;
  let ext = points[axis]!;
  for (let i = 1; i < n; i++) {
    const v = points[i * stride + axis]!;
    if (dir === 0) {
      if (v - ext > hysteresis) {
        dir = 1;
        ext = v;
      } else if (ext - v > hysteresis) {
        dir = -1;
        ext = v;
      }
    } else if (dir === 1) {
      if (v > ext) ext = v;
      else if (ext - v > hysteresis) {
        reversals++;
        dir = -1;
        ext = v;
      }
    } else {
      if (v < ext) ext = v;
      else if (v - ext > hysteresis) {
        reversals++;
        dir = 1;
        ext = v;
      }
    }
  }
  return reversals >= 4;
}

/** Striche, die von einer Zickzack-Geste überdeckt werden. */
export function zigzagTargets(
  zig: ArrayLike<number>,
  stride: number,
  zigWidth: number,
  strokes: StrokeItem[],
): StrokeItem[] {
  const box = pointsBBox(zig, stride, 2);
  const out: StrokeItem[] = [];
  for (const s of strokes) {
    if (!intersects(box, s.bbox)) continue;
    const st = s.stride;
    const total = Math.floor(s.points.length / st);
    let inside = 0;
    for (let i = 0; i < s.points.length; i += st) {
      const x = s.points[i]!;
      const y = s.points[i + 1]!;
      if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) inside++;
    }
    if (inside / total < 0.6) continue;
    // Die Kritzelei muss den Strich auch tatsächlich berühren.
    const r = zigWidth / 2 + 1.5;
    let touched = false;
    for (let i = 0; i + stride + 1 < zig.length && !touched; i += stride) {
      touched = strokeHitsCapsule(s, zig[i]!, zig[i + 1]!, zig[i + stride]!, zig[i + stride + 1]!, r);
    }
    if (touched) out.push(s);
  }
  return out;
}

/**
 * Endpunkt einer geraden Linie, auf Vielfache von 45° eingerastet,
 * wenn der Winkel höchstens `snapDeg` davon abweicht.
 */
export function snapLineEnd(x0: number, y0: number, x1: number, y1: number, snapDeg = 4): [number, number] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return [x1, y1];
  const angle = Math.atan2(dy, dx);
  const step = Math.PI / 4;
  const snapped = Math.round(angle / step) * step;
  if (Math.abs(angle - snapped) <= (snapDeg * Math.PI) / 180) {
    return [x0 + Math.cos(snapped) * len, y0 + Math.sin(snapped) * len];
  }
  return [x1, y1];
}

// ---------- Welliges Durchstreichen ----------

export interface WavyStrike {
  /** Startpunkt und Richtung (Einheitsvektor) der Durchstreichung */
  ox: number;
  oy: number;
  ux: number;
  uy: number;
  /** Ausdehnung entlang der Richtung (t) und quer dazu (d) */
  minT: number;
  maxT: number;
  minD: number;
  maxD: number;
}

/**
 * Erkennt eine wellige Linie, mit der Text durchgestrichen wird: läuft
 * überwiegend in eine Richtung und schwingt mindestens vier Mal quer dazu,
 * mit kleiner Amplitude im Verhältnis zur Länge.
 */
export function wavyStrike(points: ArrayLike<number>, stride: number): WavyStrike | null {
  const n = Math.floor(points.length / stride);
  if (n < 10) return null;
  const ox = points[0]!;
  const oy = points[1]!;
  const ex = points[(n - 1) * stride]!;
  const ey = points[(n - 1) * stride + 1]!;
  const L = Math.hypot(ex - ox, ey - oy);
  if (L < 24) return null;
  const ux = (ex - ox) / L;
  const uy = (ey - oy) / L;
  let minT = Infinity;
  let maxT = -Infinity;
  let minD = Infinity;
  let maxD = -Infinity;
  let backtrack = 0;
  let prevT = 0;
  const ds: number[] = [];
  for (let i = 0; i < n; i++) {
    const dx = points[i * stride]! - ox;
    const dy = points[i * stride + 1]! - oy;
    const t = dx * ux + dy * uy;
    const d = -dx * uy + dy * ux;
    if (i > 0 && t < prevT) backtrack += prevT - t;
    prevT = t;
    minT = Math.min(minT, t);
    maxT = Math.max(maxT, t);
    minD = Math.min(minD, d);
    maxD = Math.max(maxD, d);
    ds.push(d);
  }
  const amplitude = (maxD - minD) / 2;
  // vorwärts laufend, flache Welle, aber deutlich gewellt
  if (backtrack > L * 0.15 || amplitude < 1.5 || amplitude > L * 0.2) return null;
  if (pathLength(points, stride) < L * 1.06) return null;
  const hysteresis = Math.max(1, amplitude * 0.5);
  let reversals = 0;
  let dir = 0;
  let ext = ds[0]!;
  for (const d of ds) {
    if (dir === 0) {
      if (d - ext > hysteresis) [dir, ext] = [1, d];
      else if (ext - d > hysteresis) [dir, ext] = [-1, d];
    } else if (dir === 1) {
      if (d > ext) ext = d;
      else if (ext - d > hysteresis) [reversals, dir, ext] = [reversals + 1, -1, d];
    } else {
      if (d < ext) ext = d;
      else if (d - ext > hysteresis) [reversals, dir, ext] = [reversals + 1, 1, d];
    }
  }
  if (reversals < 4) return null;
  return { ox, oy, ux, uy, minT, maxT, minD, maxD };
}

/** Elemente, die von einer welligen Durchstreichung getroffen werden. */
export function wavyTargets<T extends { type: string; bbox: { x: number; y: number; w: number; h: number } }>(
  wave: WavyStrike,
  zig: ArrayLike<number>,
  stride: number,
  zigWidth: number,
  items: readonly T[],
): T[] {
  const out: T[] = [];
  const project = (x: number, y: number) => {
    const dx = x - wave.ox;
    const dy = y - wave.oy;
    return [dx * wave.ux + dy * wave.uy, -dx * wave.uy + dy * wave.ux] as const;
  };
  for (const it of items) {
    if (it.type !== 'stroke' && it.type !== 'text') continue;
    const b = it.bbox;
    // Ecken der Box in das Koordinatensystem der Welle
    let t0 = Infinity;
    let t1 = -Infinity;
    let d0 = Infinity;
    let d1 = -Infinity;
    for (const [x, y] of [
      [b.x, b.y],
      [b.x + b.w, b.y],
      [b.x, b.y + b.h],
      [b.x + b.w, b.y + b.h],
    ] as const) {
      const [t, d] = project(x, y);
      t0 = Math.min(t0, t);
      t1 = Math.max(t1, t);
      d0 = Math.min(d0, d);
      d1 = Math.max(d1, d);
    }
    // Größtenteils innerhalb der Länge der Welle …
    const overlapT = Math.min(t1, wave.maxT + 2) - Math.max(t0, wave.minT - 2);
    if (overlapT < (t1 - t0) * 0.7) continue;
    // … und die Welle läuft quer durch das Element
    if (d1 < wave.minD || d0 > wave.maxD) continue;
    if (it.type === 'stroke') {
      const s = it as unknown as StrokeItem;
      let touched = false;
      for (let i = 0; i + stride + 1 < zig.length && !touched; i += stride) {
        touched = strokeHitsCapsule(
          s,
          zig[i]!,
          zig[i + 1]!,
          zig[i + stride]!,
          zig[i + stride + 1]!,
          zigWidth / 2 + 1.5,
        );
      }
      if (!touched) continue;
    }
    out.push(it);
  }
  return out;
}
