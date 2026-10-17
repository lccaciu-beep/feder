// Strich-Darstellung: perfect-freehand-Optionen pro Werkzeug, Umriss-Pfade
// (gecacht), Bleistift-Körnung und gestrichelte Linien.

import { getStroke, type StrokeOptions } from 'perfect-freehand';
import type { DashStyle, InkTool, Item, PressureMode, StrokeItem } from '../../model/types';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const BASE: Record<InkTool, StrokeOptions> = {
  fountain: { thinning: 0.62, smoothing: 0.6, streamline: 0.42 },
  ballpoint: { thinning: 0.18, smoothing: 0.5, streamline: 0.45 },
  brush: { thinning: 0.88, smoothing: 0.65, streamline: 0.4 },
  pencil: { thinning: 0.35, smoothing: 0.5, streamline: 0.42 },
  highlighter: { thinning: 0, smoothing: 0.6, streamline: 0.55 },
};

export interface InkStyle {
  tool: InkTool;
  width: number;
  pressureMode: PressureMode;
  stride: number;
  dash: DashStyle;
}

export function strokeOptions(style: InkStyle, last: boolean): StrokeOptions {
  const base = BASE[style.tool];
  const opts: StrokeOptions = { ...base, size: style.width, simulatePressure: false, last };
  if (style.tool === 'brush') {
    opts.start = { taper: style.width * 4, cap: true };
    opts.end = { taper: style.width * 6, cap: true };
  }
  return opts;
}

/** Weiche Druckkurve: leichter Druck ergibt schon sichtbare Breite. */
export function mapPressure(p: number): number {
  const c = p < 0 ? 0 : p > 1 ? 1 : p;
  return 1 - Math.pow(1 - c, 1.8);
}

/** Bleistift wird bei flach gehaltenem Stift breiter. */
export function tiltFactor(altitude: number): number {
  const flat = 1 - Math.min(1, Math.max(0, altitude / (Math.PI / 2)));
  return flat > 0.35 ? 1 + (flat - 0.35) * 2.2 : 1;
}

/** Wandelt verschachtelte Punktdaten in perfect-freehand-Eingabe um. */
export function toFreehandInput(points: ArrayLike<number>, style: InkStyle, extra?: number[][]): number[][] {
  const st = style.stride;
  const out: number[][] = [];
  const pencilTilt = style.tool === 'pencil' && st >= 6;
  for (let i = 0; i + 2 < points.length; i += st) {
    out.push([points[i]!, points[i + 1]!, pressureAt(points, i, style, pencilTilt)]);
  }
  if (extra) out.push(...extra);
  return out;
}

function pressureAt(points: ArrayLike<number>, i: number, style: InkStyle, pencilTilt: boolean): number {
  let p: number;
  if (style.pressureMode === 'none' || style.tool === 'highlighter') p = 0.5;
  else if (style.pressureMode === 'real') p = mapPressure(points[i + 2]!);
  else p = points[i + 2]!;
  if (pencilTilt) p *= tiltFactor(points[i + 5]!);
  return p;
}

/** Umriss als Path2D (quadratische Glättung zwischen den Umrisspunkten). */
export function outlineToPath(outline: number[][]): Path2D {
  const path = new Path2D();
  const n = outline.length;
  if (n < 2) return path;
  const [x0, y0] = outline[0]!;
  path.moveTo(x0!, y0!);
  for (let i = 1; i < n; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % n]!;
    path.quadraticCurveTo(a[0]!, a[1]!, (a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2);
  }
  path.closePath();
  return path;
}

/** Mittellinie (für gestrichelte und gepunktete Striche). */
export function centerlinePath(points: ArrayLike<number>, stride: number): Path2D {
  const path = new Path2D();
  const n = Math.floor(points.length / stride);
  if (!n) return path;
  path.moveTo(points[0]!, points[1]!);
  if (n === 1) {
    path.lineTo(points[0]! + 0.01, points[1]!);
    return path;
  }
  for (let i = 1; i < n - 1; i++) {
    const o = i * stride;
    const mx = (points[o]! + points[o + stride]!) / 2;
    const my = (points[o + 1]! + points[o + stride + 1]!) / 2;
    path.quadraticCurveTo(points[o]!, points[o + 1]!, mx, my);
  }
  const lo = (n - 1) * stride;
  path.lineTo(points[lo]!, points[lo + 1]!);
  return path;
}

export function dashPattern(dash: DashStyle, width: number): number[] {
  if (dash === 'dashed') return [width * 3.2, width * 2.4];
  if (dash === 'dotted') return [0.001, width * 2.2];
  return [];
}

const pathCache = new WeakMap<StrokeItem, Path2D>();

export function strokePath(item: StrokeItem): Path2D {
  let p = pathCache.get(item);
  if (!p) {
    p =
      item.dash === 'solid'
        ? outlineToPath(getStroke(toFreehandInput(item.points, item), strokeOptions(item, true)))
        : centerlinePath(item.points, item.stride);
    pathCache.set(item, p);
  }
  return p;
}

