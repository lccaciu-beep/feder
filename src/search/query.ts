// Volltextsuche über PDF-Text, Textfelder, Stichworte, Lesezeichen und Gliederung.

import type { Id, Notebook, Rect } from '../model/types';
import { getDb } from '../storage/db';
import { normalize, tokenize } from './text';

export type HitKind = 'pdf' | 'text' | 'tag' | 'bookmark' | 'outline';

export interface Hit {
  notebookId: Id;
  notebookTitle: string;
  pageId: Id;
  pageIndex: number;
  kind: HitKind;
  snippet: string;
}

const HIT_LABEL: Record<HitKind, string> = {
  pdf: 'PDF-Text',
  text: 'Textfeld',
  tag: 'Stichwort',
  bookmark: 'Lesezeichen',
  outline: 'Gliederung',
};

export function hitLabel(k: HitKind): string {
  return HIT_LABEL[k];
}

/** Ausschnitt rund um den ersten Treffer. */
export function snippet(text: string, query: string, radius = 50): string {
  const norm = normalize(text);
  const idx = norm.indexOf(normalize(query));
  if (idx < 0) return text.slice(0, radius * 2).trim();
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + query.length + radius);
  return (
    (start > 0 ? '… ' : '') +
    text.slice(start, end).replace(/\s+/g, ' ').trim() +
    (end < text.length ? ' …' : '')
  );
}

/** Passt der Text zur Anfrage? Ganze Phrase oder alle Wörter (als Wortanfang). */
export function matches(text: string, query: string): boolean {
  const norm = normalize(text);
  if (norm.includes(normalize(query))) return true;
  const words = tokenize(text);
  return tokenize(query).every((q) => words.some((w) => w.startsWith(q)));
}

export async function searchContent(
  query: string,
  opts: { notebookId?: Id; limit?: number } = {},
): Promise<Hit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const db = getDb();
  const limit = opts.limit ?? 300;
  const notebooks = new Map<Id, Notebook>();
  for (const n of await db.notebooks.toArray()) if (!n.deletedAt) notebooks.set(n.id, n);
  const scope = (id: Id) => notebooks.has(id) && (!opts.notebookId || id === opts.notebookId);
  const hits: Hit[] = [];
  const push = (notebookId: Id, pageId: Id, kind: HitKind, text: string) => {
    const nb = notebooks.get(notebookId);
    if (!nb) return;
    const pageIndex = nb.pageIds.indexOf(pageId);
    if (pageIndex < 0) return;
    hits.push({ notebookId, notebookTitle: nb.title, pageId, pageIndex, kind, snippet: snippet(text, q) });
  };

  const tokens = tokenize(q).sort((a, b) => b.length - a.length);
  if (tokens[0]) {
    const candidates = await db.textIndex.where('tokens').startsWith(tokens[0]).distinct().toArray();
    for (const e of candidates)
      if (scope(e.notebookId) && matches(e.text, q)) push(e.notebookId, e.pageId, e.source, e.text);
  }
  for (const b of await db.bookmarks.toArray())
    if (scope(b.notebookId) && matches(b.label, q)) push(b.notebookId, b.pageId, 'bookmark', b.label);
  for (const o of await db.outline.toArray())
    if (scope(o.notebookId) && matches(o.title, q)) push(o.notebookId, o.pageId, 'outline', o.title);
  const nq = normalize(q);
  await db.pages
    .filter((p) => p.tags.length > 0 && scope(p.notebookId))
    .each((p) => {
      const tag = p.tags.find((t) => normalize(t).includes(nq));
      if (tag) push(p.notebookId, p.id, 'tag', `#${tag}`);
    });

  hits.sort((a, b) => a.notebookTitle.localeCompare(b.notebookTitle, 'de') || a.pageIndex - b.pageIndex);
  return hits.slice(0, limit);
}

/** Bereiche der Textfelder einer Seite, die die Anfrage enthalten. */
export function textItemRects(
  items: readonly { type: string; bbox: Rect; text?: string }[],
  query: string,
): Rect[] {
  return items.filter((it) => it.type === 'text' && it.text && matches(it.text, query)).map((it) => it.bbox);
}
