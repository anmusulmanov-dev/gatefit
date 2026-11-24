'use client';

import {
  type DeskPaymentMethod,
  type InvoiceDto,
  newIdempotencyKey,
  type Page,
  type PaymentDto,
} from '@gatefit/shared';
import { useFormatter, useTranslations } from 'next-intl';
import { type SubmitEvent, useState } from 'react';

import { Field, FormActions, FormMessage } from '@/components/form';
import { Empty, LoadFailed, Loading } from '@/components/page-states';
import { useCan } from '@/components/staff-session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useApiAction, useApiGet } from '@/lib/use-api';

import {
  compareMinor,
  fromTyped,
  InvoiceStatusBadge,
  openReceipt,
  PaymentMethodSelect,
  toTyped,
  useItemLabel,
  useMethodName,
} from '../../billing/billing-ui';
import { RefundDialog } from '../../billing/refund-dialog';
import { useCalendarDate, useMoney } from '../../plans/plan-ui';

type Open = { kind: 'pay'; invoice: InvoiceDto } | { kind: 'refund'; payment: PaymentDto } | null;

/** A member's invoices and payments on their card: what is owed, paying it, refunds. */
export function BillingSection({
  memberId,
  archived,
  version,
  onChanged,
}: {
  memberId: string;
  archived: boolean;
  /** Changes when something on the card sold or charged, so the lists reload. */
  version: number;
  onChanged: () => void;
}) {
  const t = useTranslations();
  const format = useFormatter();
  const canAccept = useCan('payments.accept') && !archived;
  const canRefund = useCan('payments.refund');
  const invoices = useApiGet<Page<InvoiceDto>>(
    `/invoices?memberId=${memberId}&limit=100&v=${String(version)}`,
  );
  const payments = useApiGet<Page<PaymentDto>>(
    `/payments?memberId=${memberId}&limit=100&v=${String(version)}`,
  );
  const money = useMoney();
  const date = useCalendarDate();
  const methodName = useMethodName();
  const itemLabel = useItemLabel();
  const sms = useApiAction();
  const [smsSentFor, setSmsSentFor] = useState<string | null>(null);
  const [open, setOpen] = useState<Open>(null);

  const done = () => {
    setOpen(null);
    invoices.reload();
    payments.reload();
    onChanged();
  };
  const owed = (invoices.data?.items ?? []).reduce(
    (sum, invoice) => sum + BigInt(invoice.balanceMinor),
    0n,
  );
  const currency = invoices.data?.items[0]?.currency;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="billing-title">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="billing-title" className="text-lg font-semibold">
          {t('billing.member.title')}
        </h2>
        {owed > 0n && currency && (
          <Badge tone="warning">
            {t('billing.member.owes', { amount: money(owed.toString(), currency) })}
          </Badge>
        )}
      </div>

      {invoices.error ? (
        <LoadFailed onRetry={invoices.reload} />
      ) : !invoices.data ? (
        <Loading />
      ) : invoices.data.items.length === 0 ? (
        <Empty>{t('billing.member.noInvoices')}</Empty>
      ) : (
        <ul
          className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card shadow-card [&>li]:transition-colors [&>li:hover]:bg-muted/50"
          aria-busy={invoices.loading}
        >
          {invoices.data.items.map((invoice) => (
            <li
              key={invoice.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {t('billing.invoiceNumber', { number: invoice.number })}
                  </span>
                  <InvoiceStatusBadge status={invoice.status} />
                  {invoice.overdue && <Badge tone="warning">{t('billing.overdue')}</Badge>}
                </div>
                <span className="text-sm text-muted-foreground">
                  {[
                    invoice.items.map(itemLabel).join(', '),
                    date(invoice.createdAt.slice(0, 10)),
                    t('billing.member.amounts', {
                      total: money(invoice.totalMinor, invoice.currency),
                      paid: money(invoice.paidMinor, invoice.currency),
                    }),
                    invoice.dueOn && t('billing.member.dueOn', { date: date(invoice.dueOn) }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {invoice.voidReason && (
                  <span className="text-sm text-muted-foreground">
                    {t('billing.member.voided', { reason: invoice.voidReason })}
                  </span>
                )}
              </div>
              {canAccept && invoice.balanceMinor !== '0' && (
                <Button
                  size="sm"
                  onClick={() => {
                    setOpen({ kind: 'pay', invoice });
                  }}
                >
                  {t('billing.pay.action', {
                    amount: money(invoice.balanceMinor, invoice.currency),
                  })}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {payments.data && payments.data.items.length > 0 && (
        <>
          <h3 className="text-base font-semibold">{t('billing.member.payments')}</h3>
          <FormMessage
            error={sms.error}
            success={smsSentFor ? t('billing.receipt.smsSent') : null}
          />
          <ul
            className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card shadow-card [&>li]:transition-colors [&>li:hover]:bg-muted/50"
            aria-busy={payments.loading}
          >
            {payments.data.items.map((payment) => (
              <li
                key={payment.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex min-w-0 flex-col gap-1 text-sm">
                  <span className="font-medium">
                    {money(payment.amountMinor, payment.currency)} · {methodName(payment.method)}
                  </span>
                  <span className="text-muted-foreground">
                    {[
                      format.dateTime(new Date(payment.createdAt), {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      }),
                      t('billing.invoiceNumber', { number: payment.invoice.number }),
                      payment.refundedMinor !== '0' &&
                        t('billing.refunded', {
                          amount: money(payment.refundedMinor, payment.currency),
                        }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      openReceipt(payment.id);
                    }}
                  >
                    {t('billing.receipt.print')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={sms.pending}
                    onClick={() => {
                      setSmsSentFor(null);
                      sms.run(
                        () => api.post(`/payments/${payment.id}/receipt/sms`),
                        () => {
                          setSmsSentFor(payment.id);
                        },
                      );
                    }}
                  >
                    {t('billing.receipt.sms')}
                  </Button>
                  {canRefund && payment.refundedMinor !== payment.amountMinor && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setOpen({ kind: 'refund', payment });
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

      {open?.kind === 'pay' && (
        <PayDialog
          invoice={open.invoice}
          onClose={() => {
            setOpen(null);
          }}
          onDone={done}
        />
      )}
      {open?.kind === 'refund' && (
        <RefundDialog
          payment={open.payment}
          onClose={() => {
            setOpen(null);
          }}
          onDone={done}
        />
      )}
    </section>
  );
}

function PayDialog({
  invoice,
  onClose,
  onDone,
}: {
  invoice: InvoiceDto;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations();
  const action = useApiAction();
  const money = useMoney();
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [method, setMethod] = useState<DeskPaymentMethod>('cash');
  const [amount, setAmount] = useState(toTyped(invoice.balanceMinor, invoice.currency));

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountMinor = fromTyped(amount, invoice.currency);
    if (amountMinor === null || amountMinor === '0') {
      action.fail(t('billing.invalidAmount'));
      return;
    }
    if (compareMinor(amountMinor, invoice.balanceMinor) > 0) {
      action.fail(t('errors.AMOUNT_EXCEEDS_BALANCE'));
      return;
    }
    action.run(
      () =>
        api.post(`/invoices/${invoice.id}/payments`, { method, amountMinor }, { idempotencyKey }),
      onDone,
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('billing.pay.title', { number: invoice.number })}
      description={t('billing.pay.description', {
        amount: money(invoice.balanceMinor, invoice.currency),
      })}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="pay-method" label={t('billing.method')}>
            <PaymentMethodSelect id="pay-method" value={method} onChange={setMethod} />
          </Field>
          <Field
            id="pay-amount"
            label={t('billing.amount')}
            hint={t('billing.amountHint', { currency: invoice.currency })}
          >
            <Input
              id="pay-amount"
              inputMode="decimal"
              value={amount}
              autoFocus
              onChange={(event) => {
                setAmount(event.target.value);
              }}
            />
          </Field>
        </div>
        <FormMessage error={action.error} />
        <FormActions>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={action.pending}>
            {t('billing.pay.confirm')}
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}
