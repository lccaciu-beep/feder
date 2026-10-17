import type { Item, PaperSpec } from '../../model/types';
import { drawPaper } from '../../templates/draw';
import { renderFileBackground } from './background';
import { drawItems } from './items';

/**
 * Zeichnet eine Seite vollständig (Hintergrund inkl. PDF + Inhalte) in einen
 * Canvas mit `k` Pixeln pro pt. Wird für Miniaturen und den Bild-Export genutzt.
 */
export async function renderPageTo(
  canvas: HTMLCanvasElement,
  paper: PaperSpec,
  items: readonly Item[] | undefined,
  k: number,
): Promise<void> {
  canvas.width = Math.max(1, Math.round(paper.width * k));
  canvas.height = Math.max(1, Math.round(paper.height * k));
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  drawPaper(ctx, paper, k);
  {
    const img = await renderFileBackground(paper, { x: 0, y: 0, w: paper.width, h: paper.height }, k).catch(
      () => null,
    );
    if (img) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.setTransform(k, 0, 0, k, 0, 0);
      img.width = img.height = 0;
    }
  }
  if (items) drawItems(ctx, items);
}

/** Zeichnet eine Seiten-Miniatur in der angegebenen CSS-Breite. */
export async function renderThumbnail(
  canvas: HTMLCanvasElement,
  paper: PaperSpec,
  items: readonly Item[] | undefined,
  cssWidth: number,
): Promise<void> {
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${(cssWidth * paper.height) / paper.width}px`;
  // In einen Zwischen-Canvas rendern, damit die Miniatur nicht kurz leer ist.
  const tmp = document.createElement('canvas');
  await renderPageTo(tmp, paper, items, (cssWidth / paper.width) * dpr);
  canvas.width = tmp.width;
  canvas.height = tmp.height;
  canvas.getContext('2d')?.drawImage(tmp, 0, 0);
  tmp.width = tmp.height = 0;
}
