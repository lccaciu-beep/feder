// Stift, Textmarker und Formen-Werkzeug. Zeichnet live auf die Live-Ebene,
// erkennt „zeichnen und halten“ (Linie oder Form), Zickzack-Löschen und
// Kreise um Inhalte (Auswahl anbieten).

import { getStroke } from 'perfect-freehand';
import type { Id, Item, StrokeItem } from '../../model/types';
import { recognizeShape, type Recognized } from '../geometry/shapes';
import { itemInPolygon } from '../geometry/transform';
import { shapePath } from '../render/items';
import { makeShape, type ShapeStyle } from './factory';
import { applyInkStyle, centerlinePath, outlineToPath, strokeOptions, toFreehandInput } from '../ink/brushes';
import { StrokeBuilder, type StrokeStyle } from '../ink/capture';
import { isZigzag, wavyStrike, wavyTargets, zigzagTargets } from '../geometry/hit';
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
  /** Erkannte Form (Formen-Werkzeug oder Stift nach Halten) */
  private shapePreview: Recognized | null = null;

  constructor(
    private readonly host: ToolHost,
    readonly kind: 'pen' | 'highlighter' | 'shape',
  ) {}

  private shapeStyle(): ShapeStyle {
    const s = this.host.settings;
    return this.kind === 'shape'
      ? { color: s.shape.color, width: s.shape.width, dash: s.shape.dash, fill: s.shape.fill }
      : { color: s.pen.color, width: s.pen.width, dash: s.pen.dash, fill: false };
  }

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
    if (this.kind === 'shape') {
      return {
        tool: 'ballpoint',
        color: s.shape.color,
        width: s.shape.width,
        opacity: 1,
        dash: s.shape.dash,
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
    this.shapePreview = null;
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
    if (this.shapePreview) return;
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
      !this.shapePreview &&
      (this.kind === 'shape' || (this.kind === 'pen' && this.host.settings.holdToStraighten)) &&
      now - this.hold.t > HOLD_MS &&
      this.screenLength > HOLD_MIN_LENGTH_PX &&
      !this.isEraseGesture(b)
    ) {
      const rec = recognizeShape(b.points, b.stride);
      if (rec && rec.shape !== 'line') this.shapePreview = rec;
      else {
        this.straight = true;
        b.straighten(this.last[0], this.last[1]);
      }
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
    if (this.shapePreview) {
      const st = this.shapeStyle();
      const shape = makeShape(this.shapePreview, st, { pageId: this.pageId, notebookId: '', z: 0 });
      const r = shape.bbox;
      const sctx = live.begin(ox, oy, s, {
        x: ox + r.x * s - 4,
        y: oy + r.y * s - 4,
        w: r.w * s + 8,
        h: r.h * s + 8,
      });
      sctx.strokeStyle = st.color;
      sctx.lineWidth = st.width;
      sctx.lineJoin = 'round';
      sctx.lineCap = 'round';
      sctx.stroke(shapePath(shape));
      this.dirty = false;
      return;
    }
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

    // Durchkritzeln (Zickzack) oder welliges Durchstreichen löscht
    const erase =
      this.kind === 'pen' && !this.straight && !this.shapePreview ? this.eraseTargets(b, pageId) : null;
    if (erase?.length) {
      live.clear();
      doc.execute({
        label: 'Durchstreichen löschen',
        items: erase.map((t) => ({ before: t, after: null })),
        pages: [],
      });
      return;
    }

    const at = { pageId, notebookId: doc.id, z: doc.topZ(pageId) + 1 };
    const rec =
      this.shapePreview ??
      (this.kind === 'shape' && !this.straight ? recognizeShape(b.points, b.stride) : null);
    if (rec || (this.kind === 'shape' && this.straight)) {
      const shape = makeShape(
        rec ?? {
          shape: 'line',
          vertices: [...b.points.slice(0, 2), ...b.points.slice(-b.stride, -b.stride + 2)],
          rotation: 0,
        },
        this.shapeStyle(),
        at,
      );
      doc.execute({ label: 'Form', items: [{ before: null, after: shape }], pages: [] });
      live.clear();
      return;
    }

    const item = b.build(at);
    const offer =
      this.kind === 'pen' && !this.straight && settings.circleToLasso ? this.lassoCandidate(b, pageId) : null;
    // Erst den fertigen Strich in den Cache zeichnen lassen, dann die Live-Ebene leeren –
    // beides im selben Task, damit nichts flackert.
    doc.execute({
      label: this.kind === 'highlighter' ? 'Textmarker' : 'Stift',
      items: [{ before: null, after: item }],
      pages: [],
    });
    live.clear();
    if (offer) this.host.offerLasso?.(pageId, offer, item.id);
  }

  /** Elemente, die ein Zickzack oder eine Wellenlinie löschen würde (sonst null). */
  private eraseTargets(b: StrokeBuilder, pageId: Id): Item[] | null {
    const { settings, doc } = this.host;
    const items = doc.getItems(pageId) ?? [];
    if (settings.zigzagErase && isZigzag(b.points, b.stride)) {
      const strokes = items.filter((it): it is StrokeItem => it.type === 'stroke');
      const targets = zigzagTargets(b.points, b.stride, b.style.width, strokes);
      if (targets.length) return targets;
    }
    if (settings.waveErase) {
      const wave = wavyStrike(b.points, b.stride);
      if (wave) {
        const targets = wavyTargets(wave, b.points, b.stride, b.style.width, items);
        if (targets.length) return targets;
      }
    }
    return null;
  }

  /** Beim Halten am Ende keine Linie/Form erzeugen, wenn gerade durchgestrichen wird. */
  private eraseCache = { count: -1, result: false };

  private isEraseGesture(b: StrokeBuilder): boolean {
    if (this.kind !== 'pen') return false;
    if (this.eraseCache.count !== b.count) {
      this.eraseCache = { count: b.count, result: !!this.eraseTargets(b, this.pageId)?.length };
    }
    return this.eraseCache.result;
  }

  /** Geschlossene Schleife um vorhandene Inhalte? Dann Polygon zurückgeben. */
  private lassoCandidate(b: StrokeBuilder, pageId: Id): number[] | null {
    const st = b.stride;
    const pts = b.points;
    const n = pts.length / st;
    if (n < 12) return null;
    const box = pointsBBox(pts, st, 0);
    const diag = Math.hypot(box.w, box.h);
    if (diag < 30) return null;
    const gap = Math.hypot(pts[0]! - pts[(n - 1) * st]!, pts[1]! - pts[(n - 1) * st + 1]!);
    let len = 0;
    for (let i = 1; i < n; i++)
      len += Math.hypot(pts[i * st]! - pts[(i - 1) * st]!, pts[i * st + 1]! - pts[(i - 1) * st + 1]!);
    if (gap > diag * 0.2 || len < diag * 1.8) return null;
    const poly: number[] = [];
    for (let i = 0; i < n; i++) poly.push(pts[i * st]!, pts[i * st + 1]!);
    const inside = (this.host.doc.getItems(pageId) ?? []).some((it) => itemInPolygon(it, poly));
    return inside ? poly : null;
  }

  cancel(): void {
    this.builder = null;
    this.shapePreview = null;
    this.host.live.clear();
  }
}
