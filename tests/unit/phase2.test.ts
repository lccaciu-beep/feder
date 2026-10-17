import { describe, expect, it } from 'vitest';
import { recognizeShape } from '../../src/engine/geometry/shapes';
import {
  about,
  applyTo,
  itemBBox,
  itemHitPoint,
  itemInPolygon,
  chain,
  transformItem,
  translate,
} from '../../src/engine/geometry/transform';
import type { ShapeItem, TapeItem, TextItem } from '../../src/model/types';
import { line, stroke } from './helpers';

function pts(fn: (t: number) => [number, number], n = 80, noise = 0): number[] {
  const out: number[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * noise;
  for (let i = 0; i <= n; i++) {
    const [x, y] = fn(i / n);
    out.push(x + rnd(), y + rnd(), 0.5, i * 8);
  }
  return out;
}

function polyPath(corners: [number, number][], n = 120, noise = 1.5) {
  return pts(
    (t) => {
      const seg = t * corners.length;
      const i = Math.min(Math.floor(seg), corners.length - 1);
      const f = seg - i;
      const a = corners[i]!;
      const b = corners[(i + 1) % corners.length]!;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    },
    n,
    noise,
  );
}

describe('Formerkennung', () => {
  it('erkennt Linien', () => {
    const r = recognizeShape(
      pts((t) => [10 + t * 200, 50 + t * 3], 40, 1),
      4,
    )!;
    expect(r.shape).toBe('line');
  });

  it('erkennt Kreise und Ellipsen', () => {
    const c = recognizeShape(
      pts((t) => [100 + 50 * Math.cos(t * 2 * Math.PI), 100 + 50 * Math.sin(t * 2 * Math.PI)], 100, 2),
      4,
    )!;
    expect(c.shape).toBe('ellipse');
    expect(c.vertices[2]).toBeCloseTo(c.vertices[3]!, 0);
    expect(c.vertices[0]).toBeCloseTo(100, -0.5);
    const e = recognizeShape(
      pts((t) => [100 + 90 * Math.cos(t * 2 * Math.PI), 100 + 40 * Math.sin(t * 2 * Math.PI)], 100, 2),
      4,
    )!;
    expect(e.shape).toBe('ellipse');
    expect(Math.max(e.vertices[2]!, e.vertices[3]!)).toBeGreaterThan(80);
  });

  it('erkennt Rechtecke (auch mit Start mitten auf einer Kante)', () => {
    const r = recognizeShape(
      polyPath([
        [50, 10],
        [150, 10],
        [150, 90],
        [10, 90],
        [10, 10],
      ]),
      4,
    )!;
    expect(r.shape).toBe('rect');
    const xs = r.vertices.filter((_, i) => i % 2 === 0);
    expect(Math.min(...xs)).toBeCloseTo(10, -1);
    expect(Math.max(...xs)).toBeCloseTo(150, -1);
  });

  it('erkennt Dreiecke', () => {
    expect(
      recognizeShape(
        polyPath([
          [0, 100],
          [60, 0],
          [120, 100],
        ]),
        4,
      )!.shape,
    ).toBe('triangle');
  });

  it('erkennt Pfeile', () => {
    const arrow = [
      0, 0, 0.5, 0, 50, 0, 0.5, 8, 100, 0, 0.5, 16, 120, 0, 0.5, 20, 105, -12, 0.5, 30, 120, 0, 0.5, 36, 106,
      12, 0.5, 42,
    ];
    const r = recognizeShape(arrow, 4);
    expect(r?.shape).toBe('arrow');
    expect(r!.vertices.slice(2)).toEqual([120, 0]);
  });

  it('lässt Gekritzel als Strich', () => {
    expect(recognizeShape(stroke([0, 0, 30, 40, 5, 70, 60, 10, 20, 90, 80, 50]).points, 4)).toBeNull();
  });
});

describe('Transformationen', () => {
  it('verkettet Verschieben, Skalieren und Drehen', () => {
    const t = chain(about(0, 0, 2, Math.PI / 2), translate(10, 0));
    const [x, y] = applyTo(t, 1, 0);
    expect(x).toBeCloseTo(10);
    expect(y).toBeCloseTo(2);
  });

  it('skaliert Striche samt Breite', () => {
    const s = line(0, 0, 10, 0, 2, { width: 2 });
    const out = transformItem(s, about(0, 0, 2, 0));
    expect(out.width).toBe(4);
    expect(out.points[8]).toBe(20);
    expect(out.id).toBe(s.id);
    expect(out.bbox.w).toBeGreaterThan(20);
  });

  it('dreht Textfelder um ihre Mitte und vergrößert die Schrift', () => {
    const t: TextItem = {
      id: 't',
      type: 'text',
      pageId: 'p',
      notebookId: 'n',
      z: 1,
      createdAt: 0,
      box: { x: 0, y: 0, w: 100, h: 20 },
      bbox: { x: 0, y: 0, w: 100, h: 20 },
      rotation: 0,
      text: 'Hallo',
      style: { font: 'sans', size: 12, color: '#000', align: 'left', bold: false, italic: false },
    };
    const out = transformItem(t, about(50, 10, 1.5, Math.PI / 2));
    expect(out.style.size).toBe(18);
    expect(out.rotation).toBeCloseTo(Math.PI / 2);
    expect(out.box.x + out.box.w / 2).toBeCloseTo(50);
    expect(out.bbox.h).toBeGreaterThan(140);
  });

  it('wählt per Lasso Striche mehrheitlich innerhalb aus', () => {
    const poly = [0, 0, 100, 0, 100, 100, 0, 100];
    expect(itemInPolygon(line(10, 50, 90, 50), poly)).toBe(true);
    expect(itemInPolygon(line(80, 50, 300, 50), poly)).toBe(false);
  });

  it('trifft Tape und Formen', () => {
    const tape: TapeItem = {
      id: 'x',
      type: 'tape',
      pageId: 'p',
      notebookId: 'n',
      z: 1,
      createdAt: 0,
      bbox: { x: 0, y: 0, w: 0, h: 0 },
      path: [0, 50, 100, 50],
      width: 20,
      color: '#c00',
      covered: true,
    };
    tape.bbox = itemBBox(tape);
    expect(itemHitPoint(tape, 50, 55, 0)).toBe(true);
    expect(itemHitPoint(tape, 50, 70, 0)).toBe(false);
    const ellipse: ShapeItem = {
      id: 'e',
      type: 'shape',
      pageId: 'p',
      notebookId: 'n',
      z: 1,
      createdAt: 0,
      bbox: { x: 0, y: 0, w: 0, h: 0 },
      shape: 'ellipse',
      vertices: [50, 50, 40, 10],
      rotation: Math.PI / 2,
      stroke: '#000',
      fill: null,
      fillOpacity: 0.25,
      width: 2,
      dash: 'solid',
      opacity: 1,
    };
    const b = itemBBox(ellipse);
    expect(b.w).toBeLessThan(30);
    expect(b.h).toBeGreaterThan(80);
  });
});
