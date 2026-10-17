// Zeitsortierbare IDs im Stil von ULID: 10 Zeichen Zeit + 16 Zeichen Zufall (Crockford-Base32).

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

let lastTime = -1;
let lastRandom: number[] = [];

function encodeTime(time: number): string {
  let out = '';
  for (let i = 0; i < 10; i++) {
    out = ALPHABET[time % 32] + out;
    time = Math.floor(time / 32);
  }
  return out;
}

function randomDigits(): number[] {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b % 32);
}

/** Erzeugt eine neue ID. Innerhalb derselben Millisekunde bleibt die Reihenfolge monoton. */
export function newId(now: number = Date.now()): string {
  let digits: number[];
  if (now === lastTime) {
    digits = lastRandom.slice();
    // Zufallsteil um 1 erhöhen (mit Übertrag)
    for (let i = digits.length - 1; i >= 0; i--) {
      if (digits[i]! < 31) {
        digits[i]!++;
        break;
      }
      digits[i] = 0;
    }
  } else {
    digits = randomDigits();
    lastTime = now;
  }
  lastRandom = digits;
  return encodeTime(now) + digits.map((d) => ALPHABET[d]).join('');
}
