import type { DashStyle, FontFamily, PenKind } from './types';

export type ThemeSetting = 'system' | 'light' | 'dark';
export type PressureSetting = 'auto' | 'real' | 'velocity' | 'none';
export type ScrollDirection = 'vertical' | 'horizontal';
export type EraserMode = 'stroke' | 'precision';
export type LibrarySort = 'updated' | 'created' | 'name';
export type LibraryView = 'grid' | 'list';

export interface PenSettings {
  kind: PenKind;
  color: string;
  width: number;
  dash: DashStyle;
  colors: string[];
  widths: number[];
}

export interface HighlighterSettings {
  color: string;
  width: number;
  straight: boolean;
  colors: string[];
  widths: number[];
}

export interface EraserSettings {
  mode: EraserMode;
  /** Radius in Bildschirm-Pixeln (bleibt beim Zoomen gleich groß). */
  size: number;
  sizes: number[];
  highlighterOnly: boolean;
}

export interface ShapeSettings {
  color: string;
  width: number;
  dash: DashStyle;
  fill: boolean;
}

export interface TextSettings {
  font: FontFamily;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
}

export interface AppSettings {
  theme: ThemeSetting;
  fingerDrawing: boolean;
  pressureMode: PressureSetting;
  /** Wie stark die Geschwindigkeit die Strichstärke dünner macht (0..1). */
  velocitySensitivity: number;
  scrollDirection: ScrollDirection;
  zigzagErase: boolean;
  tapGestures: boolean;
  holdToStraighten: boolean;
  debugOverlay: boolean;
  pen: PenSettings;
  highlighter: HighlighterSettings;
  eraser: EraserSettings;
  lasso: { mode: 'free' | 'rect' };
  shape: ShapeSettings;
  text: TextSettings;
  tape: { color: string; width: number };
  laser: { color: string };
  /** Kreis um Inhalte mit dem Stift bietet eine Auswahl an. */
  circleToLasso: boolean;
  /** Eigene Farbpalette. */
  palette: string[];
  librarySort: LibrarySort;
  libraryView: LibraryView;
  /** Erinnerung, wenn das letzte Backup älter ist (Tage, 0 = aus). */
  backupReminderDays: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  fingerDrawing: false,
  pressureMode: 'auto',
  velocitySensitivity: 0.5,
  scrollDirection: 'vertical',
  zigzagErase: true,
  tapGestures: true,
  holdToStraighten: true,
  debugOverlay: false,
  pen: {
    kind: 'fountain',
    color: '#16203a',
    width: 1.4,
    dash: 'solid',
    colors: ['#16203a', '#2747c9', '#c0392b', '#2e7d4f', '#7a4e7e'],
    widths: [0.8, 1.4, 2.4],
  },
  highlighter: {
    color: '#f5d33c',
    width: 11,
    straight: false,
    colors: ['#f5d33c', '#8fd16a', '#6cc3f0', '#f59ac0', '#f6a75a'],
    widths: [6, 11, 18],
  },
  eraser: { mode: 'stroke', size: 14, sizes: [7, 14, 28], highlighterOnly: false },
  lasso: { mode: 'free' },
  shape: { color: '#16203a', width: 1.6, dash: 'solid', fill: false },
  text: { font: 'sans', size: 14, color: '#16203a', bold: false, italic: false, align: 'left' },
  tape: { color: '#e8a33d', width: 18 },
  laser: { color: '#e5383b' },
  circleToLasso: true,
  librarySort: 'updated',
  libraryView: 'grid',
  backupReminderDays: 7,
  palette: [
    '#000000',
    '#5b6270',
    '#8c5a3c',
    '#e07a1f',
    '#d4a017',
    '#3a8f5c',
    '#15808a',
    '#3456b3',
    '#6a3fb0',
    '#b0306a',
  ],
};

/** Ergänzt gespeicherte Einstellungen um neue Felder (vorwärtskompatibel). */
export function mergeSettings(stored: Partial<AppSettings> | undefined): AppSettings {
  if (!stored) return structuredClone(DEFAULT_SETTINGS);
  const d = structuredClone(DEFAULT_SETTINGS);
  return {
    ...d,
    ...stored,
    pen: { ...d.pen, ...stored.pen },
    highlighter: { ...d.highlighter, ...stored.highlighter },
    eraser: { ...d.eraser, ...stored.eraser },
    lasso: { ...d.lasso, ...stored.lasso },
    shape: { ...d.shape, ...stored.shape },
    text: { ...d.text, ...stored.text },
    tape: { ...d.tape, ...stored.tape },
    laser: { ...d.laser, ...stored.laser },
  };
}
