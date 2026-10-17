// Schreibt Dateien ins Origin Private File System. Safari erlaubt
// createSyncAccessHandle nur in Workern, darum läuft das Schreiben hier.

interface SyncAccessHandle {
  write(buffer: ArrayBuffer | ArrayBufferView, options?: { at?: number }): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
}

type WorkerRequest =
  { id: number; op: 'write'; name: string; data: ArrayBuffer } | { id: number; op: 'delete'; name: string };

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(msg: unknown): void;
};

async function blobDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('blobs', { create: true });
}

ctx.onmessage = async (e) => {
  const req = e.data;
  try {
    const dir = await blobDir();
    if (req.op === 'write') {
      const handle = await dir.getFileHandle(req.name, { create: true });
      const access = (await (
        handle as unknown as { createSyncAccessHandle(): Promise<SyncAccessHandle> }
      ).createSyncAccessHandle()) as SyncAccessHandle;
      try {
        access.truncate(0);
        access.write(new Uint8Array(req.data), { at: 0 });
        access.flush();
      } finally {
        access.close();
      }
    } else {
      await dir.removeEntry(req.name).catch(() => undefined);
    }
    ctx.postMessage({ id: req.id, ok: true });
  } catch (err) {
    ctx.postMessage({ id: req.id, ok: false, error: String(err) });
  }
};
