// Radierer: ganze Striche („Strich“) oder punktgenau („Präzision“).
// Änderungen werden während des Radierens nur angezeigt und am Ende als
// ein einziger Befehl übernommen.

import type { Id, Item, Rect, StrokeItem } from '../../model/types';
import { strokeFromPiece } from '../ink/capture';
import { eraseFromStroke, strokeHitsCapsule } from '../geometry/hit';
import { union } from '../geometry/rect';
import type { PageBox } from '../view/camera';
import { toPage, type Sample, type Tool, type ToolHost } from './types';

export class EraserTool implements Tool {
  private pageId: Id | null = null;
  private box: PageBox | null = null;
  private originals = new Map<Id, Item>();
  private hidden = new Set<Id>();
  private pieces = new Map<Id, StrokeItem>();
  private last: [number, number] = [0, 0];
  private region: Rect | null = null;
  private cursor = { sx: 0, sy: 0, visible: false };

  constructor(private readonly host: ToolHost) {}

  get active(): boolean {
    return this.pageId !== null;
  }

  begin(s: Sample, pageId: Id): void {
    const box = this.host.pageBox(pageId);
    const items = this.host.doc.getItems(pageId);
    if (!box || !items) return;
    this.pageId = pageId;
    this.box = box;
    this.originals = new Map(items.map((it) => [it.id, it]));
    this.hidden.clear();
    this.pieces.clear();
    this.host.live.setBlend('normal');
    const p = toPage(this.host, box, s);
    this.last = p;
    this.cursor = { sx: s.sx, sy: s.sy, visible: true };
    this.erase(p, p);
  }

  move(samples: Sample[]): void {
    if (!this.pageId) return;
    for (const s of samples) {
      const p = toPage(this.host, this.box!, s);
      this.erase(this.last, p);
      this.last = p;
      this.cursor = { sx: s.sx, sy: s.sy, visible: true };
    }
  }

  private erase(a: [number, number], b: [number, number]) {
    const { settings, camera } = this.host;
    const r = settings.eraser.size / camera.scale;
    const precise = settings.eraser.mode === 'precision';
    const onlyHl = settings.eraser.highlighterOnly;
    const candidates: StrokeItem[] = [];
    for (const it of this.originals.values()) {
      if (it.type === 'stroke' && !this.hidden.has(it.id)) candidates.push(it);
    }
    candidates.push(...this.pieces.values());

    for (const s of candidates) {
      if (onlyHl && s.tool !== 'highlighter') continue;
      if (!precise) {
        if (strokeHitsCapsule(s, a[0], a[1], b[0], b[1], r)) this.remove(s);
        continue;
      }
      const result = eraseFromStroke(s, a[0], a[1], b[0], b[1], r);
      if (!result) continue;
      this.remove(s);
      result.forEach((pts, i) => {
        const piece = strokeFromPiece(s, pts, s.z + (i + 1) * 1e-7);
        this.pieces.set(piece.id, piece);
      });
    }
  }

  private remove(s: StrokeItem) {
    if (this.pieces.has(s.id)) this.pieces.delete(s.id);
    else this.hidden.add(s.id);
    this.region = union(this.region, s.bbox);
  }

  frame(): void {
    if (!this.pageId) return;
    if (this.region) {
      this.host.preview(this.pageId, this.hidden, [...this.pieces.values()], this.region);
      this.region = null;
    }
    const { live, settings } = this.host;
    live.clear();
    if (this.cursor.visible) {
      const r = settings.eraser.size;
      const ctx = live.screen({
        x: this.cursor.sx - r - 2,
        y: this.cursor.sy - r - 2,
        w: 2 * r + 4,
        h: 2 * r + 4,
      });
      ctx.beginPath();
      ctx.arc(this.cursor.sx, this.cursor.sy, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fill();
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = 'rgba(40,44,52,0.7)';
      ctx.stroke();
    }
  }

  end(): void {
    if (!this.pageId) return;
    const items = [
      ...[...this.hidden].map((id) => ({ before: this.originals.get(id)!, after: null })),
      ...[...this.pieces.values()].map((p) => ({ before: null, after: p as Item })),
    ];
    this.reset();
    this.host.doc.execute({ label: 'Radieren', items, pages: [] });
  }

  cancel(): void {
    const pageId = this.pageId;
    const region = [...this.hidden].reduce<Rect | null>(
      (r, id) => union(r, this.originals.get(id)!.bbox),
      null,
    );
    this.reset();
    if (pageId && region) this.host.preview(pageId, new Set(), [], region);
  }

  private reset() {
    this.pageId = null;
    this.box = null;
    this.hidden = new Set();
    this.pieces = new Map();
    this.originals = new Map();
    this.region = null;
    this.host.live.clear();
  }
}
