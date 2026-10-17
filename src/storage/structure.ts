// Lesezeichen und Gliederung eines Notizbuchs.

import { newId } from '../model/ids';
import type { Bookmark, Id, OutlineEntry } from '../model/types';
import { getDb } from './db';

export async function toggleBookmark(notebookId: Id, pageId: Id, label: string): Promise<boolean> {
  const db = getDb();
  const existing = await db.bookmarks.where('pageId').equals(pageId).first();
  if (existing) {
    await db.bookmarks.delete(existing.id);
    return false;
  }
  const b: Bookmark = { id: newId(), notebookId, pageId, label, createdAt: Date.now() };
  await db.bookmarks.add(b);
  return true;
}

export async function renameBookmark(id: Id, label: string): Promise<void> {
  await getDb().bookmarks.update(id, { label });
}

export async function addOutline(
  notebookId: Id,
  pageId: Id,
  title: string,
  level = 0,
): Promise<OutlineEntry> {
  const db = getDb();
  const last = await db.outline.where('notebookId').equals(notebookId).toArray();
  const order = last.reduce((m, o) => Math.max(m, o.order), -1) + 1;
  const e: OutlineEntry = { id: newId(), notebookId, pageId, title, level, order };
  await db.outline.add(e);
  return e;
}

export async function updateOutline(
  id: Id,
  patch: Partial<Pick<OutlineEntry, 'title' | 'level'>>,
): Promise<void> {
  await getDb().outline.update(id, patch);
}

export async function deleteOutline(id: Id): Promise<void> {
  await getDb().outline.delete(id);
}
