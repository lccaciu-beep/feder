import { expect, test, type Page } from '@playwright/test';

type Pt = [number, number];

async function pen(page: Page, points: Pt[]) {
  await page.evaluate((points) => {
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
    fire('pointerup', points[points.length - 1]!);
  }, points);
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

async function create(page: Page, title: string, whiteboard = false) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Neu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Notizbuch' }).click();
  await page.getByLabel('Titel').fill(title);
  if (whiteboard) await page.getByRole('radio', { name: 'Whiteboard' }).click();
  await page.getByRole('button', { name: 'Notizbuch anlegen' }).click();
  await expect(page.locator('.feder-page').first()).toBeVisible();
}

const wave = (x: number, y: number): Pt[] =>
  Array.from({ length: 20 }, (_, i) => [x + i * 8, y + Math.sin(i / 3) * 20]);

test('Lesemodus: Stift zeichnet nicht', async ({ page }) => {
  await create(page, 'Lesen');
  await page.getByRole('button', { name: 'Weitere Optionen' }).click();
  await page.getByRole('menuitem', { name: 'Lesemodus' }).click();
  await expect(page.getByRole('button', { name: 'Bearbeiten' })).toBeVisible();
  await pen(page, wave(300, 450));
  await page.waitForTimeout(600);
  expect(await itemCount(page)).toBe(0);
  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  await pen(page, wave(300, 450));
  await expect.poll(() => itemCount(page)).toBe(1);
});

test('Whiteboard wächst am Rand mit', async ({ page }) => {
  await create(page, 'Tafel', true);
  const width = () =>
    page
      .locator('.feder-page')
      .first()
      .evaluate((el) => parseFloat((el as HTMLElement).dataset.w ?? '0'));
  expect(await width()).toBe(4000);
  // weit hinauszoomen und am rechten Rand schreiben
  for (let i = 0; i < 6; i++) await page.keyboard.press('Meta+-');
  await page.waitForTimeout(300);
  const box = (await page.locator('.feder-page').first().boundingBox())!;
  await pen(page, wave(box.x + box.width - 60, box.y + 200));
  await expect.poll(width).toBeGreaterThan(4000);
});

test('Tabs für mehrere geöffnete Notizbücher', async ({ page }) => {
  await create(page, 'Erstes');
  await create(page, 'Zweites');
  await expect(page.getByRole('tab', { name: 'Erstes' })).toBeVisible();
  await page.getByRole('tab', { name: 'Erstes' }).click();
  await expect(page.locator('.title')).toHaveText('Erstes');
});

test('Lernkarte erstellen und lernen', async ({ page }) => {
  await create(page, 'Vokabeln');
  await pen(page, wave(400, 450));
  await page.keyboard.press('l');
  await pen(
    page,
    Array.from({ length: 41 }, (_, i): Pt => [
      480 + 150 * Math.cos((i / 40) * 2 * Math.PI),
      450 + 90 * Math.sin((i / 40) * 2 * Math.PI),
    ]),
  );
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click();
  await page.getByRole('menuitem', { name: 'Lernkarte erstellen …' }).click();
  await page.getByPlaceholder(/Antwort eintippen/).fill('die Welle');
  await page.getByRole('button', { name: 'Karte speichern' }).click();
  await page.getByRole('button', { name: 'Zur Bibliothek' }).click();
  await page.getByRole('button', { name: 'Lernen', exact: true }).first().click();
  await expect(page.getByText('1 Karte, 1 fällig')).toBeVisible();
  await page.getByRole('main').getByRole('button', { name: 'Lernen' }).click();
  await page.getByRole('button', { name: 'Antwort zeigen' }).click();
  await expect(page.getByText('die Welle')).toBeVisible();
  await page.getByRole('button', { name: 'Gewusst' }).click();
  await expect(page.getByRole('heading', { name: 'Fertig für heute' })).toBeVisible();
});
