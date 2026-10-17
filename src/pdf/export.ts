// PDF-Export mit pdf-lib. Importierte PDF-Seiten werden 1:1 übernommen,
// eigene Seiten bekommen ihre Vorlage als Vektorgrafik, die Handschrift wird
// als Vektorpfad darübergelegt.

import {
  BlendMode,
  LineCapStyle,
  PDFDocument,
  StandardFonts,
  concatTransformationMatrix,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  rectangle,
  clip,
  endPath,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
} from 'pdf-lib';
import { dashPattern, strokeSvg } from '../engine/ink/brushes';
import type { Id, Item, Page, PaperSpec, Rect, ShapeItem, TextStyle } from '../model/types';
import { tapeCorners } from '../engine/geometry/transform';
import { LINE_HEIGHT, wrapText } from '../engine/render/items';
import { getBlobStore } from '../storage/blobstore';
import { getDb } from '../storage/db';
import { drawPaper } from '../templates/draw';

export interface PdfExportOptions {
  /** Liniatur/Karos usw. mit ausgeben (betrifft nur eigene Seiten, nicht PDF-Seiten). */
  withTemplate: boolean;
  /** Nur diese Seiten (in Notizbuch-Reihenfolge); sonst alle. */
  pageIds?: Id[];
}

type Matrix = [number, number, number, number, number, number];

/**
 * Abbildung PDF-Benutzerraum → Anzeige (pt, y nach unten), wie pdf.js sie für
 * eine Seite mit Drehung `rotation` und sichtbarer Box `box` verwendet.
 */
export function userToDisplay(
  rotation: number,
  box: { x: number; y: number; width: number; height: number },
): Matrix {
  const x1 = box.x;
  const y1 = box.y;
  const x2 = box.x + box.width;
  const y2 = box.y + box.height;
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return [0, 1, 1, 0, -y1, -x1];
    case 180:
      return [-1, 0, 0, 1, x2, -y1];
    case 270:
      return [0, -1, -1, 0, y2, x2];
    default:
      return [1, 0, 0, -1, -x1, y2];
  }
}

