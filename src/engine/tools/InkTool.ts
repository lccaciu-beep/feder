// Stift und Textmarker. Zeichnet live auf die Live-Ebene, erkennt
// „zeichnen und halten“ (gerade Linie) und Zickzack-Löschen.

import { getStroke } from 'perfect-freehand';
import type { Id, StrokeItem } from '../../model/types';
import { applyInkStyle, centerlinePath, outlineToPath, strokeOptions, toFreehandInput } from '../ink/brushes';
import { StrokeBuilder, type StrokeStyle } from '../ink/capture';
import { isZigzag, zigzagTargets } from '../geometry/hit';
import { pointsBBox } from '../geometry/rect';
import type { PageBox } from '../view/camera';
import { toPage, type Sample, type Tool, type ToolHost } from './types';

const HOLD_MS = 550;
const HOLD_SLOP_PX = 4;
const HOLD_MIN_LENGTH_PX = 24;

export class InkTool implements Tool {
  private builder: StrokeBuilder | null = null;
  private box: PageBox | null = null;
  private pageId: Id = '';
  private predicted: number[][] = [];
  private straight = false;
  private hold = { sx: 0, sy: 0, t: 0 };
  private screenLength = 0;
  private lastScreen = { sx: 0, sy: 0 };
  private last: [number, number] = [0, 0];
  private dirty = false;

  constructor(
    private readonly host: ToolHost,
    readonly kind: 'pen' | 'highlighter',
  ) {}

  get active(): boolean {
    return !!this.builder;
  }

  private style(pointerType: string): StrokeStyle {
    const s = this.host.settings;
    if (this.kind === 'highlighter') {
      return {
        tool: 'highlighter',
        color: s.highlighter.color,
        width: s.highlighter.width,
        opacity: 0.4,
        dash: 'solid',
        pressureMode: 'none',
      };
    }
    return {
      tool: s.pen.kind,
      color: s.pen.color,
      width: s.pen.width,
      opacity: 1,
      dash: s.pen.dash,
      pressureMode: this.host.pressureMode(pointerType),
    };
  }

  begin(s: Sample, pageId: Id): void {
    const box = this.host.pageBox(pageId);
    if (!box) return;
    this.box = box;
    this.pageId = pageId;
    const style = this.style(s.pointerType);
    this.builder = new StrokeBuilder(
      style,
      s.pointerType === 'pen',
      this.host.camera.scale,
      this.host.settings.velocitySensitivity,
    );
    this.straight = this.kind === 'highlighter' && this.host.settings.highlighter.straight;
    this.hold = { sx: s.sx, sy: s.sy, t: s.t };
    this.screenLength = 0;
    this.lastScreen = { sx: s.sx, sy: s.sy };
    this.predicted = [];
    this.host.live.setBlend(this.kind === 'highlighter' ? 'multiply' : 'normal');
    this.addSample(s);
    this.dirty = true;
  }

  private addSample(s: Sample, force = false) {
    const b = this.builder!;
    const [x, y] = toPage(this.host, this.box!, s);
    this.last = [x, y];
    this.screenLength += Math.hypot(s.sx - this.lastScreen.sx, s.sy - this.lastScreen.sy);
    this.lastScreen = { sx: s.sx, sy: s.sy };
    if (this.straight && b.count >= 1) {
      b.straighten(x, y);
      return;
    }
    b.add({ x, y, pressure: s.pressure, t: s.t, azimuth: s.azimuth, altitude: s.altitude }, force);
    if (Math.hypot(s.sx - this.hold.sx, s.sy - this.hold.sy) > HOLD_SLOP_PX) {
      this.hold = { sx: s.sx, sy: s.sy, t: s.t };
    }
  }

  move(samples: Sample[], predicted: Sample[]): void {
    if (!this.builder) return;
    for (const s of samples) this.addSample(s);
    this.predicted = this.straight
      ? []
      : predicted.map((p) => {
          const [x, y] = toPage(this.host, this.box!, p);
          return this.builder!.previewPoint({
            x,
            y,
            pressure: p.pressure,
            t: p.t,
            azimuth: p.azimuth,
            altitude: p.altitude,
          });
        });
    this.dirty = true;
  }

  frame(now: number): void {
    const b = this.builder;
    if (!b) return;
    if (
      !this.straight &&
      this.kind === 'pen' &&
      this.host.settings.holdToStraighten &&
      now - this.hold.t > HOLD_MS &&
      this.screenLength > HOLD_MIN_LENGTH_PX
    ) {
      this.straight = true;
      b.straighten(this.last[0], this.last[1]);
      this.predicted = [];
      this.dirty = true;
    }
    if (this.dirty) this.render();
  }

  private render() {
    const b = this.builder!;
    const box = this.box!;
    const { camera, live } = this.host;
    const style = { ...b.style, stride: b.stride };
    const pts = b.points;
    const extra = this.predicted.map((p) => p.slice(0, 3));
    const bbox = pointsBBox(pts, b.stride, style.width * 2.5 + 2);
    for (const p of this.predicted) {
      bbox.x = Math.min(bbox.x, p[0]! - style.width * 2);
      bbox.y = Math.min(bbox.y, p[1]! - style.width * 2);
      bbox.w = Math.max(bbox.w, p[0]! + style.width * 2 - bbox.x);
      bbox.h = Math.max(bbox.h, p[1]! + style.width * 2 - bbox.y);
    }
    const [ox, oy] = camera.toScreen(box.x, box.y);
    const s = camera.scale;
    live.clear();
    const ctx = live.begin(ox, oy, s, {
      x: ox + bbox.x * s,
      y: oy + bbox.y * s,
      w: bbox.w * s,
      h: bbox.h * s,
    });
    const fake = { ...b.style, stride: b.stride, opacity: b.style.opacity } as StrokeItem;
    applyInkStyle(ctx, fake);
    if (b.style.dash !== 'solid') {
      const all = extra.length ? [...pts, ...this.predicted.flat()] : pts;
      ctx.stroke(centerlinePath(all, b.stride));
      ctx.setLineDash([]);
    } else {
      const outline = getStroke(toFreehandInput(pts, style, extra), strokeOptions(style, false));
      ctx.fill(outlineToPath(outline));
    }
    ctx.globalAlpha = 1;
    this.dirty = false;
  }

  end(): void {
    const b = this.builder;
    if (!b) return;
    const { doc, settings, live } = this.host;
    const pageId = this.pageId;
    this.builder = null;

    if (this.kind === 'pen' && !this.straight && settings.zigzagErase && isZigzag(b.points, b.stride)) {
      const items = doc.getItems(pageId) ?? [];
      const strokes = items.filter((it): it is StrokeItem => it.type === 'stroke');
      const targets = zigzagTargets(b.points, b.stride, b.style.width, strokes);
      if (targets.length) {
        live.clear();
        doc.execute({
          label: 'Zickzack löschen',
          items: targets.map((t) => ({ before: t, after: null })),
          pages: [],
        });
        return;
      }
    }

    const item = b.build({ pageId, notebookId: doc.id, z: doc.topZ(pageId) + 1 });
    // Erst den fertigen Strich in den Cache zeichnen lassen, dann die Live-Ebene leeren –
    // beides im selben Task, damit nichts flackert.
    doc.execute({
      label: this.kind === 'pen' ? 'Stift' : 'Textmarker',
      items: [{ before: null, after: item }],
      pages: [],
    });
    live.clear();
  }

  cancel(): void {
    this.builder = null;
    this.host.live.clear();
  }
}
