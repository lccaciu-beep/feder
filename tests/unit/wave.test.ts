import { describe, expect, it } from 'vitest';
import { isZigzag, wavyStrike, wavyTargets } from '../../src/engine/geometry/hit';
import { line, stroke } from './helpers';

/** Wellenlinie von (x0, y) nach rechts mit Amplitude `a` und `waves` Schwingungen. */
function wave(x0: number, y: number, len: number, a: number, waves: number) {
  const xy: number[] = [];
  const n = waves * 16;
  for (let i = 0; i <= n; i++) xy.push(x0 + (len * i) / n, y + a * Math.sin((i / n) * waves * 2 * Math.PI));
  return stroke(xy);
}

describe('Welliges Durchstreichen', () => {
  it('erkennt eine flache Wellenlinie, aber keine Gerade und keine Schrift', () => {
    const w = wave(10, 50, 160, 4, 4);
    expect(wavyStrike(w.points, 4)).not.toBeNull();
    expect(isZigzag(w.points, 4)).toBe(false);
    expect(wavyStrike(line(0, 0, 200, 0).points, 4)).toBeNull();
    // hohe Schleifen („ll“) sind kein Durchstreichen
    expect(wavyStrike(wave(0, 0, 40, 20, 3).points, 4)).toBeNull();
    // zu wenige Schwingungen
    expect(wavyStrike(wave(0, 0, 160, 4, 1).points, 4)).toBeNull();
  });

  it('gilt auch schräg und von rechts nach links', () => {
    const w = wave(0, 0, 150, 4, 4);
    const pts = new Float32Array(w.points);
    for (let i = 0; i < pts.length; i += 4) {
      const x = pts[i]!;
      const y = pts[i + 1]!;
      pts[i] = 300 - (x * 0.94 - y * 0.34);
      pts[i + 1] = 100 - (x * 0.34 + y * 0.94);
    }
    expect(wavyStrike(pts, 4)).not.toBeNull();
  });

  it('löscht nur durchgestrichene Wörter und Textfelder', () => {
    const w = wave(40, 100, 200, 4, 5);
    const info = wavyStrike(w.points, 4)!;
    const crossed = stroke([60, 90, 70, 110, 80, 92, 95, 108]); // „Wort“ mitten auf der Linie
    const above = stroke([60, 40, 90, 45]); // Zeile darüber
    const right = stroke([400, 95, 430, 105]); // außerhalb der Welle
    const text = { type: 'text', bbox: { x: 120, y: 92, w: 80, h: 16 } };
    const dot = stroke([150, 91, 150.5, 91.5], { width: 2 }); // i-Punkt knapp über der Welle
    const longWord = stroke([200, 95, 225, 105, 250, 95, 270, 105]); // ragt zur Hälfte heraus
    const hits = wavyTargets(info, w.points, 4, 1.4, [crossed, above, right, text, dot, longWord]);
    expect(hits).toEqual([crossed, text, dot, longWord]);
  });
});