/** (a,b,c,d,e,f) bildet (x,y) auf (a·x + c·y + e, b·x + d·y + f) ab. */
export function invert([a, b, c, d, e, f]: Matrix): Matrix {
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function compose(m: Matrix, n: Matrix): Matrix {
  // m ∘ n: erst n, dann m
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function apply([a, b, c, d, e, f]: Matrix, x: number, y: number): [number, number] {
  return [a * x + c * y + e, b * x + d * y + f];
}

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h.padEnd(6, '0');
  const n = parseInt(full.slice(0, 6), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Schriften für Textfelder (Standardschriften, WinAnsi). */
export interface PdfFonts {
  get(style: TextStyle): Promise<PDFFont>;
}

function makeFonts(doc: PDFDocument): PdfFonts {
  const cache = new Map<string, Promise<PDFFont>>();
  const pick = (s: TextStyle): StandardFonts => {
    const b = s.bold;
    const i = s.italic || s.font === 'hand';
    if (s.font === 'serif')
      return b && i
        ? StandardFonts.TimesRomanBoldItalic
        : b
          ? StandardFonts.TimesRomanBold
          : i
            ? StandardFonts.TimesRomanItalic
            : StandardFonts.TimesRoman;
    if (s.font === 'mono')
      return b && i
        ? StandardFonts.CourierBoldOblique
        : b
          ? StandardFonts.CourierBold
          : i
            ? StandardFonts.CourierOblique
            : StandardFonts.Courier;
    return b && i
      ? StandardFonts.HelveticaBoldOblique
      : b
        ? StandardFonts.HelveticaBold
        : i
          ? StandardFonts.HelveticaOblique
          : StandardFonts.Helvetica;
  };
  return {
    get(style) {
      const name = pick(style);
      let f = cache.get(name);
      if (!f) cache.set(name, (f = doc.embedFont(name)));
      return f;
    },
  };
}

/** Zeichen, die die Standardschriften (WinAnsi) nicht kennen, ersetzen. */
function encodable(font: PDFFont, text: string): string {
  try {
    font.encodeText(text);
    return text;
  } catch {
    return [...text]
      .map((ch) => {
        try {
          font.encodeText(ch);
          return ch;
        } catch {
          return '?';
        }
      })
      .join('');
  }
}

function shapeSvg(s: ShapeItem): string {
  const v = s.vertices;
  const n = (x: number) => (Math.round(x * 100) / 100).toString();
  switch (s.shape) {
    case 'line':
      return `M${n(v[0]!)} ${n(v[1]!)}L${n(v[2]!)} ${n(v[3]!)}`;
    case 'arrow': {
      const [x0, y0, x1, y1] = v as [number, number, number, number];
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const head = Math.min(Math.hypot(x1 - x0, y1 - y0) * 0.4, Math.max(8, s.width * 5));
      let d = `M${n(x0)} ${n(y0)}L${n(x1)} ${n(y1)}`;
      for (const a of [Math.PI * 0.82, -Math.PI * 0.82]) {
        d += `M${n(x1)} ${n(y1)}L${n(x1 + Math.cos(ang + a) * head)} ${n(y1 + Math.sin(ang + a) * head)}`;
      }
      return d;
    }
    case 'ellipse': {
      const [cx, cy, rx, ry] = v as [number, number, number, number];
      const c = Math.cos(s.rotation);
      const sn = Math.sin(s.rotation);
      const p = (t: number): [number, number] => [
        cx + rx * Math.cos(t) * c - ry * Math.sin(t) * sn,
        cy + rx * Math.cos(t) * sn + ry * Math.sin(t) * c,
      ];
      // Ellipse aus 4 kubischen Bézierkurven
      const k = 0.5522847498;
      let d = '';
      for (let i = 0; i < 4; i++) {
        const t0 = (i * Math.PI) / 2;
        const t1 = t0 + Math.PI / 2;
        const a = p(t0);
        const b = p(t1);
        const ta: [number, number] = [
          -rx * Math.sin(t0) * c - ry * Math.cos(t0) * sn,
          -rx * Math.sin(t0) * sn + ry * Math.cos(t0) * c,
        ];
        const tb: [number, number] = [
          -rx * Math.sin(t1) * c - ry * Math.cos(t1) * sn,
          -rx * Math.sin(t1) * sn + ry * Math.cos(t1) * c,
        ];
        if (!i) d += `M${n(a[0])} ${n(a[1])}`;
        d += `C${n(a[0] + ta[0] * k)} ${n(a[1] + ta[1] * k)} ${n(b[0] - tb[0] * k)} ${n(b[1] - tb[1] * k)} ${n(b[0])} ${n(b[1])}`;
      }
      return d + 'Z';
    }
    default: {
      let d = `M${n(v[0]!)} ${n(v[1]!)}`;
      for (let i = 2; i + 1 < v.length; i += 2) d += `L${n(v[i]!)} ${n(v[i + 1]!)}`;
      return d + 'Z';
    }
  }
}

/** Dreht im (y-nach-oben-)Raum der Inhalte um die Mitte eines Rahmens. */
function rotateAbout(page: PDFPage, box: Rect, rotation: number) {
  if (!rotation) return;
  const cx = box.x + box.w / 2;
  const cy = -(box.y + box.h / 2);
  const c = Math.cos(-rotation);
  const s = Math.sin(-rotation);
  page.pushOperators(concatTransformationMatrix(c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy));
}

async function embedImage(doc: PDFDocument, blobId: Id, cache: Map<Id, Promise<PDFImage | null>>) {
  let p = cache.get(blobId);
  if (!p) {
    p = (async () => {
      const blob = await (await getBlobStore()).get(blobId);
      if (!blob) return null;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (blob.type === 'image/png') return doc.embedPng(bytes);
      if (blob.type === 'image/jpeg') return doc.embedJpg(bytes);
      // andere Formate (z. B. HEIC) über einen Canvas in JPEG umwandeln
      if (typeof document === 'undefined') return null;
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext('2d')!.drawImage(bmp, 0, 0);
      bmp.close();
      const jpg = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.92));
      c.width = c.height = 0;
      return jpg ? doc.embedJpg(new Uint8Array(await jpg.arrayBuffer())) : null;
    })().catch(() => null);
    cache.set(blobId, p);
  }
  return p;
}

interface DrawContext {
  doc: PDFDocument;
  fonts: PdfFonts;
  images: Map<Id, Promise<PDFImage | null>>;
}

/** Zeichnet alle Inhalte einer Seite (Anzeige-Koordinaten) auf eine PDF-Seite. */
async function drawContent(page: PDFPage, items: readonly Item[], toDisplay: Matrix, dc: DrawContext) {
  const ordered = [
    ...items.filter((s) => s.type === 'stroke' && s.tool === 'highlighter'),
    ...items.filter((s) => !(s.type === 'stroke' && s.tool === 'highlighter') && s.type !== 'link'),
  ];
  if (!ordered.length) return;
  // drawSvgPath spiegelt selbst an der x-Achse; zusammen mit dieser Matrix
  // landen SVG-Koordinaten (= Anzeige-Koordinaten) an der richtigen Stelle.
  // Für Bilder und Text gilt hier: Anzeige-y = −y.
  const k = compose(invert(toDisplay), [1, 0, 0, -1, 0, 0]);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...k));
  for (const it of ordered) {
    switch (it.type) {
      case 'stroke': {
        const path = strokeSvg(it);
        if (!path) break;
        const color = hexToRgb(it.color);
        const opacity = it.opacity * (it.tool === 'pencil' ? 0.85 : 1);
        const blendMode = it.tool === 'highlighter' ? BlendMode.Multiply : undefined;
        if (it.dash === 'solid') page.drawSvgPath(path, { x: 0, y: 0, color, opacity, blendMode });
        else
          page.drawSvgPath(path, {
            x: 0,
            y: 0,
            borderColor: color,
            borderOpacity: opacity,
            borderWidth: it.width,
            borderDashArray: dashPattern(it.dash, it.width),
            borderLineCap: LineCapStyle.Round,
          });
        break;
      }
      case 'shape': {
        const closed = it.shape !== 'line' && it.shape !== 'arrow';
        page.drawSvgPath(shapeSvg(it), {
          x: 0,
          y: 0,
          color: closed && it.fill ? hexToRgb(it.fill) : undefined,
          opacity: it.fillOpacity * it.opacity,
          borderColor: hexToRgb(it.stroke),
          borderOpacity: it.opacity,
          borderWidth: it.width,
          borderDashArray: it.dash === 'solid' ? undefined : dashPattern(it.dash, it.width),
          borderLineCap: LineCapStyle.Round,
        });
        break;
      }
      case 'tape': {
        const v = tapeCorners(it);
        let d = `M${v[0]} ${v[1]}`;
        for (let i = 2; i < v.length; i += 2) d += `L${v[i]} ${v[i + 1]}`;
        page.drawSvgPath(d + 'Z', { x: 0, y: 0, color: hexToRgb(it.color), opacity: it.covered ? 1 : 0.18 });
        break;
      }
      case 'text': {
        if (!it.text) break;
        const font = await dc.fonts.get(it.style);
        const lh = it.style.size * LINE_HEIGHT;
        const pad = (lh - it.style.size) / 2;
        page.pushOperators(pushGraphicsState());
        rotateAbout(page, it.box, it.rotation);
        wrapText(it.text, it.style, it.box.w).forEach((raw, i) => {
          const line = encodable(font, raw);
          const w = font.widthOfTextAtSize(line, it.style.size);
          const x =
            it.style.align === 'left'
              ? it.box.x
              : it.style.align === 'center'
                ? it.box.x + (it.box.w - w) / 2
                : it.box.x + it.box.w - w;
          const baseline = it.box.y + 2 + pad + i * lh + it.style.size * 0.8;
          page.drawText(line, {
            x,
            y: -baseline,
            size: it.style.size,
            font,
            color: hexToRgb(it.style.color),
          });
        });
        page.pushOperators(popGraphicsState());
        break;
      }
      case 'image': {
        const img = await embedImage(dc.doc, it.blobId, dc.images);
        if (!img) break;
        const sx = it.box.w / it.crop.w;
        const sy = it.box.h / it.crop.h;
        page.pushOperators(pushGraphicsState());
        rotateAbout(page, it.box, it.rotation);
        page.pushOperators(
          rectangle(it.box.x, -(it.box.y + it.box.h), it.box.w, it.box.h),
          clip(),
          endPath(),
        );
        const fullW = it.natW * sx;
        const fullH = it.natH * sy;
        const left = it.box.x - it.crop.x * sx;
        const top = it.box.y - it.crop.y * sy;
        page.drawImage(img, { x: left, y: -(top + fullH), width: fullW, height: fullH });
        page.pushOperators(popGraphicsState());
        break;
      }
    }
  }
  page.pushOperators(popGraphicsState());
}

