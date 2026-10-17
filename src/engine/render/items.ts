// Zeichnet alle Elementtypen in Seitenkoordinaten: Striche, Formen, Text,
// Bilder und Tape. Reihenfolge: Textmarker zuerst, dann alles andere nach z.

import type {
  FontFamily,
  ImageItem,
  Item,
  Rect,
  ShapeItem,
  TapeItem,
  TextItem,
  TextStyle,
} from '../../model/types';
import { getBlobStore } from '../../storage/blobstore';
import { dashPattern, drawStroke } from '../ink/brushes';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// ---------- Schriften & Textumbruch ----------

export const FONT_STACKS: Record<FontFamily, string> = {
  sans: '"Avenir Next", "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'Menlo, Consolas, "Courier New", monospace',
  hand: 'Noteworthy, "Bradley Hand", "Segoe Print", cursive',
};

export const FONT_LABELS: Record<FontFamily, string> = {
  sans: 'Sans',
  serif: 'Serif',
  mono: 'Mono',
  hand: 'Handschrift',
};

export function cssFont(style: TextStyle, size = style.size): string {
  return `${style.italic ? 'italic ' : ''}${style.bold ? '700 ' : '400 '}${size}px ${FONT_STACKS[style.font]}`;
}

export const LINE_HEIGHT = 1.3;

