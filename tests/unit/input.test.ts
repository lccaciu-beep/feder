import { describe, expect, it } from 'vitest';
import { PressureDetector, classify } from '../../src/engine/input/pressure';
import { StrokeBuilder, tiltToAngles } from '../../src/engine/ink/capture';
import { TouchGestures } from '../../src/engine/input/gestures';
import { Camera, layoutPages } from '../../src/engine/view/camera';
import { chooseLevel, MAX_CANVAS_PIXELS } from '../../src/engine/render/PageView';

describe('Druck-Erkennung', () => {
  it('erkennt echten Druck an variierenden Werten', () => {
    const d = new PressureDetector();
    for (let i = 0; i < 39; i++) expect(d.add(0.2 + (i % 7) * 0.08)).toBe('unknown');
    expect(d.add(0.33)).toBe('real');
  });

  it('erkennt konstante Werte als „kein Druck“', () => {
    expect(classify(Array(40).fill(0.5))).toBe('none');
    expect(classify(Array(40).fill(1))).toBe('none');
    expect(classify([...Array(20).fill(0), ...Array(20).fill(0.5)])).toBe('none');
  });
});

describe('Strich-Erfassung', () => {
  const style = { tool: 'fountain' as const, color: '#000', width: 2, opacity: 1, dash: 'solid' as const };

  it('verwirft fast identische Punkte', () => {
    const b = new StrokeBuilder({ ...style, pressureMode: 'real' }, false, 2, 0.5);
    b.add({ x: 0, y: 0, pressure: 0.5, t: 0 });
    b.add({ x: 0.05, y: 0, pressure: 0.5, t: 4 });
    b.add({ x: 5, y: 0, pressure: 0.5, t: 8 });
    expect(b.count).toBe(2);
  });

  it('macht schnelle Striche bei simuliertem Druck dünner', () => {
    const slow = new StrokeBuilder({ ...style, pressureMode: 'velocity' }, false, 2, 0.5);
    const fast = new StrokeBuilder({ ...style, pressureMode: 'velocity' }, false, 2, 0.5);
    for (let i = 0; i < 30; i++) {
      slow.add({ x: i * 0.5, y: 0, pressure: 0, t: i * 8 });
      fast.add({ x: i * 6, y: 0, pressure: 0, t: i * 8 });
    }
    const lastP = (b: StrokeBuilder) => b.points[b.points.length - 2]!;
    expect(lastP(slow)).toBeGreaterThan(lastP(fast));
    expect(lastP(fast)).toBeGreaterThanOrEqual(0.2);
  });

  it('begradigt zu einer eingerasteten Linie', () => {
    const b = new StrokeBuilder({ ...style, pressureMode: 'none' }, true, 1, 0.5);
    b.add({ x: 0, y: 0, pressure: 0.5, t: 0, altitude: 1, azimuth: 0 });
    b.add({ x: 30, y: 12, pressure: 0.5, t: 50, altitude: 1, azimuth: 0 });
    b.straighten(100, 2);
    const item = b.build({ pageId: 'p', notebookId: 'n', z: 1 });
    expect(item.stride).toBe(6);
    const pts = item.points;
    expect(pts[pts.length - 5]).toBeCloseTo(0, 3); // y des Endpunkts eingerastet
    for (let i = 1; i < pts.length; i += 6) expect(pts[i]).toBeCloseTo(0, 3);
  });

  it('rechnet Neigung in Höhenwinkel um', () => {
    expect(tiltToAngles(0, 0).altitude).toBeCloseTo(Math.PI / 2);
    expect(tiltToAngles(45, 0).altitude).toBeCloseTo(Math.PI / 4);
  });
});

describe('Gesten', () => {
  function rec() {
    const log: string[] = [];
    const g = new TouchGestures({
      onStart: () => log.push('start'),
      onPanZoom: (dx, dy, f) => log.push(`pz ${dx.toFixed(0)} ${dy.toFixed(0)} ${f.toFixed(2)}`),
      onEnd: () => log.push('end'),
      onTap: (n) => log.push(`tap ${n}`),
    });
    return { g, log };
  }

  it('erkennt einen Zwei-Finger-Tipp', () => {
    const { g, log } = rec();
    g.down(1, 100, 100, 0);
    g.down(2, 200, 100, 20);
    g.up(1, 120);
    g.up(2, 140);
    expect(log).toContain('tap 2');
  });

  it('meldet Zoom beim Auseinanderziehen', () => {
    const { g, log } = rec();
    g.down(1, 100, 100, 0);
    g.down(2, 200, 100, 0);
    g.move(1, 50, 100, 16);
    g.move(2, 250, 100, 16);
    expect(log.some((l) => l.startsWith('pz') && Number(l.split(' ')[3]) > 1)).toBe(true);
    g.up(1, 400);
    g.up(2, 400);
    expect(log).not.toContain('tap 2');
  });
});

describe('Kamera und Layout', () => {
  const pages = [
    { id: 'a', paper: { width: 600, height: 800 } },
    { id: 'b', paper: { width: 400, height: 600 } },
  ];

  it('stapelt Seiten vertikal und zentriert sie', () => {
    const l = layoutPages(pages, 'vertical', 20);
    expect(l.boxes[1]).toMatchObject({ x: 100, y: 820 });
    expect(l.height).toBe(1420);
  });

  it('passt die Breite ein und hält beim Zoomen den Punkt fest', () => {
    const cam = new Camera();
    cam.setLayout(layoutPages(pages, 'vertical'), 'vertical');
    cam.setViewport(1000, 800, { top: 100, right: 0, bottom: 0, left: 0 });
    cam.fit();
    expect(cam.scale).toBeCloseTo((1000 - 32) / 600);
    expect(cam.ty).toBe(116);
    const before = cam.toWorld(500, 400);
    cam.zoomAt(2, 500, 400);
    const after = cam.toWorld(500, 400);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
  });

  it('begrenzt das Scrollen auf den Inhalt', () => {
    const cam = new Camera();
    cam.setLayout(layoutPages(pages, 'vertical'), 'vertical');
    cam.setViewport(1000, 800, { top: 0, right: 0, bottom: 0, left: 0 });
    cam.fit();
    cam.panBy(0, 100_000);
    cam.clamp();
    expect(cam.ty).toBe(16);
    cam.panBy(0, -100_000);
    cam.clamp();
    expect(cam.toScreen(0, 1420)[1]).toBeCloseTo(800 - 16);
  });

  it('wählt Auflösungsstufen innerhalb der Speichergrenze', () => {
    expect(chooseLevel(2, 595, 842)).toBe(2);
    const big = chooseLevel(20, 595, 842);
    expect(595 * 842 * big * big).toBeLessThanOrEqual(MAX_CANVAS_PIXELS * 1.0001);
  });
});