/**
 * Minimaler Canvas-Ersatz, der die Vektor-Vorlagen aus templates/draw.ts
 * direkt in eine PDF-Seite schreibt.
 */
class PdfPaperCanvas {
  fillStyle = '#000';
  strokeStyle = '#000';
  lineWidth = 1;
  font = '10px sans-serif';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  private path: string[] = [];
  private dash: number[] = [];

  constructor(
    private page: PDFPage,
    private h: number,
    private bold: PDFFont,
  ) {}

  private n(v: number) {
    return (Math.round(v * 100) / 100).toString();
  }

  fillRect(x: number, y: number, w: number, h: number) {
    this.page.drawRectangle({ x, y: this.h - y - h, width: w, height: h, color: hexToRgb(this.fillStyle) });
  }
  strokeRect(x: number, y: number, w: number, h: number) {
    this.page.drawRectangle({
      x,
      y: this.h - y - h,
      width: w,
      height: h,
      borderColor: hexToRgb(this.strokeStyle),
      borderWidth: this.lineWidth,
    });
  }
  beginPath() {
    this.path = [];
  }
  moveTo(x: number, y: number) {
    this.path.push(`M${this.n(x)} ${this.n(y)}`);
  }
  lineTo(x: number, y: number) {
    this.path.push(`L${this.n(x)} ${this.n(y)}`);
  }
  arc(x: number, y: number, r: number) {
    // Vollkreis aus zwei Halbbögen
    this.path.push(
      `M${this.n(x + r)} ${this.n(y)}A${this.n(r)} ${this.n(r)} 0 1 0 ${this.n(x - r)} ${this.n(y)}` +
        `A${this.n(r)} ${this.n(r)} 0 1 0 ${this.n(x + r)} ${this.n(y)}Z`,
    );
  }
  setLineDash(d: number[]) {
    this.dash = d;
  }
  stroke() {
    if (!this.path.length) return;
    this.page.drawSvgPath(this.path.join(''), {
      x: 0,
      y: this.h,
      borderColor: hexToRgb(this.strokeStyle),
      borderWidth: this.lineWidth,
      borderDashArray: this.dash.length ? this.dash : undefined,
    });
  }
  fill() {
    if (!this.path.length) return;
    this.page.drawSvgPath(this.path.join(''), { x: 0, y: this.h, color: hexToRgb(this.fillStyle) });
  }
  fillText(text: string, x: number, y: number) {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10);
    this.page.drawText(text, {
      x,
      y: this.h - y - size * 0.8,
      size,
      font: this.bold,
      color: hexToRgb(this.fillStyle),
    });
  }
}

