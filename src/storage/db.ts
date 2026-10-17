import Dexie, { type EntityTable } from 'dexie';
import type { BlobData, BlobMeta, Folder, Item, Meta, Notebook, Page, Setting } from '../model/types';
import { SCHEMA_VERSION } from '../model/migrations';

export class FederDB extends Dexie {
  folders!: EntityTable<Folder, 'id'>;
  notebooks!: EntityTable<Notebook, 'id'>;
  pages!: EntityTable<Page, 'id'>;
  items!: EntityTable<Item, 'id'>;
  blobs!: EntityTable<BlobMeta, 'id'>;
  blobData!: EntityTable<BlobData, 'id'>;
  settings!: EntityTable<Setting, 'key'>;
  meta!: EntityTable<Meta, 'key'>;

  constructor(name = 'feder') {
    super(name);
    // Schema v1. Neue Versionen werden hier angehängt, Daten-Migrationen
    // stehen in model/migrations und laufen in .upgrade().
    this.version(1).stores({
      folders: 'id, parentId, deletedAt',
      notebooks: 'id, folderId, deletedAt, openedAt, favorite, updatedAt',
      pages: 'id, notebookId',
      items: 'id, pageId, notebookId, [pageId+z]',
      blobs: 'id',
      blobData: 'id',
      settings: 'key',
      meta: 'key',
    });
    this.on('populate', (tx) => {
      void tx.table('meta').add({ key: 'schemaVersion', value: SCHEMA_VERSION });
    });
  }
}

let instance: FederDB | null = null;

export function getDb(): FederDB {
  instance ??= new FederDB();
  return instance;
}

/** Nur für Tests: eigene Datenbank setzen. */
export function setDb(db: FederDB | null): void {
  instance = db;
}
