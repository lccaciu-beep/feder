// Fassade der Zeichen-Engine. Verbindet Eingabe (Pointer Events, Gesten,
// Palm Rejection), Kamera, Seiten-Darstellung und Werkzeuge. Die UI spricht
// nur über diese Klasse mit der Engine.

import type { AppSettings } from '../model/settings';
import type { Id, Item, PressureMode, Rect } from '../model/types';
import type { SaveStatus } from '../storage/autosave';
import type { DocChange, NotebookDoc } from './doc/NotebookDoc';
import { isHighlighter } from './ink/brushes';
import { tiltToAngles } from './ink/capture';
import { expand, intersection, intersects, union } from './geometry/rect';
import { TouchGestures } from './input/gestures';
import { PressureDetector, type PressureSupport } from './input/pressure';
import { LiveLayer } from './render/LiveLayer';
import { PageView, chooseLevel } from './render/PageView';
import { EraserTool } from './tools/EraserTool';
import { InkTool } from './tools/InkTool';
import type { Sample, Tool, ToolHost } from './tools/types';
import { Camera, layoutPages, type CameraState, type Insets, type Layout, type PageBox } from './view/camera';

export type ToolId = 'pen' | 'highlighter' | 'eraser';

export interface EditorState {
  tool: ToolId;
  canUndo: boolean;
  canRedo: boolean;
  pageIndex: number;
  pageCount: number;
  zoom: number;
  saveStatus: SaveStatus;
  pressureSupport: PressureSupport;
}

export interface EditorOptions {
  insets?: Insets;
  initialPage?: number;
}

/** Touches innerhalb dieser Zeit nach dem Stift gelten als Handballen. */
const PALM_AFTER_PEN_MS = 300;
/** Begann eine Finger-Geste kurz vor dem Stift, wird das Scrollen zurückgenommen. */
const PALM_UNDO_SCROLL_MS = 500;
const SETTLE_MS = 140;

type PointerWithAngles = PointerEvent & { altitudeAngle?: number; azimuthAngle?: number };

export class Editor implements ToolHost {
  readonly camera = new Camera();
  readonly live: LiveLayer;
  settings: AppSettings;
  private readonly world: HTMLDivElement;
  private views = new Map<Id, PageView>();
  private layout: Layout = layoutPages([], 'vertical');
  private boxes = new Map<Id, PageBox>();
  private tools: Record<ToolId, Tool>;
  private toolId: ToolId = 'pen';
  private dpr = 1;
  private rootRect = { left: 0, top: 0 };

  // Eingabe
  private activePointer: number | null = null;
  private activeType = '';
  private penDown = false;
  private lastPenTime = -Infinity;
  private ignored = new Set<number>();
  private gestures: TouchGestures;
  private gestureCamStart: CameraState | null = null;
  private finger: { id: number; t: number; sx: number; sy: number } | null = null;
  private pressure = new PressureDetector();

  // Animation
  private frameReq = 0;
  private cameraDirty = true;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private inertia: { vx: number; vy: number; last: number } | null = null;
  private anim: { from: CameraState; to: CameraState; start: number; ms: number } | null = null;

  private listeners = new Set<(s: EditorState) => void>();
  private lastState: EditorState | null = null;
  private disposers: (() => void)[] = [];
  private resizeObserver: ResizeObserver;
  private insets: Insets;
  private debugEl: HTMLDivElement | null = null;
  private debug = { frames: 0, events: 0, samples: 0, since: 0 };

