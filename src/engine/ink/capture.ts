// Sammelt Eingabepunkte eines Strichs (in Seitenkoordinaten) und erzeugt
// daraus ein StrokeItem. Ohne echten Druck wird die Strichstärke aus der
// Geschwindigkeit simuliert und als Druckwert gespeichert, damit das
// Ergebnis beim Neuzeichnen immer gleich aussieht.

import { newId } from '../../model/ids';
import type { DashStyle, InkTool, PressureMode, StrokeItem } from '../../model/types';
import { pointsBBox } from '../geometry/rect';
import { snapLineEnd } from '../geometry/hit';

export interface InputSample {
  /** Seitenkoordinaten in pt */
  x: number;
  y: number;
  pressure: number;
  /** Event-Zeitstempel (performance.now()-Basis) */
  t: number;
  azimuth?: number;
  altitude?: number;
}

export interface StrokeStyle {
  tool: InkTool;
  color: string;
  width: number;
  opacity: number;
  dash: DashStyle;
  pressureMode: PressureMode;
}

const MIN_DIST = 0.2; // pt

export class StrokeBuilder {
  readonly stride: 4 | 6;
  private pts: number[] = [];
  private tStart = -1;
  private lastX = NaN;
  private lastY = NaN;
  private lastT = 0;
  private speed = 0;
  private simP = 0.75;

  constructor(
    readonly style: StrokeStyle,
    hasTilt: boolean,
    /** Bildschirm-Pixel pro pt, damit die Geschwindigkeit zoom-unabhängig ist. */
    private readonly screenScale: number,
    private readonly velocitySensitivity: number,
  ) {
    this.stride = hasTilt ? 6 : 4;
  }

  get points(): readonly number[] {
    return this.pts;
  }

  get count(): number {
    return this.pts.length / this.stride;
  }

  get startTime(): number {
    return this.tStart;
  }

  add(s: InputSample, force = false): void {
    if (this.tStart < 0) this.tStart = s.t;
    const dist = Number.isNaN(this.lastX) ? Infinity : Math.hypot(s.x - this.lastX, s.y - this.lastY);
    if (!force && dist < MIN_DIST) return;
    const pressure = this.style.pressureMode === 'velocity' ? this.simulate(s, dist) : s.pressure;
    this.pts.push(s.x, s.y, pressure, s.t - this.tStart);
    if (this.stride === 6) this.pts.push(s.azimuth ?? 0, s.altitude ?? Math.PI / 2);
    this.lastX = s.x;
    this.lastY = s.y;
    this.lastT = s.t;
  }

  private simulate(s: InputSample, dist: number): number {
    const dt = s.t - this.lastT;
    if (Number.isFinite(dist) && dt > 0) {
      const v = (dist * this.screenScale) / dt; // px/ms
      this.speed = this.speed * 0.7 + v * 0.3;
      const target = Math.min(1, Math.max(0.2, 1.05 - this.speed * this.velocitySensitivity * 0.3));
      this.simP = this.simP * 0.6 + target * 0.4;
    }
    return this.simP;
  }

  /** Vorschau-Punkte (z. B. vorhergesagte Events) im selben Format, ohne sie zu speichern. */
  previewPoint(s: InputSample): number[] {
    const p = this.style.pressureMode === 'velocity' ? this.simP : s.pressure;
    const out = [s.x, s.y, p, s.t - this.tStart];
    if (this.stride === 6) out.push(s.azimuth ?? 0, s.altitude ?? Math.PI / 2);
    return out;
  }

  /** Ersetzt den Strich durch eine gerade Linie vom Start zum Punkt (x,y). */
  straighten(x: number, y: number): void {
    const st = this.stride;
    if (this.pts.length < st) return;
    const x0 = this.pts[0]!;
    const y0 = this.pts[1]!;
    const [ex, ey] = snapLineEnd(x0, y0, x, y);
    let pSum = 0;
    const n = this.pts.length / st;
    for (let i = 0; i < n; i++) pSum += this.pts[i * st + 2]!;
    const p = n ? pSum / n : 0.5;
    const tail = this.pts.slice(this.pts.length - st);
    const len = Math.hypot(ex - x0, ey - y0);
    const steps = Math.max(1, Math.ceil(len / 1.5));
    const out: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      out.push(x0 + (ex - x0) * t, y0 + (ey - y0) * t, p, tail[3]! * t);
      if (st === 6) out.push(tail[4]!, tail[5]!);
    }
    this.pts = out;
    this.lastX = ex;
    this.lastY = ey;
  }

  build(ids: { pageId: string; notebookId: string; z: number }): StrokeItem {
    const points = new Float32Array(this.pts);
    const pad = this.style.width * (this.style.tool === 'pencil' ? 2.2 : 0.75) + 1;
    return {
      id: newId(),
      type: 'stroke',
      pageId: ids.pageId,
      notebookId: ids.notebookId,
      z: ids.z,
      bbox: pointsBBox(points, this.stride, pad),
      createdAt: Date.now(),
      tool: this.style.tool,
      color: this.style.color,
      width: this.style.width,
      opacity: this.style.opacity,
      dash: this.style.dash,
      pressureMode: this.style.pressureMode,
      stride: this.stride,
      points,
      t0: Math.round(performance.timeOrigin + this.tStart),
    };
  }
}

/** Erzeugt ein neues StrokeItem aus einem Teilstück eines vorhandenen Strichs. */
export function strokeFromPiece(src: StrokeItem, points: Float32Array, z: number): StrokeItem {
  const pad = src.width * (src.tool === 'pencil' ? 2.2 : 0.75) + 1;
  return { ...src, id: newId(), z, points, bbox: pointsBBox(points, src.stride, pad) };
}

/** Höhenwinkel und Azimut aus tiltX/tiltY (Grad), falls der Browser sie nicht direkt liefert. */
export function tiltToAngles(tiltX: number, tiltY: number): { azimuth: number; altitude: number } {
  const tx = Math.tan((tiltX * Math.PI) / 180);
  const ty = Math.tan((tiltY * Math.PI) / 180);
  const azimuth = Math.atan2(ty, tx);
  const r = Math.hypot(tx, ty);
  const altitude = r === 0 ? Math.PI / 2 : Math.atan(1 / r);
  return { azimuth, altitude };
}
