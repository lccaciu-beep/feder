import { renderPageTo } from '../engine/render/thumbnail';
import type { Id } from '../model/types';
import { flushAllAutosaves } from '../storage/autosave';
import { getDb } from '../storage/db';

/** Rendert eine Seite als PNG (ca. 300 dpi, höchstens 4096 px Kantenlänge). */
export async function exportPageImage(pageId: Id): Promise<Blob> {
  await flushAllAutosaves();
  const db = getDb();
  const page = await db.pages.get(pageId);
  if (!page) throw new Error('Seite nicht gefunden.');
  const items = await db.items.where('[pageId+z]').between([pageId, -Infinity], [pageId, Infinity]).toArray();
  const k = Math.min(300 / 72, 4096 / Math.max(page.paper.width, page.paper.height));
  const canvas = document.createElement('canvas');
  await renderPageTo(canvas, page.paper, items, k);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error('Das Bild konnte nicht erzeugt werden.');
  return blob;
}
