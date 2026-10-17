// Bibliotheks-Operationen: Ordner und Notizbücher anlegen, umbenennen,
// verschieben, duplizieren, in den Papierkorb legen und endgültig löschen.
// Alle Schreibvorgänge laufen in Transaktionen.

import { newId } from '../model/ids';
import { DEFAULT_PAPER } from '../model/paper';
import type { CoverSpec, Folder, Id, Item, Notebook, NotebookKind, Page, PaperSpec } from '../model/types';
import { getDb } from './db';
import { getBlobStore } from './blobstore';

export interface NewNotebookInput {
  title: string;
  folderId: Id | null;
  cover: CoverSpec;
  paper?: PaperSpec;
  kind?: NotebookKind;
  /** Papier pro Seite (z. B. beim PDF-Import). Ohne Angabe: eine Seite mit `paper`. */
  pages?: PaperSpec[];
}

export function makePage(notebookId: Id, paper: PaperSpec, now = Date.now()): Page {
  return {
    id: newId(now),
    notebookId,
    paper: structuredClone(paper),
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
}

// ---------- Ordner ----------

export async function createFolder(name: string, parentId: Id | null): Promise<Folder> {
  const now = Date.now();
  const folder: Folder = { id: newId(now), parentId, name, createdAt: now, updatedAt: now, deletedAt: null };
  await getDb().folders.add(folder);
  return folder;
}

export async function renameFolder(id: Id, name: string): Promise<void> {
  await getDb().folders.update(id, { name, updatedAt: Date.now() });
}

/** Alle Nachfahren-Ordner (ohne den Ordner selbst). */
export async function descendantFolderIds(id: Id): Promise<Id[]> {
  const db = getDb();
  const result: Id[] = [];
  let frontier: Id[] = [id];
  while (frontier.length) {
    const children = await db.folders.where('parentId').anyOf(frontier).primaryKeys();
    result.push(...children);
    frontier = children;
  }
  return result;
}

export async function moveFolder(id: Id, parentId: Id | null): Promise<void> {
  if (parentId === id) throw new Error('Ein Ordner kann nicht in sich selbst liegen.');
  if (parentId && (await descendantFolderIds(id)).includes(parentId)) {
    throw new Error('Ein Ordner kann nicht in einen seiner Unterordner verschoben werden.');
  }
  await getDb().folders.update(id, { parentId, updatedAt: Date.now() });
}

/** Pfad von der Wurzel bis zum Ordner (für die Brotkrumen-Navigation). */
export async function folderPath(id: Id | null): Promise<Folder[]> {
  const db = getDb();
  const path: Folder[] = [];
  let current = id;
  const seen = new Set<Id>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const f = await db.folders.get(current);
    if (!f) break;
    path.unshift(f);
    current = f.parentId;
  }
  return path;
}

// ---------- Notizbücher ----------

export async function createNotebook(input: NewNotebookInput): Promise<Notebook> {
  const db = getDb();
  const now = Date.now();
  const paper = input.paper ?? DEFAULT_PAPER;
  const id = newId(now);
  const pages = (input.pages?.length ? input.pages : [paper]).map((p) => makePage(id, p, now));
  const notebook: Notebook = {
    id,
    folderId: input.folderId,
    title: input.title,
    kind: input.kind ?? 'paged',
    cover: input.cover,
    favorite: 0,
    pageIds: pages.map((p) => p.id),
    defaultPaper: structuredClone(paper),
    createdAt: now,
    updatedAt: now,
    openedAt: null,
    deletedAt: null,
  };
  await db.transaction('rw', db.notebooks, db.pages, async () => {
    await db.notebooks.add(notebook);
    await db.pages.bulkAdd(pages);
  });
  return notebook;
}

export async function renameNotebook(id: Id, title: string): Promise<void> {
  await getDb().notebooks.update(id, { title, updatedAt: Date.now() });
}

export async function setFavorite(id: Id, favorite: boolean): Promise<void> {
  await getDb().notebooks.update(id, { favorite: favorite ? 1 : 0 });
}

export async function setCover(id: Id, cover: CoverSpec): Promise<void> {
  await getDb().notebooks.update(id, { cover, updatedAt: Date.now() });
}

