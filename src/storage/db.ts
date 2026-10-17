import Dexie, { type EntityTable } from 'dexie';
import type {
  AudioClip,
  BlobData,
  BlobMeta,
  Bookmark,
  CustomTemplate,
  Deck,
  ElementDef,
  Flashcard,
  Folder,
  Item,
  Meta,
  Notebook,
  OutlineEntry,
  Page,
  Setting,
  TextIndexEntry,
} from '../model/types';
import { SCHEMA_VERSION, upgradeItemV2 } from '../model/migrations';

export class FederDB extends Dexie {
  folders!: EntityTable<Folder, 'id'>;
  notebooks!: EntityTable<Notebook, 'id'>;
  pages!: EntityTable<Page, 'id'>;
  items!: EntityTable<Item, 'id'>;
  blobs!: EntityTable<BlobMeta, 'id'>;
  blobData!: EntityTable<BlobData, 'id'>;
  settings!: EntityTable<Setting, 'key'>;
  meta!: EntityTable<Meta, 'key'>;
  elements!: EntityTable<ElementDef, 'id'>;
  bookmarks!: EntityTable<Bookmark, 'id'>;
  outline!: EntityTable<OutlineEntry, 'id'>;
  textIndex!: EntityTable<TextIndexEntry, 'id'>;
  templates!: EntityTable<CustomTemplate, 'id'>;
  audio!: EntityTable<AudioClip, 'id'>;
  decks!: EntityTable<Deck, 'id'>;
  cards!: EntityTable<Flashcard, 'id'>;

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
    this.version(2)
      .stores({
        elements: 'id, createdAt',
        bookmarks: 'id, notebookId, pageId',
        outline: 'id, notebookId, pageId',
        textIndex: 'id, notebookId, pageId, *tokens',
        templates: 'id, createdAt',
        audio: 'id, notebookId',
        decks: 'id, notebookId',
        cards: 'id, deckId, due',
      })
      .upgrade(async (tx) => {
        await tx
          .table('items')
          .toCollection()
          .modify((it: Record<string, unknown>) => Object.assign(it, upgradeItemV2(it)));
        await tx.table('meta').put({ key: 'schemaVersion', value: 2 });
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
