// Datenmodell von Feder (Schema v1). Längen in PDF-Punkten (1/72 Zoll),
// Ursprung oben links. Zeiten in ms seit Epoch.

export type Id = string;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------- Bibliothek ----------

export interface Folder {
  id: Id;
  parentId: Id | null;
  name: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface CoverSpec {
  color: string;
  pattern: 'plain' | 'linen' | 'stripe' | 'dots';
}

export type NotebookKind = 'paged' | 'whiteboard';

export interface Notebook {
  id: Id;
  folderId: Id | null;
  title: string;
  kind: NotebookKind;
  cover: CoverSpec;
  /** 0 oder 1 – als Zahl, damit IndexedDB danach indizieren kann. */
  favorite: 0 | 1;
  pageIds: Id[];
  defaultPaper: PaperSpec;
  createdAt: number;
  updatedAt: number;
  openedAt: number | null;
  deletedAt: number | null;
}

// ---------- Papier ----------

export type PaperColor = 'white' | 'yellow' | 'dark';

export type BuiltinTemplateId =
  'blank' | 'ruled' | 'grid' | 'dots' | 'cornell' | 'music' | 'planner-week' | 'planner-day';

export interface TemplateParams {
  /** Linien-/Rasterabstand in pt. */
  spacing?: number;
  /** Randlinie bei liniertem Papier. */
  margin?: boolean;
}

export type TemplateRef =
  | { kind: 'builtin'; id: BuiltinTemplateId; params: TemplateParams }
  | { kind: 'image'; blobId: Id }
  | { kind: 'pdf'; blobId: Id; pageIndex: number };

export interface PaperSpec {
  width: number;
  height: number;
  color: PaperColor;
  template: TemplateRef;
}

export interface Page {
  id: Id;
  notebookId: Id;
  paper: PaperSpec;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

// ---------- Inhalte ----------

export type PenKind = 'fountain' | 'ballpoint' | 'brush' | 'pencil';
export type InkTool = PenKind | 'highlighter';
export type DashStyle = 'solid' | 'dashed' | 'dotted';
export type PressureMode = 'real' | 'velocity' | 'none';

export interface ItemBase {
  id: Id;
  pageId: Id;
  notebookId: Id;
  /** Zeichenreihenfolge, aufsteigend. */
  z: number;
  bbox: Rect;
  createdAt: number;
}

/**
 * Punkte sind verschachtelt gespeichert: x, y, Druck (0..1), dt (ms seit t0)
 * und bei stride 6 zusätzlich Azimut und Höhenwinkel (rad).
 */
export interface StrokeItem extends ItemBase {
  type: 'stroke';
  tool: InkTool;
  color: string;
  /** Durchmesser in pt. */
  width: number;
  opacity: number;
  dash: DashStyle;
  pressureMode: PressureMode;
  stride: 4 | 6;
  points: Float32Array;
  t0: number;
}

export type ShapeKind = 'line' | 'arrow' | 'rect' | 'ellipse' | 'triangle' | 'polygon';

/**
 * Bedeutung von `vertices` je Form:
 * - line/arrow: [x0, y0, x1, y1] (Pfeilspitze am Ende)
 * - rect/triangle/polygon: Eckpunkte [x, y, x, y, …] (geschlossen, beliebig gedreht)
 * - ellipse: [cx, cy, rx, ry]; Drehung in `rotation` (rad)
 */
export interface ShapeItem extends ItemBase {
  type: 'shape';
  shape: ShapeKind;
  vertices: number[];
  rotation: number;
  stroke: string;
  fill: string | null;
  fillOpacity: number;
  width: number;
  dash: DashStyle;
  opacity: number;
}

export type FontFamily = 'sans' | 'serif' | 'mono' | 'hand';

export interface TextStyle {
  font: FontFamily;
  size: number;
  color: string;
  align: 'left' | 'center' | 'right';
  bold: boolean;
  italic: boolean;
}

/** Elemente mit Rahmen: `box` ist das ungedrehte Rechteck, gedreht wird um dessen Mitte. */
export interface BoxedItem extends ItemBase {
  box: Rect;
  rotation: number;
}

export interface TextItem extends BoxedItem {
  type: 'text';
  text: string;
  style: TextStyle;
}

export interface ImageItem extends BoxedItem {
  type: 'image';
  blobId: Id;
  /** Ausschnitt in Bildpixeln */
  crop: Rect;
  natW: number;
  natH: number;
}

export interface TapeItem extends ItemBase {
  type: 'tape';
  /** Mittellinie [x0, y0, x1, y1] */
  path: number[];
  width: number;
  color: string;
  covered: boolean;
}

export type LinkTarget =
  | { kind: 'url'; url: string }
  | { kind: 'page'; pageId: Id }
  | { kind: 'notebook'; notebookId: Id; pageId?: Id };

/** Verknüpfung als Bereich auf der Seite (bbox). */
export interface LinkItem extends ItemBase {
  type: 'link';
  target: LinkTarget;
  label: string;
}

export type Item = StrokeItem | ShapeItem | TextItem | ImageItem | TapeItem | LinkItem;

// ---------- Weiteres ----------

export interface BlobMeta {
  id: Id;
  mime: string;
  size: number;
  store: 'opfs' | 'idb';
  createdAt: number;
}

/** Rohdaten im IndexedDB-Fallback. Als ArrayBuffer gespeichert, weil Safari
 *  Blobs in IndexedDB lange unzuverlässig behandelt hat. */
export interface BlobData {
  id: Id;
  data: ArrayBuffer;
  type: string;
}

export interface Setting {
  key: string;
  value: unknown;
}

export interface Meta {
  key: string;
  value: unknown;
}

// ---------- Ab Schema v2 ----------

/** Gespeicherte Auswahl („Element“/Sticker); Inhalte relativ zu (0,0). */
export interface ElementDef {
  id: Id;
  name: string;
  items: Item[];
  width: number;
  height: number;
  /** kleine Vorschau als Data-URL */
  preview: string;
  createdAt: number;
}

export interface Bookmark {
  id: Id;
  notebookId: Id;
  pageId: Id;
  label: string;
  createdAt: number;
}

export interface OutlineEntry {
  id: Id;
  notebookId: Id;
  pageId: Id;
  title: string;
  level: number;
  order: number;
}

/** Durchsuchbarer Text pro Seite und Quelle. */
export interface TextIndexEntry {
  id: string; // `${pageId}:${source}`
  notebookId: Id;
  pageId: Id;
  source: 'pdf' | 'text';
  text: string;
  tokens: string[];
}

export interface CustomTemplate {
  id: Id;
  name: string;
  blobId: Id;
  kind: 'pdf' | 'image';
  pageIndex: number;
  width: number;
  height: number;
  createdAt: number;
}

export interface AudioClip {
  id: Id;
  notebookId: Id;
  blobId: Id;
  /** Startzeit (ms seit Epoch) – passt zu StrokeItem.t0 */
  startedAt: number;
  duration: number;
  mime: string;
}

export interface Deck {
  id: Id;
  name: string;
  notebookId: Id | null;
  createdAt: number;
}

/** Lernkarte: Vorderseite = Bild der Lasso-Auswahl, Rückseite optional Text/Bild. */
export interface Flashcard {
  id: Id;
  deckId: Id;
  front: string; // Data-URL
  back: string | null; // Data-URL
  backText: string;
  sourcePageId: Id | null;
  /** Leitner-Fach 1–5 */
  box: number;
  due: number;
  createdAt: number;
}
