import { expect, test } from '@playwright/test';
import { t } from '../../support/i18n.ts';

// A 1×1 transparent PNG: a real image the browser can draw.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test('owner uploads the club logo, sees it in the header, then removes it', async ({ page }) => {
  await page.goto('/settings/organization');

  await page.getByLabel(t('orgSettings.logoUpload')).setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: PNG,
  });

  // The preview in settings, named after the organization.
  const altEnd = t('orgSettings.logoAlt', { name: '' }).trim();
  await expect(page.getByRole('img', { name: new RegExp(`${altEnd}$`) })).toBeVisible();
  // The header shows the logo in place of the Gatefit mark.
  await expect(page.getByRole('banner').locator('img')).toHaveAttribute(
    'src',
    /\/api\/v1\/files\//,
  );

  // Kept by the API: still there after a reload.
  await page.reload();
  await expect(page.getByRole('button', { name: t('orgSettings.logoReplace') })).toBeVisible();

  await page.getByRole('button', { name: t('orgSettings.logoRemove') }).click();
  await expect(page.getByText(t('orgSettings.logoNone'))).toBeVisible();
  await expect(page.getByRole('banner').locator('img')).toHaveCount(0);
});
