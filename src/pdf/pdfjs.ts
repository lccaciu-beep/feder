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
