import { expect, test } from '@playwright/test';
import { SALE_MEMBER } from '../../support/env.ts';
import { t } from '../../support/i18n.ts';

// Acceptance criterion 2 (docs/TZ.md section 11): the desk adds a member, sells a
// membership and takes the payment within 60 seconds. The member is used by the member
// app and offline reception flows that follow.

test('the desk adds a member, sells a membership and takes the payment in 60 s', async ({
  page,
}) => {
  const started = Date.now();

  await page.goto('/members/new');
  await page.getByLabel(t('members.fields.lastName'), { exact: true }).fill(SALE_MEMBER.lastName);
  await page.getByLabel(t('members.fields.firstName'), { exact: true }).fill(SALE_MEMBER.firstName);
  await page.getByLabel(t('members.fields.phone'), { exact: true }).fill(SALE_MEMBER.phone);
  await page.getByRole('button', { name: t('common.save') }).click();
  await expect(page).toHaveURL(/\/members\/[0-9a-f-]{36}$/);

  await page.getByRole('button', { name: t('memberships.sell.action') }).click();
  const dialog = page.getByRole('dialog', { name: t('memberships.sell.title') });
  await dialog
    .getByLabel(t('memberships.sell.plan'), { exact: true })
    .selectOption({ label: 'Oylik' });
  // A card payment needs no open cash shift.
  await dialog
    .getByLabel(t('billing.method'), { exact: true })
    .selectOption({ label: t('billing.methods.card_terminal') });
  const [before, after] = t('billing.sale.sellAndPay').split('{amount}');
  await dialog
    .getByRole('button', { name: new RegExp(`^${escape(before ?? '')}.+${escape(after ?? '')}$`) })
    .click();

  await expect(page.getByText(t('billing.sale.doneTitle'))).toBeVisible();
  expect(Date.now() - started).toBeLessThan(60_000);
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
