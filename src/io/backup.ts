// Eigenes Dateiformat `.feder` (ZIP ohne Kompression):
//   manifest.json   { app, kind, formatVersion, createdAt, counts }
//   data/<tabelle>.json
//   blobs/<id>      Rohdateien (PDFs …)
// Vollbackup: alle Tabellen. Notizbuch-Datei: ein Notizbuch mit Seiten,
// Inhalten und den zugehörigen PDFs.

import { base64ToFloat32, float32ToBase64 } from '../model/codec';
import { newId } from '../model/ids';
import { migrate, SCHEMA_VERSION, type TableDump } from '../model/migrations';
import type { AudioClip, BlobMeta, Bookmark, Id, Item, Notebook, OutlineEntry, Page } from '../model/types';
import { flushAllAutosaves } from '../storage/autosave';
import { getBlobStore } from '../storage/blobstore';
import { getDb } from '../storage/db';
import { deleteUnusedBlobs } from '../storage/library';
import { createZip, readZip } from './zip';

export type FederFileKind = 'backup' | 'notebook';

export interface Manifest {
  app: 'feder';
  kind: FederFileKind;
  formatVersion: number;
  createdAt: number;
  counts: Record<string, number>;
  title?: string;
}

export const FEDER_MIME = 'application/x-feder';

// ---------- JSON mit Float32Arrays ----------

export function toJson(value: unknown): string {
  // Realm-unabhängig prüfen (IndexedDB kann Arrays aus einem anderen Kontext liefern).
  const isF32 = (v: unknown): v is Float32Array =>
    ArrayBuffer.isView(v) && Object.prototype.toString.call(v) === '[object Float32Array]';
  return JSON.stringify(value, (_k, v: unknown) => (isF32(v) ? { __f32: float32ToBase64(v) } : v));
}

export function fromJson<T>(text: string): T {
  return JSON.parse(text, (_k, v: unknown) =>
    v && typeof v === 'object' && '__f32' in v && typeof (v as { __f32: unknown }).__f32 === 'string'
      ? base64ToFloat32((v as { __f32: string }).__f32)
      : v,
  ) as T;
}

/** Alle Dateien, auf die Seiten, Bilder oder Audioaufnahmen verweisen. */
function blobRefs(pages: Page[], items: Item[], audio: AudioClip[]): Set<Id> {
  const ids = new Set<Id>();
  for (const p of pages) {
    const t = p.paper.template;
    if (t.kind === 'pdf' || t.kind === 'image') ids.add(t.blobId);
  }
  for (const it of items) if (it.type === 'image') ids.add(it.blobId);
  for (const a of audio) ids.add(a.blobId);
  return ids;
}

async function build(
  kind: FederFileKind,
  tables: TableDump,
  blobIds: Iterable<Id>,
  title?: string,
): Promise<Blob> {
  const store = await getBlobStore();
  const db = getDb();
  const entries: { name: string; data: Blob | string }[] = [];
  const metas: BlobMeta[] = [];
  for (const id of blobIds) {
    const meta = await db.blobs.get(id);
    const blob = await store.get(id);
    if (!meta || !blob) continue;
    metas.push(meta);
    entries.push({ name: `blobs/${id}`, data: blob });
  }
  const all: TableDump = { ...tables, blobs: metas };
  const counts = Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.length]));
  const manifest: Manifest = {
    app: 'feder',
    kind,
    formatVersion: SCHEMA_VERSION,
    createdAt: Date.now(),
    counts,
    title,
  };
  return createZip(
    [
      { name: 'manifest.json', data: JSON.stringify(manifest, null, 2) },
      ...Object.entries(all).map(([name, rows]) => ({ name: `data/${name}.json`, data: toJson(rows) })),
      ...entries,
    ],
    FEDER_MIME,
  );
}

/** Tabellen, die ein Vollbackup enthält (textIndex wird mitgesichert, ist aber ableitbar). */
const BACKUP_TABLES = [
  'folders',
  'notebooks',
  'pages',
  'items',
  'settings',
  'elements',
  'bookmarks',
  'outline',
  'textIndex',
  'templates',
  'audio',
  'decks',
  'cards',
] as const;

/** Vollbackup aller Daten als eine Datei. */
export async function exportBackup(): Promise<Blob> {
  await flushAllAutosaves();
  const db = getDb();
  const tables: TableDump = {};
  for (const name of BACKUP_TABLES) tables[name] = await db.table(name).toArray();
  const blob = await build('backup', tables, (await db.blobs.toCollection().primaryKeys()) as Id[]);
  await db.meta.put({ key: 'lastBackupAt', value: Date.now() });
  return blob;
}

/** Ein einzelnes Notizbuch als `.feder`-Datei. */
export async function exportNotebookFile(notebookId: Id): Promise<Blob> {
  await flushAllAutosaves();
  const db = getDb();
  const nb = await db.notebooks.get(notebookId);
  if (!nb) throw new Error('Notizbuch nicht gefunden.');
  const byNb = (t: string) => db.table(t).where('notebookId').equals(notebookId).toArray();
  const pages = (await byNb('pages')) as Page[];
  const items = (await byNb('items')) as Item[];
  const audio = (await byNb('audio')) as AudioClip[];
  const tables: TableDump = {
    notebooks: [nb],
    pages,
    items,
    bookmarks: await byNb('bookmarks'),
    outline: await byNb('outline'),
    audio,
  };
  return build('notebook', tables, blobRefs(pages, items, audio), nb.title);
}

export interface FederFile {
  manifest: Manifest;
  tables: TableDump;
  blob(id: Id): Promise<Blob | null>;
}

