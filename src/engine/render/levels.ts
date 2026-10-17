// Auflösungsstufen für Seiten-Canvases.

/** Höchstzahl an Pixeln pro Canvas (Speichergrenze von Safari auf dem iPad). */
export const MAX_CANVAS_PIXELS = 8_000_000;

const LEVELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 12, 16];

/** Wählt eine Auflösungsstufe (Gerätepixel pro pt) für eine Seite. */
export function chooseLevel(target: number, pageW: number, pageH: number): number {
  const cap = Math.sqrt(MAX_CANVAS_PIXELS / (pageW * pageH));
  const wanted = LEVELS.find((l) => l >= target * 0.98) ?? LEVELS[LEVELS.length - 1]!;
  return Math.min(wanted, cap);
}
