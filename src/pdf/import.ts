// PDF-Import: Datei im Blob-Speicher ablegen und pro PDF-Seite eine
// Notizbuch-Seite mit dem PDF als Hintergrund anlegen.

import type { NotebookDoc } from '../engine/doc/NotebookDoc';
import type { CoverSpec, Id, Notebook, Page, PaperSpec } from '../model/types';
import { getBlobStore } from '../storage/blobstore';
import { createNotebook, makePage } from '../storage/library';
import { openPdfBytes, pageSizes } from './pdfjs';

export function isPdfFile(f: File): boolean {
  return f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
}

/** Speichert das PDF und liefert das Papier für jede Seite. */
async function storePdf(file: File): Promise<PaperSpec[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // pdf.js übernimmt den Puffer in den Worker – deshalb mit einer Kopie arbeiten.
  const doc = await openPdfBytes(bytes.slice());
  let sizes: { width: number; height: number }[];
  try {
    sizes = await pageSizes(doc);
  } finally {
    void doc.loadingTask.destroy();
  }
  if (!sizes.length) throw new Error('Das PDF enthält keine Seiten.');
  const meta = await (await getBlobStore()).put(new Blob([bytes], { type: 'application/pdf' }));
  return sizes.map((s, pageIndex) => ({
    width: s.width,
    height: s.height,
    color: 'white',
    template: { kind: 'pdf', blobId: meta.id, pageIndex },
  }));
}

const PDF_COVER: CoverSpec = { color: '#6b7280', pattern: 'plain' };

/** Legt aus einem PDF ein neues Notizbuch an. */
export async function importPdfAsNotebook(file: File, folderId: Id | null): Promise<Notebook> {
  const papers = await storePdf(file);
  const title = file.name.replace(/\.pdf$/i, '').trim() || 'PDF';
  return createNotebook({
    title,
    folderId,
    cover: PDF_COVER,
    pages: papers,
    paper: { ...papers[0]!, template: { kind: 'builtin', id: 'blank', params: {} } },
  });
}

/** Fügt die Seiten eines PDFs an `index` in ein geöffnetes Notizbuch ein (rückgängig machbar). */
export async function insertPdfPages(doc: NotebookDoc, file: File, index: number): Promise<Page[]> {
  const papers = await storePdf(file);
  const now = Date.now();
  const pages = papers.map((p) => makePage(doc.id, p, now));
  doc.insertPages(index, pages, 'PDF einfügen');
  return pages;
}
