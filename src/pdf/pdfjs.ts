// pdf.js laden, PDF-Dokumente zwischenspeichern und Seitenausschnitte rendern.
// Das Rendern läuft im pdf.js-Worker; hier wird nur das Ergebnis übernommen.

import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Id, Rect } from '../model/types';
import { getBlobStore } from '../storage/blobstore';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const assets = `${import.meta.env.BASE_URL}pdfjs/`;
const MAX_OPEN_DOCS = 4;

/** Gemeinsame Optionen für getDocument (Offline-Zusatzdateien aus public/pdfjs). */
export function documentOptions(data: Uint8Array) {
  return {
    data,
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`,
    wasmUrl: `${assets}wasm/`,
    iccUrl: `${assets}iccs/`,
    isEvalSupported: false,
    enableXfa: false,
  };
}

export async function openPdfBytes(data: Uint8Array): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument(documentOptions(data)).promise;
}

const open = new Map<Id, Promise<PDFDocumentProxy>>();

/** Liefert das PDF zu einem gespeicherten Blob (mit kleinem LRU-Cache). */
export function pdfFor(blobId: Id): Promise<PDFDocumentProxy> {
  let p = open.get(blobId);
  if (p) {
    open.delete(blobId);
    open.set(blobId, p);
    return p;
  }
  p = (async () => {
    const blob = await (await getBlobStore()).get(blobId);
    if (!blob) throw new Error('PDF-Datei fehlt im Speicher.');
    return openPdfBytes(new Uint8Array(await blob.arrayBuffer()));
  })();
  p.catch(() => open.delete(blobId));
  open.set(blobId, p);
  while (open.size > MAX_OPEN_DOCS) {
    const [oldest, doc] = open.entries().next().value!;
    open.delete(oldest);
    void doc.then((d) => d.loadingTask.destroy()).catch(() => undefined);
  }
  return p;
}

/** Seitengrößen (pt, wie angezeigt – Drehung berücksichtigt). */
export async function pageSizes(doc: PDFDocumentProxy): Promise<{ width: number; height: number }[]> {
  const out: { width: number; height: number }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    out.push({ width: vp.width, height: vp.height });
    page.cleanup();
  }
  return out;
}

/**
 * Rendert einen Ausschnitt (pt) einer PDF-Seite mit `level` Gerätepixeln pro pt
 * in einen neuen Canvas. Gibt null zurück, wenn abgebrochen.
 */
export async function renderPdfRegion(
  blobId: Id,
  pageIndex: number,
  rect: Rect,
  level: number,
  signal?: AbortSignal,
): Promise<HTMLCanvasElement | null> {
  const doc = await pdfFor(blobId);
  if (signal?.aborted) return null;
  const page = await doc.getPage(pageIndex + 1);
  if (signal?.aborted) return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rect.w * level));
  canvas.height = Math.max(1, Math.round(rect.h * level));
  const viewport = page.getViewport({ scale: level, offsetX: -rect.x * level, offsetY: -rect.y * level });
  const task = page.render({ canvas, viewport });
  const abort = () => task.cancel();
  signal?.addEventListener('abort', abort);
  try {
    await task.promise;
    return canvas;
  } catch (err) {
    if (signal?.aborted || (err as Error)?.name === 'RenderingCancelledException') {
      canvas.width = canvas.height = 0;
      return null;
    }
    throw err;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

export interface PdfLink {
  rect: Rect;
  url?: string;
  pageIndex?: number;
}

export interface PdfPageInfo {
  width: number;
  height: number;
  links: PdfLink[];
  text: string;
}

/** Seitengrößen, Links und Text eines PDFs auslesen (für Import und Suche). */
export async function analyzePdf(doc: PDFDocumentProxy): Promise<PdfPageInfo[]> {
  const out: PdfPageInfo[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const links: PdfLink[] = [];
    try {
      for (const a of await page.getAnnotations({ intent: 'display' })) {
        if (a.subtype !== 'Link' || !Array.isArray(a.rect)) continue;
        const [x1, y1] = vp.convertToViewportPoint(a.rect[0], a.rect[1]) as [number, number];
        const [x2, y2] = vp.convertToViewportPoint(a.rect[2], a.rect[3]) as [number, number];
        const rect = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
        const url = (a.url ?? a.unsafeUrl) as string | undefined;
        if (url && /^(https?:|mailto:|tel:)/i.test(url)) {
          links.push({ rect, url });
          continue;
        }
        let dest = a.dest as unknown;
        if (typeof dest === 'string') dest = await doc.getDestination(dest).catch(() => null);
        if (Array.isArray(dest) && dest[0] != null) {
          const ref = dest[0];
          const pageIndex =
            typeof ref === 'number'
              ? ref
              : await doc.getPageIndex(ref as Parameters<typeof doc.getPageIndex>[0]).catch(() => -1);
          if (pageIndex >= 0) links.push({ rect, pageIndex });
        }
      }
    } catch {
      /* fehlerhafte Annotationen ignorieren */
    }
    let text = '';
    try {
      const tc = await page.getTextContent();
      text = tc.items
        .map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : ' ') : ''))
        .join('')
        .replace(/[ \t]+/g, ' ')
        .trim();
    } catch {
      /* Seite ohne Text */
    }
    out.push({ width: vp.width, height: vp.height, links, text });
    page.cleanup();
  }
  return out;
}

/** Inhaltsverzeichnis (Lesezeichen) eines PDFs, flach mit Ebene. */
export async function pdfOutline(
  doc: PDFDocumentProxy,
): Promise<{ title: string; level: number; pageIndex: number }[]> {
  const out: { title: string; level: number; pageIndex: number }[] = [];
  let tree: Awaited<ReturnType<PDFDocumentProxy['getOutline']>> | null = null;
  try {
    tree = await doc.getOutline();
  } catch {
    return out;
  }
  const walk = async (nodes: NonNullable<typeof tree>, level: number) => {
    for (const n of nodes) {
      let dest = n.dest as unknown;
      if (typeof dest === 'string') dest = await doc.getDestination(dest).catch(() => null);
      if (Array.isArray(dest) && dest[0] != null) {
        const ref = dest[0];
        const pageIndex =
          typeof ref === 'number'
            ? ref
            : await doc.getPageIndex(ref as Parameters<typeof doc.getPageIndex>[0]).catch(() => -1);
        if (pageIndex >= 0 && n.title)
          out.push({ title: n.title.trim(), level: Math.min(level, 4), pageIndex });
      }
      if (n.items?.length) await walk(n.items as NonNullable<typeof tree>, level + 1);
      if (out.length > 2000) return;
    }
  };
  if (tree) await walk(tree, 0);
  return out;
}

/** Rechtecke (pt, Anzeige) aller Stellen auf einer PDF-Seite, die `query` enthalten. */
export async function pdfTextRects(
  blobId: Id,
  pageIndex: number,
  query: string,
  norm: (s: string) => string,
): Promise<Rect[]> {
  const doc = await pdfFor(blobId);
  const page = await doc.getPage(pageIndex + 1);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const nq = norm(query);
  const out: Rect[] = [];
  if (!nq) return out;
  for (const it of tc.items) {
    if (!('str' in it) || !it.str) continue;
    const n = norm(it.str);
    const tr = it.transform as number[];
    const h = it.height || Math.hypot(tr[2]!, tr[3]!);
    let from = 0;
    let i: number;
    while ((i = n.indexOf(nq, from)) >= 0) {
      from = i + nq.length;
      const x0 = tr[4]! + (it.width * i) / n.length;
      const x1 = tr[4]! + (it.width * (i + nq.length)) / n.length;
      const [ax, ay] = vp.convertToViewportPoint(x0, tr[5]! - h * 0.2) as [number, number];
      const [bx, by] = vp.convertToViewportPoint(x1, tr[5]! + h * 0.9) as [number, number];
      out.push({ x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) });
    }
  }
  page.cleanup();
  return out;
}
