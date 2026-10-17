// Laserpointer: leuchtende Spur, die nach kurzer Zeit verblasst.
// Es wird nichts gespeichert.

import type { Id } from '../../model/types';
import type { Sample, Tool, ToolHost } from './types';

const FADE_MS = 650;

export class LaserTool implements Tool {
  private trail: { x: number; y: number; t: number }[] = [];
  private down = false;

  constructor(private readonly host: ToolHost) {}

  get active(): boolean {
    return this.down || this.trail.length > 0;
  }

  begin(s: Sample, _pageId: Id): void {
    this.down = true;
    this.trail.push({ x: s.sx, y: s.sy, t: performance.now() });
  }

  move(samples: Sample[]): void {
    const t = performance.now();
    for (const s of samples) this.trail.push({ x: s.sx, y: s.sy, t });
  }

  frame(): void {
    const cutoff = performance.now() - FADE_MS;
    while (this.trail.length && this.trail[0]!.t < cutoff) this.trail.shift();
    const { live } = this.host;
    live.clear();
    if (!this.trail.length) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of this.trail) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const ctx = live.screen({ x: minX - 20, y: minY - 20, w: maxX - minX + 40, h: maxY - minY + 40 });
    const color = this.host.settings.laser.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const tNow = performance.now();
    for (let i = 1; i < this.trail.length; i++) {
      const a = this.trail[i - 1]!;
      const b = this.trail[i]!;
      const life = 1 - (tNow - b.t) / FADE_MS;
      ctx.globalAlpha = Math.max(0, life);
      ctx.strokeStyle = color;
      ctx.lineWidth = 3 + 4 * life;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    if (this.down) {
      const p = this.trail[this.trail.length - 1]!;
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  end(): void {
    this.down = false;
  }

  cancel(): void {
    this.down = false;
    this.trail = [];
    this.host.live.clear();
  }
}
