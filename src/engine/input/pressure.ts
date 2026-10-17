// Erkennt zur Laufzeit, ob der Stift echte Druckwerte liefert.
// Apple Pencil 1 liefert variierende Werte, Apple Pencil USB-C und viele
// andere Eingaben liefern eine Konstante (meist 0, 0,5 oder 1).

export type PressureSupport = 'unknown' | 'real' | 'none';

const NEEDED = 40;

export class PressureDetector {
  private samples: number[] = [];
  private result: PressureSupport = 'unknown';

  get support(): PressureSupport {
    return this.result;
  }

  /** Einen Druckwert eines aufgesetzten Stifts melden. */
  add(pressure: number): PressureSupport {
    if (this.result !== 'unknown') return this.result;
    this.samples.push(pressure);
    if (this.samples.length >= NEEDED) this.result = classify(this.samples);
    return this.result;
  }

  reset(): void {
    this.samples = [];
    this.result = 'unknown';
  }
}

export function classify(samples: number[]): PressureSupport {
  let min = Infinity;
  let max = -Infinity;
  let nonTrivial = 0;
  for (const p of samples) {
    if (p < min) min = p;
    if (p > max) max = p;
    if (p !== 0 && p !== 0.5 && p !== 1) nonTrivial++;
  }
  return max - min > 0.04 && nonTrivial > samples.length * 0.3 ? 'real' : 'none';
}