  constructor(
    readonly root: HTMLElement,
    readonly doc: NotebookDoc,
    settings: AppSettings,
    opts: EditorOptions = {},
  ) {
    this.settings = settings;
    this.insets = opts.insets ?? { top: 0, right: 0, bottom: 0, left: 0 };
    root.classList.add('feder-editor');
    this.world = document.createElement('div');
    this.world.className = 'feder-world';
    root.appendChild(this.world);
    this.live = new LiveLayer(root);
    this.tools = {
      pen: new InkTool(this, 'pen'),
      highlighter: new InkTool(this, 'highlighter'),
      eraser: new EraserTool(this),
    };
    this.gestures = new TouchGestures({
      onStart: () => this.stopMotion(),
      onPanZoom: (dx, dy, f, cx, cy) => {
        if (f !== 1) this.camera.zoomAt(f, cx, cy);
        this.camera.panBy(dx, dy);
        this.camera.clamp();
        this.invalidateCamera();
      },
      onEnd: (vx, vy) => this.onGestureEnd(vx, vy),
      onTap: (n) => {
        if (!this.settings.tapGestures) return;
        if (n === 2) this.undo();
        else if (n === 3) this.redo();
      },
    });

    this.listen(root, 'pointerdown', this.onPointerDown);
    this.listen(root, 'pointermove', this.onPointerMove);
    this.listen(root, 'pointerup', this.onPointerUp);
    this.listen(root, 'pointercancel', this.onPointerUp);
    this.listen(root, 'lostpointercapture', this.onPointerUp);
    this.listen(root, 'wheel', this.onWheel, { passive: false });
    // Safari: Lupe, Textauswahl und Long-Press-Menü auf der Zeichenfläche verhindern.
    this.listen(root, 'touchstart', (e: TouchEvent) => e.preventDefault(), { passive: false });
    this.listen(root, 'touchmove', (e: TouchEvent) => e.preventDefault(), { passive: false });
    this.listen(root, 'contextmenu', (e: Event) => e.preventDefault());
    this.listen(root, 'gesturestart', (e: Event) => e.preventDefault());

    this.disposers.push(doc.on((c) => this.onDocChange(c)));
    this.disposers.push(doc.autosave.onStatus(() => this.emit()));

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(root);
    this.relayout();
    this.measure();
    this.camera.fit();
    if (opts.initialPage) this.goToPage(opts.initialPage, false);
    this.setDebug(settings.debugOverlay);
    // Erste Ansicht sofort aufbauen, nicht erst im nächsten Frame.
    this.cameraDirty = false;
    this.updateViews();
    this.scheduleSettle();
  }

  private listen<E extends Event>(
    target: EventTarget,
    type: string,
    fn: (e: E) => void,
    opts?: AddEventListenerOptions,
  ) {
    const h = fn as EventListener;
    target.addEventListener(type, h, opts);
    this.disposers.push(() => target.removeEventListener(type, h, opts));
  }

  // ---------- öffentliche API ----------

  get tool(): ToolId {
    return this.toolId;
  }

  setTool(id: ToolId) {
    if (this.toolId === id) return;
    this.tools[this.toolId].cancel();
    this.toolId = id;
    this.emit();
  }

  updateSettings(s: AppSettings) {
    const dirChanged = s.scrollDirection !== this.settings.scrollDirection;
    this.settings = s;
    this.setDebug(s.debugOverlay);
    if (s.pressureMode === 'auto' && this.pressure.support === 'unknown') this.pressure.reset();
    if (dirChanged) {
      const page = this.currentPageIndex();
      this.relayout();
      this.camera.fit();
      this.goToPage(page, false);
    }
  }

  setInsets(insets: Insets) {
    const prevTop = this.insets.top;
    this.insets = insets;
    this.onResize(prevTop);
  }

  undo() {
    this.cancelActiveTool();
    this.doc.undo();
    this.emit();
  }

  redo() {
    this.cancelActiveTool();
    this.doc.redo();
    this.emit();
  }

  onState(cb: (s: EditorState) => void): () => void {
    this.listeners.add(cb);
    cb(this.state());
    return () => this.listeners.delete(cb);
  }

