import { beforeEach, describe, expect, it } from 'vitest';
import { NotebookDoc } from '../../src/engine/doc/NotebookDoc';
import { History, invert } from '../../src/engine/history/history';
import { createNotebook } from '../../src/storage/library';
import { makePaper } from '../../src/model/paper';
import type { FederDB } from '../../src/storage/db';
import type { Item, Notebook } from '../../src/model/types';
import { freshDb, line } from './helpers';

let db: FederDB;
let nb: Notebook;

beforeEach(async () => {
  db = freshDb();
  nb = await createNotebook({ title: 'Doc', folderId: null, cover: { color: '#000', pattern: 'plain' } });
});

async function open() {
  const doc = await NotebookDoc.load(db, nb.id);
  await doc.ensureItems(doc.pageIds[0]!);
  return doc;
}

function strokeOn(doc: NotebookDoc, pageId: string, z: number): Item {
  return { ...line(z, 0, z + 10, 10), pageId, notebookId: doc.id, z };
}

describe('Verlauf', () => {
  it('kehrt Befehle symmetrisch um', () => {
    const a = line(0, 0, 1, 1);
    const cmd = { label: 'x', items: [{ before: null, after: a }], pages: [] };
    expect(invert(invert(cmd))).toEqual(cmd);
    expect(invert(cmd).items[0]).toEqual({ before: a, after: null });
  });

  it('begrenzt die Länge und verwirft Redo nach neuer Aktion', () => {
    const h = new History(3);
    for (let i = 0; i < 5; i++) h.push({ label: String(i), items: [], pages: [] });
    let undos = 0;
    while (h.undo()) undos++;
    expect(undos).toBe(3);
    h.redo();
    h.push({ label: 'neu', items: [], pages: [] });
    expect(h.canRedo).toBe(false);
  });
});

describe('NotebookDoc', () => {
  it('fügt Striche hinzu, macht sie rückgängig und speichert', async () => {
    const doc = await open();
    const pid = doc.pageIds[0]!;
    const a = strokeOn(doc, pid, 1);
    const b = strokeOn(doc, pid, 2);
    doc.execute({ label: 'Stift', items: [{ before: null, after: b }], pages: [] });
    doc.execute({ label: 'Stift', items: [{ before: null, after: a }], pages: [] });
    expect(doc.getItems(pid)!.map((i) => i.z)).toEqual([1, 2]);
    expect(doc.topZ(pid)).toBe(2);
    doc.undo();
    expect(doc.getItems(pid)).toHaveLength(1);
    doc.redo();
    expect(doc.getItems(pid)).toHaveLength(2);
    await doc.autosave.flush();
    const reloaded = await open();
    expect((await reloaded.ensureItems(pid)).map((i) => i.id)).toEqual([a.id, b.id]);
  });

  it('meldet Änderungen pro Seite', async () => {
    const doc = await open();
    const pid = doc.pageIds[0]!;
    const seen: string[] = [];
    doc.on((c) => seen.push(...c.items.keys()));
    doc.execute({ label: 'Stift', items: [{ before: null, after: strokeOn(doc, pid, 1) }], pages: [] });
    expect(seen).toEqual([pid]);
  });

  it('löscht Seiten mit Inhalt und stellt sie per Undo wieder her', async () => {
    const doc = await open();
    const first = doc.pageIds[0]!;
    const second = doc.addPage(1);
    doc.execute({ label: 'Stift', items: [{ before: null, after: strokeOn(doc, second.id, 1) }], pages: [] });
    expect(await doc.deletePage(second.id)).toBe(true);
    expect(doc.pageIds).toEqual([first]);
    // die letzte Seite lässt sich nicht löschen
    expect(await doc.deletePage(first)).toBe(false);
    await doc.autosave.flush();
    expect(await db.items.where('pageId').equals(second.id).count()).toBe(0);
    doc.undo();
    expect(doc.pageIds).toEqual([first, second.id]);
    expect(doc.getItems(second.id)).toHaveLength(1);
    await doc.autosave.flush();
    expect(await db.items.where('pageId').equals(second.id).count()).toBe(1);
  });

  it('dupliziert, verschiebt und ändert Vorlagen von Seiten', async () => {
    const doc = await open();
    const first = doc.pageIds[0]!;
    doc.execute({ label: 'Stift', items: [{ before: null, after: strokeOn(doc, first, 1) }], pages: [] });
    const copy = await doc.duplicatePage(first);
    expect(doc.pageIds).toEqual([first, copy!.id]);
    expect(doc.getItems(copy!.id)).toHaveLength(1);
    doc.movePage(1, 0);
    expect(doc.pageIds).toEqual([copy!.id, first]);
    const grid = makePaper('a5', 'landscape', 'yellow', 'grid');
    doc.setPaper([first], grid);
    expect(doc.pages.get(first)!.paper).toEqual(grid);
    doc.undo();
    expect(doc.pages.get(first)!.paper.template).toMatchObject({ id: 'ruled' });
    await doc.autosave.flush();
    const stored = await db.notebooks.get(nb.id);
    expect(stored!.pageIds).toEqual([copy!.id, first]);
  });

  it('repariert eine inkonsistente Seitenreihenfolge beim Laden', async () => {
    await db.notebooks.update(nb.id, { pageIds: ['gibt-es-nicht'] });
    const doc = await NotebookDoc.load(db, nb.id);
    expect(doc.pageIds).toEqual(nb.pageIds);
  });
});
