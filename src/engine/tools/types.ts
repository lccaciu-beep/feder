import type { AppSettings } from '../../model/settings';
import type { Id, Item, PressureMode, Rect, TextItem } from '../../model/types';
import type { NotebookDoc } from '../doc/NotebookDoc';
import type { Sim } from '../geometry/transform';
import type { LiveLayer } from '../render/LiveLayer';
import type { Camera, PageBox } from '../view/camera';

export interface Sample {
  /** Bildschirmkoordinaten relativ zum Editor (CSS-px) */
  sx: number;
  sy: number;
  pressure: number;
  /** Event-Zeitstempel (performance.now()-Basis) */
  t: number;
  azimuth?: number;
  altitude?: number;
  pointerType: string;
}

export interface SelectionState {
  pageId: Id;
  ids: Set<Id>;
  /** Vorschau einer laufenden Transformation (Verschieben/Skalieren/Drehen) */
  preview: Sim | null;
}

export type SelectionHandle =
  { kind: 'inside' } | { kind: 'scale' } | { kind: 'rotate' } | { kind: 'vertex'; index: number };

export interface ToolHost {
  readonly doc: NotebookDoc;
  readonly camera: Camera;
  readonly live: LiveLayer;
  readonly settings: AppSettings;
  /** Druckmodus für den aktuellen Strich (berücksichtigt die Druck-Erkennung). */
  pressureMode(pointerType: string): PressureMode;
  pageBox(pageId: Id): PageBox | undefined;
  /** Zeigt eine Seite vorübergehend mit ausgeblendeten/zusätzlichen Elementen. */
  preview(pageId: Id, hidden: ReadonlySet<Id>, extra: readonly Item[], region: Rect): void;

  // Auswahl (nur im Haupt-Editor vorhanden)
  readonly selection?: SelectionState | null;
  setSelection?(pageId: Id, ids: Iterable<Id>): void;
  clearSelection?(): void;
  selectionHandleAt?(sx: number, sy: number): SelectionHandle | null;
  setSelectionPreview?(t: Sim | null): void;
  /** Textbearbeitung beginnen (neues oder vorhandenes Textfeld). */
  startTextEdit?(item: TextItem, isNew: boolean): void;
  /** Kreis um Inhalte gezogen → Auswahl anbieten. */
  offerLasso?(pageId: Id, polygon: number[], strokeId: Id): void;
}

export interface Tool {
  readonly active: boolean;
  begin(s: Sample, pageId: Id): void;
  move(samples: Sample[], predicted: Sample[]): void;
  end(): void;
  cancel(): void;
  /** Wird pro Frame aufgerufen, solange das Werkzeug aktiv ist. */
  frame(now: number): void;
}

/** Bildschirm → Seitenkoordinaten. */
export function toPage(host: ToolHost, box: PageBox, s: Sample): [number, number] {
  const [wx, wy] = host.camera.toWorld(s.sx, s.sy);
  return [wx - box.x, wy - box.y];
}