  currentPageIndex(): number {
    const cam = this.camera;
    const [cx, cy] = cam.toWorld(cam.vw / 2, (cam.vh + this.insets.top) / 2);
    let best = 0;
    let bestDist = Infinity;
    for (const b of this.layout.boxes) {
      const d =
        this.camera.dir === 'vertical'
          ? cy < b.y
            ? b.y - cy
            : cy > b.y + b.h
              ? cy - b.y - b.h
              : 0
          : cx < b.x
            ? b.x - cx
            : cx > b.x + b.w
              ? cx - b.x - b.w
              : 0;
      if (d < bestDist) {
        bestDist = d;
        best = b.index;
      }
    }
    return best;
  }

  goToPage(index: number, animate = true) {
    const box = this.layout.boxes[Math.max(0, Math.min(index, this.layout.boxes.length - 1))];
    if (!box) return;
    const target = this.clampedTarget(this.camera.targetForPage(box));
    if (animate) this.animateTo(target);
    else {
      this.camera.restore(target);
      this.invalidateCamera();
    }
  }

  zoomBy(factor: number) {
    this.camera.zoomAt(factor, this.camera.vw / 2, this.camera.vh / 2);
    this.camera.clamp();
    this.invalidateCamera();
  }

  fitWidth() {
    const page = this.currentPageIndex();
    this.camera.fit();
    this.goToPage(page, false);
  }

  destroy() {
    this.cancelActiveTool();
    cancelAnimationFrame(this.frameReq);
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.resizeObserver.disconnect();
    for (const d of this.disposers) d();
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
    this.live.destroy();
    this.world.remove();
    this.debugEl?.remove();
    this.root.classList.remove('feder-editor');
    const save = this.doc.autosave;
    void save.flush().finally(() => save.dispose());
  }

  // ---------- ToolHost ----------

  pressureMode(pointerType: string): PressureMode {
    if (pointerType !== 'pen') return 'velocity';
    switch (this.settings.pressureMode) {
      case 'real':
        return 'real';
      case 'none':
        return 'none';
      case 'velocity':
        return 'velocity';
      default:
        return this.pressure.support === 'real' ? 'real' : 'velocity';
    }
  }

  pageBox(pageId: Id): PageBox | undefined {
    return this.boxes.get(pageId);
  }

  preview(pageId: Id, hidden: ReadonlySet<Id>, extra: readonly Item[], region: Rect) {
    const view = this.views.get(pageId);
    const items = this.doc.getItems(pageId);
    if (!view || !items) return;
    const merged = items.filter((it) => !hidden.has(it.id)).concat(extra);
    if (extra.length) merged.sort((a, b) => a.z - b.z);
    view.redrawRegion(expand(region, 1), merged);
  }

  // ---------- Zustand ----------

  private state(): EditorState {
    return {
      tool: this.toolId,
      canUndo: this.doc.history.canUndo,
      canRedo: this.doc.history.canRedo,
      pageIndex: this.currentPageIndex(),
      pageCount: this.doc.pageIds.length,
      zoom: this.camera.zoom,
      saveStatus: this.doc.autosave.getStatus(),
      pressureSupport: this.pressure.support,
    };
  }

  private emit() {
    const s = this.state();
    const l = this.lastState;
    if (
      l &&
      l.tool === s.tool &&
      l.canUndo === s.canUndo &&
      l.canRedo === s.canRedo &&
      l.pageIndex === s.pageIndex &&
      l.pageCount === s.pageCount &&
      Math.abs(l.zoom - s.zoom) < 0.005 &&
      l.saveStatus === s.saveStatus &&
      l.pressureSupport === s.pressureSupport
    ) {
      return;
    }
    this.lastState = s;
    for (const cb of this.listeners) cb(s);
  }

  // ---------- Layout & Darstellung ----------

  private relayout() {
    const pages = this.doc.pageIds.map((id) => this.doc.pages.get(id)!).filter(Boolean);
    this.layout = layoutPages(pages, this.settings.scrollDirection);
    this.boxes = new Map(this.layout.boxes.map((b) => [b.id, b]));
    this.camera.setLayout(this.layout, this.settings.scrollDirection);
    this.camera.clamp();
    this.invalidateCamera();
  }

