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
  | { kind: 'custom'; templateId: Id }
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

export interface ShapeItem extends ItemBase {
  type: 'shape';
  shape: ShapeKind;
  vertices: number[];
  rotation: number;
  stroke: string;
  fill: string | null;
  width: number;
  dash: DashStyle;
}

export interface TextStyle {
  font: string;
  size: number;
  color: string;
  align: 'left' | 'center' | 'right';
  bold: boolean;
  italic: boolean;
}

export interface TextItem extends ItemBase {
  type: 'text';
  text: string;
  style: TextStyle;
  rotation: number;
}

export interface ImageItem extends ItemBase {
  type: 'image';
  blobId: Id;
  crop: Rect;
  rotation: number;
}

export interface TapeItem extends ItemBase {
  type: 'tape';
  path: number[];
  width: number;
  pattern: string;
  covered: boolean;
}

export type LinkTarget =
  | { kind: 'url'; url: string }
  | { kind: 'page'; pageId: Id }
  | { kind: 'notebook'; notebookId: Id; pageId?: Id };

export interface LinkItem extends ItemBase {
  type: 'link';
  target: LinkTarget;
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
