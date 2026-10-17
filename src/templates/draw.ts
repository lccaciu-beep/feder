// Zeichnet Papier und Vorlagen als Vektoren auf einen Canvas-Kontext.
// Der Aufrufer setzt die Transformation so, dass 1 Einheit = 1 pt ist.

import { MM, PAPER_COLORS } from '../model/paper';
import type { PaperSpec, TemplateParams } from '../model/types';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

/**
 * Zeichnet Papierfarbe und Vorlage. `scale` (Gerätepixel pro pt) bestimmt
 * die Mindeststärke der Haarlinien.
 */
export function drawPaper(ctx: Ctx, paper: PaperSpec, scale: number): void {
  const colors = PAPER_COLORS[paper.color];
  ctx.fillStyle = colors.fill;
  ctx.fillRect(0, 0, paper.width, paper.height);
  const t = paper.template;
  if (t.kind !== 'builtin') return;
  // Haarlinien: mindestens ein Gerätepixel breit, damit sie nicht verschwinden.
  const hair = Math.max(0.5, 1 / scale);
  const p = t.params;
  switch (t.id) {
    case 'blank':
      break;
    case 'ruled':
      ruled(ctx, paper, p, hair, colors.line, colors.accent);
      break;
    case 'grid':
      grid(ctx, paper, p.spacing ?? 5 * MM, hair, colors.line);
      break;
    case 'dots':
      dots(ctx, paper, p.spacing ?? 5 * MM, Math.max(0.7, 1.2 / scale), colors.line);
      break;
    case 'cornell':
      cornell(ctx, paper, p, hair, colors.line, colors.accent);
      break;
    case 'music':
      music(ctx, paper, hair, colors.line);
      break;
    case 'planner-week':
      plannerWeek(ctx, paper, hair, colors.line);
      break;
    case 'planner-day':
      plannerDay(ctx, paper, hair, colors.line);
      break;
  }
}

function hLine(ctx: Ctx, x0: number, x1: number, y: number) {
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
}

function vLine(ctx: Ctx, x: number, y0: number, y1: number) {
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y1);
}

function ruled(ctx: Ctx, paper: PaperSpec, p: TemplateParams, w: number, line: string, accent: string) {
  const s = p.spacing ?? 7 * MM;
  const top = Math.max(s * 2.5, 20 * MM);
  ctx.beginPath();
  for (let y = top; y < paper.height - s * 0.6; y += s) hLine(ctx, 0, paper.width, y);
  ctx.strokeStyle = line;
  ctx.lineWidth = w;
  ctx.stroke();
  if (p.margin) {
    ctx.beginPath();
    vLine(ctx, Math.min(25 * MM, paper.width * 0.15), 0, paper.height);
    ctx.strokeStyle = accent;
    ctx.lineWidth = w * 1.2;
    ctx.stroke();
  }
}

function grid(ctx: Ctx, paper: PaperSpec, s: number, w: number, line: string) {
  const ox = (paper.width % s) / 2;
  const oy = (paper.height % s) / 2;
  ctx.beginPath();
  for (let x = ox; x <= paper.width; x += s) vLine(ctx, x, 0, paper.height);
  for (let y = oy; y <= paper.height; y += s) hLine(ctx, 0, paper.width, y);
  ctx.strokeStyle = line;
  ctx.lineWidth = w;
  ctx.stroke();
}

