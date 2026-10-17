// Finger-Gesten: Verschieben mit einem oder mehreren Fingern, Zoomen mit
// zwei Fingern, Tipps mit zwei/drei Fingern (Undo/Redo).

export interface GestureHandlers {
  onStart(): void;
  onPanZoom(dx: number, dy: number, factor: number, cx: number, cy: number): void;
  /** Geschwindigkeit in px/ms beim Loslassen */
  onEnd(vx: number, vy: number): void;
  onTap(fingers: number): void;
}

interface Track {
  x: number;
  y: number;
  sx: number;
  sy: number;
}

const TAP_MAX_MS = 280;
const TAP_SLOP = 12;

export class TouchGestures {
  private pts = new Map<number, Track>();
  private startTime = 0;
  private maxFingers = 0;
  private moved = false;
  private prevCx = 0;
  private prevCy = 0;
  private prevDist = 0;
  private samples: { t: number; x: number; y: number }[] = [];
  active = false;

  constructor(private readonly h: GestureHandlers) {}

  get count(): number {
    return this.pts.size;
  }

  get startedAt(): number {
    return this.startTime;
  }

  has(id: number): boolean {
    return this.pts.has(id);
  }

  down(id: number, x: number, y: number, t: number) {
    if (!this.pts.size) {
      this.startTime = t;
      this.maxFingers = 0;
      this.moved = false;
      this.active = true;
      this.samples = [];
      this.h.onStart();
    }
    this.pts.set(id, { x, y, sx: x, sy: y });
    this.maxFingers = Math.max(this.maxFingers, this.pts.size);
    this.resetReference();
  }

  move(id: number, x: number, y: number, t: number) {
    const p = this.pts.get(id);
    if (!p) return;
    p.x = x;
    p.y = y;
    if (Math.hypot(x - p.sx, y - p.sy) > TAP_SLOP) this.moved = true;
    const { cx, cy, dist } = this.centroid();
    const factor = this.pts.size >= 2 && this.prevDist > 0 ? dist / this.prevDist : 1;
    const dx = cx - this.prevCx;
    const dy = cy - this.prevCy;
    this.prevCx = cx;
    this.prevCy = cy;
    this.prevDist = dist;
    if (this.moved) {
      this.h.onPanZoom(dx, dy, factor, cx, cy);
      this.samples.push({ t, x: cx, y: cy });
      while (this.samples.length > 2 && t - this.samples[0]!.t > 100) this.samples.shift();
    }
  }

  up(id: number, t: number) {
    if (!this.pts.delete(id)) return;
    if (this.pts.size) {
      this.resetReference();
      // Bei Wechsel der Fingerzahl keinen Schwung übernehmen.
      this.samples = [];
      return;
    }
    this.active = false;
    if (!this.moved && t - this.startTime < TAP_MAX_MS) {
      this.h.onEnd(0, 0);
      this.h.onTap(this.maxFingers);
      return;
    }
    let vx = 0;
    let vy = 0;
    const s = this.samples;
    if (s.length >= 2) {
      const a = s[0]!;
      const b = s[s.length - 1]!;
      const dt = b.t - a.t;
      if (dt > 0 && t - b.t < 60) {
        vx = (b.x - a.x) / dt;
        vy = (b.y - a.y) / dt;
      }
    }
    this.h.onEnd(vx, vy);
  }

  /** Bricht die Geste ab (z. B. wenn der Stift aufsetzt). */
  cancel() {
    if (!this.pts.size) return;
    this.pts.clear();
    this.active = false;
    this.h.onEnd(0, 0);
  }

  private resetReference() {
    const { cx, cy, dist } = this.centroid();
    this.prevCx = cx;
    this.prevCy = cy;
    this.prevDist = dist;
  }

  private centroid() {
    let cx = 0;
    let cy = 0;
    for (const p of this.pts.values()) {
      cx += p.x;
      cy += p.y;
    }
    const n = Math.max(1, this.pts.size);
    cx /= n;
    cy /= n;
    let dist = 0;
    for (const p of this.pts.values()) dist += Math.hypot(p.x - cx, p.y - cy);
    return { cx, cy, dist: dist / n };
  }
}
