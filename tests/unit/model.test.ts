import { describe, expect, it } from 'vitest';
import { newId } from '../../src/model/ids';
import { base64ToFloat32, float32ToBase64 } from '../../src/model/codec';
import { MM, PAPER_SIZES, makePaper } from '../../src/model/paper';
import { migrate, SCHEMA_VERSION } from '../../src/model/migrations';
import { DEFAULT_SETTINGS, mergeSettings } from '../../src/model/settings';
import { choiceToPaper, paperToChoice } from '../../src/app/library/paperChoice';

describe('IDs', () => {
  it('sind eindeutig und zeitlich sortierbar', () => {
    const ids = Array.from({ length: 2000 }, () => newId());
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
    expect(ids[0]).toHaveLength(26);
  });

  it('bleiben innerhalb derselben Millisekunde monoton', () => {
    const t = 1_800_000_000_000;
    const a = newId(t);
    const b = newId(t);
    const c = newId(t);
    expect(a < b && b < c).toBe(true);
  });
});

describe('Punkt-Kodierung', () => {
  it('überlebt den Base64-Roundtrip exakt', () => {
    const arr = new Float32Array([0, 1.5, -3.25, 1e6, Math.PI, 0.1]);
    const back = base64ToFloat32(float32ToBase64(arr));
    expect(Array.from(back)).toEqual(Array.from(arr));
  });

  it('kommt mit großen Arrays zurecht', () => {
    const arr = new Float32Array(200_000).map((_, i) => i * 0.5);
    expect(base64ToFloat32(float32ToBase64(arr))).toEqual(arr);
  });
});

describe('Papier', () => {
  it('dreht Formate passend zur Ausrichtung', () => {
    const p = makePaper('a4', 'portrait', 'white', 'ruled');
    expect(p.width).toBeCloseTo(PAPER_SIZES.a4.width);
    expect(p.height).toBeCloseTo(PAPER_SIZES.a4.height);
    const l = makePaper('a4', 'landscape', 'white', 'ruled');
    expect(l.width).toBeCloseTo(PAPER_SIZES.a4.height);
  });

  it('übernimmt Standardparameter der Vorlage', () => {
    const p = makePaper('a5', 'portrait', 'yellow', 'grid');
    expect(p.template).toEqual({ kind: 'builtin', id: 'grid', params: { spacing: 5 * MM } });
  });

  it('übersetzt zwischen Papier und Dialog-Auswahl hin und zurück', () => {
    const paper = makePaper('letter', 'landscape', 'dark', 'dots', { spacing: 7 * MM });
    const choice = paperToChoice(paper);
    expect(choice.size).toBe('letter');
    expect(choice.orientation).toBe('landscape');
    expect(choiceToPaper(choice)).toEqual(paper);
  });

  it('erkennt eigene Maße', () => {
    const c = paperToChoice(
      makePaper('custom', 'portrait', 'white', 'blank', {}, { width: 100 * MM, height: 150 * MM }),
    );
    expect(c.size).toBe('custom');
    expect(c.customWmm).toBe(100);
    expect(c.customHmm).toBe(150);
  });
});

describe('Migrationen', () => {
  it('lässt aktuelle Daten unverändert', () => {
    const data = { notebooks: [{ id: 'a' }] };
    expect(migrate(data, SCHEMA_VERSION)).toBe(data);
  });

  it('lehnt Daten aus einer neueren Version ab', () => {
    expect(() => migrate({}, SCHEMA_VERSION + 1)).toThrow(/neueren/);
  });
});

describe('Einstellungen', () => {
  it('ergänzt fehlende Felder mit Standardwerten', () => {
    const s = mergeSettings({ theme: 'dark', pen: { kind: 'pencil' } } as never);
    expect(s.theme).toBe('dark');
    expect(s.pen.kind).toBe('pencil');
    expect(s.pen.widths).toEqual(DEFAULT_SETTINGS.pen.widths);
    expect(s.eraser).toEqual(DEFAULT_SETTINGS.eraser);
  });
});
