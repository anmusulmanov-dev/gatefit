import { expect, test } from '@playwright/test';
import { DESK_MEMBER, memberUrl } from '../../support/env.ts';
import { t } from '../../support/i18n.ts';

// Without SMS: the receptionist gets a sign-in code on the member's card and reads it out;
// the member signs in to the member app with it.

test('a member signs in to the app with a code from the front desk', async ({ page, browser }) => {
  await page.goto('/members/new');
  await page.getByLabel(t('members.fields.lastName'), { exact: true }).fill(DESK_MEMBER.lastName);
  await page.getByLabel(t('members.fields.firstName'), { exact: true }).fill(DESK_MEMBER.firstName);
  await page.getByLabel(t('members.fields.phone'), { exact: true }).fill(DESK_MEMBER.phone);
  await page.getByRole('button', { name: t('common.save') }).click();
  await expect(page).toHaveURL(/\/members\/[0-9a-f-]{36}$/);

  await page.getByRole('button', { name: t('members.signInCode.action') }).click();
  const dialog = page.getByRole('dialog', { name: t('members.signInCode.title') });
  const code = (await dialog.getByText(/^\d{6}$/).textContent()) ?? '';
  expect(code).toMatch(/^\d{6}$/);
  await dialog.getByRole('button', { name: t('members.signInCode.close') }).click();

  // The member's own phone: a browser with nobody signed in.
  const member = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const app = await member.newPage();
  await app.goto(`${memberUrl}/login`);
  await app.getByLabel(t('auth.phone'), { exact: true }).fill(DESK_MEMBER.phone);
  await app.getByRole('button', { name: t('auth.haveDeskCode') }).click();
  await app.getByLabel(t('auth.deskCode'), { exact: true }).fill(code);
  await app.getByRole('button', { name: t('auth.signIn'), exact: true }).click();

  await expect(app).not.toHaveURL(/\/login/);
  await member.close();
});
