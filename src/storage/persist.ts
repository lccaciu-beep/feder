// Dauerhafte Speicherung anfragen und Belegung abfragen.

import { getDb } from './db';

export interface StorageInfo {
  persisted: boolean;
  usage: number | null;
  quota: number | null;
}

/** Fragt persistenten Speicher an (einmal pro Start, solange er nicht gewährt ist). */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    const granted = await navigator.storage.persist();
    await getDb().meta.put({ key: 'persistRequestedAt', value: Date.now() });
    return granted;
  } catch {
    return false;
  }
}

export async function storageInfo(): Promise<StorageInfo> {
  const persisted = (await navigator.storage?.persisted?.().catch(() => false)) ?? false;
  const est = await navigator.storage?.estimate?.().catch(() => null);
  return { persisted, usage: est?.usage ?? null, quota: est?.quota ?? null };
}

export function formatBytes(n: number | null): string {
  if (n == null) return '–';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toLocaleString('de-DE', { maximumFractionDigits: i ? 1 : 0 })} ${units[i]}`;
}
