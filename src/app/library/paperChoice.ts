import { MM, PAPER_SIZES, makePaper, templateInfo, type PaperSizeId } from '../../model/paper';
import type { BuiltinTemplateId, PaperColor, PaperSpec, TemplateParams } from '../../model/types';

/** Zustand der Papierauswahl in Dialogen. */
export interface PaperChoice {
  size: PaperSizeId;
  orientation: 'portrait' | 'landscape';
  color: PaperColor;
  template: BuiltinTemplateId;
  spacing: number | undefined;
  margin: boolean;
  customWmm: number;
  customHmm: number;
  /** Gewählte Datei-Vorlage (PDF-Seite oder Bild); überschreibt die übrigen Felder. */
  file: PaperSpec | null;
}

export function choiceToPaper(c: PaperChoice): PaperSpec {
  if (c.file) return structuredClone(c.file);
  const params: TemplateParams = {};
  if (c.spacing !== undefined) params.spacing = c.spacing;
  if (c.template === 'ruled') params.margin = c.margin;
  const custom = { width: c.customWmm * MM, height: c.customHmm * MM };
  return makePaper(c.size, c.orientation, c.color, c.template, params, custom);
}

export function paperToChoice(p: PaperSpec): PaperChoice {
  const landscape = p.width > p.height;
  const short = Math.min(p.width, p.height);
  const long = Math.max(p.width, p.height);
  let size: PaperSizeId = 'custom';
  for (const [id, s] of Object.entries(PAPER_SIZES)) {
    if (
      Math.abs(Math.min(s.width, s.height) - short) < 1 &&
      Math.abs(Math.max(s.width, s.height) - long) < 1
    ) {
      size = id as PaperSizeId;
    }
  }
  const t = p.template.kind === 'builtin' ? p.template : null;
  const template = t?.id ?? 'blank';
  return {
    size,
    orientation: landscape ? 'landscape' : 'portrait',
    color: p.color,
    template,
    spacing: t?.params.spacing ?? templateInfo(template).defaults.spacing,
    margin: t?.params.margin ?? true,
    customWmm: Math.round(p.width / MM),
    customHmm: Math.round(p.height / MM),
    file: t ? null : structuredClone(p),
  };
}
