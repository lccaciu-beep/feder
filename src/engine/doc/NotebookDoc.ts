// Das geöffnete Notizbuch im Arbeitsspeicher. Alle Änderungen laufen als
// Befehle hierüber: sie aktualisieren das Modell, landen im Verlauf und
// gehen gedrosselt an das Autosave.

import { newId } from '../../model/ids';
import type { Id, Item, Notebook, Page, PaperSpec } from '../../model/types';
import type { FederDB } from '../../storage/db';
import { Autosave, type Op } from '../../storage/autosave';
import { makePage } from '../../storage/library';
import { History, isEmpty, type Change, type Command } from '../history/history';
import { tokenize } from '../../search/text';

export interface PageItemChange {
  added: Item[];
  removed: Item[];
}

export interface DocChange {
  /** Inhaltsänderungen pro Seite */
  items: Map<Id, PageItemChange>;
  /** Seiten, deren Papier/Metadaten sich geändert haben */
  pages: Set<Id>;
  /** Reihenfolge oder Anzahl der Seiten hat sich geändert */
  structure: boolean;
}

type Listener = (change: DocChange) => void;

const MAX_LOADED_PAGES = 40;

export class NotebookDoc {
  notebook: Notebook;
  readonly pages = new Map<Id, Page>();
  private items = new Map<Id, Item[]>();
  private loading = new Map<Id, Promise<Item[]>>();
  private lru: Id[] = [];
  readonly history = new History();
  private listeners = new Set<Listener>();
  /** Seiten, die gerade sichtbar sind und nicht entladen werden dürfen. */
  pinned = new Set<Id>();

  private constructor(
    private readonly db: FederDB,
    readonly autosave: Autosave,
    notebook: Notebook,
    pages: Page[],
  ) {
    this.notebook = notebook;
    for (const p of pages) this.pages.set(p.id, p);
  }

  static async load(db: FederDB, id: Id, autosave = new Autosave(db)): Promise<NotebookDoc> {
    const notebook = await db.notebooks.get(id);
    if (!notebook) throw new Error('Notizbuch nicht gefunden.');
    const pages = await db.pages.where('notebookId').equals(id).toArray();
    const doc = new NotebookDoc(db, autosave, notebook, pages);
    doc.repairPageOrder();
    return doc;
  }

  /** Stellt sicher, dass pageIds und Seiten-Tabelle zusammenpassen. */
  private repairPageOrder() {
    const known = new Set(this.notebook.pageIds.filter((id) => this.pages.has(id)));
    const missing = [...this.pages.keys()].filter((id) => !known.has(id));
    let ids = [...known, ...missing];
    if (!ids.length) {
      const page = makePage(this.notebook.id, this.notebook.defaultPaper);
      this.pages.set(page.id, page);
      ids = [page.id];
      this.autosave.enqueue([{ table: 'pages', type: 'put', value: page }]);
    }
    if (ids.join() !== this.notebook.pageIds.join()) {
      this.notebook = { ...this.notebook, pageIds: ids };
      this.autosave.enqueue([{ table: 'notebooks', type: 'put', value: this.notebook }]);
    }
  }

  get id(): Id {
    return this.notebook.id;
  }

  get pageIds(): readonly Id[] {
    return this.notebook.pageIds;
  }

  pageAt(index: number): Page | undefined {
    const id = this.notebook.pageIds[index];
    return id ? this.pages.get(id) : undefined;
  }

  indexOf(pageId: Id): number {
    return this.notebook.pageIds.indexOf(pageId);
  }

