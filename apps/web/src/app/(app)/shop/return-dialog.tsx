'use client';

import { newIdempotencyKey, type ShopReturnInput, type ShopSaleDto } from '@gatefit/shared';
import { useTranslations } from 'next-intl';
import { type SubmitEvent, useState } from 'react';

import { CheckboxRow, Field, FormActions, FormMessage } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useApiAction } from '@/lib/use-api';

import { wholeNumber } from './shop-ui';

/**
 * Takes goods back from a sale: money goes back the way it was paid, or what is owed
 * shrinks. Goods fit to sell go back to stock; the rest is written off.
 */
export function ReturnDialog({
  sale,
  onClose,
  onDone,
}: {
  sale: ShopSaleDto;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations();
  const action = useApiAction();
  const [idempotencyKey] = useState(newIdempotencyKey);
  const lines = sale.lines.filter((line) => line.returnedQuantity < line.quantity);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState(true);
  const [reason, setReason] = useState('');

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const chosen: ShopReturnInput['lines'] = [];
    for (const line of lines) {
      const typed = quantities[line.invoiceItemId] ?? '';
      if (typed.trim() === '' || typed.trim() === '0') continue;
      const quantity = wholeNumber(typed);
      if (quantity === null || quantity > line.quantity - line.returnedQuantity) {
        action.fail(t('errors.RETURN_EXCEEDS_SOLD'));
        return;
      }
      chosen.push({ invoiceItemId: line.invoiceItemId, quantity, restock });
    }
    if (chosen.length === 0 || !reason.trim()) {
      action.fail(t('shop.return.nothing'));
      return;
    }
    action.run(
      () =>
        api.post(
          `/shop/sales/${sale.invoice.id}/returns`,
          { reason: reason.trim(), lines: chosen },
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
      title={t('shop.return.title')}
      description={t('shop.return.description')}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {lines.map((line) => (
          <Field
            key={line.invoiceItemId}
            id={`return-${line.invoiceItemId}`}
            label={`${line.product.name} · ${line.unitName}`}
            hint={t('shop.return.left', { count: line.quantity - line.returnedQuantity })}
          >
            <Input
              id={`return-${line.invoiceItemId}`}
              inputMode="numeric"
              className="w-32"
              value={quantities[line.invoiceItemId] ?? ''}
              onChange={(event) => {
                setQuantities((all) => ({ ...all, [line.invoiceItemId]: event.target.value }));
              }}
            />
          </Field>
        ))}
        <CheckboxRow
          label={t('shop.return.restock')}
          checked={restock}
          onChange={(event) => {
            setRestock(event.target.checked);
          }}
        />
        <Field id="return-reason" label={t('shop.return.reason')}>
          <Input
            id="return-reason"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </Field>
        <FormMessage error={action.error} />
        <FormActions>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={action.pending}>
            {t('shop.return.confirm')}
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}
