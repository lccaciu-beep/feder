// Erzeugt die PNG-Icons aus public/icons/icon.svg mit Playwright (WebKit).
// Aufruf: npm run icons
import fs from 'node:fs';
import path from 'node:path';
import { webkit } from '@playwright/test';

const dir = path.join(import.meta.dirname, '..', 'public', 'icons');
const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const bodyOnly = inner.replace(/<rect[^>]*\/>/, '');

const targets = [
  { file: 'icon-192.png', size: 192, mode: 'rounded' },
  { file: 'icon-512.png', size: 512, mode: 'rounded' },
  { file: 'apple-touch-icon.png', size: 180, mode: 'full' },
  { file: 'icon-maskable-512.png', size: 512, mode: 'maskable' },
  { file: 'favicon-32.png', size: 32, mode: 'rounded' },
];

function markup(mode) {
  if (mode === 'rounded') return svg;
  if (mode === 'full') {
    // iOS rundet selbst ab: volle Fläche ohne eigene Rundung.
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#233047"/>${bodyOnly}</svg>`;
  }
  // maskable: Inhalt auf die 80-%-Sicherheitszone verkleinern.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#233047"/><g transform="translate(51.2 51.2) scale(0.8)">${bodyOnly}</g></svg>`;
}

const browser = await webkit.launch();
const page = await browser.newPage();
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${markup(t.mode).replace('<svg ', `<svg width="${t.size}" height="${t.size}" `)}</body></html>`,
  );
  await page.screenshot({ path: path.join(dir, t.file), omitBackground: true });
  console.log('✓', t.file);
}
await browser.close();
