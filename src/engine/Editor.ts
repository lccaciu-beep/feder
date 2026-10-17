// Fassade der Zeichen-Engine. Verbindet Eingabe (Pointer Events, Gesten,
// Palm Rejection), Kamera, Seiten-Darstellung und Werkzeuge. Die UI spricht
// nur über diese Klasse mit der Engine.

import type { AppSettings } from '../model/settings';
import { newId } from '../model/ids';
import type {
  ElementDef,
  Id,
  ImageItem,
  Item,
  LinkTarget,
  PressureMode,
  Rect,
  TextItem,
  TextStyle,
} from '../model/types';
import { getBlobStore } from '../storage/blobstore';
import { prepareImage } from '../io/images';
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
import { LassoTool, selectionBounds } from './tools/LassoTool';
import { LaserTool } from './tools/LaserTool';
import { TapeTool, toggleTapeAt } from './tools/TapeTool';
import { TextTool, tapText } from './tools/TextTool';
import { fitText } from './tools/factory';
import type { SelectionHandle, SelectionState, Sample, Tool, ToolHost } from './tools/types';
import {
  itemBBox,
  itemHitPoint,
  itemInPolygon,
  transformItem,
  translate,
  type Sim,
} from './geometry/transform';
import { drawItems, onImageLoaded, setPlaybackCutoff } from './render/items';
import { ZoomWindow } from './ZoomWindow';
import { Camera, layoutPages, type CameraState, type Insets, type Layout, type PageBox } from './view/camera';

export type ToolId = 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'shape' | 'text' | 'tape' | 'laser';

export interface SelectionInfo {
  pageId: Id;
  count: number;
  /** Bildschirm-Rechteck der Auswahl (CSS-px, relativ zum Editor) */
  screen: Rect;
  /** Das einzige ausgewählte Element, falls genau eins */
  single: Item | null;
}

export interface TextEditInfo {
  item: TextItem;
  isNew: boolean;
  /** Bildschirm-Rechteck des (ungedrehten) Textfelds */
  screen: Rect;
  /** CSS-px pro pt */
  scale: number;
}

export type EditorEvent =
  | { type: 'selection'; info: SelectionInfo | null }
  | { type: 'textEdit'; info: TextEditInfo | null }
  | { type: 'lassoOffer'; info: { x: number; y: number } | null }
  | { type: 'zoomWindow'; info: { height: number } | null }
  | { type: 'link'; target: LinkTarget }
  | { type: 'seek'; t: number };

