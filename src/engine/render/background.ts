// Hintergründe aus Dateien (PDF-Seite oder Bild) als Ausschnitt rendern.
// Eingebaute Vorlagen zeichnet templates/draw.ts direkt und synchron.

import type { PaperSpec, Rect } from '../../model/types';
import { renderPdfRegion } from '../../pdf/pdfjs';
import { loadImage } from './items';

export function hasFileBackground(paper: PaperSpec): boolean {
  return paper.template.kind === 'pdf' || paper.template.kind === 'image';
}

/** Rendert den Ausschnitt `rect` (pt) mit `level` Pixeln pro pt in einen neuen Canvas. */
export async function renderFileBackground(
  paper: PaperSpec,
  rect: Rect,
  level: number,
  signal?: AbortSignal,
): Promise<HTMLCanvasElement | null> {
  const t = paper.template;
  if (t.kind === 'pdf') return renderPdfRegion(t.blobId, t.pageIndex, rect, level, signal);
  if (t.kind !== 'image') return null;
  const img = await loadImage(t.blobId);
  if (!img || signal?.aborted) return null;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(rect.w * level));
  c.height = Math.max(1, Math.round(rect.h * level));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  // Bild füllt die ganze Seite; nur der Ausschnitt wird gezeichnet.
  ctx.setTransform(level, 0, 0, level, -rect.x * level, -rect.y * level);
  ctx.drawImage(img, 0, 0, paper.width, paper.height);
  return c;
}
