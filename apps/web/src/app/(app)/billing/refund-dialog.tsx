'use client';

import { newIdempotencyKey, type PaymentDto } from '@gatefit/shared';
import { useTranslations } from 'next-intl';
import { type SubmitEvent, useState } from 'react';

import { Field, FormActions, FormMessage } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useApiAction } from '@/lib/use-api';

import { useMoney } from '../plans/plan-ui';
import { compareMinor, fromTyped, toTyped } from './billing-ui';

/** Gives back part or all of a payment, with a reason (docs/TZ.md F-4.3). */
export function RefundDialog({
  payment,
  onClose,
  onDone,
}: {
  payment: PaymentDto;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations();
  const action = useApiAction();
  const money = useMoney();
  const [idempotencyKey] = useState(newIdempotencyKey);
  const left = (BigInt(payment.amountMinor) - BigInt(payment.refundedMinor)).toString();
  const [amount, setAmount] = useState(toTyped(left, payment.currency));
  const [reason, setReason] = useState('');

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountMinor = fromTyped(amount, payment.currency);
    if (amountMinor === null || amountMinor === '0' || !reason.trim()) {
      action.fail();
      return;
    }
    if (compareMinor(amountMinor, left) > 0) {
      action.fail(t('errors.REFUND_EXCEEDS_PAYMENT'));
      return;
    }
    action.run(
      () =>
        api.post(
          `/payments/${payment.id}/refund`,
          { amountMinor, reason: reason.trim() },
          { idempotencyKey },
        ),
      onDone,
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('billing.refund.title')}
      description={t('billing.refund.description', {
        left: money(left, payment.currency),
        method: t(`billing.methods.${payment.method}`),
      })}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field
          id="refund-amount"
          label={t('billing.amount')}
          hint={t('billing.amountHint', { currency: payment.currency })}
        >
          <Input
            id="refund-amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
          />
        </Field>
        <Field id="refund-reason" label={t('billing.refund.reason')}>
          <Input
            id="refund-reason"
            value={reason}
            maxLength={500}
            required
            autoFocus
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </Field>
        <p className="text-sm text-muted-foreground">{t('billing.refund.membershipHint')}</p>
        <FormMessage error={action.error} />
        <FormActions>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="destructive" disabled={action.pending}>
            {t('billing.refund.confirm')}
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}