export async function moveNotebook(id: Id, folderId: Id | null): Promise<void> {
  await getDb().notebooks.update(id, { folderId, updatedAt: Date.now() });
}

export async function touchOpened(id: Id): Promise<void> {
  await getDb().notebooks.update(id, { openedAt: Date.now() });
}

/** Kopiert ein Notizbuch mit allen Seiten und Inhalten (neue IDs). */
export async function duplicateNotebook(id: Id, targetFolder?: Id | null, title?: string): Promise<Notebook> {
  const db = getDb();
  return db.transaction(
    'rw',
    [db.notebooks, db.pages, db.items, db.textIndex, db.bookmarks, db.outline],
    async () => {
      const src = await db.notebooks.get(id);
      if (!src) throw new Error('Notizbuch nicht gefunden.');
      const now = Date.now();
      const newNbId = newId(now);
      const pageMap = new Map<Id, Id>();
      const pages = await db.pages.where('notebookId').equals(id).toArray();
      const newPages = pages.map((p) => {
        const np: Page = {
          ...structuredClone(p),
          id: newId(),
          notebookId: newNbId,
          createdAt: now,
          updatedAt: now,
        };
        pageMap.set(p.id, np.id);
        return np;
      });
      const items = await db.items.where('notebookId').equals(id).toArray();
      const newItems: Item[] = items.map((it) => ({
        ...structuredClone(it),
        id: newId(),
        notebookId: newNbId,
        pageId: pageMap.get(it.pageId) ?? it.pageId,
      }));
      const copy: Notebook = {
        ...structuredClone(src),
        id: newNbId,
        folderId: targetFolder === undefined ? src.folderId : targetFolder,
        title: title ?? `${src.title} (Kopie)`,
        pageIds: src.pageIds.map((pid) => pageMap.get(pid)).filter((x): x is Id => !!x),
        favorite: 0,
        createdAt: now,
        updatedAt: now,
        openedAt: null,
        deletedAt: null,
      };
      await db.notebooks.add(copy);
      await db.pages.bulkAdd(newPages);
      await db.items.bulkAdd(newItems);
      // Suchindex, Lesezeichen und Gliederung mitkopieren
      const remap = <T extends { pageId: Id }>(rows: T[]) =>
        rows
          .filter((r) => pageMap.has(r.pageId))
          .map((r) => ({ ...r, notebookId: newNbId, pageId: pageMap.get(r.pageId)! }));
      const index = await db.textIndex.where('notebookId').equals(id).toArray();
      await db.textIndex.bulkPut(remap(index).map((r) => ({ ...r, id: `${r.pageId}:${r.source}` })));
      await db.bookmarks.bulkAdd(
        remap(await db.bookmarks.where('notebookId').equals(id).toArray()).map((r) => ({
          ...r,
          id: newId(),
        })),
      );
      await db.outline.bulkAdd(
        remap(await db.outline.where('notebookId').equals(id).toArray()).map((r) => ({ ...r, id: newId() })),
      );
      return copy;
    },
  );
}

/** Kopiert einen Ordner rekursiv mit allen Unterordnern und Notizbüchern. */
export async function duplicateFolder(id: Id, targetParent?: Id | null): Promise<Folder> {
  const db = getDb();
  const src = await db.folders.get(id);
  if (!src) throw new Error('Ordner nicht gefunden.');
  const copy = await createFolder(
    `${src.name} (Kopie)`,
    targetParent === undefined ? src.parentId : targetParent,
  );
  await copyFolderContents(id, copy.id);
  return copy;
}

async function copyFolderContents(fromId: Id, toId: Id): Promise<void> {
  const db = getDb();
  const notebooks = await db.notebooks
    .where('folderId')
    .equals(fromId)
    .filter((n) => !n.deletedAt)
    .toArray();
  for (const nb of notebooks) await duplicateNotebook(nb.id, toId, nb.title);
  const folders = await db.folders
    .where('parentId')
    .equals(fromId)
    .filter((f) => !f.deletedAt)
    .toArray();
  for (const f of folders) {
    const child = await createFolder(f.name, toId);
    await copyFolderContents(f.id, child.id);
  }
}

// ---------- Papierkorb ----------

export interface Selection {
  folders: Id[];
  notebooks: Id[];
}

