import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Autosave, type SaveStatus } from '../../src/storage/autosave';
import { createNotebook } from '../../src/storage/library';
import type { FederDB } from '../../src/storage/db';
import type { Notebook, StrokeItem } from '../../src/model/types';
import { freshDb, line } from './helpers';

let db: FederDB;
let nb: Notebook;

beforeEach(async () => {
  db = freshDb();
  nb = await createNotebook({ title: 'T', folderId: null, cover: { color: '#000', pattern: 'plain' } });
});

const item = (x: number) => ({ ...line(x, 0, x + 10, 10), pageId: nb.pageIds[0]!, notebookId: nb.id });

describe('Autosave', () => {
  it('fasst mehrere Änderungen am selben Datensatz zusammen', async () => {
    const save = new Autosave(db, { debounceMs: 10_000 });
    const a = item(0);
    save.enqueue([{ table: 'items', type: 'put', value: a }]);
    save.enqueue([{ table: 'items', type: 'put', value: { ...a, color: '#f00' } }]);
    expect(save.size).toBe(1);
    await save.flush();
    expect(((await db.items.get(a.id)) as StrokeItem).color).toBe('#f00');
  });

  it('schreibt Löschungen und aktualisiert das Änderungsdatum', async () => {
    const save = new Autosave(db);
    const a = item(0);
    await db.items.add(a);
    const before = (await db.notebooks.get(nb.id))!.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    save.enqueue([
      { table: 'items', type: 'delete', key: a.id, pageId: a.pageId },
      { table: 'items', type: 'put', value: item(20) },
    ]);
    await save.flush();
    expect(await db.items.get(a.id)).toBeUndefined();
    expect(await db.items.count()).toBe(1);
    // Löschen allein trägt keine notebookId – das Put schon
    expect((await db.notebooks.get(nb.id))!.updatedAt).toBeGreaterThan(before);
  });

  it('speichert gedrosselt nach der Wartezeit', async () => {
    // echte Timer: fake-indexeddb braucht selbst setTimeout/setImmediate
    const save = new Autosave(db, { debounceMs: 80, maxWaitMs: 1000 });
    const statuses: SaveStatus[] = [];
    save.onStatus((s) => statuses.push(s));
    save.enqueue([{ table: 'items', type: 'put', value: item(0) }]);
    expect(save.getStatus()).toBe('pending');
    await new Promise((r) => setTimeout(r, 30));
    expect(await db.items.count()).toBe(0);
    await new Promise((r) => setTimeout(r, 250));
    expect(await db.items.count()).toBe(1);
    expect(statuses).toEqual(['pending', 'saving', 'saved']);
  });

  it('legt fehlgeschlagene Ops zurück, ohne neuere zu überschreiben', async () => {
    const save = new Autosave(db, { debounceMs: 10_000, retryMs: 10_000 });
    const a = item(0);
    const spy = vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('Speicher voll'));
    save.enqueue([{ table: 'items', type: 'put', value: a }]);
    await save.flush();
    expect(save.getStatus()).toBe('error');
    expect(save.size).toBe(1);
    // neuere Version desselben Datensatzes gewinnt
    save.enqueue([{ table: 'items', type: 'put', value: { ...a, color: '#0a0' } }]);
    spy.mockRestore();
    await save.flush();
    expect(save.getStatus()).toBe('saved');
    expect(((await db.items.get(a.id)) as StrokeItem).color).toBe('#0a0');
  });

  it('meldet ausstehende Änderungen pro Seite', () => {
    const save = new Autosave(db, { debounceMs: 10_000 });
    const a = item(0);
    save.enqueue([{ table: 'items', type: 'delete', key: a.id, pageId: a.pageId }]);
    expect(save.hasPendingForPage(a.pageId)).toBe(true);
    expect(save.hasPendingForPage('andere')).toBe(false);
  });
});