let measureCtx: CanvasRenderingContext2D | null = null;
function measurer(): CanvasRenderingContext2D | null {
  if (measureCtx) return measureCtx;
  if (typeof document === 'undefined') return null;
  measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

/** Bricht Text in Zeilen um, die in `width` passen (Absätze bleiben erhalten). */
export function wrapText(text: string, style: TextStyle, width: number): string[] {
  const ctx = measurer();
  const measure = (s: string) => (ctx ? ctx.measureText(s).width : s.length * style.size * 0.55);
  if (ctx) ctx.font = cssFont(style);
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const next = line + w;
      if (line && measure(next.trimEnd()) > width) {
        lines.push(line.trimEnd());
        line = w.trimStart();
        // einzelnes überlanges Wort hart umbrechen
        while (measure(line) > width && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && measure(line.slice(0, cut)) > width) cut--;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      } else line = next;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/** Höhe, die ein Textfeld bei gegebener Breite braucht. */
export function textHeight(text: string, style: TextStyle, width: number): number {
  return Math.max(1, wrapText(text, style, width).length) * style.size * LINE_HEIGHT + 4;
}

// ---------- Bilder ----------

const images = new Map<string, ImageBitmap | HTMLImageElement | 'loading' | 'error'>();
const imageListeners = new Set<(blobId: string) => void>();

/** Benachrichtigt, sobald ein Bild geladen ist (Seiten müssen dann neu zeichnen). */
export function onImageLoaded(cb: (blobId: string) => void): () => void {
  imageListeners.add(cb);
  return () => imageListeners.delete(cb);
}

export function getImage(blobId: string): ImageBitmap | HTMLImageElement | null {
  const v = images.get(blobId);
  if (v && v !== 'loading' && v !== 'error') return v;
  if (!v) {
    images.set(blobId, 'loading');
    void (async () => {
      try {
        const blob = await (await getBlobStore()).get(blobId);
        if (!blob) throw new Error('fehlt');
        const bmp = await decode(blob);
        images.set(blobId, bmp);
        for (const l of imageListeners) l(blobId);
      } catch {
        images.set(blobId, 'error');
      }
    })();
  }
  return null;
}

/** Lädt ein Bild vorab (z. B. für Export) und wartet darauf. */
export async function loadImage(blobId: string): Promise<ImageBitmap | HTMLImageElement | null> {
  const have = getImage(blobId);
  if (have) return have;
  for (let i = 0; i < 200; i++) {
    await new Promise((r) => setTimeout(r, 25));
    const v = images.get(blobId);
    if (v === 'error') return null;
    if (v && v !== 'loading') return v;
  }
  return null;
}

async function decode(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      /* Fallback unten */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// ---------- Zeichnen ----------

function withRotation(ctx: Ctx, box: Rect, rotation: number, draw: () => void) {
  ctx.save();
  if (rotation) {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    ctx.translate(cx, cy);
    ctx.rotate(rotation);
    ctx.translate(-cx, -cy);
  }
  draw();
  ctx.restore();
}

export function shapePath(s: ShapeItem): Path2D {
  const p = new Path2D();
  const v = s.vertices;
  switch (s.shape) {
    case 'line':
      p.moveTo(v[0]!, v[1]!);
      p.lineTo(v[2]!, v[3]!);
      break;
    case 'arrow': {
      const [x0, y0, x1, y1] = v as [number, number, number, number];
      p.moveTo(x0, y0);
      p.lineTo(x1, y1);
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const head = Math.min(Math.hypot(x1 - x0, y1 - y0) * 0.4, Math.max(8, s.width * 5));
      for (const d of [Math.PI * 0.82, -Math.PI * 0.82]) {
        p.moveTo(x1, y1);
        p.lineTo(x1 + Math.cos(ang + d) * head, y1 + Math.sin(ang + d) * head);
      }
      break;
    }
    case 'ellipse':
      p.ellipse(v[0]!, v[1]!, Math.abs(v[2]!), Math.abs(v[3]!), s.rotation, 0, Math.PI * 2);
      break;
    default:
      p.moveTo(v[0]!, v[1]!);
      for (let i = 2; i + 1 < v.length; i += 2) p.lineTo(v[i]!, v[i + 1]!);
      p.closePath();
  }
  return p;
}

const shapeCache = new WeakMap<ShapeItem, Path2D>();

function drawShape(ctx: Ctx, s: ShapeItem) {
  let path = shapeCache.get(s);
  if (!path) shapeCache.set(s, (path = shapePath(s)));
  ctx.save();
  ctx.globalAlpha = s.opacity;
  if (s.fill && s.shape !== 'line' && s.shape !== 'arrow') {
    ctx.globalAlpha = s.opacity * s.fillOpacity;
    ctx.fillStyle = s.fill;
    ctx.fill(path);
    ctx.globalAlpha = s.opacity;
  }
  ctx.strokeStyle = s.stroke;
  ctx.lineWidth = s.width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash(dashPattern(s.dash, s.width));
  ctx.stroke(path);
  ctx.restore();
}

export function drawText(ctx: Ctx, t: TextItem) {
  if (!t.text) return;
  withRotation(ctx, t.box, t.rotation, () => {
    ctx.font = cssFont(t.style);
    ctx.fillStyle = t.style.color;
    ctx.textBaseline = 'top';
    ctx.textAlign = t.style.align;
    const x =
      t.style.align === 'left'
        ? t.box.x
        : t.style.align === 'center'
          ? t.box.x + t.box.w / 2
          : t.box.x + t.box.w;
    const lh = t.style.size * LINE_HEIGHT;
    const pad = (lh - t.style.size) / 2;
    wrapText(t.text, t.style, t.box.w).forEach((line, i) =>
      ctx.fillText(line, x, t.box.y + 2 + pad + i * lh),
    );
    ctx.textAlign = 'left';
  });
}

function drawImageItem(ctx: Ctx, it: ImageItem) {
  const img = getImage(it.blobId);
  withRotation(ctx, it.box, it.rotation, () => {
    if (img) {
      const c = it.crop;
      ctx.drawImage(img, c.x, c.y, c.w, c.h, it.box.x, it.box.y, it.box.w, it.box.h);
    } else {
      ctx.fillStyle = 'rgba(120,130,150,0.15)';
      ctx.fillRect(it.box.x, it.box.y, it.box.w, it.box.h);
    }
  });
}

let tapeTexture: CanvasPattern | null = null;
function tapePattern(ctx: Ctx): CanvasPattern | null {
  if (tapeTexture || typeof document === 'undefined') return tapeTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 12;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(255,255,255,0.28)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(-3, 15);
  g.lineTo(15, -3);
  g.stroke();
  tapeTexture = ctx.createPattern(c, 'repeat');
  return tapeTexture;
}

/** Eckpunkte des Tape-Streifens (Rechteck um die Mittellinie). */
export function tapePolygon(t: TapeItem): number[] {
  const [x0, y0, x1, y1] = t.path as [number, number, number, number];
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = (-(y1 - y0) / len) * (t.width / 2);
  const ny = ((x1 - x0) / len) * (t.width / 2);
  return [x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny];
}

function drawTape(ctx: Ctx, t: TapeItem) {
  const v = tapePolygon(t);
  const p = new Path2D();
  p.moveTo(v[0]!, v[1]!);
  for (let i = 2; i < v.length; i += 2) p.lineTo(v[i]!, v[i + 1]!);
  p.closePath();
  ctx.save();
  if (t.covered) {
    ctx.fillStyle = t.color;
    ctx.fill(p);
    const pat = tapePattern(ctx);
    if (pat) {
      ctx.fillStyle = pat;
      ctx.fill(p);
    }
  } else {
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = t.color;
    ctx.fill(p);
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = t.color;
    ctx.lineWidth = 0.8;
    ctx.stroke(p);
  }
  ctx.restore();
}

function drawLink(ctx: Ctx, it: Item & { type: 'link' }) {
  if (it.fromPdf) return;
  const b = it.bbox;
  ctx.save();
  ctx.fillStyle = 'rgba(39,71,201,0.08)';
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.strokeStyle = 'rgba(39,71,201,0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(b.x, b.y + b.h);
  ctx.lineTo(b.x + b.w, b.y + b.h);
  ctx.stroke();
  ctx.restore();
}

export function drawItem(ctx: Ctx, it: Item): void {
  switch (it.type) {
    case 'stroke':
      drawStroke(ctx, it);
      break;
    case 'shape':
      drawShape(ctx, it);
      break;
    case 'text':
      drawText(ctx, it);
      break;
    case 'image':
      drawImageItem(ctx, it);
      break;
    case 'tape':
      drawTape(ctx, it);
      break;
    case 'link':
      drawLink(ctx, it);
      break;
  }
}

/** Zeichnet Inhalte in der richtigen Reihenfolge: Textmarker zuerst, darüber alles andere. */
export function drawItems(ctx: Ctx, items: readonly Item[], filter?: (it: Item) => boolean): void {
  for (const it of items) {
    if (it.type === 'stroke' && it.tool === 'highlighter' && (!filter || filter(it))) drawStroke(ctx, it);
  }
  for (const it of items) {
    if (filter && !filter(it)) continue;
    if (it.type === 'stroke' && it.tool === 'highlighter') continue;
    drawItem(ctx, it);
  }
}
