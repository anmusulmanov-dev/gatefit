import { expect, type Locator, test } from '@playwright/test';
import { t } from '../../support/i18n.ts';

// The shop (docs/TZ.md F-4.8): protein bought by the 5 kg bag is sold by the 30 g portion,
// and the stock goes down in grams.

const PRODUCT = `E2E Whey ${String(Date.now())}`;

test('the owner adds a product, receives a bag and sells portions to a walk-in', async ({
  page,
}) => {
  await page.goto('/shop');
  await expect(page.getByRole('heading', { name: t('shop.title') })).toBeVisible();

  // A product counted in grams: bought by the bag, sold by the portion.
  await page.getByRole('tab', { name: t('shop.tabs.products') }).click();
  await page.getByRole('button', { name: t('shop.products.add') }).click();
  const product = page.getByRole('dialog', { name: t('shop.product.titleNew') });
  await product.getByLabel(t('shop.product.name'), { exact: true }).fill(PRODUCT);
  await product
    .getByLabel(t('shop.product.baseUnit'), { exact: true })
    .selectOption({ label: t('shop.baseUnitNames.gram') });
  const unitName = product.getByLabel(t('shop.product.unitName'), { exact: true });
  const unitSize = product.getByLabel(
    t('shop.product.unitSize', { unit: t('shop.baseUnits.gram') }),
    { exact: true },
  );
  const unitPrice = product.getByLabel(t('shop.product.unitPrice', { currency: 'UZS' }), {
    exact: true,
  });
  await unitName.nth(0).fill('Qadoq 5 kg');
  await unitSize.nth(0).fill('5000');
  await product.getByRole('button', { name: t('shop.product.addUnit') }).click();
  await unitName.nth(1).fill('Porsiya');
  await unitSize.nth(1).fill('30');
  await unitPrice.nth(1).fill('15000');
  await product.getByRole('button', { name: t('common.save') }).click();
  await expect(product).toBeHidden();
  await expect(page.getByText(PRODUCT)).toBeVisible();

  // One 5 kg bag arrives for 350 000.
  await page.getByRole('tab', { name: t('shop.tabs.stock') }).click();
  await page.getByRole('button', { name: t('shop.stock.receive'), exact: true }).click();
  const receive = page.getByRole('dialog', { name: t('shop.receive.title') });
  await receive
    .getByLabel(t('shop.line.product'), { exact: true })
    .selectOption({ label: PRODUCT });
  await receive.getByLabel(t('shop.line.quantity'), { exact: true }).fill('1');
  await receive.getByLabel(t('shop.receive.cost'), { exact: true }).fill('350000');
  await receive.getByRole('button', { name: t('shop.receive.confirm') }).click();
  await expect(receive).toBeHidden();
  await expect(page.getByRole('listitem').filter({ hasText: PRODUCT }).first()).toContainText(
    t('shop.stock.kinds.receipt'),
  );

  // Three portions to someone who is not a member, by card.
  await page.getByRole('tab', { name: t('shop.tabs.sales') }).click();
  await page.getByRole('button', { name: t('shop.sale.action') }).click();
  const sale = page.getByRole('dialog', { name: t('shop.sale.title') });
  await expect(sale.getByLabel(t('shop.sale.buyer'), { exact: true })).toHaveValue('walk-in');
  await sale.getByLabel(t('shop.line.product'), { exact: true }).selectOption({ label: PRODUCT });
  await sale.getByLabel(t('shop.line.quantity'), { exact: true }).fill('3');
  await sale.getByRole('button', { name: t('shop.sale.add'), exact: true }).click();
  await sale
    .getByLabel(t('billing.method'), { exact: true })
    .selectOption({ label: t('billing.methods.card_terminal') });
  const [before, after] = t('billing.sale.sellAndPay').split('{amount}');
  await sale
    .getByRole('button', { name: new RegExp(`^${escape(before ?? '')}.+${escape(after ?? '')}$`) })
    .click();
  await expect(page.getByText(t('shop.sale.doneTitle'))).toBeVisible();
  await page.getByRole('button', { name: t('common.close') }).click();
  await expect(rowOf(page.getByRole('listitem'), t('shop.walkIn'))).toContainText(PRODUCT);

  // 5000 g less 3 × 30 g.
  await page.getByRole('tab', { name: t('shop.tabs.products') }).click();
  await expect(rowOf(page.getByRole('listitem'), PRODUCT)).toContainText(/4[\s,.]?910\s?g/);

  // The report shows the revenue of the sale.
  await page.getByRole('tab', { name: t('shop.tabs.report') }).click();
  await expect(page.getByRole('row').filter({ hasText: PRODUCT })).toContainText(/45[\s,.]?000/);
});

function rowOf(rows: Locator, text: string): Locator {
  return rows.filter({ hasText: text }).first();
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
