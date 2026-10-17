import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type Pt = [number, number];

async function pen(page: Page, points: Pt[], opts: { holdMs?: number; target?: string } = {}) {
  await page.evaluate(
    async ({ points, holdMs, target }) => {
      const host = document.querySelector(target ?? '.feder-editor')!;
      const fire = (type: string, [x, y]: Pt) =>
        host.dispatchEvent(
          new PointerEvent(type, {
            pointerType: 'pen',
            pointerId: 5,
            isPrimary: true,
            clientX: x,
            clientY: y,
            pressure: type === 'pointerup' ? 0 : 0.5,
            buttons: type === 'pointerup' ? 0 : 1,
            bubbles: true,
          }),
        );
      fire('pointerdown', points[0]!);
      for (const p of points.slice(1)) fire('pointermove', p);
      if (holdMs) await new Promise((r) => setTimeout(r, holdMs));
      fire('pointerup', points[points.length - 1]!);
    },
    { points, holdMs: opts.holdMs ?? 0, target: opts.target },
  );
}

async function tap(page: Page, x: number, y: number) {
  await pen(page, [
    [x, y],
    [x, y],
  ]);
}

async function items(page: Page): Promise<{ type: string; [k: string]: unknown }[]> {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('feder');
        req.onsuccess = () => {
          const r = req.result.transaction('items').objectStore('items').getAll();
          r.onsuccess = () => {
            resolve(r.result.map((it: { type: string }) => ({ ...it, points: undefined })));
            req.result.close();
          };
        };
      }),
  );
}

async function newNotebook(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Neues Notizbuch' }).click();
  await page.getByRole('button', { name: 'Notizbuch anlegen' }).click();
  await expect(page.locator('.feder-page').first()).toBeVisible();
}

const circle = (cx: number, cy: number, r: number, n = 48): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => [
    cx + r * Math.cos((i / n) * 2 * Math.PI),
    cy + r * Math.sin((i / n) * 2 * Math.PI),
  ]);

test('Formen-Werkzeug erkennt einen Kreis', async ({ page }) => {
  await newNotebook(page);
  await page.keyboard.press('s');
  await pen(page, circle(500, 450, 80));
  await expect
    .poll(async () => (await items(page)).map((i) => `${i.type}:${i.shape}`))
    .toEqual(['shape:ellipse']);
});

test('Lasso wählt aus, verschiebt und löscht', async ({ page }) => {
  await newNotebook(page);
  await pen(
    page,
    Array.from({ length: 20 }, (_, i): Pt => [400 + i * 8, 420]),
  );
  await expect.poll(async () => (await items(page)).length).toBe(1);
  const before = (await items(page))[0]!.bbox as { x: number };

  await page.keyboard.press('l');
  await pen(page, circle(475, 420, 120));
  await expect(page.getByRole('toolbar', { name: 'Auswahl' })).toBeVisible();
  // Auswahl um 100 px nach rechts ziehen
  await pen(
    page,
    Array.from({ length: 11 }, (_, i): Pt => [470 + i * 10, 420]),
  );
  await expect
    .poll(async () => ((await items(page))[0]!.bbox as { x: number }).x)
    .toBeGreaterThan(before.x + 30);

  await page.getByRole('button', { name: 'Löschen' }).click();
  await expect.poll(async () => (await items(page)).length).toBe(0);
});

test('Kreis um Inhalt bietet Auswahl an', async ({ page }) => {
  await newNotebook(page);
  await pen(
    page,
    Array.from({ length: 10 }, (_, i): Pt => [450 + i * 5, 450]),
  );
  await pen(page, circle(475, 450, 90));
  await page.getByRole('button', { name: 'Auswählen' }).click();
  await expect(page.getByRole('toolbar', { name: 'Auswahl' })).toBeVisible();
  // Der Kreis selbst wurde entfernt, der Strich bleibt
  await expect.poll(async () => (await items(page)).length).toBe(1);
});

test('Textfeld anlegen und bearbeiten', async ({ page }) => {
  await newNotebook(page);
  await page.keyboard.press('t');
  await tap(page, 300, 400);
  const box = page.getByRole('textbox', { name: 'Text' });
  await expect(box).toBeFocused();
  await box.fill('Hallo Feder');
  await page.getByRole('button', { name: 'Fertig' }).click();
  await expect.poll(async () => (await items(page)).map((i) => i.text)).toEqual(['Hallo Feder']);
});

test('Tape legen und per Tipp aufdecken', async ({ page }) => {
  await newNotebook(page);
  await page.keyboard.press('b');
  await pen(
    page,
    Array.from({ length: 10 }, (_, i): Pt => [350 + i * 20, 500]),
  );
  await expect.poll(async () => (await items(page)).map((i) => i.covered)).toEqual([true]);
  await tap(page, 440, 500);
  await expect.poll(async () => (await items(page)).map((i) => i.covered)).toEqual([false]);
});

test('Bild einfügen', async ({ page }) => {
  await newNotebook(page);
  // kleines PNG erzeugen
  const png = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 120;
    c.height = 80;
    const g = c.getContext('2d')!;
    g.fillStyle = '#2747c9';
    g.fillRect(0, 0, 120, 80);
    const b = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    return Array.from(new Uint8Array(await b!.arrayBuffer()));
  });
  const file = path.join(os.tmpdir(), `feder-img-${Date.now()}.png`);
  fs.writeFileSync(file, Buffer.from(png));
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Bild einfügen' }).click();
  await (await chooser).setFiles(file);
  await expect.poll(async () => (await items(page)).map((i) => i.type)).toEqual(['image']);
  await expect(page.getByRole('toolbar', { name: 'Auswahl' })).toBeVisible();
});

test('Zoom-Fenster schreibt auf die Seite', async ({ page }) => {
  await newNotebook(page);
  await page.getByRole('button', { name: 'Zoom-Fenster' }).click();
  await expect(page.locator('.feder-zoom')).toBeVisible();
  const r = await page.locator('.feder-zoom').boundingBox();
  await pen(
    page,
    Array.from({ length: 15 }, (_, i): Pt => [r!.x + 100 + i * 12, r!.y + r!.height / 2 + Math.sin(i) * 10]),
    { target: '.feder-zoom' },
  );
  await expect.poll(async () => (await items(page)).length).toBe(1);
  await page.screenshot({ path: 'test-results/zoom-window.png' });
});

test('Bildschirmfoto der Werkzeuge (Sichtprüfung)', async ({ page }) => {
  await newNotebook(page);
  await page.keyboard.press('s');
  await pen(page, circle(300, 400, 60));
  await page.keyboard.press('b');
  await pen(
    page,
    Array.from({ length: 10 }, (_, i): Pt => [420 + i * 20, 400]),
  );
  await page.keyboard.press('t');
  await tap(page, 300, 560);
  await page.getByRole('textbox', { name: 'Text' }).fill('Textfeld mit Notiz');
  await page.getByRole('button', { name: 'Fertig' }).click();
  await page.keyboard.press('l');
  await pen(page, circle(320, 400, 100));
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/tools.png' });
});
