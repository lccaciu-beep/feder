// Kopiert die Zusatzdateien von pdf.js (CMaps, Standardschriften, WASM-Decoder,
// ICC-Profile) nach public/pdfjs, damit PDFs auch offline korrekt dargestellt werden.
// Läuft automatisch nach `npm install` (postinstall).
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const src = path.join(root, 'node_modules', 'pdfjs-dist');
const dest = path.join(root, 'public', 'pdfjs');

if (!fs.existsSync(src)) {
  console.warn('pdfjs-dist nicht gefunden – übersprungen.');
  process.exit(0);
}

fs.rmSync(dest, { recursive: true, force: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  fs.cpSync(path.join(src, dir), path.join(dest, dir), {
    recursive: true,
    // quickjs dient nur der Formular-Skriptausführung, die Feder nicht nutzt.
    filter: (f) => !path.basename(f).startsWith('quickjs'),
  });
}
console.log('pdf.js-Zusatzdateien nach public/pdfjs kopiert.');
