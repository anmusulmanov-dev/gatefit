import { expect, test } from '@playwright/test';
import { OWNER, OWNER_STATE } from '../support/env.ts';
import { t } from '../support/i18n.ts';
import { completeTotpSetup, submitCredentials } from '../support/sign-in.ts';
import { unusedTotpCode } from '../support/totp.ts';

// demo.localhost: the seeded owner has a password but no authenticator yet.

test('owner sets up an authenticator, then signs in with a code', async ({ page }) => {
  const home = page.getByRole('heading', { name: t('web.home.title') });

  await page.goto('/login');
  await submitCredentials(page, OWNER);
  // The owner role requires an authenticator: the first sign-in sets it up.
  const { secret, code } = await completeTotpSetup(page);
  await expect(home).toBeVisible();

  await page.getByRole('button', { name: t('auth.signOut') }).click();
  await expect(page).toHaveURL(/\/login$/);

  await submitCredentials(page, OWNER);
  await expect(page.getByText(t('auth.totpHint'))).toBeVisible();
  await page.getByLabel(t('auth.totpCode')).fill(unusedTotpCode(secret, code));
  await page.getByRole('button', { name: t('auth.confirm') }).click();
  await expect(home).toBeVisible();

  await page.context().storageState({ path: OWNER_STATE });
});

test('a wrong password is refused', async ({ page }) => {
  await page.goto('/login');
  await submitCredentials(page, { phone: OWNER.phone, password: 'not-the-password' });
  // Next.js keeps its own (empty) route announcer alert on the page too.
  await expect(
    page.getByRole('alert').filter({ hasText: t('errors.INVALID_CREDENTIALS') }),
  ).toBeVisible();
});
