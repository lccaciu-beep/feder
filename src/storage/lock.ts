// App-Sperre per Zahlencode. Das ist ein Sichtschutz, keine Verschlüsselung:
// Die Notizen selbst liegen weiterhin unverschlüsselt im Speicher des Geräts.
// Gespeichert wird nur ein PBKDF2-Hash des Codes.

import { getDb } from './db';

export interface LockConfig {
  salt: string;
  hash: string;
  iterations: number;
  length: number;
  /** Sperren nach so vielen Minuten im Hintergrund (0 = sofort) */
  delayMin: number;
}

const ITERATIONS = 150_000;

const b64 = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(code: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return b64(bits);
}

export async function getLock(): Promise<LockConfig | null> {
  const row = await getDb().meta.get('appLock');
  return (row?.value as LockConfig | undefined) ?? null;
}

export async function setLock(code: string, delayMin = 0): Promise<void> {
  if (!/^\d{4,6}$/.test(code)) throw new Error('Der Code muss aus 4 bis 6 Ziffern bestehen.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cfg: LockConfig = {
    salt: b64(salt),
    hash: await derive(code, salt, ITERATIONS),
    iterations: ITERATIONS,
    length: code.length,
    delayMin,
  };
  await getDb().meta.put({ key: 'appLock', value: cfg });
}

export async function setLockDelay(delayMin: number): Promise<void> {
  const cfg = await getLock();
  if (cfg) await getDb().meta.put({ key: 'appLock', value: { ...cfg, delayMin } });
}

export async function clearLock(): Promise<void> {
  await getDb().meta.delete('appLock');
}

export async function verifyCode(code: string, cfg?: LockConfig | null): Promise<boolean> {
  const c = cfg ?? (await getLock());
  if (!c) return true;
  const hash = await derive(code, unb64(c.salt), c.iterations);
  // Vergleich in konstanter Zeit
  if (hash.length !== c.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ c.hash.charCodeAt(i);
  return diff === 0;
}
