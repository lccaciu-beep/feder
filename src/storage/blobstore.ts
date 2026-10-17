// Speicher für große Binärdaten (PDFs, Bilder, Audio). Bevorzugt OPFS,
// fällt auf eine IndexedDB-Tabelle zurück, wenn OPFS nicht verfügbar ist
// (z. B. im privaten Modus). Metadaten liegen immer in der Tabelle `blobs`.

import { newId } from '../model/ids';
import type { BlobMeta, Id } from '../model/types';
import { getDb } from './db';

export interface BlobBackend {
  readonly kind: 'opfs' | 'idb';
  write(id: Id, blob: Blob): Promise<void>;
  read(id: Id): Promise<Blob | null>;
  remove(id: Id): Promise<void>;
}

export class IdbBackend implements BlobBackend {
  readonly kind = 'idb' as const;
  async write(id: Id, blob: Blob) {
    await getDb().blobData.put({ id, data: await blob.arrayBuffer(), type: blob.type });
  }
  async read(id: Id) {
    const row = await getDb().blobData.get(id);
    return row ? new Blob([row.data], { type: row.type }) : null;
  }
  async remove(id: Id) {
    await getDb().blobData.delete(id);
  }
}

export class OpfsBackend implements BlobBackend {
  readonly kind = 'opfs' as const;
  private worker: Worker | null = null;
  private seq = 0;
  private waiting = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();

  private call(msg: { op: 'write'; name: string; data: ArrayBuffer } | { op: 'delete'; name: string }) {
    if (!this.worker) {
      this.worker = new Worker(new URL('./opfs.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; error?: string }>) => {
        const w = this.waiting.get(e.data.id);
        if (!w) return;
        this.waiting.delete(e.data.id);
        if (e.data.ok) w.resolve();
        else w.reject(new Error(e.data.error));
      };
    }
    const id = ++this.seq;
    return new Promise<void>((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.worker!.postMessage({ id, ...msg }, msg.op === 'write' ? [msg.data] : []);
    });
  }

  private async dir() {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle('blobs', { create: true });
  }

  async write(id: Id, blob: Blob) {
    await this.call({ op: 'write', name: id, data: await blob.arrayBuffer() });
  }

  async read(id: Id) {
    try {
      const handle = await (await this.dir()).getFileHandle(id);
      return await handle.getFile();
    } catch {
      return null;
    }
  }

  async remove(id: Id) {
    await this.call({ op: 'delete', name: id });
  }
}

/** Prüft, ob OPFS samt Worker-Schreibzugriff wirklich funktioniert. */
async function probeOpfs(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory || typeof Worker === 'undefined') {
    return false;
  }
  try {
    const backend = new OpfsBackend();
    const probeId = '__probe__';
    await backend.write(probeId, new Blob([new Uint8Array([1, 2, 3])]));
    const back = await backend.read(probeId);
    const ok = !!back && back.size === 3;
    await backend.remove(probeId);
    return ok;
  } catch {
    return false;
  }
}

export class BlobStore {
  constructor(private readonly backend: BlobBackend) {}

  get kind() {
    return this.backend.kind;
  }

  async put(blob: Blob, id: Id = newId()): Promise<BlobMeta> {
    const meta: BlobMeta = {
      id,
      mime: blob.type || 'application/octet-stream',
      size: blob.size,
      store: this.backend.kind,
      createdAt: Date.now(),
    };
    await this.backend.write(id, blob);
    await getDb().blobs.put(meta);
    return meta;
  }

  async get(id: Id): Promise<Blob | null> {
    const meta = await getDb().blobs.get(id);
    if (!meta) return null;
    // Blobs aus dem jeweils anderen Speicher (z. B. nach Restore) trotzdem finden.
    const backend = meta.store === this.backend.kind ? this.backend : new IdbBackend();
    const blob = await backend.read(id);
    return blob && meta.mime && blob.type !== meta.mime ? new Blob([blob], { type: meta.mime }) : blob;
  }

  async delete(id: Id): Promise<void> {
    const meta = await getDb().blobs.get(id);
    if (!meta) return;
    const backend = meta.store === this.backend.kind ? this.backend : new IdbBackend();
    await backend.remove(id);
    await getDb().blobs.delete(id);
  }
}

let store: Promise<BlobStore> | null = null;

export function getBlobStore(): Promise<BlobStore> {
  store ??= probeOpfs().then((ok) => new BlobStore(ok ? new OpfsBackend() : new IdbBackend()));
  return store;
}
