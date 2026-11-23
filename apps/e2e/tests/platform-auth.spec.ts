import { expect, test } from '@playwright/test';
import { OPERATOR, platformUrl } from '../support/env.ts';
import { t } from '../support/i18n.ts';
import { completeTotpSetup, submitCredentials } from '../support/sign-in.ts';

// admin.localhost: the seeded operator has a password but no authenticator yet.

test('operator signs in to the platform console', async ({ page }) => {
  await page.goto(`${platformUrl}/platform/login`);
  await submitCredentials(page, OPERATOR);
  // Operators always need an authenticator: the first sign-in sets it up.
  await completeTotpSetup(page);

  await expect(page).toHaveURL(/\/platform\/organizations/);
  await expect(page.getByRole('heading', { name: t('platform.nav.organizations') })).toBeVisible();
  await expect(page.getByText('Gatefit Demo')).toBeVisible();
});
