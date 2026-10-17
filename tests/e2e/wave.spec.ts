import { expect, test, type Page } from '@playwright/test';

type Pt = [number, number];

async function pen(page: Page, points: Pt[], holdMs = 0) {
  await page.evaluate(
    async ({ points, holdMs }) => {
      const host = document.querySelector('.feder-editor')!;
      const fire = (type: string, [x, y]: Pt) =>
        host.dispatchEvent(
          new PointerEvent(type, {
            pointerType: 'pen',
            pointerId: 5,
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
    { points, holdMs },
  );
}

async function itemCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open('feder');
        req.onsuccess = () => {
          const c = req.result.transaction('items').objectStore('items').count();
          c.onsuccess = () => {
            resolve(c.result);
            req.result.close();
          };
        };
      }),
  );
}

// „Wort“ als Zickzack nach oben/unten (wie Buchstaben), dann Welle quer hindurch
const word: Pt[] = Array.from({ length: 16 }, (_, i) => [400 + i * 8, i % 2 ? 400 : 430]);
const wave: Pt[] = Array.from({ length: 81 }, (_, i) => [
  380 + i * 2.2,
  415 + 8 * Math.sin((i / 80) * 5 * 2 * Math.PI),
]);

async function open(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Neues Notizbuch' }).click();
  await page.getByRole('button', { name: 'Notizbuch anlegen' }).click();
  await expect(page.locator('.feder-page').first()).toBeVisible();
}

test('Welliges Durchstreichen löscht das Wort', async ({ page }) => {
  await open(page);
  await pen(page, word);
  await expect.poll(() => itemCount(page)).toBe(1);
  await pen(page, wave);
  await expect.poll(() => itemCount(page)).toBe(0);
  // rückgängig holt das Wort zurück
  await page.getByRole('button', { name: /Rückgängig/ }).click();
  await expect.poll(() => itemCount(page)).toBe(1);
});

test('Auch mit kurzem Halten am Ende wird gelöscht (keine gerade Linie)', async ({ page }) => {
  await open(page);
  await pen(page, word);
  await expect.poll(() => itemCount(page)).toBe(1);
  await pen(page, wave, 900);
  await expect.poll(() => itemCount(page)).toBe(0);
});

test('Ausgeschaltet bleibt die Welle als Strich stehen', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Weitere Optionen' }).click();
  await page.getByRole('menuitem', { name: 'Einstellungen' }).click();
  await page.getByRole('checkbox', { name: /Welliges Durchstreichen löscht/ }).uncheck();
  await page.getByRole('button', { name: 'Schließen' }).click();
  await pen(page, word);
  await pen(page, wave);
  await expect.poll(() => itemCount(page)).toBe(2);
});
