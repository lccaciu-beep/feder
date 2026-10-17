import { beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { createZip, crc32, readZip } from '../../src/io/zip';
import {
  exportBackup,
  exportNotebookFile,
  fromJson,
  importNotebookFile,
  lastBackupAt,
  readFederFile,
  restoreBackup,
  safeFileName,
  toJson,
} from '../../src/io/backup';
import { apply, exportNotebookPdf, userToDisplay } from '../../src/pdf/export';
import { getBlobStore } from '../../src/storage/blobstore';
import { createFolder, createNotebook, deletePermanently } from '../../src/storage/library';
import { makePaper } from '../../src/model/paper';
import type { FederDB } from '../../src/storage/db';
import type { Notebook, PaperSpec, StrokeItem } from '../../src/model/types';
import { freshDb, line } from './helpers';

let db: FederDB;
const cover = { color: '#1f2d4d', pattern: 'plain' as const };

beforeEach(() => {
  db = freshDb();
});

async function withStroke(nb: Notebook, extra: Partial<StrokeItem> = {}) {
  const s = { ...line(50, 50, 300, 120, 30), pageId: nb.pageIds[0]!, notebookId: nb.id, ...extra };
  await db.items.add(s);
  return s;
}

async function samplePdf(rotate = 0): Promise<BlobPart> {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([400, 600]);
  p1.drawText('Feder Test', { x: 50, y: 500, size: 24 });
  if (rotate) p1.setRotation(degrees(rotate));
  doc.addPage([600, 400]);
  return (await doc.save()) as BlobPart;
}

describe('ZIP', () => {
  it('berechnet CRC32 korrekt', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('schreibt und liest Text, Binärdaten und Umlaut-Namen', async () => {
    const bin = new Uint8Array(70_000).map((_, i) => i % 251);
    const zip = await createZip([
      { name: 'manifest.json', data: '{"a":1}' },
      { name: 'data/Übersicht.json', data: '[]' },
      { name: 'blobs/x', data: bin },
    ]);
    const entries = await readZip(zip);
    expect([...entries.keys()]).toEqual(['manifest.json', 'data/Übersicht.json', 'blobs/x']);
    expect(new TextDecoder().decode(await entries.get('manifest.json')!.read())).toBe('{"a":1}');
    expect(await entries.get('blobs/x')!.read()).toEqual(bin);
  });

  it('erkennt beschädigte Dateien', async () => {
    const zip = new Uint8Array(await (await createZip([{ name: 'a', data: 'hallo welt' }])).arrayBuffer());
    zip[32] ^= 0xff; // ein Datenbyte kippen
    const entries = await readZip(new Blob([zip as BlobPart]));
    await expect(entries.get('a')!.read()).rejects.toThrow(/Prüfsumme/);
    await expect(readZip(new Blob(['kein zip']))).rejects.toThrow();
  });
});

describe('Feder-Datei und Backup', () => {
  it('kodiert Float32Arrays verlustfrei in JSON', () => {
    const v = { points: new Float32Array([1.5, -2, 3.25]) };
    expect(fromJson<typeof v>(toJson(v)).points).toEqual(v.points);
  });

  it('stellt ein Vollbackup inklusive PDFs wieder her und ersetzt alles andere', async () => {
    const folder = await createFolder('Uni', null);
    const nb = await createNotebook({ title: 'Analysis', folderId: folder.id, cover });
    const s = await withStroke(nb);
    const pdf = await (await getBlobStore()).put(new Blob([await samplePdf()], { type: 'application/pdf' }));
    await db.pages.update(nb.pageIds[0]!, {
      'paper.template': { kind: 'pdf', blobId: pdf.id, pageIndex: 0 },
    });
    await db.settings.put({ key: 'app', value: { theme: 'dark' } });

    const backup = await exportBackup();
    expect(await lastBackupAt()).not.toBeNull();

    // Danach geändert: neues Notizbuch, das nach dem Wiederherstellen weg sein muss
    const later = await createNotebook({ title: 'Später', folderId: null, cover });
    await deletePermanently({ folders: [folder.id], notebooks: [] });
    expect(await db.items.count()).toBe(0);

    await restoreBackup(await readFederFile(backup));
    expect(await db.notebooks.get(later.id)).toBeUndefined();
    expect((await db.notebooks.get(nb.id))!.title).toBe('Analysis');
    expect((await db.folders.get(folder.id))!.name).toBe('Uni');
    const restored = (await db.items.get(s.id)) as StrokeItem;
    expect(Array.from(restored.points)).toEqual(Array.from(s.points));
    const blob = await (await getBlobStore()).get(pdf.id);
    expect(blob?.size).toBe(pdf.size);
    expect((await db.settings.get('app'))!.value).toEqual({ theme: 'dark' });
  });

  it('importiert eine Notizbuch-Datei als unabhängige Kopie', async () => {
    const nb = await createNotebook({ title: 'Physik', folderId: null, cover });
    await withStroke(nb);
    const file = await exportNotebookFile(nb.id);
    const f = await readFederFile(file);
    expect(f.manifest.kind).toBe('notebook');
    const target = await createFolder('Import', null);
    const copy = await importNotebookFile(f, target.id);
    expect(copy.id).not.toBe(nb.id);
    expect(copy.folderId).toBe(target.id);
    expect(copy.pageIds).toHaveLength(1);
    expect(copy.pageIds[0]).not.toBe(nb.pageIds[0]);
    expect(await db.items.where('notebookId').equals(copy.id).count()).toBe(1);
    expect(await db.items.where('notebookId').equals(nb.id).count()).toBe(1);
  });

  it('verwechselt Backup und Notizbuch nicht', async () => {
    const nb = await createNotebook({ title: 'X', folderId: null, cover });
    const asNotebook = await readFederFile(await exportNotebookFile(nb.id));
    await expect(restoreBackup(asNotebook)).rejects.toThrow(/kein Vollbackup/);
    const asBackup = await readFederFile(await exportBackup());
    await expect(importNotebookFile(asBackup, null)).rejects.toThrow(/Vollbackup/);
  });

  it('erzeugt sichere Dateinamen', () => {
    expect(safeFileName('Mathe: Teil 1/2?', 'pdf')).toBe('Mathe Teil 1 2.pdf');
    expect(safeFileName('   ', 'feder')).toBe('Feder.feder');
  });
});

describe('PDF-Export', () => {
  it('bildet die Ecken jeder Drehung richtig ab', () => {
    const box = { x: 10, y: 20, width: 400, height: 600 };
    // linke obere Ecke der Anzeige entspricht je nach Drehung einer anderen PDF-Ecke
    expect(apply(userToDisplay(0, box), 10, 620)).toEqual([0, 0]);
    expect(apply(userToDisplay(90, box), 10, 20)).toEqual([0, 0]);
    expect(apply(userToDisplay(180, box), 410, 20)).toEqual([0, 0]);
    expect(apply(userToDisplay(270, box), 410, 620)).toEqual([0, 0]);
    // gegenüberliegende Ecke = (Anzeigebreite, Anzeigehöhe)
    expect(apply(userToDisplay(90, box), 410, 620)).toEqual([600, 400]);
  });

  it('exportiert eigene Seiten mit Vorlage und Handschrift', async () => {
    const paper: PaperSpec = makePaper('a5', 'landscape', 'yellow', 'planner-week');
    const nb = await createNotebook({ title: 'Woche', folderId: null, cover, paper });
    await withStroke(nb);
    await withStroke(nb, { id: 'hl', tool: 'highlighter', opacity: 0.4, color: '#f5d33c', width: 10, z: 0 });
    await withStroke(nb, { id: 'dash', dash: 'dashed', z: 3 });
    const blob = await exportNotebookPdf(nb.id, { withTemplate: true });
    const out = await PDFDocument.load(await blob.arrayBuffer());
    expect(out.getPageCount()).toBe(1);
    const { width, height } = out.getPage(0).getSize();
    expect(width).toBeCloseTo(paper.width);
    expect(height).toBeCloseTo(paper.height);
    const without = await exportNotebookPdf(nb.id, { withTemplate: false });
    expect(without.size).toBeLessThan(blob.size);
  });

  it('übernimmt importierte PDF-Seiten samt Drehung', async () => {
    const meta = await (
      await getBlobStore()
    ).put(new Blob([await samplePdf(90)], { type: 'application/pdf' }));
    const pdfPage = (i: number, w: number, h: number): PaperSpec => ({
      width: w,
      height: h,
      color: 'white',
      template: { kind: 'pdf', blobId: meta.id, pageIndex: i },
    });
    const nb = await createNotebook({
      title: 'Skript',
      folderId: null,
      cover,
      pages: [pdfPage(0, 600, 400), pdfPage(1, 600, 400)],
    });
    await withStroke(nb);
    const blob = await exportNotebookPdf(nb.id, { withTemplate: true, pageIds: [nb.pageIds[0]!] });
    const out = await PDFDocument.load(await blob.arrayBuffer());
    expect(out.getPageCount()).toBe(1);
    expect(out.getPage(0).getRotation().angle).toBe(90);
    expect(out.getTitle()).toBe('Skript');
  });
});

describe('Aufräumen', () => {
  it('löscht PDFs erst, wenn keine Seite sie mehr braucht', async () => {
    const meta = await (await getBlobStore()).put(new Blob([await samplePdf()], { type: 'application/pdf' }));
    const paper: PaperSpec = {
      width: 400,
      height: 600,
      color: 'white',
      template: { kind: 'pdf', blobId: meta.id, pageIndex: 0 },
    };
    const a = await createNotebook({ title: 'A', folderId: null, cover, pages: [paper] });
    const b = await createNotebook({ title: 'B', folderId: null, cover, pages: [paper] });
    await deletePermanently({ folders: [], notebooks: [a.id] });
    expect(await db.blobs.get(meta.id)).toBeDefined();
    await deletePermanently({ folders: [], notebooks: [b.id] });
    expect(await db.blobs.get(meta.id)).toBeUndefined();
  });
});

describe('PDF-Export aller Elementtypen', () => {
  it('exportiert Formen, Text und Tape ohne Fehler', async () => {
    const nb = await createNotebook({ title: 'Mix', folderId: null, cover });
    const base = {
      pageId: nb.pageIds[0]!,
      notebookId: nb.id,
      createdAt: 0,
      bbox: { x: 0, y: 0, w: 10, h: 10 },
    };
    await db.items.bulkAdd([
      {
        ...base,
        id: 's1',
        z: 1,
        type: 'shape',
        shape: 'ellipse',
        vertices: [100, 100, 40, 20],
        rotation: 0.3,
        stroke: '#123456',
        fill: '#123456',
        fillOpacity: 0.2,
        width: 2,
        dash: 'dashed',
        opacity: 1,
      },
      {
        ...base,
        id: 's2',
        z: 2,
        type: 'shape',
        shape: 'arrow',
        vertices: [10, 10, 200, 80],
        rotation: 0,
        stroke: '#000',
        fill: null,
        fillOpacity: 0.2,
        width: 1.5,
        dash: 'solid',
        opacity: 1,
      },
      {
        ...base,
        id: 't1',
        z: 3,
        type: 'text',
        box: { x: 50, y: 300, w: 200, h: 40 },
        rotation: 0.2,
        text: 'Grüße – Prüfung ✓ 你好',
        style: { font: 'serif', size: 14, color: '#2747c9', align: 'center', bold: true, italic: false },
      },
      {
        ...base,
        id: 'tp',
        z: 4,
        type: 'tape',
        path: [40, 500, 300, 500],
        width: 18,
        color: '#e8a33d',
        covered: true,
      },
    ] as never);
    const blob = await exportNotebookPdf(nb.id, { withTemplate: true });
    const out = await PDFDocument.load(await blob.arrayBuffer());
    expect(out.getPageCount()).toBe(1);
  });
});
