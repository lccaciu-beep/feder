import type { Item, PaperSpec } from '../../model/types';
import { drawPaper } from '../../templates/draw';
import { drawItems } from '../ink/brushes';

/** Zeichnet eine Seiten-Miniatur in der angegebenen CSS-Breite. */
export function renderThumbnail(
  canvas: HTMLCanvasElement,
  paper: PaperSpec,
  items: readonly Item[] | undefined,
  cssWidth: number,
): void {
  const dpr = window.devicePixelRatio || 1;
  const k = (cssWidth / paper.width) * dpr;
  canvas.width = Math.round(paper.width * k);
  canvas.height = Math.round(paper.height * k);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${(cssWidth * paper.height) / paper.width}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  drawPaper(ctx, paper, k);
  if (items) drawItems(ctx, items);
}