// ---------- Bleistift-Körnung ----------

const grainCache = new Map<string, CanvasPattern | string>();
let grainNoise: HTMLCanvasElement | null = null;

function noiseCanvas(): HTMLCanvasElement {
  if (grainNoise) return grainNoise;
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  // deterministisches Rauschen, damit Striche bei jedem Neuzeichnen gleich aussehen
  let seed = 1337;
  for (let i = 0; i < size * size; i++) {
    seed = (seed * 16807) % 2147483647;
    const a = 150 + (seed % 106);
    img.data[i * 4 + 3] = a;
  }
  g.putImageData(img, 0, 0);
  grainNoise = c;
  return c;
}

function pencilFill(ctx: Ctx, color: string): CanvasPattern | string {
  const cached = grainCache.get(color);
  if (cached) return cached;
  try {
    const noise = noiseCanvas();
    const c = document.createElement('canvas');
    c.width = noise.width;
    c.height = noise.height;
    const g = c.getContext('2d')!;
    g.drawImage(noise, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    const pattern = ctx.createPattern(c, 'repeat') ?? color;
    if (typeof pattern !== 'string') pattern.setTransform(new DOMMatrix().scale(0.25));
    grainCache.set(color, pattern);
    return pattern;
  } catch {
    return color;
  }
}

// ---------- Zeichnen ----------

export function applyInkStyle(ctx: Ctx, s: StrokeItem): void {
  ctx.globalAlpha = s.opacity;
  if (s.dash !== 'solid') {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash(dashPattern(s.dash, s.width));
  } else {
    ctx.fillStyle = s.tool === 'pencil' ? pencilFill(ctx, s.color) : s.color;
  }
}

export function drawStroke(ctx: Ctx, s: StrokeItem): void {
  const path = strokePath(s);
  applyInkStyle(ctx, s);
  if (s.dash !== 'solid') {
    ctx.stroke(path);
    ctx.setLineDash([]);
  } else {
    ctx.fill(path);
  }
  ctx.globalAlpha = 1;
}

/** Zeichnet Inhalte in der richtigen Reihenfolge: Textmarker zuerst, darüber die Tinte. */
export function drawItems(ctx: Ctx, items: readonly Item[], filter?: (it: Item) => boolean): void {
  for (const it of items) {
    if (it.type === 'stroke' && it.tool === 'highlighter' && (!filter || filter(it))) drawStroke(ctx, it);
  }
  for (const it of items) {
    if (filter && !filter(it)) continue;
    if (it.type === 'stroke' && it.tool !== 'highlighter') drawStroke(ctx, it);
  }
}

export function isHighlighter(it: Item): boolean {
  return it.type === 'stroke' && it.tool === 'highlighter';
}

// ---------- SVG-Pfade (für den PDF-Export) ----------

const f = (n: number) => (Math.round(n * 100) / 100).toString();

/** Umriss als SVG-Pfad – dieselbe Glättung wie outlineToPath. */
export function outlineToSvg(outline: number[][]): string {
  const n = outline.length;
  if (n < 2) return '';
  const parts = [`M${f(outline[0]![0]!)} ${f(outline[0]![1]!)}`];
  for (let i = 1; i < n; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % n]!;
    parts.push(`Q${f(a[0]!)} ${f(a[1]!)} ${f((a[0]! + b[0]!) / 2)} ${f((a[1]! + b[1]!) / 2)}`);
  }
  return parts.join('') + 'Z';
}

/** Mittellinie als SVG-Pfad (gestrichelte/gepunktete Striche). */
export function centerlineSvg(points: ArrayLike<number>, stride: number): string {
  const n = Math.floor(points.length / stride);
  if (!n) return '';
  const parts = [`M${f(points[0]!)} ${f(points[1]!)}`];
  if (n === 1) return parts[0] + `L${f(points[0]! + 0.01)} ${f(points[1]!)}`;
  for (let i = 1; i < n - 1; i++) {
    const o = i * stride;
    parts.push(
      `Q${f(points[o]!)} ${f(points[o + 1]!)} ${f((points[o]! + points[o + stride]!) / 2)} ${f((points[o + 1]! + points[o + stride + 1]!) / 2)}`,
    );
  }
  const lo = (n - 1) * stride;
  parts.push(`L${f(points[lo]!)} ${f(points[lo + 1]!)}`);
  return parts.join('');
}

/** SVG-Pfad eines Strichs: Umriss (gefüllt) oder Mittellinie (gestrichelt). */
export function strokeSvg(item: StrokeItem): string {
  return item.dash === 'solid'
    ? outlineToSvg(getStroke(toFreehandInput(item.points, item), strokeOptions(item, true)))
    : centerlineSvg(item.points, item.stride);
}
