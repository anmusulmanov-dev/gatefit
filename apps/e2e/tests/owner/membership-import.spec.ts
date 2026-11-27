import { expect, test } from '@playwright/test';
import { t } from '../../support/i18n.ts';

// Moving a gym in (docs/TZ.md F-1.4.1): its members first, then the memberships they hold in
// the old system, with their own dates and what is still owed.

const STAMP = String(Date.now()).slice(-7);
const PHONE = `+99893${STAMP}`;
const LAST_NAME = `Ko'chirilgan${STAMP}`;

/** A calendar day in Tashkent, `days` from today, as `DD.MM.YYYY`. */
function tashkentDay(days: number): string {
  const day = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(day);
  return iso.split('-').reverse().join('.');
}

const csv = (rows: string[][]) => Buffer.from(rows.map((row) => row.join(',')).join('\n'), 'utf8');

test('the owner imports members, then their running memberships with a debt', async ({ page }) => {
  // The members, as the old system exported them.
  await page.goto('/members/import');
  await page.getByLabel(t('members.importWizard.chooseFile'), { exact: true }).setInputFiles({
    name: 'members.csv',
    mimeType: 'text/csv',
    buffer: csv([
      [
        t('memberFile.columns.lastName'),
        t('memberFile.columns.firstName'),
        t('memberFile.columns.phone'),
      ],
      [LAST_NAME, 'Aziz', PHONE],
    ]),
  });
  await page.getByRole('button', { name: t('members.importWizard.upload') }).click();
  await page.getByRole('button', { name: t('members.importWizard.validate') }).click();
  await page.getByRole('button', { name: t('members.importWizard.start', { count: 1 }) }).click();
  await expect(page.getByText(t('members.importWizard.finished', { created: 1 }))).toBeVisible({
    timeout: 30_000,
  });

  // Their memberships: started 20 days ago, 10 days left, 100 000 still owed.
  await page.goto('/members');
  await page.getByRole('link', { name: t('membershipImport.open') }).click();
  await expect(page.getByRole('heading', { name: t('membershipImport.title') })).toBeVisible();
  const columns = (field: string) => t(`membershipFile.columns.${field}`);
  await page.getByLabel(t('members.importWizard.chooseFile'), { exact: true }).setInputFiles({
    name: 'memberships.csv',
    mimeType: 'text/csv',
    buffer: csv([
      [columns('phone'), columns('plan'), columns('startsOn'), columns('endsOn'), columns('debt')],
      [PHONE, 'Oylik', tashkentDay(-20), tashkentDay(10), '100000'],
    ]),
  });
  await page.getByRole('button', { name: t('members.importWizard.upload') }).click();
  await page.getByRole('button', { name: t('members.importWizard.validate') }).click();
  await expect(page.getByText(t('members.importWizard.valid', { count: 1 }))).toBeVisible();
  await expect(page.getByText(/100[\s,.]?000/)).toBeVisible();
  await page.getByRole('button', { name: t('membershipImport.start', { count: 1 }) }).click();
  await expect(page.getByText(t('membershipImport.finished', { created: 1 }))).toBeVisible({
    timeout: 30_000,
  });

  // The member's card shows the membership as brought in.
  await page.goto('/members');
  await page.getByLabel(t('members.search')).fill(PHONE);
  await page.getByRole('link', { name: new RegExp(LAST_NAME) }).click();
  await expect(page.getByText(t('memberships.imported'))).toBeVisible();
  await expect(page.getByText('Oylik', { exact: true }).first()).toBeVisible();
});
