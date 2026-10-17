import { expect, test, type Page } from '@playwright/test';

type Pt = [number, number, number?];

/** Simuliert einen Apple-Pencil-Strich über synthetische Pointer Events. */
async function pen(page: Page, points: Pt[], pointerType: 'pen' | 'touch' = 'pen', pointerId = 11) {
  await page.evaluate(
    ({ points, pointerType, pointerId }) => {
      const host = document.querySelector('.feder-editor')!;
      const fire = (type: string, [x, y, p = 0.5]: Pt) =>
        host.dispatchEvent(
          new PointerEvent(type, {
            pointerType,
            pointerId,
            isPrimary: true,
            clientX: x,
            clientY: y,
            pressure: type === 'pointerup' ? 0 : p,
            tiltX: 15,
            tiltY: 5,
            buttons: type === 'pointerup' ? 0 : 1,
            bubbles: true,
          }),
        );
      fire('pointerdown', points[0]!);
      for (const p of points.slice(1)) fire('pointermove', p);
      fire('pointerup', points[points.length - 1]!);
    },
    { points, pointerType, pointerId },
  );
}

function wave(x0: number, y0: number, n = 50): Pt[] {
  return Array.from({ length: n }, (_, i) => [
    x0 + i * 7,
    y0 + Math.sin(i / 4) * 25,
    0.3 + 0.4 * Math.abs(Math.sin(i / 7)),
  ]);
}

/** Liest die gespeicherten Items direkt aus IndexedDB. */
async function storedItems(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const req = indexedDB.open('feder');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const tx = req.result.transaction('items', 'readonly');
          const c = tx.objectStore('items').count();
          c.onsuccess = () => {
            resolve(c.result);
            req.result.close();
          };
        };
      }),
  );
}

/** Anzahl gezeichneter Pixel auf dem Ink-Canvas der ersten Seite. */
async function inkPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('.feder-ink')!;
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) n++;
    return n;
  });
}

async function newNotebook(page: Page, title = 'Testheft') {
  await page.goto('/');
  await page.getByRole('button', { name: 'Neues Notizbuch' }).click();
  await page.getByLabel('Titel').fill(title);
  await page.getByRole('button', { name: 'Notizbuch anlegen' }).click();
  await expect(page.locator('.feder-page').first()).toBeVisible();
  await expect(page.locator('.save')).toHaveText('Gespeichert');
}

test('Bibliothek startet und zeigt den leeren Zustand', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dokumente' })).toBeVisible();
  await expect(page.getByText('Noch keine Notizbücher')).toBeVisible();
});

test('Stift-Strich wird gezeichnet, gespeichert und überlebt ein Neuladen', async ({ page }) => {
  await newNotebook(page);
  expect(await inkPixels(page)).toBe(0);
  await pen(page, wave(300, 420));
  expect(await inkPixels(page)).toBeGreaterThan(500);
  await expect(page.locator('.save')).toHaveText('Gespeichert');
  expect(await storedItems(page)).toBe(1);

  await page.reload();
  await expect(page.locator('.feder-page').first()).toBeVisible();
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(500);
});

test('Rückgängig, Wiederholen und Radierer', async ({ page }) => {
  await newNotebook(page);
  await pen(page, wave(300, 420));
  await pen(page, wave(300, 560));
  const undo = page.getByRole('button', { name: /Rückgängig/ });
  const redo = page.getByRole('button', { name: /Wiederholen/ });
  await undo.click();
  await expect(redo).toBeEnabled();
  await expect.poll(() => storedItems(page)).toBe(1);
  await redo.click();
  await expect.poll(() => storedItems(page)).toBe(2);

  await page.keyboard.press('e');
  await expect(page.getByRole('button', { name: 'Radierer (E)' })).toHaveAttribute('aria-pressed', 'true');
  // senkrecht durch beide Wellen
  await pen(
    page,
    Array.from({ length: 40 }, (_, i): Pt => [440, 360 + i * 7]),
  );
  await expect.poll(() => storedItems(page)).toBe(0);
  expect(await inkPixels(page)).toBe(0);
});