  private measure() {
    const r = this.root.getBoundingClientRect();
    this.rootRect = { left: r.left, top: r.top };
    this.dpr = window.devicePixelRatio || 1;
    this.camera.setViewport(r.width, r.height, this.insets);
    this.live.resize(r.width, r.height, this.dpr);
  }

  /** Hält beim Größenwechsel den Punkt oben in der Mitte an seiner Stelle. */
  private onResize(prevTop = this.insets.top) {
    const cam = this.camera;
    const zoom = cam.zoom;
    const [ax, ay] = cam.toWorld(cam.vw / 2, prevTop);
    this.measure();
    cam.scale = cam.fitScale * zoom;
    cam.tx = cam.vw / 2 - ax * cam.scale;
    cam.ty = this.insets.top - ay * cam.scale;
    cam.clamp();
    this.invalidateCamera();
  }

  private invalidateCamera() {
    this.cameraDirty = true;
    this.requestFrame();
  }

  private requestFrame() {
    if (!this.frameReq) this.frameReq = requestAnimationFrame((t) => this.frame(t));
  }

  private frame(now: number) {
    this.frameReq = 0;
    this.stepMotion(now);
    if (this.cameraDirty) {
      this.cameraDirty = false;
      this.updateViews();
      this.scheduleSettle();
      this.emit();
    }
    const tool = this.tools[this.toolId];
    if (tool.active) tool.frame(now);
    if (tool.active || this.inertia || this.anim) this.requestFrame();
    this.debugFrame(now);
  }

  /** Erzeugt/positioniert Seiten im (erweiterten) Sichtbereich und entfernt den Rest. */
  private updateViews() {
    const cam = this.camera;
    const vis = cam.visibleWorld();
    const pre =
      cam.dir === 'vertical'
        ? { x: vis.x, y: vis.y - vis.h, w: vis.w, h: vis.h * 3 }
        : { x: vis.x - vis.w, y: vis.y, w: vis.w * 3, h: vis.h };
    const keep = new Set<Id>();
    for (const box of this.layout.boxes) {
      if (!intersects(box, pre)) continue;
      keep.add(box.id);
      let view = this.views.get(box.id);
      if (!view) {
        view = this.createView(box, intersects(box, vis)) ?? undefined;
        if (!view) continue;
      }
      const [sx, sy] = cam.toScreen(box.x, box.y);
      view.setTransform(sx, sy, cam.scale, this.dpr);
    }
    for (const [id, view] of this.views) {
      if (!keep.has(id)) {
        view.destroy();
        this.views.delete(id);
      }
    }
    this.doc.pinned = keep;
  }

  private createView(box: PageBox, visible: boolean): PageView | null {
    const page = this.doc.pages.get(box.id);
    if (!page) return null;
    const view = new PageView(page, this.world);
    this.views.set(box.id, view);
    const target = this.camera.scale * this.dpr;
    const items = this.doc.getItems(box.id);
    view.setLevel(chooseLevel(visible ? target : target * 0.5, page.paper.width, page.paper.height), items);
    if (!items) {
      void this.doc.ensureItems(box.id).then((list) => {
        if (this.views.get(box.id) === view) view.renderInk(list);
      });
    }
    return view;
  }

