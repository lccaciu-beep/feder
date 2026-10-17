import { beforeEach, describe, expect, it } from 'vitest';
import { clearLock, getLock, setLock, verifyCode } from '../../src/storage/lock';
import { freshDb } from './helpers';

beforeEach(() => {
  freshDb();
});

describe('App-Sperre', () => {
  it('speichert nur einen Hash und prüft den Code', async () => {
    await setLock('2468', 5);
    const cfg = (await getLock())!;
    expect(cfg.length).toBe(4);
    expect(cfg.delayMin).toBe(5);
    expect(JSON.stringify(cfg)).not.toContain('2468');
    expect(await verifyCode('2468')).toBe(true);
    expect(await verifyCode('1357')).toBe(false);
    await clearLock();
    expect(await getLock()).toBeNull();
  });

  it('lehnt ungültige Codes ab', async () => {
    await expect(setLock('12')).rejects.toThrow();
    await expect(setLock('abcd')).rejects.toThrow();
  });
});
