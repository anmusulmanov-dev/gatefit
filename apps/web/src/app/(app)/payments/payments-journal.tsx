'use client';

import {
  addDays,
  localDate,
  type Page,
  PAYMENT_METHODS,
  type PaymentDto,
  type PaymentMethod,
  startOfLocalDay,
} from '@gatefit/shared';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Field } from '@/components/form';
import { Empty, LoadFailed, Loading } from '@/components/page-states';
import { useCan } from '@/components/staff-session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useApiGet } from '@/lib/use-api';

import { openReceipt, useMethodName } from '../billing/billing-ui';
import { RefundDialog } from '../billing/refund-dialog';
import type { MemberScope } from '../members/member-scope';
import { useMemberLocations } from '../members/member-ui';
import { useMoney } from '../plans/plan-ui';

/** The payments journal (docs/TZ.md F-4.1, F-4.3): a day's payments at a location, with refunds. */
export function PaymentsJournal({ scope }: { scope: MemberScope }) {
  const t = useTranslations();
  const format = useFormatter();
  const canRefund = useCan('payments.refund');
  const locations = useMemberLocations(scope);
  const money = useMoney();
  const methodName = useMethodName();
  const [locationId, setLocationId] = useState(scope.currentLocationId ?? '');
  const location =
    locations.data?.find((item) => item.id === locationId) ?? locations.data?.[0] ?? null;
  const timeZone = location?.timezone ?? 'UTC';
  const today = localDate(new Date(), timeZone);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [method, setMethod] = useState<PaymentMethod | ''>('');
  const [refunding, setRefunding] = useState<PaymentDto | null>(null);

  const fromDay = from || today;
  const toDay = to || fromDay;
  const query = new URLSearchParams({ limit: '100' });
  // Day bounds in the location's own time zone.
  query.set('from', startOfLocalDay(fromDay, timeZone).toISOString());
  query.set('to', startOfLocalDay(addDays(toDay, 1), timeZone).toISOString());
  if (location) query.set('locationId', location.id);
  if (method) query.set('method', method);
  const payments = useApiGet<Page<PaymentDto>>(`/payments?${query.toString()}`);

  const items = payments.data?.items ?? [];
  const currency = items[0]?.currency;
  const total = items.reduce(
    (sum, item) => sum + BigInt(item.amountMinor) - BigInt(item.refundedMinor),
    0n,
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('billing.journal.title')}</h1>
      <div className="grid gap-3 sm:grid-cols-4">
        {(locations.data?.length ?? 0) > 1 && (
          <Field id="journal-location" label={t('members.location')}>
            <Select
              id="journal-location"
              value={location?.id ?? ''}
              onChange={(event) => {
                setLocationId(event.target.value);
              }}
            >
              {locations.data?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field id="journal-from" label={t('billing.journal.from')}>
          <Input
            id="journal-from"
            type="date"
            value={fromDay}
            onChange={(event) => {
              setFrom(event.target.value);
            }}
          />
        </Field>
        <Field id="journal-to" label={t('billing.journal.to')}>
          <Input
            id="journal-to"
            type="date"
            value={toDay}
            min={fromDay}
            onChange={(event) => {
              setTo(event.target.value);
            }}
          />
        </Field>
        <Field id="journal-method" label={t('billing.method')}>
          <Select
            id="journal-method"
            value={method}
            onChange={(event) => {
              setMethod(event.target.value as PaymentMethod | '');
            }}
          >
            <option value="">{t('billing.journal.allMethods')}</option>
            {PAYMENT_METHODS.filter((value) => value !== 'online').map((value) => (
              <option key={value} value={value}>
                {methodName(value)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {payments.error ? (
        <LoadFailed onRetry={payments.reload} />
      ) : !payments.data ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty>{t('billing.journal.empty')}</Empty>
      ) : (
        <>
          {currency && (
            <p className="text-sm">
              {t('billing.journal.total', {
                count: items.length,
                amount: money(total.toString(), currency),
              })}
            </p>
          )}
          <ul className="flex flex-col divide-y rounded-lg border" aria-busy={payments.loading}>
            {items.map((payment) => (
              <li
                key={payment.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex min-w-0 flex-col gap-1 text-sm">
                  <span className="font-medium">
                    {money(payment.amountMinor, payment.currency)} · {methodName(payment.method)}
                  </span>
                  <span className="text-muted-foreground">
                    {format.dateTime(new Date(payment.createdAt), { timeStyle: 'short' })}
                    {' · '}
                    <Link href={`/members/${payment.member.id}`} className="hover:underline">
                      {payment.member.lastName} {payment.member.firstName}
                    </Link>
                    {' · '}
                    {t('billing.invoiceNumber', { number: payment.invoice.number })}
                    {payment.refundedMinor !== '0' &&
                      ` · ${t('billing.refunded', { amount: money(payment.refundedMinor, payment.currency) })}`}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      openReceipt(payment.id);
                    }}
                  >
                    {t('billing.receipt.print')}
                  </Button>
                  {canRefund && payment.refundedMinor !== payment.amountMinor && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setRefunding(payment);
                      }}
                    >
                      {t('billing.refund.action')}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {refunding && (
        <RefundDialog
          payment={refunding}
          onClose={() => {
            setRefunding(null);
          }}
          onDone={() => {
            setRefunding(null);
            payments.reload();
          }}
        />
      )}
    </div>
  );
}