function dots(ctx: Ctx, paper: PaperSpec, s: number, r: number, line: string) {
  const ox = (paper.width % s) / 2 || s / 2;
  const oy = (paper.height % s) / 2 || s / 2;
  ctx.fillStyle = line;
  ctx.beginPath();
  for (let y = oy; y < paper.height; y += s) {
    for (let x = ox; x < paper.width; x += s) {
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
  }
  ctx.fill();
}

function cornell(ctx: Ctx, paper: PaperSpec, p: TemplateParams, w: number, line: string, accent: string) {
  const s = p.spacing ?? 7 * MM;
  const header = Math.min(30 * MM, paper.height * 0.12);
  const summary = paper.height - Math.min(50 * MM, paper.height * 0.2);
  const cue = Math.min(60 * MM, paper.width * 0.3);
  ctx.beginPath();
  for (let y = header + s; y < summary - s * 0.4; y += s) hLine(ctx, cue, paper.width, y);
  for (let y = summary + s; y < paper.height - s * 0.4; y += s) hLine(ctx, 0, paper.width, y);
  ctx.strokeStyle = line;
  ctx.lineWidth = w;
  ctx.stroke();
  ctx.beginPath();
  hLine(ctx, 0, paper.width, header);
  hLine(ctx, 0, paper.width, summary);
  vLine(ctx, cue, header, summary);
  ctx.strokeStyle = accent;
  ctx.lineWidth = w * 1.6;
  ctx.stroke();
}

function music(ctx: Ctx, paper: PaperSpec, w: number, line: string) {
  const gap = 2.2 * MM;
  const staff = gap * 4;
  const between = 11 * MM;
  const margin = 15 * MM;
  ctx.beginPath();
  for (let y = margin + 5 * MM; y + staff < paper.height - margin; y += staff + between) {
    for (let i = 0; i < 5; i++) hLine(ctx, margin, paper.width - margin, y + i * gap);
    vLine(ctx, margin, y, y + staff);
    vLine(ctx, paper.width - margin, y, y + staff);
  }
  ctx.strokeStyle = line;
  ctx.lineWidth = w * 1.2;
  ctx.stroke();
}

function label(ctx: Ctx, text: string, x: number, y: number, size: number, color: string) {
  ctx.fillStyle = color;
  ctx.font = `600 ${size}px -apple-system, system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillText(text, x, y);
}

function plannerWeek(ctx: Ctx, paper: PaperSpec, w: number, line: string) {
  const m = 12 * MM;
  const head = 18 * MM;
  const landscape = paper.width > paper.height;
  const cols = landscape ? 4 : 2;
  const rows = 2 * Math.ceil(8 / (cols * 2));
  const cellW = (paper.width - 2 * m) / cols;
  const cellH = (paper.height - m - head) / rows;
  ctx.beginPath();
  ctx.strokeStyle = line;
  ctx.lineWidth = w * 1.4;
  ctx.strokeRect(m, head, paper.width - 2 * m, paper.height - m - head);
  for (let c = 1; c < cols; c++) vLine(ctx, m + c * cellW, head, paper.height - m);
  for (let r = 1; r < rows; r++) hLine(ctx, m, paper.width - m, head + r * cellH);
  ctx.stroke();
  const titles = [...WEEKDAYS, 'Notizen'];
  const fs = Math.min(11, cellW / 9);
  titles.forEach((t, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    label(ctx, t, m + c * cellW + 6, head + r * cellH + 6, fs, line);
  });
  label(ctx, 'Woche', m, m * 0.6, 14, line);
}

function plannerDay(ctx: Ctx, paper: PaperSpec, w: number, line: string) {
  const m = 12 * MM;
  const head = 22 * MM;
  const timeCol = 16 * MM;
  const hours = 17; // 6 bis 22 Uhr
  const rowH = (paper.height - m - head) / hours;
  ctx.beginPath();
  ctx.strokeStyle = line;
  ctx.lineWidth = w;
  for (let i = 0; i <= hours; i++) hLine(ctx, m, paper.width - m, head + i * rowH);
  vLine(ctx, m + timeCol, head, paper.height - m);
  ctx.stroke();
  // halbe Stunden gestrichelt
  ctx.beginPath();
  ctx.setLineDash([2, 3]);
  for (let i = 0; i < hours; i++) hLine(ctx, m + timeCol, paper.width - m, head + (i + 0.5) * rowH);
  ctx.stroke();
  ctx.setLineDash([]);
  const fs = Math.min(10, rowH * 0.4);
  for (let i = 0; i < hours; i++) label(ctx, `${6 + i}:00`, m + 4, head + i * rowH + 4, fs, line);
  label(ctx, 'Datum', m, m * 0.6, 14, line);
}
