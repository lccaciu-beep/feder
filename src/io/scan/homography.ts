// Perspektivische Entzerrung: Homographie aus vier Punktpaaren und
// pixelgenaues Umrechnen eines Vierecks in ein Rechteck.

export type Quad = [[number, number], [number, number], [number, number], [number, number]];

/** 3×3-Matrix (zeilenweise), h[8] = 1 */
export type H = number[];

/** Löst A·x = b per Gauß-Elimination mit Pivotsuche. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    if (Math.abs(M[p]![c]!) < 1e-12) throw new Error('Die Eckpunkte liegen auf einer Linie.');
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

/** Homographie, die `from[i]` auf `to[i]` abbildet. */
export function homography(from: Quad, to: Quad): H {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i]!;
    const [u, v] = to[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  return [...solve(A, b), 1];
}

export function project(h: H, x: number, y: number): [number, number] {
  const w = h[6]! * x + h[7]! * y + h[8]!;
  return [(h[0]! * x + h[1]! * y + h[2]!) / w, (h[3]! * x + h[4]! * y + h[5]!) / w];
}

/** Sinnvolle Zielgröße aus den Kantenlängen des Vierecks (Reihenfolge: oben links, oben rechts, unten rechts, unten links). */
export function targetSize(q: Quad): { width: number; height: number } {
  const d = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const width = Math.max(d(q[0], q[1]), d(q[3], q[2]));
  const height = Math.max(d(q[0], q[3]), d(q[1], q[2]));
  return { width: Math.round(width), height: Math.round(height) };
}

export type ScanFilter = 'color' | 'gray' | 'bw';

/**
 * Entzerrt das Viereck `quad` aus `src` (RGBA) in ein Rechteck der Größe
 * width×height (bilineare Abtastung) und wendet optional einen Filter an.
 */
export function warp(
  src: { data: Uint8ClampedArray; width: number; height: number },
  quad: Quad,
  width: number,
  height: number,
  filter: ScanFilter = 'color',
): Uint8ClampedArray {
  const rect: Quad = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
  const h = homography(rect, quad);
  const out = new Uint8ClampedArray(width * height * 4);
  const sw = src.width;
  const sh = src.height;
  const s = src.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [fx, fy] = project(h, x + 0.5, y + 0.5);
      const x0 = Math.max(0, Math.min(sw - 2, Math.floor(fx - 0.5)));
      const y0 = Math.max(0, Math.min(sh - 2, Math.floor(fy - 0.5)));
      const ax = Math.max(0, Math.min(1, fx - 0.5 - x0));
      const ay = Math.max(0, Math.min(1, fy - 0.5 - y0));
      const i00 = (y0 * sw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = s[i00 + c]! * (1 - ax) + s[i10 + c]! * ax;
        const bottom = s[i01 + c]! * (1 - ax) + s[i11 + c]! * ax;
        out[o + c] = top * (1 - ay) + bottom * ay;
      }
      out[o + 3] = 255;
    }
  }
  if (filter !== 'color') applyFilter(out, width, height, filter);
  return out;
}

/** Graustufen bzw. kontrastreiches Schwarzweiß (lokaler Schwellwert für ungleichmäßiges Licht). */
function applyFilter(px: Uint8ClampedArray, width: number, height: number, filter: ScanFilter) {
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++)
    gray[i] = px[i * 4]! * 0.299 + px[i * 4 + 1]! * 0.587 + px[i * 4 + 2]! * 0.114;
  if (filter === 'gray') {
    for (let i = 0; i < gray.length; i++) px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = gray[i]!;
    return;
  }
  // Integralbild für schnellen Mittelwert in einem Fenster
  const integ = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += gray[y * width + x]!;
      integ[(y + 1) * (width + 1) + x + 1] = integ[y * (width + 1) + x + 1]! + row;
    }
  }
  const r = Math.max(8, Math.round(Math.min(width, height) / 24));
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(height, y + r + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width, x + r + 1);
      const sum =
        integ[y1 * (width + 1) + x1]! -
        integ[y0 * (width + 1) + x1]! -
        integ[y1 * (width + 1) + x0]! +
        integ[y0 * (width + 1) + x0]!;
      const mean = sum / ((x1 - x0) * (y1 - y0));
      const v = gray[y * width + x]! < mean * 0.88 ? 0 : 255;
      const o = (y * width + x) * 4;
      px[o] = px[o + 1] = px[o + 2] = v;
    }
  }
}