export async function moveToTrash(sel: Selection): Promise<void> {
  const db = getDb();
  const now = Date.now();
  await db.transaction('rw', db.folders, db.notebooks, async () => {
    for (const id of sel.folders) await db.folders.update(id, { deletedAt: now });
    for (const id of sel.notebooks) await db.notebooks.update(id, { deletedAt: now });
  });
}

export async function restoreFromTrash(sel: Selection): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.folders, db.notebooks, async () => {
    // Liegt der Elternordner selbst im Papierkorb oder fehlt er, wandert das Element in die Wurzel.
    const parentAlive = async (pid: Id | null) => {
      if (!pid) return true;
      const p = await db.folders.get(pid);
      return !!p && !p.deletedAt;
    };
    for (const id of sel.folders) {
      const f = await db.folders.get(id);
      if (!f) continue;
      await db.folders.update(id, {
        deletedAt: null,
        parentId: (await parentAlive(f.parentId)) ? f.parentId : null,
      });
    }
    for (const id of sel.notebooks) {
      const n = await db.notebooks.get(id);
      if (!n) continue;
      await db.notebooks.update(id, {
        deletedAt: null,
        folderId: (await parentAlive(n.folderId)) ? n.folderId : null,
      });
    }
  });
}

/** Löscht endgültig – inklusive Unterordnern, Seiten und Inhalten. */
export async function deletePermanently(sel: Selection): Promise<void> {
  const db = getDb();
  const folderIds = new Set<Id>();
  for (const id of sel.folders) {
    folderIds.add(id);
    for (const d of await descendantFolderIds(id)) folderIds.add(d);
  }
  const notebookIds = new Set<Id>(sel.notebooks);
  if (folderIds.size) {
    const inFolders = await db.notebooks
      .where('folderId')
      .anyOf([...folderIds])
      .primaryKeys();
    inFolders.forEach((id) => notebookIds.add(id));
  }
  const nbIds = [...notebookIds];
  const blobIds = new Set<Id>();
  if (nbIds.length) {
    for (const p of await db.pages.where('notebookId').anyOf(nbIds).toArray()) {
      const t = p.paper.template;
      if (t.kind === 'pdf' || t.kind === 'image') blobIds.add(t.blobId);
    }
    for (const it of await db.items.where('notebookId').anyOf(nbIds).toArray()) {
      if (it.type === 'image') blobIds.add(it.blobId);
    }
    for (const a of await db.audio.where('notebookId').anyOf(nbIds).toArray()) blobIds.add(a.blobId);
  }
  const related = [db.bookmarks, db.outline, db.textIndex, db.audio];
  await db.transaction('rw', [db.folders, db.notebooks, db.pages, db.items, ...related], async () => {
    if (nbIds.length) for (const t of related) await t.where('notebookId').anyOf(nbIds).delete();
    if (nbIds.length) {
      await db.items.where('notebookId').anyOf(nbIds).delete();
      await db.pages.where('notebookId').anyOf(nbIds).delete();
      await db.notebooks.bulkDelete(nbIds);
    }
    await db.folders.bulkDelete([...folderIds]);
  });
  await deleteUnusedBlobs(blobIds);
}

/** Löscht Dateien (PDFs, Bilder, Audio), auf die nichts mehr verweist. */
export async function deleteUnusedBlobs(candidates: Iterable<Id>): Promise<void> {
  const ids = new Set(candidates);
  if (!ids.size) return;
  const db = getDb();
  await db.pages.each((p) => {
    const t = p.paper.template;
    if (t.kind === 'pdf' || t.kind === 'image') ids.delete(t.blobId);
  });
  if (ids.size) await db.items.each((it) => void (it.type === 'image' && ids.delete(it.blobId)));
  if (ids.size) await db.templates.each((t) => void ids.delete(t.blobId));
  if (ids.size) await db.audio.each((a) => void ids.delete(a.blobId));
  if (!ids.size) return;
  const store = await getBlobStore();
  for (const id of ids) await store.delete(id);
}

export async function emptyTrash(): Promise<void> {
  const db = getDb();
  const folders = await db.folders.filter((f) => !!f.deletedAt).primaryKeys();
  const notebooks = await db.notebooks.filter((n) => !!n.deletedAt).primaryKeys();
  await deletePermanently({ folders, notebooks });
}
