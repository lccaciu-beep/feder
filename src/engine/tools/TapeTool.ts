// Tape: Ziehen legt einen Klebestreifen über Inhalte, Antippen deckt ihn
// auf oder zu (zum Lernen).

import type { Id, Item, TapeItem } from '../../model/types';
import { snapLineEnd } from '../geometry/hit';
import { itemHitPoint } from '../geometry/transform';
import { drawItem } from '../render/items';
import type { PageBox } from '../view/camera';
import { makeTape } from './factory';
import { toPage, type Sample, type Tool, type ToolHost } from './types';

export class TapeTool implements Tool {
  private pageId: Id | null = null;
  private box: PageBox | null = null;
  private start: [number, number] = [0, 0];
  private end_: [number, number] = [0, 0];
  private startScreen = { sx: 0, sy: 0 };
  private moved = false;
  private dirty = false;

  constructor(private readonly host: ToolHost) {}

  get active(): boolean {
    return this.pageId !== null;
  }

  begin(s: Sample, pageId: Id): void {
    this.box = this.host.pageBox(pageId) ?? null;
    if (!this.box) return;
    this.pageId = pageId;
    this.start = toPage(this.host, this.box, s);
    this.end_ = this.start;
    this.startScreen = { sx: s.sx, sy: s.sy };
    this.moved = false;
  }

  move(samples: Sample[]): void {
    if (!this.box) return;
    for (const s of samples) {
      const [x, y] = toPage(this.host, this.box, s);
      this.end_ = snapLineEnd(this.start[0], this.start[1], x, y, 6);
      if (Math.hypot(s.sx - this.startScreen.sx, s.sy - this.startScreen.sy) > 6) this.moved = true;
    }
    this.dirty = true;
  }

  private draft(pageId: Id): TapeItem {
    const st = this.host.settings.tape;
    return makeTape([...this.start, ...this.end_], st.width, st.color, {
      pageId,
      notebookId: this.host.doc.id,
      z: this.host.doc.topZ(pageId) + 1,
    });
  }

  frame(): void {
    if (!this.dirty || !this.moved || !this.box) return;
    this.dirty = false;
    const { live, camera } = this.host;
    const t = this.draft(this.pageId!);
    const [ox, oy] = camera.toScreen(this.box.x, this.box.y);
    const s = camera.scale;
    live.clear();
    const ctx = live.begin(ox, oy, s, {
      x: ox + t.bbox.x * s - 2,
      y: oy + t.bbox.y * s - 2,
      w: t.bbox.w * s + 4,
      h: t.bbox.h * s + 4,
    });
    drawItem(ctx, t);
  }

  end(): void {
    const pageId = this.pageId;
    this.pageId = null;
    this.host.live.clear();
    if (!pageId) return;
    if (this.moved) {
      const t = this.draft(pageId);
      this.host.doc.execute({ label: 'Tape', items: [{ before: null, after: t }], pages: [] });
      return;
    }
    toggleTapeAt(this.host, pageId, this.start[0], this.start[1]);
  }

  cancel(): void {
    this.pageId = null;
    this.host.live.clear();
  }
}

/** Deckt das oberste Tape an (x, y) auf bzw. zu. Gibt true zurück, wenn eins getroffen wurde. */
export function toggleTapeAt(host: ToolHost, pageId: Id, x: number, y: number): boolean {
  const items = host.doc.getItems(pageId) ?? [];
  for (let i = items.length - 1; i >= 0; i--) {
    const it: Item = items[i]!;
    if (it.type === 'tape' && itemHitPoint(it, x, y, 2)) {
      host.doc.execute({
        label: it.covered ? 'Tape aufdecken' : 'Tape zudecken',
        items: [{ before: it, after: { ...it, covered: !it.covered } }],
        pages: [],
      });
      return true;
    }
  }
  return false;
}
