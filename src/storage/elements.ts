// Gespeicherte Elemente („Sticker“): wiederverwendbare Auswahlen.

import { selectionBounds } from '../engine/tools/LassoTool';
import { transformItem, translate } from '../engine/geometry/transform';
import { newId } from '../model/ids';
import type { ElementDef, Id, Item } from '../model/types';
import { getDb } from './db';

/** Speichert Elemente relativ zu (0,0) samt kleiner Vorschau. */
export async function saveElement(
  name: string,
  items: readonly Item[],
  preview: Blob | null,
): Promise<ElementDef> {
  const b = selectionBounds(items);
  if (!b) throw new Error('Keine Elemente ausgewählt.');
  const t = translate(-b.x, -b.y);
  const def: ElementDef = {
    id: newId(),
    name,
    items: items.map((it) => transformItem(it, t)),
    width: b.w,
    height: b.h,
    preview: preview ? await blobToDataUrl(preview) : '',
    createdAt: Date.now(),
  };
  await getDb().elements.add(def);
  return def;
}

export async function renameElement(id: Id, name: string): Promise<void> {
  await getDb().elements.update(id, { name });
}

export async function deleteElement(id: Id): Promise<void> {
  await getDb().elements.delete(id);
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