/** Liest und prüft eine `.feder`-Datei und hebt sie auf das aktuelle Datenformat. */
export async function readFederFile(file: Blob): Promise<FederFile> {
  const zip = await readZip(file);
  const m = zip.get('manifest.json');
  if (!m) throw new Error('Das ist keine Feder-Datei (manifest.json fehlt).');
  const manifest = JSON.parse(new TextDecoder().decode(await m.read())) as Manifest;
  if (manifest.app !== 'feder') throw new Error('Das ist keine Feder-Datei.');
  const raw: TableDump = {};
  for (const [name, entry] of zip) {
    const match = /^data\/(\w+)\.json$/.exec(name);
    if (!match) continue;
    const rows = fromJson<unknown>(new TextDecoder().decode(await entry.read()));
    if (!Array.isArray(rows)) throw new Error(`Ungültige Daten in ${name}.`);
    raw[match[1]!] = rows;
  }
  const tables = migrate(raw, manifest.formatVersion);
  const metas = new Map(((tables.blobs ?? []) as BlobMeta[]).map((b) => [b.id, b]));
  return {
    manifest,
    tables,
    blob: async (id) => {
      const e = zip.get(`blobs/${id}`);
      return e ? e.blob(metas.get(id)?.mime ?? '') : null;
    },
  };
}

async function writeBlobs(f: FederFile, onlyMissing: boolean): Promise<Set<Id>> {
  const store = await getBlobStore();
  const db = getDb();
  const ids = new Set<Id>();
  for (const meta of (f.tables.blobs ?? []) as BlobMeta[]) {
    ids.add(meta.id);
    if (onlyMissing && (await db.blobs.get(meta.id))) continue;
    const blob = await f.blob(meta.id);
    if (blob) await store.put(blob, meta.id);
  }
  return ids;
}

/** Ersetzt ALLE Daten durch den Inhalt des Backups. */
export async function restoreBackup(f: FederFile): Promise<void> {
  if (f.manifest.kind !== 'backup')
    throw new Error('Diese Datei ist ein einzelnes Notizbuch, kein Vollbackup.');
  await flushAllAutosaves();
  const db = getDb();
  const previousBlobs = (await db.blobs.toCollection().primaryKeys()) as Id[];
  const restored = await writeBlobs(f, false);
  const tables = BACKUP_TABLES.map((n) => db.table(n));
  await db.transaction('rw', tables, async () => {
    for (const table of tables) {
      await table.clear();
      await table.bulkPut((f.tables[table.name] ?? []) as object[]);
    }
  });
  await deleteUnusedBlobs(previousBlobs.filter((id) => !restored.has(id)));
  await db.meta.put({ key: 'lastBackupAt', value: Date.now() });
}

/** Importiert eine Notizbuch-Datei als neues Notizbuch (immer mit neuen IDs). */
export async function importNotebookFile(f: FederFile, folderId: Id | null): Promise<Notebook> {
  if (f.manifest.kind !== 'notebook')
    throw new Error('Diese Datei ist ein Vollbackup. Bitte über Einstellungen → Backup wiederherstellen.');
  const src = (f.tables.notebooks ?? [])[0] as Notebook | undefined;
  if (!src) throw new Error('Die Datei enthält kein Notizbuch.');
  await writeBlobs(f, true);
  const now = Date.now();
  const nbId = newId(now);
  const pageMap = new Map<Id, Id>();
  const pages = ((f.tables.pages ?? []) as Page[]).map((p) => {
    const id = newId();
    pageMap.set(p.id, id);
    return { ...p, id, notebookId: nbId };
  });
  const items = ((f.tables.items ?? []) as Item[])
    .filter((it) => pageMap.has(it.pageId))
    .map((it) => ({ ...it, id: newId(), notebookId: nbId, pageId: pageMap.get(it.pageId)! }));
  const notebook: Notebook = {
    ...src,
    id: nbId,
    folderId,
    pageIds: src.pageIds.map((id) => pageMap.get(id)).filter((x): x is Id => !!x),
    favorite: 0,
    createdAt: now,
    updatedAt: now,
    openedAt: null,
    deletedAt: null,
  };
  const remap = <T extends { id: Id; pageId: Id; notebookId: Id }>(rows: unknown[] | undefined) =>
    ((rows ?? []) as T[])
      .filter((r) => pageMap.has(r.pageId))
      .map((r) => ({ ...r, id: newId(), notebookId: nbId, pageId: pageMap.get(r.pageId)! }));
  const bookmarks = remap<Bookmark>(f.tables.bookmarks);
  const outline = remap<OutlineEntry>(f.tables.outline);
  const audio = ((f.tables.audio ?? []) as AudioClip[]).map((a) => ({ ...a, id: newId(), notebookId: nbId }));
  const db = getDb();
  await db.transaction(
    'rw',
    [db.notebooks, db.pages, db.items, db.bookmarks, db.outline, db.audio],
    async () => {
      await db.notebooks.add(notebook);
      await db.pages.bulkAdd(pages);
      await db.items.bulkAdd(items);
      await db.bookmarks.bulkAdd(bookmarks);
      await db.outline.bulkAdd(outline);
      await db.audio.bulkAdd(audio);
    },
  );
  return notebook;
}

export async function lastBackupAt(): Promise<number | null> {
  const row = await getDb().meta.get('lastBackupAt');
  return typeof row?.value === 'number' ? row.value : null;
}

/** Dateiname ohne Zeichen, die iOS/Windows stören. */
export function safeFileName(title: string, ext: string): string {
  const base =
    title
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'Feder';
  return `${base}.${ext}`;
}
