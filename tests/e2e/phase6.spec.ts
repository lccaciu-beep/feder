import { expect, test } from '@playwright/test';

test('App-Sperre: Code festlegen, nach Neuladen entsperren', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Einstellungen' }).click();
  await page.getByRole('button', { name: 'Code festlegen' }).click();
  await page.getByLabel('Neuer Code').fill('1234');
  await page.getByLabel('Code wiederholen').fill('1234');
  await page.getByRole('button', { name: 'Code sichern' }).click();
  await expect(page.getByRole('button', { name: 'Sperre ausschalten' })).toBeVisible();

  await page.reload();
  const lock = page.getByRole('dialog', { name: 'Feder ist gesperrt' });
  await expect(lock).toBeVisible();
  for (const d of '9999') await lock.getByRole('button', { name: d, exact: true }).click();
  await expect(lock.getByText('Falscher Code.')).toBeVisible();
  for (const d of '1234') await lock.getByRole('button', { name: d, exact: true }).click();
  await expect(lock).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Dokumente' })).toBeVisible();
});
