import { describe, expect, it } from 'vitest';
import { BlobStore, IdbBackend } from '../../src/storage/blobstore';
import { freshDb } from './helpers';

describe('BlobStore (IndexedDB-Fallback)', () => {
  it('speichert, liest und löscht Dateien samt Metadaten', async () => {
    const db = freshDb();
    const store = new BlobStore(new IdbBackend());
    const meta = await store.put(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'application/pdf' }));
    expect(meta).toMatchObject({ size: 4, mime: 'application/pdf', store: 'idb' });
    const back = await store.get(meta.id);
    expect(back?.size).toBe(4);
    expect(new Uint8Array(await back!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    await store.delete(meta.id);
    expect(await store.get(meta.id)).toBeNull();
    expect(await db.blobs.count()).toBe(0);
  });
});
