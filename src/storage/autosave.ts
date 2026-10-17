// Gedrosseltes, transaktionales Autosave. Änderungen kommen als Ops in eine
// Queue (pro Datensatz gewinnt die letzte Op) und werden 400 ms nach der
// letzten Änderung, spätestens aber nach 2 s, in EINER Transaktion geschrieben.

import type { Item, Notebook, Page } from '../model/types';
import type { FederDB } from './db';

type TableMap = { items: Item; pages: Page; notebooks: Notebook };
export type OpTable = keyof TableMap;

export type Op =
  | { [T in OpTable]: { table: T; type: 'put'; value: TableMap[T] } }[OpTable]
  | { table: OpTable; type: 'delete'; key: string; pageId?: string };

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

export interface AutosaveOptions {
  debounceMs: number;
  maxWaitMs: number;
  retryMs: number;
}

const DEFAULTS: AutosaveOptions = { debounceMs: 400, maxWaitMs: 2000, retryMs: 3000 };

function opKey(op: Op): string {
  return `${op.table}:${op.type === 'put' ? op.value.id : op.key}`;
}

const instances = new Set<Autosave>();

/** Schreibt alle ausstehenden Änderungen aller offenen Notizbücher (z. B. vor einem Backup). */
export async function flushAllAutosaves(): Promise<void> {
  await Promise.all([...instances].map((a) => a.flush()));
}

export class Autosave {
  private pending = new Map<string, Op>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private firstPendingAt = 0;
  private running: Promise<void> | null = null;
  private status: SaveStatus = 'saved';
  private listeners = new Set<(s: SaveStatus, error?: unknown) => void>();
  private readonly opts: AutosaveOptions;
  lastError: unknown = null;

  constructor(
    private readonly db: FederDB,
    opts: Partial<AutosaveOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
    instances.add(this);
  }

  /** Abmelden, wenn das Notizbuch geschlossen wird (vorher flush()). */
  dispose(): void {
    instances.delete(this);
  }

  get size(): number {
    return this.pending.size;
  }

  getStatus(): SaveStatus {
    return this.status;
  }

  onStatus(cb: (s: SaveStatus, error?: unknown) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private setStatus(s: SaveStatus, error?: unknown) {
    this.status = s;
    for (const cb of this.listeners) cb(s, error);
  }

  /** True, wenn für diese Seite noch ungespeicherte Item-Ops existieren. */
  hasPendingForPage(pageId: string): boolean {
    for (const op of this.pending.values()) {
      if (op.table !== 'items') continue;
      if (op.type === 'put' ? op.value.pageId === pageId : op.pageId === pageId) return true;
    }
    return false;
  }

  enqueue(ops: Op[]): void {
    if (!ops.length) return;
    if (!this.pending.size) this.firstPendingAt = Date.now();
    for (const op of ops) this.pending.set(opKey(op), op);
    if (this.status !== 'saving') this.setStatus('pending');
    this.schedule(this.opts.debounceMs);
  }

  private schedule(delay: number) {
    if (this.timer) clearTimeout(this.timer);
    const waited = Date.now() - this.firstPendingAt;
    const wait = Math.max(0, Math.min(delay, this.opts.maxWaitMs - waited));
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, wait);
  }

  /** Schreibt alles Ausstehende sofort. Mehrfache Aufrufe werden nacheinander ausgeführt. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.running) await this.running;
    if (!this.pending.size) return;

    const batch = this.pending;
    this.pending = new Map();
    this.setStatus('saving');
    this.running = this.write([...batch.values()])
      .then(() => {
        this.lastError = null;
        this.setStatus(this.pending.size ? 'pending' : 'saved');
        if (this.pending.size) this.schedule(this.opts.debounceMs);
      })
      .catch((err: unknown) => {
        // Fehlgeschlagene Ops zurücklegen, ohne neuere Änderungen zu überschreiben.
        for (const [key, op] of batch) if (!this.pending.has(key)) this.pending.set(key, op);
        if (!this.firstPendingAt) this.firstPendingAt = Date.now();
        this.lastError = err;
        this.setStatus('error', err);
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.flush();
        }, this.opts.retryMs);
      })
      .finally(() => {
        this.running = null;
      });
    await this.running;
  }

  private async write(ops: Op[]): Promise<void> {
    const db = this.db;
    const now = Date.now();
    await db.transaction('rw', db.items, db.pages, db.notebooks, async () => {
      const touched = new Set<string>();
      for (const op of ops) {
        const table = db.table(op.table);
        if (op.type === 'put') {
          await table.put(op.value);
          if (op.table !== 'notebooks') touched.add(op.value.notebookId);
        } else {
          await table.delete(op.key);
        }
      }
      // Änderungsdatum der betroffenen Notizbücher nachziehen.
      for (const id of touched) await db.notebooks.update(id, { updatedAt: now });
    });
  }
}
