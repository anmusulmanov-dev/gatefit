import { expect, test } from '@playwright/test';
import { organizationUrlOf, platformUrl } from '../../support/env.ts';
import { t } from '../../support/i18n.ts';
import { completeTotpSetup, submitCredentials } from '../../support/sign-in.ts';

// Acceptance criterion 1 (docs/TZ.md section 11): a new organization and location are set
// up within 30 minutes, with plans, staff and 500 members imported. Starts as the operator
// signed in by platform-auth.spec.ts, then continues as the new organization's owner.

/**
 * The club of one attempt. A retry (CI retries once) opens a club of its own: the failed
 * attempt may already have created the first one, and slugs and staff phones are taken.
 */
function clubFor(attempt: number) {
  return {
    name: `E2E Fitness ${String(attempt + 1)}`,
    slug: `e2e-fitness-${String(attempt + 1)}`,
    location: 'Markaz',
    owner: { phone: `+998900${String(attempt)}09902`, firstName: 'Jasur', lastName: 'Egamov' },
    ownerPassword: 'e2e-fitness-owner',
    staff: { phone: `+998900${String(attempt)}09903`, firstName: 'Malika', lastName: 'Karimova' },
  };
}
const MEMBERS = 500;

test('a new organization is set up with plans, staff and 500 members in 30 minutes', async ({
  page,
  browser,
}) => {
  test.setTimeout(5 * 60 * 1000);
  const CLUB = clubFor(test.info().retry);
  const started = Date.now();

  // The operator opens the organization with its first location and owner.
  await page.goto(`${platformUrl}/platform/organizations`);
  await page.getByRole('button', { name: t('platformOrgs.add') }).click();
  const create = page.getByRole('dialog', { name: t('platformOrgs.add') });
  // "Nomi" names the organization and, in its own group, the first location.
  await create.locator('#org-name').fill(CLUB.name);
  await create.getByLabel(t('platformOrgs.slug'), { exact: true }).fill(CLUB.slug);
  // Start allows 200 active members per location: the club brings 500.
  await create
    .getByLabel(t('platformOrgs.plan'), { exact: true })
    .selectOption({ label: 'Standard' });
  await create
    .getByRole('group', { name: t('platformOrgs.locationSection') })
    .getByLabel(t('locations.name'), { exact: true })
    .fill(CLUB.location);
  await create.getByLabel(t('staffSettings.phone'), { exact: true }).fill(CLUB.owner.phone);
  await create.getByLabel(t('staffSettings.firstName'), { exact: true }).fill(CLUB.owner.firstName);
  await create.getByLabel(t('staffSettings.lastName'), { exact: true }).fill(CLUB.owner.lastName);
  const temporaryPassword = await create
    .getByLabel(t('staffSettings.temporaryPassword'), { exact: true })
    .inputValue();
  await create.getByRole('button', { name: t('common.save') }).click();
  await expect(page).toHaveURL(/\/platform\/organizations\/[0-9a-f-]{36}$/);

  // The owner's first sign-in: a password of their own, then an authenticator.
  const club = await browser.newContext({ baseURL: organizationUrlOf(CLUB.slug) });
  const owner = await club.newPage();
  await owner.goto('/login');
  await submitCredentials(owner, { phone: CLUB.owner.phone, password: temporaryPassword });
  await owner.getByLabel(t('auth.newPassword'), { exact: true }).fill(CLUB.ownerPassword);
  await owner.getByLabel(t('auth.confirmPassword'), { exact: true }).fill(CLUB.ownerPassword);
  await owner.getByRole('button', { name: t('auth.confirm') }).click();
  await completeTotpSetup(owner);
  await expect(owner.getByRole('heading', { name: t('web.home.title') })).toBeVisible();

  // A plan to sell.
  await owner.goto('/plans');
  await owner.getByRole('button', { name: t('plans.add') }).click();
  const plan = owner.getByRole('dialog', { name: t('plans.add') });
  await plan.getByLabel(t('plans.fields.name'), { exact: true }).fill('Oylik');
  await plan.getByLabel(t('plans.fields.price'), { exact: true }).fill('300000');
  await plan.getByRole('button', { name: t('common.save') }).click();
  await expect(plan).toBeHidden();
  await expect(owner.getByRole('listitem').filter({ hasText: 'Oylik' })).toBeVisible();

  // A manager at the location.
  await owner.goto('/settings/staff');
  await owner.getByRole('button', { name: t('staffSettings.add') }).click();
  const staff = owner.getByRole('dialog', { name: t('staffSettings.add') });
  await staff.getByLabel(t('staffSettings.phone'), { exact: true }).fill(CLUB.staff.phone);
  await staff.getByLabel(t('staffSettings.firstName'), { exact: true }).fill(CLUB.staff.firstName);
  await staff.getByLabel(t('staffSettings.lastName'), { exact: true }).fill(CLUB.staff.lastName);
  await staff
    .getByLabel(t('staffSettings.role'), { exact: true })
    .selectOption({ label: t('roles.manager') });
  await staff.getByLabel(CLUB.location, { exact: true }).check();
  await staff.getByRole('button', { name: t('common.save') }).click();
  await expect(staff).toBeHidden();
  await expect(owner.getByRole('listitem').filter({ hasText: CLUB.staff.lastName })).toBeVisible();

  // The club's member list, from the file its previous system exported.
  await owner.goto('/members/import');
  await owner.getByLabel(t('members.importWizard.chooseFile'), { exact: true }).setInputFiles({
    name: 'members.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(membersCsv(MEMBERS), 'utf8'),
  });
  await owner.getByRole('button', { name: t('members.importWizard.upload') }).click();
  // The columns are recognized from their headers. A failed upload shows its error instead:
  // fail on it here rather than wait out the test timeout.
  const validate = owner.getByRole('button', { name: t('members.importWizard.validate') });
  await expect(validate).toBeVisible({ timeout: 30_000 });
  await validate.click();
  await expect(owner.getByText(t('members.importWizard.valid', { count: MEMBERS }))).toBeVisible();
  await owner
    .getByRole('button', { name: t('members.importWizard.start', { count: MEMBERS }) })
    .click();
  await expect(
    owner.getByText(t('members.importWizard.finished', { created: MEMBERS })),
  ).toBeVisible({ timeout: 60_000 });

  await club.close();
  expect(Date.now() - started).toBeLessThan(30 * 60 * 1000);
});

/** A CSV with the Uzbek column headers the import recognizes, and distinct valid phones. */
function membersCsv(count: number): string {
  const header = [
    t('memberFile.columns.lastName'),
    t('memberFile.columns.firstName'),
    t('memberFile.columns.phone'),
  ].join(',');
  const rows = Array.from(
    { length: count },
    (_, index) => `Aliyev,Member ${String(index + 1)},+99891${String(index).padStart(7, '0')}`,
  );
  return [header, ...rows].join('\n');
}
