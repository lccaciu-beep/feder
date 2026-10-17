// Treffer-Rechtecke für eine Seite berechnen (Textfelder und PDF-Text).

import type { NotebookDoc } from '../engine/doc/NotebookDoc';
import type { Id, Rect } from '../model/types';
import { pdfTextRects } from '../pdf/pdfjs';
import { textItemRects } from './query';
import { normalize } from './text';

export async function highlightsFor(doc: NotebookDoc, pageId: Id, query: string): Promise<Rect[]> {
  const page = doc.pages.get(pageId);
  if (!page || query.trim().length < 2) return [];
  const items = await doc.ensureItems(pageId);
  const rects = textItemRects(items as readonly { type: string; bbox: Rect; text?: string }[], query);
  const t = page.paper.template;
  if (t.kind === 'pdf') {
    try {
      rects.push(...(await pdfTextRects(t.blobId, t.pageIndex, query, normalize)));
    } catch {
      /* PDF nicht lesbar */
    }
  }
  return rects;
}
