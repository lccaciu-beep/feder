import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, PDFName, PDFNull, rgb } from 'pdf-lib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function linkedPdf(): Promise<string> {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([420, 595]);
  const p2 = doc.addPage([420, 595]);
  p1.drawRectangle({ x: 50, y: 500, width: 200, height: 40, color: rgb(0.9, 0.9, 1) });
  p1.drawText('Zur zweiten Seite', { x: 60, y: 515, size: 14 });
  p2.drawText('Seite zwei', { x: 60, y: 515, size: 14 });
  const annot = doc.context.register(
    doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [50, 500, 250, 540],
      Border: [0, 0, 0],
      Dest: [p2.ref, PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull],
    }),
  );
  p1.node.set(PDFName.of('Annots'), doc.context.obj([annot]));
  const file = path.join(os.tmpdir(), `feder-link-${Date.now()}.pdf`);
  fs.writeFileSync(file, await doc.save());
  return file;
}

async function fingerTap(page: Page, x: number, y: number) {
  await page.evaluate(
    ({ x, y }) => {
      const host = document.querySelector('.feder-editor')!;
      for (const type of ['pointerdown', 'pointerup']) {
        host.dispatchEvent(
          new PointerEvent(type, {
            pointerType: 'touch',
            pointerId: 77,
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

test('Links in importierten PDFs springen zur Zielseite', async ({ page }) => {
  const pdf = await linkedPdf();
  await page.goto('/');
  await page.getByRole('button', { name: 'Neu', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'PDF importieren …' }).click();
  await (await chooser).setFiles(pdf);
  await expect(page.locator('.pager')).toHaveText('1 / 2');
  const box = (await page.locator('.feder-page').first().boundingBox())!;
  const k = box.width / 420;
  // Link liegt im PDF bei y 500..540 (von unten) → Anzeige y 55..95
  await fingerTap(page, box.x + 150 * k, box.y + 75 * k);
  await expect(page.locator('.pager')).toHaveText('2 / 2');
});

test('Dokument scannen fügt eine entzerrte Seite ein', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Neues Notizbuch' }).click();
  await page.getByRole('button', { name: 'Notizbuch anlegen' }).click();
  await expect(page.locator('.feder-page').first()).toBeVisible();
  const png = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    const g = c.getContext('2d')!;
    g.fillStyle = '#8a8a8a';
    g.fillRect(0, 0, 400, 300);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(40, 30);
    g.lineTo(370, 50);
    g.lineTo(350, 280);
    g.lineTo(30, 260);
    g.fill();
    const b = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    return Array.from(new Uint8Array(await b!.arrayBuffer()));
  });
  const file = path.join(os.tmpdir(), `feder-scan-${Date.now()}.png`);
  fs.writeFileSync(file, Buffer.from(png));
  await page.getByRole('button', { name: 'Weitere Optionen' }).click();
  await page.getByRole('menuitem', { name: 'Dokument scannen …' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Bild wählen' }).click();
  await (await chooser).setFiles(file);
  await page.getByRole('button', { name: 'Entzerren' }).click();
  await expect(page.getByAltText('Entzerrter Scan')).toBeVisible();
  await page.getByRole('button', { name: 'Schwarzweiß' }).click();
  await page.getByRole('button', { name: 'Als Seite einfügen' }).click();
  await expect(page.locator('.pager')).toHaveText('2 / 2');
});

test('Eigene Vorlage aus einem PDF', async ({ page }) => {
  const pdf = await linkedPdf();
  await page.goto('/');
  await page.getByRole('button', { name: 'Neues Notizbuch' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Aus PDF oder Bild' }).click();
  await (await chooser).setFiles(pdf);
  await expect(page.getByRole('listbox', { name: 'Eigene Vorlagen' }).getByRole('option')).toHaveCount(2);
  await page.getByRole('button', { name: 'Notizbuch anlegen' }).click();
  await expect(page.locator('.feder-page').first()).toBeVisible();
  const size = await page
    .locator('.feder-page')
    .first()
    .evaluate((el) => (el as HTMLElement).dataset.w);
  expect(size).toBe('420');
});