function drawTemplate(page: PDFPage, paper: PaperSpec, bold: PDFFont) {
  const ctx = new PdfPaperCanvas(page, paper.height, bold);
  drawPaper(ctx as unknown as CanvasRenderingContext2D, paper, 4);
}

/** Erstellt das PDF eines Notizbuchs. */
export async function exportNotebookPdf(notebookId: Id, opts: PdfExportOptions): Promise<Blob> {
  const db = getDb();
  const nb = await db.notebooks.get(notebookId);
  if (!nb) throw new Error('Notizbuch nicht gefunden.');
  const pages = new Map(
    (await db.pages.where('notebookId').equals(notebookId).toArray()).map((p) => [p.id, p]),
  );
  const wanted = opts.pageIds ? new Set(opts.pageIds) : null;
  const order = nb.pageIds.filter((id) => pages.has(id) && (!wanted || wanted.has(id)));

  const out = await PDFDocument.create();
  out.setTitle(nb.title);
  out.setCreator('Feder');
  out.setProducer('Feder');
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const dc: DrawContext = { doc: out, fonts: makeFonts(out), images: new Map() };
  const sources = new Map<Id, Promise<PDFDocument>>();
  const source = (blobId: Id) => {
    let p = sources.get(blobId);
    if (!p) {
      p = (async () => {
        const blob = await (await getBlobStore()).get(blobId);
        if (!blob) throw new Error('Ein importiertes PDF fehlt im Speicher.');
        return PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true });
      })();
      sources.set(blobId, p);
    }
    return p;
  };

  for (const id of order) {
    const page: Page = pages.get(id)!;
    const items = await db.items.where('[pageId+z]').between([id, -Infinity], [id, Infinity]).toArray();
    const t = page.paper.template;
    let pdfPage: PDFPage;
    let toDisplay: Matrix;
    if (t.kind === 'pdf') {
      const [copied] = await out.copyPages(await source(t.blobId), [t.pageIndex]);
      pdfPage = out.addPage(copied!);
      toDisplay = userToDisplay(pdfPage.getRotation().angle, pdfPage.getCropBox());
    } else {
      pdfPage = out.addPage([page.paper.width, page.paper.height]);
      if (t.kind === 'image') {
        // Bild-Hintergründe (Scans, eigene Vorlagen) gehören zum Inhalt
        const img = await embedImage(out, t.blobId, dc.images);
        if (img) pdfPage.drawImage(img, { x: 0, y: 0, width: page.paper.width, height: page.paper.height });
      } else if (opts.withTemplate) drawTemplate(pdfPage, page.paper, bold);
      toDisplay = userToDisplay(0, { x: 0, y: 0, width: page.paper.width, height: page.paper.height });
    }
    await drawContent(pdfPage, items, toDisplay, dc);
  }
  if (!order.length) out.addPage();
  const bytes = await out.save();
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}
