import { beforeEach, describe, expect, it } from 'vitest';
import { matches, searchContent, snippet } from '../../src/search/query';
import { NotebookDoc } from '../../src/engine/doc/NotebookDoc';
import { createNotebook } from '../../src/storage/library';
import { addOutline, toggleBookmark } from '../../src/storage/structure';
import { tokenize } from '../../src/search/text';
import type { FederDB } from '../../src/storage/db';
import type { TextItem } from '../../src/model/types';
import { freshDb } from './helpers';

let db: FederDB;
const cover = { color: '#000', pattern: 'plain' as const };

beforeEach(() => {
  db = freshDb();
});

describe('Suche', () => {
  it('findet Phrasen und Wortanfänge ohne Umlaut-Probleme', () => {
    expect(matches('Die Übungsaufgabe zur Analysis', 'ubungs')).toBe(true);
    expect(matches('Die Übungsaufgabe zur Analysis', 'analysis übung')).toBe(true);
    expect(matches('Lineare Algebra', 'analysis')).toBe(false);
    expect(snippet('a'.repeat(100) + ' Treffer ' + 'b'.repeat(100), 'treffer', 10)).toBe(
      '… aaaaaaaaa Treffer bbbbbbbbb …',
    );
  });

  it('durchsucht PDF-Text, Lesezeichen, Gliederung und Stichworte', async () => {
    const nb = await createNotebook({ title: 'Mathe', folderId: null, cover });
    const other = await createNotebook({ title: 'Bio', folderId: null, cover });
    const p = nb.pageIds[0]!;
    await db.textIndex.put({
      id: `${p}:pdf`,
      notebookId: nb.id,
      pageId: p,
      source: 'pdf',
      text: 'Satz des Pythagoras',
      tokens: tokenize('Satz des Pythagoras'),
    });
    await db.textIndex.put({
      id: `${other.pageIds[0]}:pdf`,
      notebookId: other.id,
      pageId: other.pageIds[0]!,
      source: 'pdf',
      text: 'Pythagoras im Garten',
      tokens: tokenize('Pythagoras im Garten'),
    });
    await toggleBookmark(nb.id, p, 'Wichtige Formel');
    await addOutline(nb.id, p, 'Kapitel Geometrie');
    await db.pages.update(p, { tags: ['klausur'] });

    const all = await searchContent('pythagoras');
    expect(all.map((h) => h.notebookTitle).sort()).toEqual(['Bio', 'Mathe']);
    const scoped = await searchContent('pythagoras', { notebookId: nb.id });
    expect(scoped).toHaveLength(1);
    expect(scoped[0]).toMatchObject({ kind: 'pdf', pageIndex: 0 });
    expect((await searchContent('formel'))[0]!.kind).toBe('bookmark');
    expect((await searchContent('geometrie'))[0]!.kind).toBe('outline');
    expect((await searchContent('klaus'))[0]!.kind).toBe('tag');
  });

  it('indexiert Textfelder und Stichworte über das Notizbuch', async () => {
    const nb = await createNotebook({ title: 'Notizen', folderId: null, cover });
    const doc = await NotebookDoc.load(db, nb.id);
    const p = doc.pageIds[0]!;
    await doc.ensureItems(p);
    const t: TextItem = {
      id: 't1',
      type: 'text',
      pageId: p,
      notebookId: nb.id,
      z: 1,
      createdAt: 0,
      box: { x: 0, y: 0, w: 100, h: 20 },
      bbox: { x: 0, y: 0, w: 100, h: 20 },
      rotation: 0,
      text: 'Termin beim Zahnarzt',
      style: { font: 'sans', size: 12, color: '#000', align: 'left', bold: false, italic: false },
    };
    doc.execute({ label: 'Text', items: [{ before: null, after: t }], pages: [] });
    doc.setTags(p, [' privat ', 'privat', '']);
    await doc.flushReindex();
    await doc.autosave.flush();
    expect((await searchContent('zahnarzt')).map((h) => h.kind)).toEqual(['text']);
    expect((await db.pages.get(p))!.tags).toEqual(['privat']);
    doc.undo(); // Stichworte zurück
    doc.undo(); // Text weg
    await doc.flushReindex();
    expect(await searchContent('zahnarzt')).toEqual([]);
  });
});
