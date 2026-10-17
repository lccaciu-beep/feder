import type { BuiltinTemplateId, PaperColor, PaperSpec, TemplateParams } from './types';

export const MM = 72 / 25.4;

export type PaperSizeId = 'a4' | 'a5' | 'letter' | 'custom';

export const PAPER_SIZES: Record<
  Exclude<PaperSizeId, 'custom'>,
  { label: string; width: number; height: number }
> = {
  a4: { label: 'A4', width: 595.28, height: 841.89 },
  a5: { label: 'A5', width: 419.53, height: 595.28 },
  letter: { label: 'Letter', width: 612, height: 792 },
};

export const PAPER_COLORS: Record<PaperColor, { label: string; fill: string; line: string; accent: string }> =
  {
    white: { label: 'Weiß', fill: '#ffffff', line: '#c9d3df', accent: '#e8a39a' },
    yellow: { label: 'Gelb', fill: '#fbf4d9', line: '#d6cba3', accent: '#e3a38e' },
    dark: { label: 'Dunkel', fill: '#24272e', line: '#454b57', accent: '#8a5a52' },
  };

export interface TemplateInfo {
  id: BuiltinTemplateId;
  label: string;
  /** Wählbare Abstände in pt, falls die Vorlage einen hat. */
  spacings?: { label: string; value: number }[];
  defaults: TemplateParams;
}

export const TEMPLATES: TemplateInfo[] = [
  { id: 'blank', label: 'Blanko', defaults: {} },
  {
    id: 'ruled',
    label: 'Liniert',
    spacings: [
      { label: 'Eng (6 mm)', value: 6 * MM },
      { label: 'Mittel (7 mm)', value: 7 * MM },
      { label: 'Weit (8,5 mm)', value: 8.5 * MM },
    ],
    defaults: { spacing: 7 * MM, margin: true },
  },
  {
    id: 'grid',
    label: 'Kariert',
    spacings: [
      { label: '4 mm', value: 4 * MM },
      { label: '5 mm', value: 5 * MM },
      { label: '7 mm', value: 7 * MM },
    ],
    defaults: { spacing: 5 * MM },
  },
  {
    id: 'dots',
    label: 'Gepunktet',
    spacings: [
      { label: '4 mm', value: 4 * MM },
      { label: '5 mm', value: 5 * MM },
      { label: '7 mm', value: 7 * MM },
    ],
    defaults: { spacing: 5 * MM },
  },
  { id: 'cornell', label: 'Cornell', defaults: { spacing: 7 * MM } },
  { id: 'music', label: 'Notenlinien', defaults: {} },
  { id: 'planner-week', label: 'Wochenplaner', defaults: {} },
  { id: 'planner-day', label: 'Tagesplaner', defaults: {} },
];

export function templateInfo(id: BuiltinTemplateId): TemplateInfo {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]!;
}

export function makePaper(
  size: PaperSizeId,
  orientation: 'portrait' | 'landscape',
  color: PaperColor,
  templateId: BuiltinTemplateId,
  params?: TemplateParams,
  custom?: { width: number; height: number },
): PaperSpec {
  const base = size === 'custom' ? (custom ?? PAPER_SIZES.a4) : PAPER_SIZES[size];
  let { width, height } = base;
  const isLandscape = width > height;
  if ((orientation === 'landscape') !== isLandscape) [width, height] = [height, width];
  return {
    width,
    height,
    color,
    template: {
      kind: 'builtin',
      id: templateId,
      params: { ...templateInfo(templateId).defaults, ...params },
    },
  };
}

export const DEFAULT_PAPER: PaperSpec = makePaper('a4', 'portrait', 'white', 'ruled');

export const COVER_COLORS = [
  '#1f2d4d', // Nachtblau
  '#2747c9', // Königsblau
  '#3f6f73', // Petrol
  '#5f7d4e', // Moos
  '#c49a2c', // Senf
  '#b5473a', // Siegellack
  '#6d4a7d', // Pflaume
  '#6b7280', // Schiefer
  '#e5e1d6', // Leinen
];
