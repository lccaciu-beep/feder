import { beforeEach, describe, expect, it } from 'vitest';
import * as lib from '../../src/storage/library';
import { freshDb, line } from './helpers';
import type { FederDB } from '../../src/storage/db';

const cover = { color: '#1f2d4d', pattern: 'plain' as const };
let db: FederDB;

beforeEach(() => {
  db = freshDb();
});

describe('Bibliothek', () => {
  it('legt ein Notizbuch mit erster Seite an', async () => {
    const nb = await lib.createNotebook({ title: 'Mathe', folderId: null, cover });
    const pages = await db.pages.where('notebookId').equals(nb.id).toArray();
    expect(pages).toHaveLength(1);
    expect(nb.pageIds).toEqual([pages[0]!.id]);
  });

  it('verhindert Ordner-Zyklen', async () => {
    const a = await lib.createFolder('A', null);
    const b = await lib.createFolder('B', a.id);
    const c = await lib.createFolder('C', b.id);
    await expect(lib.moveFolder(a.id, c.id)).rejects.toThrow();
    await expect(lib.moveFolder(a.id, a.id)).rejects.toThrow();
    await lib.moveFolder(c.id, null);
    expect((await db.folders.get(c.id))!.parentId).toBeNull();
  });

  it('liefert den Ordnerpfad für die Navigation', async () => {
    const a = await lib.createFolder('Uni', null);
    const b = await lib.createFolder('Mathe', a.id);
    expect((await lib.folderPath(b.id)).map((f) => f.name)).toEqual(['Uni', 'Mathe']);
  });

  it('dupliziert Notizbücher mit Seiten und Inhalten unter neuen IDs', async () => {
    const nb = await lib.createNotebook({ title: 'Original', folderId: null, cover });
    const pageId = nb.pageIds[0]!;
    await db.items.add({ ...line(0, 0, 10, 10), pageId, notebookId: nb.id });
    const copy = await lib.duplicateNotebook(nb.id);
    expect(copy.title).toBe('Original (Kopie)');
    expect(copy.id).not.toBe(nb.id);
    expect(copy.pageIds[0]).not.toBe(pageId);
    const items = await db.items.where('notebookId').equals(copy.id).toArray();
    expect(items).toHaveLength(1);
    expect(items[0]!.pageId).toBe(copy.pageIds[0]);
    expect(Array.from((items[0] as { points: Float32Array }).points)).toHaveLength(84);
  });

  it('dupliziert Ordner rekursiv', async () => {
    const a = await lib.createFolder('A', null);
    const sub = await lib.createFolder('Sub', a.id);
    await lib.createNotebook({ title: 'N1', folderId: a.id, cover });
    await lib.createNotebook({ title: 'N2', folderId: sub.id, cover });
    const copy = await lib.duplicateFolder(a.id);
    const subCopies = await db.folders.where('parentId').equals(copy.id).toArray();
    expect(subCopies.map((f) => f.name)).toEqual(['Sub']);
    expect(await db.notebooks.where('folderId').equals(copy.id).count()).toBe(1);
    expect(await db.notebooks.where('folderId').equals(subCopies[0]!.id).count()).toBe(1);
  });

  it('legt in den Papierkorb und stellt wieder her', async () => {
    const f = await lib.createFolder('F', null);
    const nb = await lib.createNotebook({ title: 'N', folderId: f.id, cover });
    await lib.moveToTrash({ folders: [f.id], notebooks: [nb.id] });
    expect((await db.folders.get(f.id))!.deletedAt).not.toBeNull();
    // Notizbuch zuerst wiederherstellen: Ordner liegt noch im Papierkorb → Wurzel
    await lib.restoreFromTrash({ folders: [], notebooks: [nb.id] });
    expect((await db.notebooks.get(nb.id))!.folderId).toBeNull();
    await lib.restoreFromTrash({ folders: [f.id], notebooks: [] });
    expect((await db.folders.get(f.id))!.deletedAt).toBeNull();
  });

  it('löscht endgültig samt Unterordnern, Seiten und Inhalten', async () => {
    const f = await lib.createFolder('F', null);
    const sub = await lib.createFolder('Sub', f.id);
    const nb = await lib.createNotebook({ title: 'N', folderId: sub.id, cover });
    await db.items.add({ ...line(0, 0, 5, 5), pageId: nb.pageIds[0]!, notebookId: nb.id });
    const keep = await lib.createNotebook({ title: 'Bleibt', folderId: null, cover });
    await lib.moveToTrash({ folders: [f.id], notebooks: [] });
    await lib.emptyTrash();
    expect(await db.folders.count()).toBe(0);
    expect(await db.notebooks.toArray()).toEqual([expect.objectContaining({ id: keep.id })]);
    expect(await db.pages.where('notebookId').equals(nb.id).count()).toBe(0);
    expect(await db.items.count()).toBe(0);
  });
});
