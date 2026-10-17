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
  type PDFFont,
  type PDFPage,
  type RGB,
} from 'pdf-lib';
import { dashPattern, strokeSvg } from '../engine/ink/brushes';
import type { Id, Item, Page, PaperSpec, StrokeItem } from '../model/types';
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

/** Zeichnet die Inhalte einer Seite in Anzeige-Koordinaten auf eine PDF-Seite. */
function drawInk(page: PDFPage, items: readonly Item[], toDisplay: Matrix) {
  const strokes = items.filter((it): it is StrokeItem => it.type === 'stroke');
  const ordered = [
    ...strokes.filter((s) => s.tool === 'highlighter'),
    ...strokes.filter((s) => s.tool !== 'highlighter'),
  ];
  if (!ordered.length) return;
  // drawSvgPath spiegelt selbst an der x-Achse; zusammen mit dieser Matrix
  // landen SVG-Koordinaten (= Anzeige-Koordinaten) an der richtigen Stelle.
  const k = compose(invert(toDisplay), [1, 0, 0, -1, 0, 0]);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...k));
  for (const s of ordered) {
    const path = strokeSvg(s);
    if (!path) continue;
    const color = hexToRgb(s.color);
    const opacity = s.opacity * (s.tool === 'pencil' ? 0.85 : 1);
    const blendMode = s.tool === 'highlighter' ? BlendMode.Multiply : undefined;
    if (s.dash === 'solid') {
      page.drawSvgPath(path, { x: 0, y: 0, color, opacity, blendMode });
    } else {
      page.drawSvgPath(path, {
        x: 0,
        y: 0,
        borderColor: color,
        borderOpacity: opacity,
        borderWidth: s.width,
        borderDashArray: dashPattern(s.dash, s.width),
        borderLineCap: LineCapStyle.Round,
      });
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
      if (opts.withTemplate) drawTemplate(pdfPage, page.paper, bold);
      toDisplay = userToDisplay(0, { x: 0, y: 0, width: page.paper.width, height: page.paper.height });
    }
    drawInk(pdfPage, items, toDisplay);
  }
  if (!order.length) out.addPage();
  const bytes = await out.save();
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}
