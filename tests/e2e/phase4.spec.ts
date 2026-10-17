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

async function fingerTap(page: Page, x: number, y: number) {
  await page.evaluate(
    ({ x, y }) => {
      const host = document.querySelector('.feder-editor')!;
      for (const type of ['pointerdown', 'pointerup']) {
        host.dispatchEvent(
          new PointerEvent(type, {
            pointerType: 'touch',
            pointerId: 88,
            clientX: x,
            clientY: y,
            buttons: type === 'pointerdown' ? 1 : 0,
            bubbles: true,
          }),
        );
      }
    },
    { x, y },
  );
}

async function notebookWithText(page: Page, title: string, text: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Neues Notizbuch' }).click();
  await page.getByLabel('Titel').fill(title);
  await page.getByRole('button', { name: 'Notizbuch anlegen' }).click();
  await expect(page.locator('.feder-page').first()).toBeVisible();
  await page.keyboard.press('t');
  await pen(page, [
    [300, 420],
    [300, 420],
  ]);
  await page.getByRole('textbox', { name: 'Text' }).fill(text);
  await page.getByRole('button', { name: 'Fertig' }).click();
  await expect(page.locator('.save')).toHaveText('Gespeichert');
}

test('Suche im Notizbuch findet Textfelder und markiert sie', async ({ page }) => {
  await notebookWithText(page, 'Biologie', 'Photosynthese in Pflanzen');
  await page.keyboard.press('Meta+f');
  await page.getByRole('searchbox', { name: 'Im Notizbuch suchen' }).fill('photosynth');
  await expect(page.getByRole('button', { name: /Seite 1, Textfeld/ })).toBeVisible();
});

test('Bibliothekssuche findet Inhalte und öffnet die Seite', async ({ page }) => {
  await notebookWithText(page, 'Chemie', 'Avogadro-Konstante');
  await page.waitForTimeout(1200); // Suchindex wird verzögert geschrieben
  await page.getByRole('button', { name: 'Zur Bibliothek' }).click();
  await page.getByRole('searchbox', { name: 'Notizbücher suchen' }).fill('avogadro');
  await page.getByRole('button', { name: /Seite 1, Textfeld/ }).click();
  await expect(page.locator('.title')).toHaveText('Chemie');
  await expect(page.getByRole('searchbox', { name: 'Im Notizbuch suchen' })).toHaveValue('avogadro');
});

test('Lesezeichen setzen und in der Seitenleiste sehen', async ({ page }) => {
  await notebookWithText(page, 'Physik', 'Impuls');
  await page.getByRole('button', { name: /Lesezeichen setzen/ }).click();
  await expect(page.getByRole('button', { name: /Lesezeichen entfernen/ })).toBeVisible();
  await page.getByRole('button', { name: 'Seitenübersicht', exact: true }).click();
  await page.getByRole('tab', { name: 'Lesezeichen' }).click();
  await expect(page.getByRole('button', { name: /Seite 1/ }).first()).toBeVisible();
});

test('Link auf eine andere Seite anlegen und antippen', async ({ page }) => {
  await notebookWithText(page, 'Links', 'Zum Anhang');
  await page.getByRole('button', { name: /Seite einfügen/ }).click();
  await page.keyboard.press('Home');
  await page.waitForTimeout(400);
  await page.keyboard.press('l');
  const r = 300;
  await pen(
    page,
    Array.from({ length: 41 }, (_, i): Pt => [
      520 + r * Math.cos((i / 40) * 2 * Math.PI),
      420 + 80 * Math.sin((i / 40) * 2 * Math.PI),
    ]),
  );
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click();
  await page.getByRole('menuitem', { name: 'Link hinzufügen …' }).click();
  await page.getByRole('button', { name: 'Seite', exact: true }).click();
  await page.getByRole('spinbutton').fill('2');
  await page.getByRole('button', { name: 'Link anlegen' }).click();
  await expect(page.locator('.pager')).toHaveText('1 / 2');
  await fingerTap(page, 330, 425);
  await expect(page.locator('.pager')).toHaveText('2 / 2');
});
