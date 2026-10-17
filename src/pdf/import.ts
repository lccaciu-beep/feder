// PDF-Import: Datei im Blob-Speicher ablegen und pro PDF-Seite eine
// Notizbuch-Seite mit dem PDF als Hintergrund anlegen. Links im PDF werden
// als antippbare Verknüpfungen übernommen, der Text kommt in den Suchindex.

import type { NotebookDoc } from '../engine/doc/NotebookDoc';
import { newId } from '../model/ids';
import type { CoverSpec, Id, LinkItem, Notebook, Page, PaperSpec, TextIndexEntry } from '../model/types';
import { getBlobStore } from '../storage/blobstore';
import { getDb } from '../storage/db';
import { createNotebook, makePage } from '../storage/library';
import { tokenize } from '../search/text';
import { analyzePdf, openPdfBytes, type PdfPageInfo } from './pdfjs';

export function isPdfFile(f: File): boolean {
  return f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
}

/** Speichert das PDF und liefert Papier und Seiteninfos. */
async function storePdf(file: File): Promise<{ papers: PaperSpec[]; infos: PdfPageInfo[] }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // pdf.js übernimmt den Puffer in den Worker – deshalb mit einer Kopie arbeiten.
  const doc = await openPdfBytes(bytes.slice());
  let infos: PdfPageInfo[];
  try {
    infos = await analyzePdf(doc);
  } finally {
    void doc.loadingTask.destroy();
  }
  if (!infos.length) throw new Error('Das PDF enthält keine Seiten.');
  const meta = await (await getBlobStore()).put(new Blob([bytes], { type: 'application/pdf' }));
  const papers: PaperSpec[] = infos.map((s, pageIndex) => ({
    width: s.width,
    height: s.height,
    color: 'white',
    template: { kind: 'pdf', blobId: meta.id, pageIndex },
  }));
  return { papers, infos };
}

/** Links und Suchtext der PDF-Seiten als Datensätze. */
function derived(notebookId: Id, pages: Page[], infos: PdfPageInfo[]) {
  const links: LinkItem[] = [];
  const index: TextIndexEntry[] = [];
  const now = Date.now();
  infos.forEach((info, i) => {
    const page = pages[i]!;
    info.links.forEach((l, k) => {
      const target =
        l.url !== undefined
          ? ({ kind: 'url', url: l.url } as const)
          : pages[l.pageIndex!]
            ? ({ kind: 'page', pageId: pages[l.pageIndex!]!.id } as const)
            : null;
      if (!target) return;
      links.push({
        id: newId(),
        type: 'link',
        pageId: page.id,
        notebookId,
        z: -1000 + k,
        bbox: l.rect,
        createdAt: now,
        target,
        label: l.url ?? `Seite ${l.pageIndex! + 1}`,
        fromPdf: true,
      });
    });
    if (info.text) {
      index.push({
        id: `${page.id}:pdf`,
        notebookId,
        pageId: page.id,
        source: 'pdf',
        text: info.text,
        tokens: tokenize(info.text),
      });
    }
  });
  return { links, index };
}

const PDF_COVER: CoverSpec = { color: '#6b7280', pattern: 'plain' };

/** Legt aus einem PDF ein neues Notizbuch an. */
export async function importPdfAsNotebook(file: File, folderId: Id | null): Promise<Notebook> {
  const { papers, infos } = await storePdf(file);
  const title = file.name.replace(/\.pdf$/i, '').trim() || 'PDF';
  const nb = await createNotebook({
    title,
    folderId,
    cover: PDF_COVER,
    pages: papers,
    paper: { ...papers[0]!, template: { kind: 'builtin', id: 'blank', params: {} } },
  });
  const db = getDb();
  const pageMap = new Map((await db.pages.where('notebookId').equals(nb.id).toArray()).map((p) => [p.id, p]));
  const pages = nb.pageIds.map((id) => pageMap.get(id)!);
  const { links, index } = derived(nb.id, pages, infos);
  await db.transaction('rw', db.items, db.textIndex, async () => {
    await db.items.bulkAdd(links);
    await db.textIndex.bulkPut(index);
  });
  return nb;
}

/** Fügt die Seiten eines PDFs an `index` in ein geöffnetes Notizbuch ein (rückgängig machbar). */
export async function insertPdfPages(doc: NotebookDoc, file: File, index: number): Promise<Page[]> {
  const { papers, infos } = await storePdf(file);
  const now = Date.now();
  const pages = papers.map((p) => makePage(doc.id, p, now));
  doc.insertPages(index, pages, 'PDF einfügen');
  const { links, index: text } = derived(doc.id, pages, infos);
  if (links.length)
    doc.execute({ label: 'PDF-Links', items: links.map((after) => ({ before: null, after })), pages: [] });
  await getDb().textIndex.bulkPut(text);
  return pages;
}
