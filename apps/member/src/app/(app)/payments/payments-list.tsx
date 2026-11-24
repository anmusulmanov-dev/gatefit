'use client';

import type { MemberPaymentsDto } from '@gatefit/shared';
import { useFormatter, useTranslations } from 'next-intl';

import { useApiGet } from '@/lib/use-api-get';

import { useMoneyText } from '../member-ui';

/** The member's payments, newest first, and what they still owe (docs/TZ.md F-9.1). */
export function PaymentsList() {
  const t = useTranslations();
  const format = useFormatter();
  const money = useMoneyText();
  const payments = useApiGet<MemberPaymentsDto>('/me/payments?limit=100');

  if (payments.error) {
    return <p className="text-sm text-muted-foreground">{t('member.loadFailed')}</p>;
  }
  if (!payments.data) {
    return <p className="text-sm text-muted-foreground">{t('member.loading')}</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {payments.data.owed.map((debt) => (
        <p key={debt.currency} className="rounded-md bg-warn-soft px-3 py-2 text-warn-ink">
          {t('member.payments.owed', { amount: money(debt.amountMinor, debt.currency) })}
        </p>
      ))}
      {payments.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('member.payments.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-card">
          {payments.data.items.map((payment) => (
            <li key={payment.id} className="flex flex-col gap-1 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">
                  {money(payment.amountMinor, payment.currency)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {format.dateTime(new Date(payment.createdAt), { dateStyle: 'short' })}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {[
                  t(`billing.methods.${payment.method}`),
                  payment.location.name,
                  t('billing.invoiceNumber', { number: payment.invoiceNumber }),
                  payment.refundedMinor !== '0' &&
                    t('billing.refunded', {
                      amount: money(payment.refundedMinor, payment.currency),
                    }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