test('Präziser Radierer teilt einen Strich', async ({ page }) => {
  await newNotebook(page);
  await pen(
    page,
    Array.from({ length: 40 }, (_, i): Pt => [300 + i * 10, 450]),
  );
  await page.keyboard.press('e');
  await page.getByRole('button', { name: 'Präzise' }).click();
  await pen(page, [
    [500, 400],
    [500, 450],
    [500, 500],
  ]);
  await expect.poll(() => storedItems(page)).toBe(2);
});

test('Handballen: Berührung während des Schreibens scrollt nicht', async ({ page }) => {
  await newNotebook(page);
  await page.getByRole('button', { name: /Seite einfügen/ }).click();
  await page.getByRole('button', { name: /Seite einfügen/ }).click();
  await page.keyboard.press('Home');
  await page.waitForTimeout(400);
  const transform = () =>
    page
      .locator('.feder-page')
      .first()
      .evaluate((el) => (el as HTMLElement).style.transform);
  const before = await transform();
  await page.evaluate(() => {
    const host = document.querySelector('.feder-editor')!;
    const ev = (type: string, pointerType: string, id: number, x: number, y: number) =>
      host.dispatchEvent(
        new PointerEvent(type, {
          pointerType,
          pointerId: id,
          clientX: x,
          clientY: y,
          pressure: 0.5,
          buttons: 1,
          bubbles: true,
        }),
      );
    ev('pointerdown', 'pen', 21, 400, 400);
    // Handballen setzt auf und wischt
    ev('pointerdown', 'touch', 31, 700, 600);
    for (let i = 1; i < 20; i++) ev('pointermove', 'touch', 31, 700, 600 - i * 15);
    ev('pointerup', 'touch', 31, 700, 300);
    ev('pointermove', 'pen', 21, 450, 420);
    ev('pointerup', 'pen', 21, 450, 420);
  });
  await page.waitForTimeout(200);
  expect(await transform()).toBe(before);
  await expect.poll(() => storedItems(page)).toBe(1);
});

test('Finger scrollt, wenn kein Stift aktiv ist', async ({ page }) => {
  await newNotebook(page);
  await page.getByRole('button', { name: /Seite einfügen/ }).click();
  await page.keyboard.press('Home');
  await page.waitForTimeout(400);
  const top = () =>
    page
      .locator('.feder-page')
      .first()
      .evaluate((el) => el.getBoundingClientRect().top);
  const before = await top();
  await pen(
    page,
    Array.from({ length: 20 }, (_, i): Pt => [600, 600 - i * 15]),
    'touch',
    41,
  );
  await expect.poll(top).toBeLessThan(before - 100);
  expect(await storedItems(page)).toBe(0);
});

test('Bibliothek: Ordner anlegen, Notizbuch verschieben und in den Papierkorb legen', async ({ page }) => {
  await newNotebook(page, 'Physik');
  await page.getByRole('button', { name: 'Zur Bibliothek' }).click();
  await page.getByRole('button', { name: 'Neu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Ordner' }).click();
  await page.getByRole('textbox', { name: 'Neuer Ordner' }).fill('Uni');
  await page.getByRole('button', { name: 'Ordner anlegen' }).click();
  await expect(page.getByRole('button', { name: 'Ordner Uni' })).toBeVisible();

  await page.getByRole('button', { name: 'Notizbuch Physik' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Verschieben …' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Uni' }).click();
  await expect(page.getByRole('button', { name: 'Notizbuch Physik' })).toBeHidden();
  await page.getByRole('button', { name: 'Ordner Uni' }).click();
  await expect(page.getByRole('button', { name: 'Notizbuch Physik' })).toBeVisible();

  await page.getByRole('button', { name: 'Notizbuch Physik' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'In den Papierkorb' }).click();
  await page.getByRole('button', { name: 'Papierkorb' }).click();
  await expect(page.getByRole('button', { name: 'Notizbuch Physik' })).toBeVisible();
});

test('Offline: App lädt nach Installation des Service Workers ohne Netz', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // einmal neu laden, damit der Service Worker die Seite kontrolliert
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Dokumente' })).toBeVisible();
  await context.setOffline(false);
});
