// Text normalisieren und in Suchbegriffe zerlegen (deutsch/englisch).

/** Kleinschreibung, ohne Akzente, ß → ss, Umlaute → Grundbuchstabe. */
export function normalize(s: string): string {
  return s
    .toLocaleLowerCase('de')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/** Eindeutige Wörter (mind. 2 Zeichen) für den Suchindex. */
export function tokenize(text: string): string[] {
  const set = new Set<string>();
  for (const w of normalize(text).split(/[^\p{L}\p{N}]+/u)) if (w.length >= 2) set.add(w);
  return [...set];
}