  private scheduleSettle() {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      if (this.gestures.active || this.inertia || this.anim) {
        this.scheduleSettle();
        return;
      }
      this.settle();
    }, SETTLE_MS);
  }

  /** Nach dem Zoomen/Scrollen: Auflösung anpassen und Detail-Ausschnitte scharf rendern. */
  private settle() {
    const cam = this.camera;
    const vis = cam.visibleWorld();
    const target = cam.scale * this.dpr;
    for (const [id, view] of this.views) {
      const box = this.boxes.get(id);
      if (!box) continue;
      const visible = intersects(box, vis);
      const items = this.doc.getItems(id);
      const desired = chooseLevel(visible ? target : target * 0.5, box.w, box.h);
      // Hochskalieren sofort, Herunterskalieren erst bei deutlich zu viel Auflösung (spart Arbeit).
      if (desired > view.level * 1.01 || desired < view.level * 0.55) view.setLevel(desired, items);
      if (visible && view.level < target * 0.95) {
        const inter = intersection(box, expand(vis, Math.min(vis.w, vis.h) * 0.1));
        if (inter) {
          const rect = { x: inter.x - box.x, y: inter.y - box.y, w: inter.w, h: inter.h };
          view.renderDetail(rect, target, items);
        }
      } else {
        view.hideDetail();
      }
    }
  }

  private onDocChange(c: DocChange) {
    if (c.structure || c.pages.size) {
      for (const id of c.pages) {
        const view = this.views.get(id);
        const page = this.doc.pages.get(id);
        if (view && page) {
          view.setPage(page);
          if (!view.level)
            view.setLevel(
              chooseLevel(this.camera.scale * this.dpr, page.paper.width, page.paper.height),
              this.doc.getItems(id),
            );
          else view.renderBackground();
          if (view.detailRect) view.renderDetail(view.detailRect, view.detailLevel, this.doc.getItems(id));
        }
      }
      this.relayout();
      this.scheduleSettle();
    }
    for (const [pageId, ch] of c.items) {
      const view = this.views.get(pageId);
      const items = this.doc.getItems(pageId);
      if (!view || !items) continue;
      const n = ch.added.length;
      const topIds = new Set(items.slice(items.length - n).map((it) => it.id));
      const onTop = !ch.removed.length && ch.added.every((it) => !isHighlighter(it) && topIds.has(it.id));
      if (onTop) view.drawOnTop(ch.added);
      else {
        let region: Rect | null = null;
        for (const it of [...ch.added, ...ch.removed]) region = union(region, it.bbox);
        if (region) view.redrawRegion(expand(region, 1), items);
      }
    }
    this.emit();
  }

  // ---------- Bewegung ----------

  private stopMotion() {
    this.inertia = null;
    this.anim = null;
  }

  private onGestureEnd(vx: number, vy: number) {
    const cam = this.camera;
    if (cam.dir === 'horizontal' && cam.zoom <= 1.05 && this.layout.boxes.length > 1) {
      let idx = this.currentPageIndex();
      const box = this.layout.boxes[idx]!;
      const center = cam.toScreen(box.x + box.w / 2, 0)[0];
      if (vx < -0.3 || (Math.abs(vx) <= 0.3 && center < cam.vw * 0.25)) idx++;
      else if (vx > 0.3 || (Math.abs(vx) <= 0.3 && center > cam.vw * 0.75)) idx--;
      const target = this.layout.boxes[Math.max(0, Math.min(idx, this.layout.boxes.length - 1))]!;
      this.animateTo(this.clampedTarget(cam.targetForPage(target, cam.scale)));
      return;
    }
    if (Math.hypot(vx, vy) > 0.05) {
      this.inertia = { vx, vy, last: performance.now() };
      this.requestFrame();
    }
  }

  private clampedTarget(t: CameraState): CameraState {
    const snap = this.camera.snapshot();
    this.camera.restore(t);
    this.camera.clamp();
    const out = this.camera.snapshot();
    this.camera.restore(snap);
    return out;
  }

  private animateTo(to: CameraState, ms = 280) {
    this.inertia = null;
    this.anim = { from: this.camera.snapshot(), to, start: performance.now(), ms };
    this.requestFrame();
  }

  private stepMotion(now: number) {
    const cam = this.camera;
    if (this.anim) {
      const a = this.anim;
      const t = Math.min(1, (now - a.start) / a.ms);
      const e = 1 - Math.pow(1 - t, 3);
      cam.scale = a.from.scale + (a.to.scale - a.from.scale) * e;
      cam.tx = a.from.tx + (a.to.tx - a.from.tx) * e;
      cam.ty = a.from.ty + (a.to.ty - a.from.ty) * e;
      if (t >= 1) this.anim = null;
      this.cameraDirty = true;
    } else if (this.inertia) {
      const m = this.inertia;
      const dt = Math.min(48, Math.max(0, now - m.last));
      m.last = now;
      const before = cam.snapshot();
      cam.panBy(m.vx * dt, m.vy * dt);
      cam.clamp();
      if (cam.tx === before.tx) m.vx = 0;
      if (cam.ty === before.ty) m.vy = 0;
      const decay = Math.exp(-dt / 325);
      m.vx *= decay;
      m.vy *= decay;
      if (Math.hypot(m.vx, m.vy) < 0.01) this.inertia = null;
      this.cameraDirty = true;
    }
  }

  // ---------- Eingabe ----------

  private sample(e: PointerEvent): Sample {
    const pe = e as PointerWithAngles;
    let azimuth: number | undefined;
    let altitude: number | undefined;
    if (e.pointerType === 'pen') {
      if (typeof pe.altitudeAngle === 'number' && typeof pe.azimuthAngle === 'number') {
        altitude = pe.altitudeAngle;
        azimuth = pe.azimuthAngle;
      } else {
        ({ azimuth, altitude } = tiltToAngles(e.tiltX || 0, e.tiltY || 0));
      }
    }
    return {
      sx: e.clientX - this.rootRect.left,
      sy: e.clientY - this.rootRect.top,
      pressure: e.pressure,
      t: e.timeStamp,
      azimuth,
      altitude,
      pointerType: e.pointerType,
    };
  }

  private hitPage(sx: number, sy: number): PageBox | null {
    const [wx, wy] = this.camera.toWorld(sx, sy);
    for (const b of this.layout.boxes) {
      if (wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) return b;
    }
    return null;
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      this.touchDown(e);
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.startDrawing(e);
  };

  private startDrawing(e: PointerEvent): boolean {
    if (this.activePointer !== null) return false;
    if (e.pointerType === 'pen') {
      this.penDown = true;
      this.lastPenTime = e.timeStamp;
      if (this.gestures.active) {
        // Handballen hat zuerst aufgesetzt: Geste abbrechen und Scrollen zurücknehmen.
        const snap = this.gestureCamStart;
        const age = e.timeStamp - this.gestures.startedAt;
        this.gestures.cancel();
        if (snap && age < PALM_UNDO_SCROLL_MS) {
          this.camera.restore(snap);
          this.invalidateCamera();
        }
      }
      this.stopMotion();
    }
    const s = this.sample(e);
    const box = this.hitPage(s.sx, s.sy);
    if (!box) return false;
    this.activePointer = e.pointerId;
    this.activeType = e.pointerType;
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      /* synthetische Events haben keinen echten Pointer */
    }
    if (e.pointerType === 'pen' && e.pressure > 0) this.pressure.add(e.pressure);
    this.tools[this.toolId].begin(s, box.id);
    this.requestFrame();
    return true;
  }

  private touchDown(e: PointerEvent) {
    const id = e.pointerId;
    const t = e.timeStamp;
    if (this.penDown || t - this.lastPenTime < PALM_AFTER_PEN_MS) {
      this.ignored.add(id);
      return;
    }
    const s = this.sample(e);
    if (this.settings.fingerDrawing) {
      if (this.activePointer === null && !this.gestures.count) {
        if (this.startDrawing(e)) this.finger = { id, t, sx: s.sx, sy: s.sy };
        else this.beginGesture(id, s.sx, s.sy, t);
        return;
      }
      if (this.finger && this.activePointer === this.finger.id && t - this.finger.t < 200) {
        // Zweiter Finger kurz nach dem ersten: Das war eine Geste, kein Strich.
        const first = this.finger;
        this.tools[this.toolId].cancel();
        this.activePointer = null;
        this.finger = null;
        this.beginGesture(first.id, first.sx, first.sy, t);
        this.beginGesture(id, s.sx, s.sy, t);
        return;
      }
    }
    if (this.activePointer !== null) {
      this.ignored.add(id);
      return;
    }
    this.beginGesture(id, s.sx, s.sy, t);
  }

  private beginGesture(id: number, sx: number, sy: number, t: number) {
    if (!this.gestures.count) this.gestureCamStart = this.camera.snapshot();
    this.stopMotion();
    this.gestures.down(id, sx, sy, t);
  }

  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerId === this.activePointer) {
      const events = e.getCoalescedEvents?.() ?? [];
      const list = events.length ? events : [e];
      const samples = list.map((ev) => this.sample(ev));
      const predicted = (e.getPredictedEvents?.() ?? []).map((ev) => this.sample(ev));
      if (e.pointerType === 'pen') for (const ev of list) if (ev.pressure > 0) this.pressure.add(ev.pressure);
      if (this.finger) {
        const last = samples[samples.length - 1]!;
        this.finger.sx = last.sx;
        this.finger.sy = last.sy;
      }
      this.tools[this.toolId].move(samples, predicted);
      this.debug.events++;
      this.debug.samples += samples.length;
      this.requestFrame();
      return;
    }
    if (e.pointerType === 'touch' && this.gestures.has(e.pointerId)) {
      const s = this.sample(e);
      this.gestures.move(e.pointerId, s.sx, s.sy, e.timeStamp);
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.pointerId === this.activePointer) {
      const tool = this.tools[this.toolId];
      if (e.type === 'pointerup') tool.move([], []);
      tool.end();
      this.activePointer = null;
      this.finger = null;
      if (this.activeType === 'pen') {
        this.penDown = false;
        this.lastPenTime = e.timeStamp;
      }
      this.emit();
      this.requestFrame();
      return;
    }
    this.ignored.delete(e.pointerId);
    if (this.gestures.has(e.pointerId)) this.gestures.up(e.pointerId, e.timeStamp);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.stopMotion();
    const sx = e.clientX - this.rootRect.left;
    const sy = e.clientY - this.rootRect.top;
    if (e.ctrlKey || e.metaKey) this.camera.zoomAt(Math.exp(-e.deltaY * 0.01), sx, sy);
    else this.camera.panBy(-e.deltaX, -e.deltaY);
    this.camera.clamp();
    this.invalidateCamera();
  };

  private cancelActiveTool() {
    if (this.activePointer === null) return;
    this.tools[this.toolId].cancel();
    this.activePointer = null;
    this.finger = null;
  }

  // ---------- Debug ----------

  private setDebug(on: boolean) {
    if (on && !this.debugEl) {
      this.debugEl = document.createElement('div');
      this.debugEl.className = 'feder-debug';
      this.root.appendChild(this.debugEl);
      this.debug.since = performance.now();
    } else if (!on && this.debugEl) {
      this.debugEl.remove();
      this.debugEl = null;
    }
  }

  private debugFrame(now: number) {
    if (!this.debugEl) return;
    this.debug.frames++;
    const dt = now - this.debug.since;
    if (dt < 500) {
      this.requestFrame();
      return;
    }
    const d = this.debug;
    const fps = (d.frames * 1000) / dt;
    const spe = d.events ? d.samples / d.events : 0;
    this.debugEl.textContent =
      `${fps.toFixed(0)} fps · ${spe.toFixed(1)} Samples/Event · Druck: ${this.pressure.support}` +
      ` · Modus: ${this.pressureMode('pen')} · Zoom ${(this.camera.zoom * 100).toFixed(0)} % · ` +
      `Seiten: ${this.views.size} · Speichern: ${this.doc.autosave.getStatus()}`;
    this.debug = { frames: 0, events: 0, samples: 0, since: now };
    this.requestFrame();
  }
}
