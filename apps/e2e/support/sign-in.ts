import { expect, type Page } from '@playwright/test';
import { t } from './i18n.ts';
import { totpCode } from './totp.ts';

/** Fills the phone and password step of the staff or operator sign-in form. */
export async function submitCredentials(
  page: Page,
  account: { phone: string; password: string },
): Promise<void> {
  await page.getByLabel(t('auth.phone')).fill(account.phone);
  await page.getByLabel(t('auth.password')).fill(account.password);
  await page.getByRole('button', { name: t('auth.signIn'), exact: true }).click();
}

/**
 * Completes the authenticator setup step the way a person with an app would: reads the
 * secret shown on screen and types the current code. Returns the secret and the used code.
 */
export async function completeTotpSetup(page: Page): Promise<{ secret: string; code: string }> {
  await expect(page.getByText(t('auth.totpSetupTitle'))).toBeVisible();
  const secret = (await page.locator('code').textContent())?.trim() ?? '';
  expect(secret).toMatch(/^[A-Z2-7]+=*$/);

  const code = totpCode(secret);
  await page.getByLabel(t('auth.totpCode')).fill(code);
  await page.getByRole('button', { name: t('auth.confirm') }).click();
  return { secret, code };
}
