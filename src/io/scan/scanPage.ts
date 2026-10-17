// Gescanntes Bild als Seite speichern.

import { PAPER_SIZES } from '../../model/paper';
import type { PaperSpec } from '../../model/types';
import { getBlobStore } from '../../storage/blobstore';

/** Speichert den Scan und liefert das Papier (A4-Breite, Höhe nach Seitenverhältnis). */
export async function scanPaper(blob: Blob, width: number, height: number): Promise<PaperSpec> {
  const meta = await (await getBlobStore()).put(blob);
  const w = PAPER_SIZES.a4.width;
  return {
    width: w,
    height: (w * height) / width,
    color: 'white',
    template: { kind: 'image', blobId: meta.id },
  };
}
