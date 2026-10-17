import { describe, expect, it } from 'vitest';
import {
  eraseFromStroke,
  isZigzag,
  pathLength,
  resample,
  snapLineEnd,
  strokeHitsCapsule,
  zigzagTargets,
} from '../../src/engine/geometry/hit';
import { intersection, pointsBBox, union } from '../../src/engine/geometry/rect';
import { line, stroke } from './helpers';

describe('Rechtecke', () => {
  it('berechnet Schnitt und Vereinigung', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    const b = { x: 5, y: 5, w: 10, h: 10 };
    expect(intersection(a, b)).toEqual({ x: 5, y: 5, w: 5, h: 5 });
    expect(union(a, b)).toEqual({ x: 0, y: 0, w: 15, h: 15 });
    expect(intersection(a, { x: 20, y: 20, w: 1, h: 1 })).toBeNull();
  });

  it('berechnet die Bounding Box mit Rand', () => {
    expect(pointsBBox([1, 2, 0, 0, 5, 8, 0, 0], 4, 1)).toEqual({ x: 0, y: 1, w: 6, h: 8 });
  });
});

describe('Radierer', () => {
  const s = line(0, 50, 100, 50, 10, { width: 2 });

  it('trifft Striche innerhalb des Radius (inkl. Strichbreite)', () => {
    expect(strokeHitsCapsule(s, 50, 45, 50, 45, 4.5)).toBe(true);
    expect(strokeHitsCapsule(s, 50, 40, 50, 40, 4.5)).toBe(false);
    // schnelle Bewegung quer über den Strich: Kapsel statt Kreis
    expect(strokeHitsCapsule(s, 50, 0, 50, 100, 1)).toBe(true);
  });

  it('teilt einen Strich beim präzisen Radieren in zwei Teile', () => {
    const pieces = eraseFromStroke(s, 50, 50, 50, 50, 5)!;
    expect(pieces).toHaveLength(2);
    const [left, right] = pieces;
    expect(Math.max(...Array.from(left!).filter((_, i) => i % 4 === 0))).toBeLessThan(45);
    expect(Math.min(...Array.from(right!).filter((_, i) => i % 4 === 0))).toBeGreaterThan(55);
  });

  it('meldet nicht getroffene Striche als null und ganz gelöschte als leer', () => {
    expect(eraseFromStroke(s, 50, 90, 50, 90, 3)).toBeNull();
    expect(eraseFromStroke(line(0, 0, 2, 0, 2), 1, 0, 1, 0, 10)).toEqual([]);
  });

  it('tastet fein ab, ohne die Endpunkte zu verändern', () => {
    const coarse = stroke([0, 0, 10, 0]);
    const fine = resample(coarse.points, 4, 1);
    expect(fine.length / 4).toBeGreaterThanOrEqual(10);
    expect(Array.from(fine.slice(-4, -2))).toEqual([10, 0]);
    expect(pathLength(fine, 4)).toBeCloseTo(10);
  });
});

describe('Zickzack-Löschen', () => {
  const zig = stroke([0, 0, 40, 4, 0, 8, 40, 12, 0, 16, 40, 20, 0, 24, 40, 28]);

  it('erkennt Kritzeleien, aber keine normale Schrift', () => {
    expect(isZigzag(zig.points, 4)).toBe(true);
    expect(isZigzag(line(0, 0, 100, 0).points, 4)).toBe(false);
    // ein „w“ hat zu wenige Richtungswechsel
    expect(isZigzag(stroke([0, 0, 5, 10, 10, 0, 15, 10, 20, 0]).points, 4)).toBe(false);
  });

  it('findet nur die überdeckten Striche', () => {
    const under = line(5, 14, 35, 14, 10);
    const far = line(200, 200, 260, 200, 10);
    const partly = line(10, 10, 300, 10, 30); // ragt weit heraus
    expect(zigzagTargets(zig.points, 4, 2, [under, far, partly]).map((s) => s.id)).toEqual([under.id]);
  });
});

describe('Gerade Linien', () => {
  it('rastet nahe 0°/45°/90° ein', () => {
    const [x, y] = snapLineEnd(0, 0, 100, 3);
    expect(y).toBeCloseTo(0);
    expect(x).toBeCloseTo(Math.hypot(100, 3));
    const [dx, dy] = snapLineEnd(0, 0, 100, 102);
    expect(dx).toBeCloseTo(dy);
    expect(snapLineEnd(0, 0, 100, 30)).toEqual([100, 30]);
  });
});