export interface EditorState {
  tool: ToolId;
  canUndo: boolean;
  canRedo: boolean;
  pageIndex: number;
  pageCount: number;
  zoom: number;
  saveStatus: SaveStatus;
  pressureSupport: PressureSupport;
  readMode: boolean;
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
  private readonly overlay: LiveLayer;
  settings: AppSettings;
  private sel: SelectionState | null = null;
  private textEdit: { item: TextItem; isNew: boolean } | null = null;
  private lassoOffer: {
    pageId: Id;
    polygon: number[];
    strokeId: Id;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private overlayDirty = false;
  private highlights = new Map<Id, Rect[]>();
  private zoom: ZoomWindow | null = null;
  private readMode = false;
  private playback: number | null = null;
  private playbackSignature = -1;
  private readonly whiteboard: boolean;
  private uiInsets: Insets;
  private eventListeners = new Set<(e: EditorEvent) => void>();
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
    this.uiInsets = this.insets;
    this.whiteboard = doc.notebook.kind === 'whiteboard';
    this.camera.whiteboard = this.whiteboard;
    root.classList.add('feder-editor');
    root.setAttribute('role', 'application');
    root.setAttribute('aria-label', 'Zeichenfläche');
    root.setAttribute('aria-roledescription', 'Notizbuchseite');
    this.world = document.createElement('div');
    this.world.className = 'feder-world';
    root.appendChild(this.world);
    this.live = new LiveLayer(root);
    this.overlay = new LiveLayer(root);
    this.overlay.canvas.classList.add('feder-overlay');
    this.tools = {
      pen: new InkTool(this, 'pen'),
      highlighter: new InkTool(this, 'highlighter'),
      eraser: new EraserTool(this),
      lasso: new LassoTool(this),
      shape: new InkTool(this, 'shape'),
      text: new TextTool(this),
      tape: new TapeTool(this),
      laser: new LaserTool(this),
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
      onTap: (n, x, y) => {
        if (n === 1) this.onFingerTap(x, y);
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
    this.disposers.push(onImageLoaded((blobId) => this.onImageLoaded(blobId)));
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
    this.finishTextEdit();
    if (id !== 'lasso') this.clearSelection();
    this.toolId = id;
    this.emit();
  }

  onEvent(cb: (e: EditorEvent) => void): () => void {
    this.eventListeners.add(cb);
    return () => this.eventListeners.delete(cb);
  }

  private fire(e: EditorEvent) {
    for (const cb of this.eventListeners) cb(e);
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
    this.uiInsets = insets;
    this.insets = { ...insets, bottom: insets.bottom + this.zoomHeight() };
    this.onResize(prevTop);
  }

  // ---------- Audio-Wiedergabe ----------

  /** Wiedergabezeit setzen (ms seit Epoch); null beendet die Wiedergabe-Ansicht. */
  setPlaybackTime(t: number | null) {
    if (t !== null && this.playback === null) {
      this.cancelActiveTool();
      this.finishTextEdit();
      this.clearSelection();
    }
    this.playback = t;
    setPlaybackCutoff(t);
    // Nur neu zeichnen, wenn sich die Zahl der „schon geschriebenen“ Elemente ändert.
    let sig = t === null ? -1 : 0;
    if (t !== null) {
      for (const id of this.views.keys()) {
        for (const it of this.doc.getItems(id) ?? [])
          if ((it.type === 'stroke' ? it.t0 : it.createdAt) <= t) sig++;
      }
    }
    if (sig === this.playbackSignature) return;
    this.playbackSignature = sig;
    for (const [id, view] of this.views) view.renderInk(this.doc.getItems(id));
  }

  // ---------- Lesemodus ----------

  get readOnly(): boolean {
    return this.readMode;
  }

  setReadMode(on: boolean) {
    if (on === this.readMode) return;
    this.cancelActiveTool();
    this.finishTextEdit();
    this.clearSelection();
    this.closeZoomWindow();
    this.readMode = on;
    this.emit();
  }

  // ---------- Whiteboard ----------

  /** Wächst die Fläche, wenn nahe am rechten oder unteren Rand gezeichnet wird. */
  private growWhiteboard(pageId: Id, added: readonly Item[]) {
    const page = this.doc.pages.get(pageId);
    if (!page || !added.length) return;
    const EDGE = 600;
    const STEP = 2000;
    let w = page.paper.width;
    let h = page.paper.height;
    for (const it of added) {
      if (it.bbox.x + it.bbox.w > w - EDGE) w = Math.max(w, it.bbox.x + it.bbox.w + STEP);
      if (it.bbox.y + it.bbox.h > h - EDGE) h = Math.max(h, it.bbox.y + it.bbox.h + STEP);
    }
    if (w === page.paper.width && h === page.paper.height) return;
    const after = { ...page, paper: { ...page.paper, width: w, height: h } };
    // Wachsen ist kein eigener Undo-Schritt
    queueMicrotask(() =>
      this.doc.execute(
        { label: 'Fläche erweitern', items: [], pages: [{ before: page, after }] },
        { history: false },
      ),
    );
  }

  // ---------- Zoom-Fenster ----------

  get toolName(): string {
    return this.toolId;
  }

  get zoomWindowOpen(): boolean {
    return !!this.zoom;
  }

  private zoomHeight(): number {
    return this.zoom ? Math.round(Math.min(260, this.camera.vh * 0.32)) : 0;
  }

  openZoomWindow() {
    if (this.zoom) return;
    const pageId = this.doc.pageIds[this.currentPageIndex()];
    const box = pageId ? this.boxes.get(pageId) : undefined;
    if (!pageId || !box) return;
    this.zoom = new ZoomWindow(this, this.root);
    this.setInsets(this.uiInsets);
    const vis = intersection(box, this.camera.visibleWorld()) ?? box;
    const w = box.w * 0.45;
    this.zoom.setRect(pageId, { x: box.w * 0.06, y: vis.y - box.y + vis.h * 0.3, w, h: w / 4 });
    this.fire({ type: 'zoomWindow', info: { height: this.zoomHeight() } });
  }

  closeZoomWindow() {
    if (!this.zoom) return;
    this.zoom.destroy();
    this.zoom = null;
    this.setInsets(this.uiInsets);
    this.overlayDirty = true;
    this.requestFrame();
    this.fire({ type: 'zoomWindow', info: null });
  }

  zoomWindowAdvance() {
    this.zoom?.advance();
  }

  zoomWindowNewLine() {
    this.zoom?.newLine();
  }

  onZoomRectChanged() {
    this.overlayDirty = true;
    this.requestFrame();
  }

  undo() {
    this.cancelActiveTool();
    this.finishTextEdit();
    this.doc.undo();
    this.emit();
  }

  redo() {
    this.cancelActiveTool();
    this.finishTextEdit();
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
    this.overlay.destroy();
    this.zoom?.destroy();
    if (this.lassoOffer) clearTimeout(this.lassoOffer.timer);
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
      readMode: this.readMode,
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
      l.pressureSupport === s.pressureSupport &&
      l.readMode === s.readMode
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
    this.overlay.resize(r.width, r.height, this.dpr);
    this.overlayDirty = true;
    if (this.zoom) {
      const zh = this.zoomHeight();
      this.zoom.el.style.height = `${zh}px`;
      this.zoom.resize(r.width, zh, this.dpr);
    }
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
      this.overlayDirty = true;
      this.emitPositions();
    }
    if (this.overlayDirty) {
      this.overlayDirty = false;
      this.drawOverlay();
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
    if (this.sel) {
      const items = this.doc.getItems(this.sel.pageId) ?? [];
      const alive = new Set(items.map((it) => it.id));
      for (const id of [...this.sel.ids]) if (!alive.has(id)) this.sel.ids.delete(id);
      if (!this.sel.ids.size || !this.doc.pages.has(this.sel.pageId)) this.clearSelection();
      else this.selectionChanged();
    }
    if (this.whiteboard) for (const [pageId, ch] of c.items) this.growWhiteboard(pageId, ch.added);
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
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.anim = null;
      this.camera.restore(to);
      this.invalidateCamera();
      return;
    }
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
    if (this.readMode || this.playback !== null) {
      // Lesemodus: jede Eingabe blättert/zoomt, Tippen öffnet Links und Tapes
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const s = this.sample(e);
      this.beginGesture(e.pointerId, s.sx, s.sy, e.timeStamp);
      return;
    }
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
    if (!box && this.toolId !== 'laser') {
      if (this.toolId === 'lasso') this.clearSelection();
      return false;
    }
    this.dismissLassoOffer();
    if (this.textEdit) this.finishTextEdit();
    this.activePointer = e.pointerId;
    this.activeType = e.pointerType;
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      /* synthetische Events haben keinen echten Pointer */
    }
    if (e.pointerType === 'pen' && e.pressure > 0) this.pressure.add(e.pressure);
    this.tools[this.toolId].begin(s, box?.id ?? '');
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
    // Auswahl mit dem Finger verschieben, skalieren oder drehen
    if (this.toolId === 'lasso' && !this.gestures.count && this.selectionHandleAt(s.sx, s.sy)) {
      if (this.startDrawing(e)) {
        this.finger = { id, t, sx: s.sx, sy: s.sy };
        return;
      }
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
    if (
      (e.pointerType === 'touch' || this.readMode || this.playback !== null) &&
      this.gestures.has(e.pointerId)
    ) {
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

  // ---------- Finger-Tipp ----------

  private onFingerTap(sx: number, sy: number) {
    const box = this.hitPage(sx, sy);
    if (!box) return;
    const [wx, wy] = this.camera.toWorld(sx, sy);
    if (this.zoom) {
      const r = this.zoom.rect;
      this.zoom.setRect(box.id, { ...r, x: wx - box.x - r.w * 0.1, y: wy - box.y - r.h / 2 });
      return;
    }
    if (this.playback !== null) {
      // Wiedergabe: Antippen eines Strichs springt zur passenden Stelle der Aufnahme
      const items = this.doc.getItems(box.id) ?? [];
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i]!;
        if (it.type !== 'link' && itemHitPoint(it, wx - box.x, wy - box.y, 6)) {
          this.fire({ type: 'seek', t: it.type === 'stroke' ? it.t0 : it.createdAt });
          return;
        }
      }
    }
    if (toggleTapeAt(this, box.id, wx - box.x, wy - box.y)) return;
    if (this.followLinkAt(box.id, wx - box.x, wy - box.y)) return;
    if (this.toolId === 'text') {
      tapText(this, box.id, box, { sx, sy, pressure: 0.5, t: performance.now(), pointerType: 'touch' });
      return;
    }
    if (this.toolId === 'lasso' && this.sel && !this.selectionHandleAt(sx, sy)) this.clearSelection();
  }

  /** Verknüpfung an (x, y) öffnen. Seiten-Links springen direkt, alles andere übernimmt die UI. */
  followLinkAt(pageId: Id, x: number, y: number): boolean {
    const items = this.doc.getItems(pageId) ?? [];
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]!;
      if (it.type !== 'link') continue;
      const b = it.bbox;
      if (x < b.x - 2 || x > b.x + b.w + 2 || y < b.y - 2 || y > b.y + b.h + 2) continue;
      if (it.target.kind === 'page') {
        const idx = this.doc.indexOf(it.target.pageId);
        if (idx >= 0) this.goToPage(idx);
      } else this.fire({ type: 'link', target: it.target });
      return true;
    }
    return false;
  }

  // ---------- Auswahl ----------

  get selection(): SelectionState | null {
    return this.sel;
  }

  setSelection(pageId: Id, ids: Iterable<Id>) {
    const set = new Set(ids);
    this.sel = set.size ? { pageId, ids: set, preview: null } : null;
    this.selectionChanged();
  }

  clearSelection() {
    if (!this.sel) return;
    this.sel = null;
    this.selectionChanged();
  }

  setSelectionPreview(t: Sim | null) {
    if (!this.sel) return;
    this.sel.preview = t;
    this.overlayDirty = true;
    this.requestFrame();
  }

  /** Alle Elemente der aktuellen Seite auswählen. */
  selectAll() {
    const pageId = this.doc.pageIds[this.currentPageIndex()];
    if (!pageId) return;
    const items = (this.doc.getItems(pageId) ?? []).filter((it) => !(it.type === 'link' && it.fromPdf));
    if (!items.length) return;
    if (this.toolId !== 'lasso') this.setTool('lasso');
    this.setSelection(
      pageId,
      items.map((it) => it.id),
    );
  }

  selectedItems(): Item[] {
    const sel = this.sel;
    if (!sel) return [];
    return (this.doc.getItems(sel.pageId) ?? []).filter((it) => sel.ids.has(it.id));
  }

  private selectionChanged() {
    this.overlayDirty = true;
    this.requestFrame();
    this.fire({ type: 'selection', info: this.selectionInfo() });
  }

  private pageRectToScreen(pageId: Id, r: Rect): Rect | null {
    const box = this.boxes.get(pageId);
    if (!box) return null;
    const [x, y] = this.camera.toScreen(box.x + r.x, box.y + r.y);
    return { x, y, w: r.w * this.camera.scale, h: r.h * this.camera.scale };
  }

  selectionInfo(): SelectionInfo | null {
    const sel = this.sel;
    if (!sel) return null;
    const items = this.selectedItems();
    const b = selectionBounds(items, sel.preview);
    const screen = b && this.pageRectToScreen(sel.pageId, b);
    if (!screen) return null;
    return { pageId: sel.pageId, count: items.length, screen, single: items.length === 1 ? items[0]! : null };
  }

  private handles(): {
    rect: Rect;
    rotate: [number, number];
    scale: [number, number];
    vertices: [number, number][];
  } | null {
    const info = this.selectionInfo();
    if (!info) return null;
    const r = info.screen;
    const vertices: [number, number][] = [];
    const single = info.single;
    if (single?.type === 'shape' && single.shape !== 'ellipse' && !this.sel?.preview) {
      const box = this.boxes.get(info.pageId)!;
      for (let i = 0; i + 1 < single.vertices.length; i += 2) {
        vertices.push(this.camera.toScreen(box.x + single.vertices[i]!, box.y + single.vertices[i + 1]!));
      }
    }
    return { rect: r, rotate: [r.x + r.w / 2, r.y - 30], scale: [r.x + r.w + 4, r.y + r.h + 4], vertices };
  }

  selectionHandleAt(sx: number, sy: number): SelectionHandle | null {
    const h = this.handles();
    if (!h) return null;
    const near = (p: [number, number]) => Math.hypot(sx - p[0], sy - p[1]) < 22;
    for (let i = 0; i < h.vertices.length; i++) if (near(h.vertices[i]!)) return { kind: 'vertex', index: i };
    if (near(h.scale)) return { kind: 'scale' };
    if (near(h.rotate)) return { kind: 'rotate' };
    const r = h.rect;
    if (sx >= r.x - 8 && sx <= r.x + r.w + 8 && sy >= r.y - 8 && sy <= r.y + r.h + 8)
      return { kind: 'inside' };
    return null;
  }

  /** Suchtreffer markieren (Seitenkoordinaten). Leere Map entfernt alle Markierungen. */
  setHighlights(map: Map<Id, Rect[]>) {
    this.highlights = map;
    this.overlayDirty = true;
    this.requestFrame();
  }

  private drawOverlay() {
    this.overlay.clear();
    for (const [pageId, rects] of this.highlights) {
      for (const r of rects) {
        const s = this.pageRectToScreen(pageId, r);
        if (!s || s.x > this.camera.vw || s.y > this.camera.vh || s.x + s.w < 0 || s.y + s.h < 0) continue;
        const ctx = this.overlay.screen({ x: s.x - 3, y: s.y - 3, w: s.w + 6, h: s.h + 6 });
        ctx.fillStyle = 'rgba(255, 200, 0, 0.35)';
        ctx.fillRect(s.x - 2, s.y - 2, s.w + 4, s.h + 4);
        ctx.strokeStyle = 'rgba(220, 150, 0, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(s.x - 2, s.y - 2, s.w + 4, s.h + 4);
      }
    }
    if (this.zoom) {
      const r = this.pageRectToScreen(this.zoom.pageId, this.zoom.rect);
      if (r) {
        const z = this.overlay.screen({ x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 });
        z.fillStyle = 'rgba(39,71,201,0.07)';
        z.fillRect(r.x, r.y, r.w, r.h);
        z.strokeStyle = '#2747c9';
        z.lineWidth = 2;
        z.strokeRect(r.x, r.y, r.w, r.h);
      }
    }
    const h = this.handles();
    if (!h) return;
    const r = h.rect;
    const ctx = this.overlay.screen({ x: r.x - 40, y: r.y - 60, w: r.w + 80, h: r.h + 100 });
    ctx.save();
    ctx.strokeStyle = '#2747c9';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(r.x + r.w / 2, r.y - 4);
    ctx.lineTo(h.rotate[0], h.rotate[1] + 8);
    ctx.stroke();
    const dot = (p: [number, number], fill: string, rad = 8) => {
      ctx.beginPath();
      ctx.arc(p[0], p[1], rad, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#2747c9';
      ctx.stroke();
    };
    dot(h.rotate, '#ffffff');
    dot(h.scale, '#2747c9');
    for (const v of h.vertices) dot(v, '#ffffff', 6);
    ctx.restore();
  }

  /** Position von Auswahl/Textfeld nach Kamerabewegung an die UI melden. */
  private emitPositions() {
    if (this.sel) this.fire({ type: 'selection', info: this.selectionInfo() });
    if (this.textEdit) this.fire({ type: 'textEdit', info: this.textEditInfo() });
  }

  deleteSelection() {
    const items = this.selectedItems();
    if (!items.length) return;
    this.clearSelection();
    this.doc.execute({
      label: 'Löschen',
      items: items.map((before) => ({ before, after: null })),
      pages: [],
    });
  }

  /** Kopiert die Auswahl in die interne Zwischenablage. */
  copySelection(): boolean {
    const items = this.selectedItems();
    if (!items.length) return false;
    const b = selectionBounds(items)!;
    clipboard = items.map((it) => transformItem(it, translate(-b.x, -b.y)));
    return true;
  }

  cutSelection() {
    if (this.copySelection()) this.deleteSelection();
  }

  get canPaste(): boolean {
    return !!clipboard?.length;
  }

  paste() {
    if (clipboard?.length) this.insertItems(clipboard);
  }

  duplicateSelection() {
    const items = this.selectedItems();
    if (!items.length || !this.sel) return;
    this.placeItems(
      this.sel.pageId,
      items.map((it) => transformItem(it, translate(16, 16))),
    );
  }

  recolorSelection(color: string) {
    const items = this.selectedItems();
    if (!items.length) return;
    const recolor = (it: Item): Item => {
      switch (it.type) {
        case 'stroke':
          return { ...it, color };
        case 'shape':
          return { ...it, stroke: color, fill: it.fill ? color : null };
        case 'text':
          return { ...it, style: { ...it.style, color } };
        case 'tape':
          return { ...it, color };
        default:
          return it;
      }
    };
    this.doc.execute({
      label: 'Farbe ändern',
      items: items.map((before) => ({ before, after: recolor(before) })),
      pages: [],
    });
  }

  /** Ersetzt Elemente (z. B. nach Zuschneiden oder Drehen eines Bildes). */
  updateItems(pairs: { before: Item; after: Item }[], label = 'Bearbeiten') {
    this.doc.execute({
      label,
      items: pairs.map((p) => ({ before: p.before, after: { ...p.after, bbox: itemBBox(p.after) } as Item })),
      pages: [],
    });
  }

  /** Rendert die Auswahl als transparentes PNG. */
  selectionImage(scale = 3): Promise<Blob | null> {
    return renderItemsPng(this.selectedItems(), scale);
  }

  /** Inhalte (relativ zu 0,0) auf der aktuellen Seite mittig einfügen und auswählen. */
  insertItems(items: readonly Item[]) {
    const pageId = this.doc.pageIds[this.currentPageIndex()];
    const box = pageId ? this.boxes.get(pageId) : undefined;
    if (!pageId || !box || !items.length) return;
    const b = selectionBounds(items)!;
    const vis = intersection(box, this.camera.visibleWorld()) ?? box;
    const cx = vis.x + vis.w / 2 - box.x;
    const cy = vis.y + vis.h / 2 - box.y;
    const t = translate(cx - (b.x + b.w / 2), cy - (b.y + b.h / 2));
    this.placeItems(
      pageId,
      items.map((it) => transformItem(it, t)),
    );
  }

  private placeItems(pageId: Id, items: Item[]) {
    let z = this.doc.topZ(pageId);
    const created = items.map(
      (it) => ({ ...it, id: newId(), pageId, notebookId: this.doc.id, z: ++z }) as Item,
    );
    this.doc.execute({
      label: 'Einfügen',
      items: created.map((after) => ({ before: null, after })),
      pages: [],
    });
    if (this.toolId !== 'lasso') {
      this.tools[this.toolId].cancel();
      this.toolId = 'lasso';
      this.emit();
    }
    this.setSelection(
      pageId,
      created.map((it) => it.id),
    );
  }

  /** Verknüpfung über der aktuellen Auswahl anlegen. */
  addLink(target: LinkTarget, label: string) {
    const sel = this.sel;
    const b = selectionBounds(this.selectedItems());
    if (!sel || !b) return;
    const link: Item = {
      id: newId(),
      type: 'link',
      pageId: sel.pageId,
      notebookId: this.doc.id,
      z: this.doc.topZ(sel.pageId) + 1,
      bbox: { ...b },
      createdAt: Date.now(),
      target,
      label,
    };
    this.clearSelection();
    this.doc.execute({ label: 'Link', items: [{ before: null, after: link }], pages: [] });
  }

  insertElement(def: ElementDef) {
    this.insertItems(def.items);
  }

  /** Bild einfügen: große Fotos werden auf 2400 px verkleinert. */
  async insertImage(file: Blob) {
    const pageId = this.doc.pageIds[this.currentPageIndex()];
    const box = pageId ? this.boxes.get(pageId) : undefined;
    if (!pageId || !box) return;
    const { blob, width, height } = await prepareImage(file);
    const meta = await (await getBlobStore()).put(blob);
    const k = Math.min(1, (box.w * 0.6) / width, (box.h * 0.5) / height);
    const w = width * k;
    const h = height * k;
    const img: ImageItem = {
      id: newId(),
      type: 'image',
      pageId,
      notebookId: this.doc.id,
      z: 0,
      createdAt: Date.now(),
      box: { x: 0, y: 0, w, h },
      bbox: { x: 0, y: 0, w, h },
      rotation: 0,
      blobId: meta.id,
      crop: { x: 0, y: 0, w: width, h: height },
      natW: width,
      natH: height,
    };
    this.insertItems([img]);
  }

  /** Elemente in einem Polygon (Seitenkoordinaten) auswählen. */
  selectInPolygon(pageId: Id, polygon: number[]) {
    const items = (this.doc.getItems(pageId) ?? []).filter(
      (it) => !(it.type === 'link' && it.fromPdf) && itemInPolygon(it, polygon),
    );
    if (items.length)
      this.setSelection(
        pageId,
        items.map((it) => it.id),
      );
  }

  // ---------- Kreis-Auswahl ----------

  offerLasso(pageId: Id, polygon: number[], strokeId: Id) {
    this.dismissLassoOffer();
    const box = this.boxes.get(pageId);
    if (!box) return;
    let maxX = -Infinity;
    let minY = Infinity;
    for (let i = 0; i < polygon.length; i += 2) {
      maxX = Math.max(maxX, polygon[i]!);
      minY = Math.min(minY, polygon[i + 1]!);
    }
    const [x, y] = this.camera.toScreen(box.x + maxX, box.y + minY);
    const timer = setTimeout(() => this.dismissLassoOffer(), 3500);
    this.lassoOffer = { pageId, polygon, strokeId, timer };
    this.fire({ type: 'lassoOffer', info: { x, y } });
  }

  dismissLassoOffer() {
    if (!this.lassoOffer) return;
    clearTimeout(this.lassoOffer.timer);
    this.lassoOffer = null;
    this.fire({ type: 'lassoOffer', info: null });
  }

  /** Den gerade gezeichneten Kreis entfernen und den Inhalt darin auswählen. */
  acceptLassoOffer() {
    const o = this.lassoOffer;
    if (!o) return;
    this.dismissLassoOffer();
    const stroke = this.doc.getItems(o.pageId)?.find((it) => it.id === o.strokeId);
    if (stroke)
      this.doc.execute({ label: 'Kreis entfernen', items: [{ before: stroke, after: null }], pages: [] });
    this.setTool('lasso');
    this.selectInPolygon(o.pageId, o.polygon);
  }

  // ---------- Text ----------

  startTextEdit(item: TextItem, isNew: boolean) {
    this.finishTextEdit();
    this.clearSelection();
    this.textEdit = { item, isNew };
    if (!isNew) this.preview(item.pageId, new Set([item.id]), [], item.bbox);
    this.fire({ type: 'textEdit', info: this.textEditInfo() });
  }

  private textEditInfo(): TextEditInfo | null {
    const te = this.textEdit;
    if (!te) return null;
    const screen = this.pageRectToScreen(te.item.pageId, te.item.box);
    if (!screen) return null;
    return { item: te.item, isNew: te.isNew, screen, scale: this.camera.scale };
  }

  get editingText(): boolean {
    return !!this.textEdit;
  }

  /** Stil des gerade bearbeiteten Textfelds ändern. */
  updateTextStyle(style: Partial<TextStyle>) {
    if (!this.textEdit) return;
    this.textEdit.item = { ...this.textEdit.item, style: { ...this.textEdit.item.style, ...style } };
    this.fire({ type: 'textEdit', info: this.textEditInfo() });
  }

  /** Text während der Eingabe merken (ohne zu speichern). */
  setEditingText(text: string) {
    if (this.textEdit) this.textEdit.item = { ...this.textEdit.item, text };
  }

  /** Bearbeitung abschließen und speichern (leerer Text löscht das Feld). */
  finishTextEdit() {
    const te = this.textEdit;
    if (!te) return;
    this.textEdit = null;
    this.fire({ type: 'textEdit', info: null });
    const value = te.item.text;
    const after = fitText(te.item);
    if (te.isNew) {
      if (value.trim()) this.doc.execute({ label: 'Text', items: [{ before: null, after }], pages: [] });
      return;
    }
    const before = this.doc.getItems(te.item.pageId)?.find((it) => it.id === te.item.id) as
      TextItem | undefined;
    if (!before) return;
    if (!value.trim()) {
      this.doc.execute({ label: 'Text löschen', items: [{ before, after: null }], pages: [] });
    } else if (value !== before.text || JSON.stringify(te.item.style) !== JSON.stringify(before.style)) {
      this.doc.execute({ label: 'Text bearbeiten', items: [{ before, after }], pages: [] });
    } else {
      this.preview(before.pageId, new Set(), [], before.bbox);
    }
  }

  // ---------- Bilder ----------

  private onImageLoaded(blobId: Id) {
    for (const [pageId, view] of this.views) {
      const items = this.doc.getItems(pageId);
      if (items?.some((it) => it.type === 'image' && it.blobId === blobId)) view.renderInk(items);
    }
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

/** Interne Zwischenablage (relativ zu 0,0), gilt für alle Notizbücher. */
let clipboard: Item[] | null = null;

/** Rendert Elemente als transparentes PNG. */
export async function renderItemsPng(items: readonly Item[], scale = 3): Promise<Blob | null> {
  const b = selectionBounds(items);
  if (!b) return null;
  const pad = 4;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil((b.w + pad * 2) * scale));
  c.height = Math.max(1, Math.ceil((b.h + pad * 2) * scale));
  const ctx = c.getContext('2d')!;
  ctx.setTransform(scale, 0, 0, scale, (pad - b.x) * scale, (pad - b.y) * scale);
  drawItems(
    ctx,
    [...items].sort((x, y) => x.z - y.z),
  );
  const out = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  c.width = c.height = 0;
  return out;
}
