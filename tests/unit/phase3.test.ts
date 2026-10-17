import { describe, expect, it } from 'vitest';
import { homography, project, targetSize, warp, type Quad } from '../../src/io/scan/homography';
import { normalize, tokenize } from '../../src/search/text';
import { parse, href } from '../../src/app/stores/router.svelte';

describe('Homographie', () => {
  it('bildet vier Punkte exakt ab', () => {
    const from: Quad = [
      [0, 0],
      [100, 0],
      [100, 50],
      [0, 50],
    ];
    const to: Quad = [
      [10, 20],
      [120, 5],
      [130, 90],
      [5, 70],
    ];
    const h = homography(from, to);
    for (let i = 0; i < 4; i++) {
      const [x, y] = project(h, ...from[i]!);
      expect(x).toBeCloseTo(to[i]![0], 6);
      expect(y).toBeCloseTo(to[i]![1], 6);
    }
  });

  it('erkennt entartete Vierecke', () => {
    const line: Quad = [
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ];
    expect(() => homography(line, line)).toThrow();
  });

  it('wählt die Zielgröße aus den längsten Kanten', () => {
    expect(
      targetSize([
        [0, 0],
        [200, 10],
        [210, 300],
        [5, 290],
      ]),
    ).toEqual({ width: 205, height: 290 });
  });

  it('entzerrt ein schräges Rechteck auf ein gerades', () => {
    // 40×40-Quelle: linke Hälfte schwarz, rechte weiß
    const w = 40;
    const data = new Uint8ClampedArray(w * w * 4);
    for (let y = 0; y < w; y++)
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const v = x < 20 ? 0 : 255;
        data[o] = data[o + 1] = data[o + 2] = v;
        data[o + 3] = 255;
      }
    const out = warp(
      { data, width: w, height: w },
      [
        [0, 0],
        [40, 0],
        [40, 40],
        [0, 40],
      ],
      10,
      10,
      'bw',
    );
    expect(out[(5 * 10 + 1) * 4]).toBe(0);
    expect(out[(5 * 10 + 8) * 4]).toBe(255);
  });
});

describe('Suchtext', () => {
  it('normalisiert Umlaute und ß', () => {
    expect(normalize('Größe Übung')).toBe('grosse ubung');
  });

  it('zerlegt in eindeutige Wörter', () => {
    expect(tokenize('Die Analysis-Übung, die Übung!')).toEqual(['die', 'analysis', 'ubung']);
  });
});

describe('Routen', () => {
  it('unterscheidet Seitennummer und Seiten-ID', () => {
    expect(parse('#/nb/ABC/3')).toEqual({ name: 'notebook', id: 'ABC', page: 3 });
    expect(parse('#/nb/ABC/01XYZ')).toEqual({ name: 'notebook', id: 'ABC', pageId: '01XYZ' });
    expect(href({ name: 'notebook', id: 'ABC', pageId: 'P1' })).toBe('#/nb/ABC/P1');
  });
});
