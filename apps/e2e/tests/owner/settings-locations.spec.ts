import { expect, test } from '@playwright/test';
import { t } from '../../support/i18n.ts';

// Everything under tests/owner runs as the owner signed in by staff-auth.spec.ts.

test('owner adds a location in settings', async ({ page }) => {
  const name = `E2E ${Date.now().toString(36)}`;

  await page.goto('/settings/locations');
  await page.getByRole('button', { name: t('locations.add') }).click();

  const dialog = page.getByRole('dialog', { name: t('locations.add') });
  await dialog.getByLabel(t('locations.name')).fill(name);
  await dialog.getByLabel(t('locations.address')).fill('Toshkent, Mirobod tumani');
  await dialog.getByRole('button', { name: t('common.save') }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('listitem').filter({ hasText: name })).toBeVisible();

  // Saved by the API, not just shown: still there after a reload.
  await page.reload();
  await expect(page.getByRole('listitem').filter({ hasText: name })).toBeVisible();
});
