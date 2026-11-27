'use client';

import {
  type DeskPaymentMethod,
  localDate,
  newIdempotencyKey,
  type ProductDto,
  type ShopSaleDto,
} from '@gatefit/shared';
import { useTranslations } from 'next-intl';
import { type SubmitEvent, useState } from 'react';

import { Field, FormActions, FormMessage } from '@/components/form';
import { Empty, LoadFailed, Loading } from '@/components/page-states';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import { useApiAction } from '@/lib/use-api';

import {
  compareMinor,
  fromTyped,
  openReceipt,
  PaymentMethodSelect,
  toTyped,
} from '../billing/billing-ui';
import { useMoney } from '../plans/plan-ui';
import { type LineDraft, LineFields, useProducts, useUnitLabel, wholeNumber } from './shop-ui';

interface CartLine {
  product: ProductDto;
  unitId: string;
  quantity: number;
}

const forSale = (product: ProductDto) =>
  product.units.filter((unit) => unit.isActive && unit.priceMinor !== null);

/**
 * Sells goods at the desk (docs/TZ.md F-4.8): pick products into a cart, then take the
 * payment. A member may pay part and owe the rest; anyone else pays in full.
 */
export function ShopSaleDialog({
  location,
  member,
  onClose,
  onDone,
}: {
  location: { id: string; timezone: string };
  member: { id: string; firstName: string; lastName: string } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations();
  const money = useMoney();
  const unitLabel = useUnitLabel();
  const action = useApiAction();
  const products = useProducts(location.id, true);
  // One sale, one key: a double click or a retry cannot sell twice.
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [draft, setDraft] = useState<LineDraft>({ productId: '', unitId: '', quantity: '1' });
  const [cart, setCart] = useState<CartLine[]>([]);
  const [toMember, setToMember] = useState(member !== null);
  const [method, setMethod] = useState<DeskPaymentMethod>('cash');
  /** null: the full total. */
  const [amount, setAmount] = useState<string | null>(null);
  const [dueOn, setDueOn] = useState('');
  const [sale, setSale] = useState<ShopSaleDto | null>(null);

  const available = (products.data?.items ?? []).filter((item) => forSale(item).length > 0);
  const currency = available[0]?.currency ?? 'UZS';
  const priceOf = (line: CartLine) => {
    const unit = line.product.units.find((item) => item.id === line.unitId);
    return BigInt(unit?.priceMinor ?? '0') * BigInt(line.quantity);
  };
  const total = cart.reduce((sum, line) => sum + priceOf(line), 0n).toString();
  const typed = toMember && amount !== null ? amount : toTyped(total, currency);
  const amountMinor = fromTyped(typed, currency);
  const leavesDebt = amountMinor !== null && compareMinor(amountMinor, total) < 0;
  const today = localDate(new Date(), location.timezone);

  function addLine() {
    const product = available.find((item) => item.id === draft.productId);
    const quantity = wholeNumber(draft.quantity);
    if (!product || !draft.unitId || quantity === null) {
      action.fail(t('shop.line.invalid'));
      return;
    }
    action.reset();
    setCart((lines) => [...lines, { product, unitId: draft.unitId, quantity }]);
    setDraft({ productId: '', unitId: '', quantity: '1' });
    setAmount(null);
  }

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cart.length === 0) {
      action.fail(t('shop.sale.empty'));
      return;
    }
    if (amountMinor === null || compareMinor(amountMinor, total) > 0) {
      action.fail(t('billing.invalidAmount'));
      return;
    }
    if (!toMember && leavesDebt) {
      action.fail(t('errors.WALK_IN_FULL_PAYMENT'));
      return;
    }
    action.run(
      () =>
        api.post<ShopSaleDto>(
          '/shop/sales',
          {
            locationId: location.id,
            ...(toMember && member ? { memberId: member.id } : {}),
            lines: cart.map((line) => ({
              productId: line.product.id,
              unitId: line.unitId,
              quantity: line.quantity,
            })),
            ...(amountMinor !== '0' ? { payment: { method, amountMinor } } : {}),
            ...(leavesDebt && dueOn ? { dueOn } : {}),
          },
          { idempotencyKey },
        ),
      setSale,
    );
  }

  if (sale) {
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onDone();
        }}
        title={t('shop.sale.doneTitle')}
      >
        <p className="text-sm">
          {t('billing.sale.paid', {
            paid: money(sale.invoice.paidMinor, sale.invoice.currency),
            total: money(sale.invoice.totalMinor, sale.invoice.currency),
          })}
          {sale.invoice.balanceMinor !== '0' &&
            ` · ${t('billing.sale.owes', { amount: money(sale.invoice.balanceMinor, sale.invoice.currency) })}`}
        </p>
        <FormActions>
          {sale.payment && (
            <Button
              variant="outline"
              onClick={() => {
                if (sale.payment) openReceipt(sale.payment.id);
              }}
            >
              {t('billing.receipt.print')}
            </Button>
          )}
          <Button onClick={onDone}>{t('common.close')}</Button>
        </FormActions>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('shop.sale.title')}
      className="max-w-2xl"
    >
      {products.error ? (
        <LoadFailed onRetry={products.reload} />
      ) : !products.data ? (
        <Loading />
      ) : available.length === 0 ? (
        <Empty>{t('shop.sale.noProducts')}</Empty>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field id="shop-sale-buyer" label={t('shop.sale.buyer')}>
            <Select
              id="shop-sale-buyer"
              value={toMember ? 'member' : 'walk-in'}
              disabled={!member}
              onChange={(event) => {
                setToMember(event.target.value === 'member');
              }}
            >
              {member && (
                <option value="member">
                  {member.lastName} {member.firstName}
                </option>
              )}
              <option value="walk-in">{t('shop.walkIn')}</option>
            </Select>
          </Field>

          <fieldset className="flex flex-col gap-3 rounded-lg border bg-card p-3 shadow-card">
            <legend className="px-1 text-sm font-medium">{t('shop.sale.addTitle')}</legend>
            <LineFields
              idPrefix="shop-sale"
              products={available}
              value={draft}
              onChange={setDraft}
              units={forSale}
            />
            <div>
              <Button type="button" variant="outline" onClick={addLine}>
                {t('shop.sale.add')}
              </Button>
            </div>
          </fieldset>

          {cart.length === 0 ? (
            <Empty>{t('shop.sale.empty')}</Empty>
          ) : (
            <ul
              aria-label={t('shop.sale.cart')}
              className="flex flex-col divide-y rounded-lg border bg-card text-sm"
            >
              {cart.map((line, index) => {
                const unit = line.product.units.find((item) => item.id === line.unitId);
                return (
                  <li
                    key={`${line.product.id}-${line.unitId}-${String(index)}`}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <span>
                      {line.product.name}
                      {unit && ` · ${unitLabel(unit, line.product.baseUnit)}`} × {line.quantity}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-medium tabular-nums">
                        {money(priceOf(line).toString(), line.product.currency)}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setCart((lines) => lines.filter((_, at) => at !== index));
                          setAmount(null);
                        }}
                      >
                        {t('shop.sale.remove')}
                      </Button>
                    </span>
                  </li>
                );
              })}
              <li className="flex justify-between gap-3 px-3 py-2 font-semibold">
                <span>{t('billing.receipt.total')}</span>
                <span className="tabular-nums">{money(total, currency)}</span>
              </li>
            </ul>
          )}

          {cart.length > 0 && (
            <fieldset className="flex flex-col gap-3 rounded-lg border bg-card p-3 shadow-card">
              <legend className="px-1 text-sm font-medium">{t('billing.sale.payment')}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="shop-sale-method" label={t('billing.method')}>
                  <PaymentMethodSelect id="shop-sale-method" value={method} onChange={setMethod} />
                </Field>
                <Field
                  id="shop-sale-amount"
                  label={t('billing.amount')}
                  hint={
                    toMember ? t('billing.amountHint', { currency }) : t('shop.sale.walkInFull')
                  }
                >
                  <Input
                    id="shop-sale-amount"
                    inputMode="decimal"
                    value={typed}
                    disabled={!toMember}
                    onChange={(event) => {
                      setAmount(event.target.value);
                    }}
                  />
                </Field>
              </div>
              {toMember && leavesDebt && (
                <>
                  <p className="text-sm text-warn-ink">
                    {t('shop.sale.debt', {
                      amount: money((BigInt(total) - BigInt(amountMinor)).toString(), currency),
                    })}
                  </p>
                  <Field
                    id="shop-sale-due"
                    label={t('billing.dueOn')}
                    optional={t('common.optional')}
                  >
                    <Input
                      id="shop-sale-due"
                      type="date"
                      className="w-48"
                      value={dueOn}
                      min={today}
                      onChange={(event) => {
                        setDueOn(event.target.value);
                      }}
                    />
                  </Field>
                </>
              )}
            </fieldset>
          )}

          <FormMessage error={action.error} />
          <FormActions>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={action.pending || cart.length === 0}>
              {amountMinor !== null && amountMinor !== '0'
                ? t('billing.sale.sellAndPay', { amount: money(amountMinor, currency) })
                : t('shop.sale.onCredit')}
            </Button>
          </FormActions>
        </form>
      )}
    </Dialog>
  );
}
