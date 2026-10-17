// Textfeld-Werkzeug: Antippen setzt ein neues Textfeld oder öffnet ein
// vorhandenes zur Bearbeitung. Die eigentliche Eingabe passiert in einem
// echten Textfeld der UI (dort funktioniert Scribble).

import type { Id, TextItem } from '../../model/types';
import { itemHitPoint } from '../geometry/transform';
import type { PageBox } from '../view/camera';
import { makeText } from './factory';
import { toPage, type Sample, type Tool, type ToolHost } from './types';

const DEFAULT_WIDTH = 220;

export class TextTool implements Tool {
  private pageId: Id | null = null;
  private box: PageBox | null = null;
  private start = { sx: 0, sy: 0 };
  private moved = false;
  private sample: Sample | null = null;

  constructor(private readonly host: ToolHost) {}

  get active(): boolean {
    return this.pageId !== null;
  }

  begin(s: Sample, pageId: Id): void {
    this.box = this.host.pageBox(pageId) ?? null;
    if (!this.box) return;
    this.pageId = pageId;
    this.start = { sx: s.sx, sy: s.sy };
    this.sample = s;
    this.moved = false;
  }

  move(samples: Sample[]): void {
    for (const s of samples)
      if (Math.hypot(s.sx - this.start.sx, s.sy - this.start.sy) > 8) this.moved = true;
  }

  frame(): void {}

  end(): void {
    const pageId = this.pageId;
    const box = this.box;
    const s = this.sample;
    this.pageId = null;
    if (!pageId || !box || !s || this.moved) return;
    tapText(this.host, pageId, box, s);
  }

  cancel(): void {
    this.pageId = null;
  }
}

/** Gemeinsame Logik für Stift-Tipp und Finger-Tipp mit dem Text-Werkzeug. */
export function tapText(host: ToolHost, pageId: Id, box: PageBox, s: Sample): void {
  const [x, y] = toPage(host, box, s);
  const items = host.doc.getItems(pageId) ?? [];
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.type === 'text' && itemHitPoint(it, x, y, 4)) {
      host.startTextEdit?.(it as TextItem, false);
      return;
    }
  }
  const st = host.settings.text;
  const width = Math.max(60, Math.min(DEFAULT_WIDTH, box.w - x - 12));
  const item = makeText(
    x,
    y - st.size * 0.65,
    width,
    { ...st },
    {
      pageId,
      notebookId: host.doc.id,
      z: host.doc.topZ(pageId) + 1,
    },
  );
  host.startTextEdit?.(item, true);
}