  on(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // ---------- Inhalte laden ----------

  getItems(pageId: Id): readonly Item[] | undefined {
    const list = this.items.get(pageId);
    if (list) this.touch(pageId);
    return list;
  }

  async ensureItems(pageId: Id): Promise<readonly Item[]> {
    const have = this.items.get(pageId);
    if (have) {
      this.touch(pageId);
      return have;
    }
    let p = this.loading.get(pageId);
    if (!p) {
      p = (async () => {
        // Ausstehende Änderungen zuerst schreiben, damit die DB aktuell ist.
        if (this.autosave.hasPendingForPage(pageId)) await this.autosave.flush();
        const list = await this.db.items
          .where('[pageId+z]')
          .between([pageId, -Infinity], [pageId, Infinity])
          .toArray();
        // Während des Ladens kann ein Befehl die Liste bereits angelegt haben.
        const current = this.items.get(pageId);
        if (current) return current;
        this.items.set(pageId, list);
        this.touch(pageId);
        this.evict();
        return list;
      })().finally(() => this.loading.delete(pageId));
      this.loading.set(pageId, p);
    }
    return p;
  }

  private touch(pageId: Id) {
    const i = this.lru.indexOf(pageId);
    if (i >= 0) this.lru.splice(i, 1);
    this.lru.push(pageId);
  }

  private evict() {
    while (this.lru.length > MAX_LOADED_PAGES) {
      const victim = this.lru.find((id) => !this.pinned.has(id) && !this.autosave.hasPendingForPage(id));
      if (!victim) return;
      this.lru.splice(this.lru.indexOf(victim), 1);
      this.items.delete(victim);
    }
  }

  /** Höchster z-Wert einer Seite (für neue Elemente obenauf). */
  topZ(pageId: Id): number {
    const list = this.items.get(pageId);
    return list?.length ? list[list.length - 1]!.z : 0;
  }

  // ---------- Befehle ----------

  execute(cmd: Command): void {
    if (isEmpty(cmd)) return;
    this.apply(cmd);
    this.history.push(cmd);
  }

  undo(): boolean {
    const cmd = this.history.undo();
    if (!cmd) return false;
    this.apply(cmd);
    return true;
  }

  redo(): boolean {
    const cmd = this.history.redo();
    if (!cmd) return false;
    this.apply(cmd);
    return true;
  }

  private apply(cmd: Command): void {
    const ops: Op[] = [];
    const change: DocChange = { items: new Map(), pages: new Set(), structure: false };
    const pageChange = (pageId: Id) => {
      let c = change.items.get(pageId);
      if (!c) change.items.set(pageId, (c = { added: [], removed: [] }));
      return c;
    };

    for (const c of cmd.pages) {
      if (c.after) {
        this.pages.set(c.after.id, c.after);
        ops.push({ table: 'pages', type: 'put', value: c.after });
        change.pages.add(c.after.id);
      } else if (c.before) {
        this.pages.delete(c.before.id);
        ops.push({ table: 'pages', type: 'delete', key: c.before.id });
        change.structure = true;
      }
      if (!c.before && c.after) {
        // neue Seite: leere Inhaltsliste anlegen, damit nichts aus der DB nachgeladen werden muss
        if (!this.items.has(c.after.id)) this.items.set(c.after.id, []);
        change.structure = true;
      }
    }

    for (const c of cmd.items) {
      const pageId = (c.after ?? c.before)!.pageId;
      const list = this.items.get(pageId);
      if (c.before) {
        if (list) removeById(list, c.before.id);
        pageChange(pageId).removed.push(c.before);
      }
      if (c.after) {
        if (list) insertSorted(list, c.after);
        pageChange(pageId).added.push(c.after);
        ops.push({ table: 'items', type: 'put', value: c.after });
      } else if (c.before) {
        ops.push({ table: 'items', type: 'delete', key: c.before.id, pageId });
      }
    }

    if (cmd.notebook?.after) {
      const before = this.notebook;
      this.notebook = cmd.notebook.after;
      ops.push({ table: 'notebooks', type: 'put', value: this.notebook });
      if (before.pageIds.join() !== this.notebook.pageIds.join()) change.structure = true;
    }

    this.autosave.enqueue(ops);
    for (const [pageId, c] of change.items) {
      if ([...c.added, ...c.removed].some((it) => it.type === 'text')) this.scheduleReindex(pageId);
    }
    for (const l of this.listeners) l(change);
  }

  // ---------- Suchindex für Textfelder ----------

  private reindexPages = new Set<Id>();
  private reindexTimer: ReturnType<typeof setTimeout> | null = null;

  private scheduleReindex(pageId: Id) {
    this.reindexPages.add(pageId);
    if (this.reindexTimer) clearTimeout(this.reindexTimer);
    this.reindexTimer = setTimeout(() => void this.flushReindex(), 800);
  }

  /** Text aller Textfelder einer Seite in den Suchindex schreiben. */
  async flushReindex(): Promise<void> {
    if (this.reindexTimer) clearTimeout(this.reindexTimer);
    this.reindexTimer = null;
    const pages = [...this.reindexPages];
    this.reindexPages.clear();
    for (const pageId of pages) {
      const items = this.items.get(pageId);
      if (!items) continue;
      const text = items
        .filter((it) => it.type === 'text')
        .map((it) => (it as { text: string }).text)
        .join('\n')
        .trim();
      const id = `${pageId}:text`;
      if (text) {
        await this.db.textIndex.put({
          id,
          notebookId: this.id,
          pageId,
          source: 'text',
          text,
          tokens: tokenize(text),
        });
      } else await this.db.textIndex.delete(id);
    }
  }

  /** Stichworte einer Seite setzen (rückgängig machbar). */
  setTags(pageId: Id, tags: string[]): void {
    const before = this.pages.get(pageId);
    if (!before) return;
    const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
    this.execute({
      label: 'Stichworte',
      items: [],
      pages: [{ before, after: { ...before, tags: clean, updatedAt: Date.now() } }],
    });
  }

  // ---------- Seiten-Befehle ----------

  private notebookChange(pageIds: Id[]): Change<Notebook> {
    return { before: this.notebook, after: { ...this.notebook, pageIds } };
  }

  addPage(index: number, paper?: PaperSpec): Page {
    const ref = this.pageAt(Math.min(index, this.pageIds.length) - 1) ?? this.pageAt(0);
    const page = makePage(this.id, paper ?? blankLike(ref?.paper ?? this.notebook.defaultPaper));
    const ids = [...this.pageIds];
    ids.splice(index, 0, page.id);
    this.execute({
      label: 'Seite hinzufügen',
      items: [],
      pages: [{ before: null, after: page }],
      notebook: this.notebookChange(ids),
    });
    return page;
  }

  /** Fügt fertige Seiten (z. B. aus einem PDF) als ein Undo-Schritt ein. */
  insertPages(index: number, pages: Page[], label = 'Seiten einfügen'): void {
    const ids = [...this.pageIds];
    ids.splice(Math.max(0, Math.min(index, ids.length)), 0, ...pages.map((p) => p.id));
    this.execute({
      label,
      items: [],
      pages: pages.map((after) => ({ before: null, after })),
      notebook: this.notebookChange(ids),
    });
  }

  async duplicatePage(pageId: Id): Promise<Page | null> {
    const src = this.pages.get(pageId);
    if (!src) return null;
    const items = await this.ensureItems(pageId);
    const now = Date.now();
    const page: Page = { ...structuredClone(src), id: newId(now), createdAt: now, updatedAt: now };
    const copies = items.map((it) => ({ ...structuredClone(it), id: newId(), pageId: page.id }));
    const ids = [...this.pageIds];
    ids.splice(this.indexOf(pageId) + 1, 0, page.id);
    this.items.set(page.id, []);
    this.execute({
      label: 'Seite duplizieren',
      pages: [{ before: null, after: page }],
      items: copies.map((after) => ({ before: null, after })),
      notebook: this.notebookChange(ids),
    });
    return page;
  }

  async deletePage(pageId: Id): Promise<boolean> {
    const page = this.pages.get(pageId);
    if (!page || this.pageIds.length <= 1) return false;
    const items = await this.ensureItems(pageId);
    this.execute({
      label: 'Seite löschen',
      items: items.map((before) => ({ before, after: null })),
      pages: [{ before: page, after: null }],
      notebook: this.notebookChange(this.pageIds.filter((id) => id !== pageId)),
    });
    return true;
  }

  movePage(from: number, to: number): void {
    if (from === to || from < 0 || from >= this.pageIds.length) return;
    const ids = [...this.pageIds];
    const [id] = ids.splice(from, 1);
    ids.splice(Math.max(0, Math.min(to, ids.length)), 0, id!);
    this.execute({ label: 'Seite verschieben', items: [], pages: [], notebook: this.notebookChange(ids) });
  }

  setPaper(pageIds: Id[], paper: PaperSpec, alsoDefault = false): void {
    const now = Date.now();
    const pages: Change<Page>[] = [];
    for (const id of pageIds) {
      const before = this.pages.get(id);
      if (before) pages.push({ before, after: { ...before, paper: structuredClone(paper), updatedAt: now } });
    }
    const cmd: Command = { label: 'Vorlage ändern', items: [], pages };
    if (alsoDefault)
      cmd.notebook = { before: this.notebook, after: { ...this.notebook, defaultPaper: paper } };
    this.execute(cmd);
  }
}

function insertSorted(list: Item[], item: Item) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]!.z <= item.z) lo = mid + 1;
    else hi = mid;
  }
  list.splice(lo, 0, item);
}

function removeById(list: Item[], id: Id) {
  const i = list.findIndex((it) => it.id === id);
  if (i >= 0) list.splice(i, 1);
}

/** Neue Seiten nach einer PDF-Seite bekommen leeres Papier gleicher Größe. */
function blankLike(paper: PaperSpec): PaperSpec {
  if (paper.template.kind === 'builtin') return paper;
  return { ...paper, color: 'white', template: { kind: 'builtin', id: 'blank', params: {} } };
}
