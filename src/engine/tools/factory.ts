// Hilfen zum Erzeugen neuer Elemente.

import { newId } from '../../model/ids';
import type { DashStyle, Id, ShapeItem, TapeItem, TextItem, TextStyle } from '../../model/types';
import type { Recognized } from '../geometry/shapes';
import { itemBBox } from '../geometry/transform';
import { textHeight } from '../render/items';

interface Placement {
  pageId: Id;
  notebookId: Id;
  z: number;
}

export interface ShapeStyle {
  color: string;
  width: number;
  dash: DashStyle;
  fill: boolean;
  opacity?: number;
}

export function makeShape(rec: Recognized, style: ShapeStyle, at: Placement): ShapeItem {
  const s: ShapeItem = {
    id: newId(),
    type: 'shape',
    ...at,
    createdAt: Date.now(),
    bbox: { x: 0, y: 0, w: 0, h: 0 },
    shape: rec.shape,
    vertices: rec.vertices,
    rotation: rec.rotation,
    stroke: style.color,
    fill: style.fill ? style.color : null,
    fillOpacity: 0.22,
    width: style.width,
    dash: style.dash,
    opacity: style.opacity ?? 1,
  };
  s.bbox = itemBBox(s);
  return s;
}

export function makeTape(path: number[], width: number, color: string, at: Placement): TapeItem {
  const t: TapeItem = {
    id: newId(),
    type: 'tape',
    ...at,
    createdAt: Date.now(),
    bbox: { x: 0, y: 0, w: 0, h: 0 },
    path,
    width,
    color,
    covered: true,
  };
  t.bbox = itemBBox(t);
  return t;
}

export function makeText(x: number, y: number, width: number, style: TextStyle, at: Placement): TextItem {
  const box = { x, y, w: width, h: textHeight('', style, width) };
  return {
    id: newId(),
    type: 'text',
    ...at,
    createdAt: Date.now(),
    box,
    bbox: { ...box },
    rotation: 0,
    text: '',
    style,
  };
}

/** Passt die Höhe eines Textfelds an seinen Inhalt an. */
export function fitText(t: TextItem): TextItem {
  const h = textHeight(t.text, t.style, t.box.w);
  const next = { ...t, box: { ...t.box, h } };
  next.bbox = itemBBox(next);
  return next;
}
