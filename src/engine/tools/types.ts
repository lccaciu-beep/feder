import type { AppSettings } from '../../model/settings';
import type { Id, Item, PressureMode, Rect } from '../../model/types';
import type { NotebookDoc } from '../doc/NotebookDoc';
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
