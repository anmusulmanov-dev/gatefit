import { expect, test } from '@playwright/test';
import { MEMBER_STATE, memberUrl, SALE_MEMBER } from '../support/env.ts';
import { t } from '../support/i18n.ts';
import { smsCode, smsMark } from '../support/sms.ts';

// Acceptance criterion 3 (docs/TZ.md section 11): a member signs in with an SMS code and
// sees their entry QR code. The member was added and sold to by owner/reception-sale.spec.ts.

test('a member signs in with an SMS code and sees the QR code', async ({ page }) => {
  await page.goto(`${memberUrl}/login`);
  await page.getByLabel(t('auth.phone'), { exact: true }).fill(SALE_MEMBER.phone);
  const mark = smsMark();
  await page.getByRole('button', { name: t('auth.sendCode') }).click();

  const code = await smsCode(SALE_MEMBER.phone, mark);
  await page.getByLabel(t('auth.smsCode'), { exact: true }).fill(code);
  await page.getByRole('button', { name: t('auth.signIn'), exact: true }).click();

  await expect(page.getByText(t('member.qr.title'), { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: t('member.qr.alt') })).toBeVisible();

  await page.context().storageState({ path: MEMBER_STATE });

  // Back in the app (the phone was put away while the desk scanned the code): the
  // membership, and so the visits left, is asked for again.
  const refreshed = page.waitForRequest((sent) => sent.url().includes('/me/memberships'));
  // A string: this package has no DOM types.
  await page.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
  await refreshed;
});
