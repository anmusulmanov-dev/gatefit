'use client';

import {
  addDays,
  type DeskPaymentMethod,
  localDate,
  newIdempotencyKey,
  type Page,
  type PlanDto,
  type SaleDto,
  termEndDate,
} from '@gatefit/shared';
import { useTranslations } from 'next-intl';
import { type SubmitEvent, useState } from 'react';

import { Field, FormActions, FormMessage } from '@/components/form';
import { Empty, LoadFailed, Loading } from '@/components/page-states';
import { useCan } from '@/components/staff-session';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import { useApiAction, useApiGet } from '@/lib/use-api';

import {
  compareMinor,
  fromTyped,
  openReceipt,
  PaymentMethodSelect,
  toTyped,
} from '../../billing/billing-ui';
import { useCalendarDate, useMoney, usePlanSummary } from '../../plans/plan-ui';
import type { MemberScope } from '../member-scope';
import { useMemberLocations } from '../member-ui';

/**
 * Sells a plan and takes the payment in one step (docs/TZ.md acceptance criterion 2):
 * plan, amount (the full price by default), and a receipt at the end.
 */
export function SellDialog({
  memberId,
  homeLocationId,
  scope,
  onClose,
  onDone,
}: {
  memberId: string;
  homeLocationId: string;
  scope: MemberScope;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations();
  const canTakePayment = useCan('payments.accept');
  const action = useApiAction();
  const receipt = useApiAction();
  const plans = useApiGet<Page<PlanDto>>('/plans?active=true&limit=100');
  const locations = useMemberLocations(scope);
  const date = useCalendarDate();
  const money = useMoney();
  const summary = usePlanSummary();
  // One sale, one key: a double click or a retry after a lost answer cannot sell twice.
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [planId, setPlanId] = useState('');
  const [locationId, setLocationId] = useState(
    scope.organizationWide || scope.locationIds.includes(homeLocationId)
      ? homeLocationId
      : (scope.locationIds[0] ?? homeLocationId),
  );
  const [startsOn, setStartsOn] = useState('');
  const [method, setMethod] = useState<DeskPaymentMethod>('cash');
  /** null: the full price. */
  const [amount, setAmount] = useState<string | null>(null);
  const [dueOn, setDueOn] = useState('');
  const [sale, setSale] = useState<SaleDto | null>(null);
  const [smsSent, setSmsSent] = useState(false);

  const location = locations.data?.find((item) => item.id === locationId);
  const today = location ? localDate(new Date(), location.timezone) : null;
  const start = startsOn || today;
  const available = (plans.data?.items ?? []).filter(
    (item) =>
      item.restrictions.locationIds.length === 0 ||
      item.restrictions.locationIds.includes(locationId),
  );
  const plan = available.find((item) => item.id === planId) ?? available[0] ?? null;
  const endsOn = plan && start ? termEndDate(start, plan.durationValue, plan.durationUnit) : null;
  const free = plan?.priceMinor === '0';
  const typed = plan ? (amount ?? toTyped(plan.priceMinor, plan.currency)) : '';
  const amountMinor = plan ? fromTyped(typed, plan.currency) : null;
  const leavesDebt =
    plan !== null && amountMinor !== null && compareMinor(amountMinor, plan.priceMinor) < 0;

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!plan || (!free && canTakePayment && amountMinor === null)) {
      action.fail(plan ? t('billing.invalidAmount') : undefined);
      return;
    }
    if (amountMinor !== null && compareMinor(amountMinor, plan.priceMinor) > 0) {
      action.fail(t('errors.AMOUNT_EXCEEDS_BALANCE'));
      return;
    }
    action.run(
      () =>
        api.post<SaleDto>(
          `/members/${memberId}/memberships`,
          {
            planId: plan.id,
            locationId,
            ...(startsOn ? { startsOn } : {}),
            ...(!free && canTakePayment && amountMinor !== null
              ? { payment: { method, amountMinor } }
              : {}),
            ...(leavesDebt && dueOn ? { dueOn } : {}),
          },
          { idempotencyKey },
        ),
      setSale,
    );
  }

  if (sale) {
    const invoice = sale.invoice;
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onDone();
        }}
        title={t('billing.sale.doneTitle')}
      >
        <div className="flex flex-col gap-3 text-sm">
          <p>
            {t('billing.sale.sold', {
              plan: sale.membership.plan.name,
              from: date(sale.membership.startsOn),
              to: date(sale.membership.endsOn),
            })}
          </p>
          {invoice && (
            <p>
              {t('billing.sale.paid', {
                paid: money(invoice.paidMinor, invoice.currency),
                total: money(invoice.totalMinor, invoice.currency),
              })}
              {invoice.balanceMinor !== '0' &&
                ` · ${t('billing.sale.owes', { amount: money(invoice.balanceMinor, invoice.currency) })}`}
            </p>
          )}
          <FormMessage
            error={receipt.error}
            success={smsSent ? t('billing.receipt.smsSent') : null}
          />
        </div>
        <FormActions>
          {sale.payment && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  if (sale.payment) openReceipt(sale.payment.id);
                }}
              >
                {t('billing.receipt.print')}
              </Button>
              <Button
                variant="outline"
                disabled={receipt.pending || smsSent}
                onClick={() => {
                  receipt.run(
                    () => api.post(`/payments/${sale.payment?.id ?? ''}/receipt/sms`),
                    () => {
                      setSmsSent(true);
                    },
                  );
                }}
              >
                {t('billing.receipt.sms')}
              </Button>
            </>
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
      title={t('memberships.sell.title')}
    >
      {plans.error ? (
        <LoadFailed onRetry={plans.reload} />
      ) : !plans.data || !locations.data ? (
        <Loading />
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {locations.data.length > 1 && (
            <Field id="sell-location" label={t('memberships.sell.location')}>
              <Select
                id="sell-location"
                value={locationId}
                onChange={(event) => {
                  setLocationId(event.target.value);
                  setPlanId('');
                  setAmount(null);
                }}
              >
                {locations.data.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {available.length === 0 ? (
            <Empty>{t('memberships.sell.noPlans')}</Empty>
          ) : (
            <>
              <Field id="sell-plan" label={t('memberships.sell.plan')}>
                <Select
                  id="sell-plan"
                  value={plan?.id ?? ''}
                  autoFocus
                  onChange={(event) => {
                    setPlanId(event.target.value);
                    setAmount(null);
                  }}
                >
                  {available.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {plan && <p className="text-sm text-muted-foreground">{summary(plan)}</p>}
              <Field
                id="sell-start"
                label={t('memberships.sell.startsOn')}
                hint={endsOn ? t('memberships.sell.endsOn', { date: date(endsOn) }) : undefined}
              >
                <Input
                  id="sell-start"
                  type="date"
                  className="w-48"
                  value={start ?? ''}
                  min={today ? addDays(today, -31) : undefined}
                  max={today ? addDays(today, 90) : undefined}
                  onChange={(event) => {
                    setStartsOn(event.target.value);
                  }}
                />
              </Field>
              {plan && !free && canTakePayment && (
                <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
                  <legend className="px-1 text-sm font-medium">{t('billing.sale.payment')}</legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field id="sell-method" label={t('billing.method')}>
                      <PaymentMethodSelect id="sell-method" value={method} onChange={setMethod} />
                    </Field>
                    <Field
                      id="sell-amount"
                      label={t('billing.amount')}
                      hint={t('billing.amountHint', { currency: plan.currency })}
                    >
                      <Input
                        id="sell-amount"
                        inputMode="decimal"
                        value={typed}
                        onChange={(event) => {
                          setAmount(event.target.value);
                        }}
                      />
                    </Field>
                  </div>
                  {leavesDebt && (
                    <>
                      <p className="text-sm text-amber-800 dark:text-amber-300">
                        {t('billing.sale.debt', {
                          amount: money(
                            (BigInt(plan.priceMinor) - BigInt(amountMinor)).toString(),
                            plan.currency,
                          ),
                        })}
                      </p>
                      <Field
                        id="sell-due"
                        label={t('billing.dueOn')}
                        hint={t('billing.dueOnHint')}
                        optional={t('common.optional')}
                      >
                        <Input
                          id="sell-due"
                          type="date"
                          className="w-48"
                          value={dueOn}
                          min={today ?? undefined}
                          onChange={(event) => {
                            setDueOn(event.target.value);
                          }}
                        />
                      </Field>
                    </>
                  )}
                </fieldset>
              )}
            </>
          )}
          <FormMessage error={action.error} />
          <FormActions>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={action.pending || !plan}>
              {plan && !free && canTakePayment && amountMinor !== null && amountMinor !== '0'
                ? t('billing.sale.sellAndPay', { amount: money(amountMinor, plan.currency) })
                : t('memberships.sell.confirm')}
            </Button>
          </FormActions>
        </form>
      )}
    </Dialog>
  );
}
