'use client';

import type { ReceiptDto } from '@gatefit/shared';
import { useFormatter, useTranslations } from 'next-intl';

import { LoadFailed, Loading } from '@/components/page-states';
import { Button } from '@/components/ui/button';
import { useApiGet } from '@/lib/use-api';

import { useItemLabel, useMethodName } from '../../billing/billing-ui';
import { useMoney } from '../../plans/plan-ui';

/** A printable receipt (docs/TZ.md F-4.2), narrow enough for a receipt printer. */
export function Receipt({ id }: { id: string }) {
  const t = useTranslations('billing.receipt');
  const format = useFormatter();
  const money = useMoney();
  const itemLabel = useItemLabel();
  const methodName = useMethodName();
  const receipt = useApiGet<ReceiptDto>(`/payments/${id}/receipt`);

  if (receipt.error) {
    return <LoadFailed onRetry={receipt.reload} />;
  }
  if (!receipt.data) {
    return <Loading />;
  }
  const data = receipt.data;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex gap-2 print:hidden">
        <Button
          onClick={() => {
            window.print();
          }}
        >
          {t('print')}
        </Button>
      </div>
      <article className="w-full max-w-xs rounded-lg border p-4 font-mono text-sm print:max-w-none print:border-0 print:p-0">
        <header className="mb-3 text-center">
          <p className="font-semibold">{data.organization.name}</p>
          <p>{data.location.name}</p>
          {data.location.address && <p>{data.location.address}</p>}
        </header>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt>{t('number')}</dt>
          <dd className="text-right">{data.invoiceNumber}</dd>
          <dt>{t('date')}</dt>
          <dd className="text-right">
            {format.dateTime(new Date(data.paidAt), { dateStyle: 'short', timeStyle: 'short' })}
          </dd>
          <dt>{t('member')}</dt>
          <dd className="text-right">
            {data.member.lastName} {data.member.firstName}
          </dd>
        </dl>
        <hr className="my-3 border-dashed" />
        <ul className="flex flex-col gap-1">
          {data.items.map((item, index) => (
            <li key={index} className="flex justify-between gap-3">
              <span>
                {itemLabel(item)}
                {item.quantity > 1 && ` × ${String(item.quantity)}`}
              </span>
              <span>{money(item.totalMinor, data.currency)}</span>
            </li>
          ))}
        </ul>
        <hr className="my-3 border-dashed" />
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt>{t('total')}</dt>
          <dd className="text-right">{money(data.invoiceTotalMinor, data.currency)}</dd>
          <dt className="font-semibold">{t('paid', { method: methodName(data.method) })}</dt>
          <dd className="text-right font-semibold">{money(data.amountMinor, data.currency)}</dd>
          {data.balanceMinor !== '0' && (
            <>
              <dt>{t('balance')}</dt>
              <dd className="text-right">{money(data.balanceMinor, data.currency)}</dd>
            </>
          )}
        </dl>
        <p className="mt-4 text-center">{t('thanks')}</p>
      </article>
    </div>
  );
}
