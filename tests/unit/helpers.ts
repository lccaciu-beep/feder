import { FederDB, setDb } from '../../src/storage/db';
import { newId } from '../../src/model/ids';
import type { StrokeItem } from '../../src/model/types';
import { pointsBBox } from '../../src/engine/geometry/rect';

let n = 0;

/** Frische, isolierte Datenbank pro Test. */
export function freshDb(): FederDB {
  const db = new FederDB(`feder-test-${Date.now()}-${n++}`);
  setDb(db);
  return db;
}

/** Strich aus Punktpaaren [x, y, x, y, …] (stride 4, Druck 0,5). */
export function stroke(xy: number[], extra: Partial<StrokeItem> = {}): StrokeItem {
  const pts: number[] = [];
  for (let i = 0; i < xy.length; i += 2) pts.push(xy[i]!, xy[i + 1]!, 0.5, i * 8);
  const points = new Float32Array(pts);
  const width = extra.width ?? 2;
  return {
    id: newId(),
    type: 'stroke',
    pageId: 'p1',
    notebookId: 'n1',
    z: 1,
    bbox: pointsBBox(points, 4, width),
    createdAt: Date.now(),
    tool: 'ballpoint',
    color: '#000',
    width,
    opacity: 1,
    dash: 'solid',
    pressureMode: 'none',
    stride: 4,
    points,
    t0: 0,
    ...extra,
  };
}

/** Gerade Linie mit vielen Punkten. */
export function line(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  steps = 20,
  extra: Partial<StrokeItem> = {},
) {
  const xy: number[] = [];
  for (let i = 0; i <= steps; i++) xy.push(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
  return stroke(xy, extra);
}
