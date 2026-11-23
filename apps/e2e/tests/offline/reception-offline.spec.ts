import { expect, test } from '@playwright/test';
import { MEMBER_STATE, memberUrl, SALE_MEMBER } from '../../support/env.ts';
import { t } from '../../support/i18n.ts';

// Acceptance criterion 11 (docs/TZ.md section 11): with the internet down for 10 minutes the
// reception screen still checks entries, and sends them once it is back. Runs as the owner.
//
// The 10 minutes pass on the browser's clock, not the test's. The clock starts 10 minutes
// behind the real time, so after the outage the browser is at the real "now" again: the
// member's current code is fresh for it, and the API accepts the queued entry (it refuses
// entries from the future).

const OUTAGE_MS = 10 * 60 * 1000;

test('the reception screen checks a code offline for 10 minutes, then syncs', async ({
  page,
  browser,
}) => {
  await page.clock.install({ time: Date.now() - OUTAGE_MS });

  // The screen keeps a snapshot of the location's members for when the internet is gone.
  const snapshot = page.waitForResponse(
    (response) => response.url().includes('/api/v1/access/offline') && response.ok(),
  );
  await page.goto('/reception');
  await expect(page.getByRole('heading', { name: t('access.title') })).toBeVisible();
  await snapshot;

  await page.context().setOffline(true);
  await expect(page.getByText(t('access.offline.mode', { count: 0 }))).toBeVisible();
  await page.clock.fastForward(OUTAGE_MS);

  // The member's phone has its own connection: it shows the current code.
  // (Asked from a page: only the browser resolves *.localhost on every system.)
  const phone = await browser.newContext({ storageState: MEMBER_STATE });
  const app = await phone.newPage();
  await app.goto(memberUrl);
  const token = await app.evaluate(async () => {
    // The header picks the member session cookies, as the member app's own client does.
    const response = await fetch('/api/v1/me/qr', { headers: { 'x-gatefit-client': 'member' } });
    if (!response.ok) {
      throw new Error(`GET /me/qr: HTTP ${String(response.status)}`);
    }
    return ((await response.json()) as { token: string }).token;
  });
  await phone.close();

  const scan = page.getByLabel(t('access.scanLabel'));
  await scan.fill(token);
  await scan.press('Enter');
  await expect(page.getByText(t('access.allowed'))).toBeVisible();
  await expect(page.getByText(t('access.offline.decided'))).toBeVisible();
  await expect(page.getByText(t('access.offline.mode', { count: 1 }))).toBeVisible();

  // Back online: the queued entry goes to the API and the screen leaves offline mode.
  await page.context().setOffline(false);
  await expect(page.getByText(t('access.offline.mode', { count: 1 }))).toBeHidden();
  await expect(page.getByText(t('access.offline.sending', { count: 1 }))).toBeHidden({
    timeout: 15_000,
  });

  await page.goto('/check-ins');
  const row = page
    .getByRole('listitem')
    .filter({ hasText: SALE_MEMBER.firstName })
    .filter({ hasText: t('access.methods.qr_offline') });
  await expect(row).toBeVisible();
});
