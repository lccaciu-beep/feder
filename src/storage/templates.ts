// Eigene Vorlagen aus PDF-Seiten oder Bildern.

import { prepareImage } from '../io/images';
import { newId } from '../model/ids';
import { PAPER_SIZES } from '../model/paper';
import type { CustomTemplate, Id, PaperSpec } from '../model/types';
import { openPdfBytes, pageSizes } from '../pdf/pdfjs';
import { getBlobStore } from './blobstore';
import { getDb } from './db';
import { deleteUnusedBlobs } from './library';

const MAX_PDF_TEMPLATES = 20;

export function isImageFile(f: File): boolean {
  return f.type.startsWith('image/') || /\.(png|jpe?g|heic|webp|gif)$/i.test(f.name);
}

/** Legt aus einer Datei eine oder mehrere Vorlagen an (bei PDFs: eine pro Seite). */
export async function addTemplatesFromFile(file: File): Promise<CustomTemplate[]> {
  const store = await getBlobStore();
  const name = file.name.replace(/\.[^.]+$/, '') || 'Vorlage';
  const now = Date.now();
  let out: CustomTemplate[];
  if (isImageFile(file)) {
    const { blob, width, height } = await prepareImage(file);
    const meta = await store.put(blob);
    const w = PAPER_SIZES.a4.width;
    out = [
      {
        id: newId(now),
        name,
        blobId: meta.id,
        kind: 'image',
        pageIndex: 0,
        width: w,
        height: (w * height) / width,
        createdAt: now,
      },
    ];
  } else {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await openPdfBytes(bytes.slice());
    let sizes: { width: number; height: number }[];
    try {
      sizes = (await pageSizes(doc)).slice(0, MAX_PDF_TEMPLATES);
    } finally {
      void doc.loadingTask.destroy();
    }
    const meta = await store.put(new Blob([bytes], { type: 'application/pdf' }));
    out = sizes.map((s, i) => ({
      id: newId(now),
      name: sizes.length > 1 ? `${name} – Seite ${i + 1}` : name,
      blobId: meta.id,
      kind: 'pdf',
      pageIndex: i,
      width: s.width,
      height: s.height,
      createdAt: now + i,
    }));
  }
  await getDb().templates.bulkAdd(out);
  return out;
}

export async function deleteTemplate(id: Id): Promise<void> {
  const db = getDb();
  const t = await db.templates.get(id);
  if (!t) return;
  await db.templates.delete(id);
  await deleteUnusedBlobs([t.blobId]);
}

export function templatePaper(t: CustomTemplate): PaperSpec {
  return {
    width: t.width,
    height: t.height,
    color: 'white',
    template:
      t.kind === 'pdf'
        ? { kind: 'pdf', blobId: t.blobId, pageIndex: t.pageIndex }
        : { kind: 'image', blobId: t.blobId },
  };
}
