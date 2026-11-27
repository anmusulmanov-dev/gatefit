'use client';

import { newIdempotencyKey, type ProductDto, type StockCountInput } from '@gatefit/shared';
import { useTranslations } from 'next-intl';
import { type SubmitEvent, useState } from 'react';

import { Field, FormActions, FormMessage } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useApiAction } from '@/lib/use-api';

import { fromTyped } from '../billing/billing-ui';
import { type LineDraft, LineFields, useQuantity, wholeNumber } from './shop-ui';

interface Props {
  locationId: string;
  products: ProductDto[];
  onClose: () => void;
  onDone: () => void;
}

/** Goods arrived: what, how many of which unit, and what they cost in all. */
export function ReceiveDialog({ locationId, products, onClose, onDone }: Props) {
  const t = useTranslations();
  const action = useApiAction();
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [line, setLine] = useState<LineDraft>({ productId: '', unitId: '', quantity: '1' });
  const [cost, setCost] = useState('');
  const [supplier, setSupplier] = useState('');
  const currency = products[0]?.currency ?? 'UZS';

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const quantity = wholeNumber(line.quantity);
    const costMinor = fromTyped(cost, currency);
    if (!line.productId || !line.unitId || quantity === null || costMinor === null) {
      action.fail(t('shop.line.invalid'));
      return;
    }
    action.run(
      () =>
        api.post(
          '/shop/stock/receipts',
          {
            locationId,
            ...(supplier.trim() ? { supplier: supplier.trim() } : {}),
            lines: [{ productId: line.productId, unitId: line.unitId, quantity, costMinor }],
          },
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
      title={t('shop.receive.title')}
      className="max-w-2xl"
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <LineFields idPrefix="receive" products={products} value={line} onChange={setLine} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            id="receive-cost"
            label={t('shop.receive.cost')}
            hint={t('billing.amountHint', { currency })}
          >
            <Input
              id="receive-cost"
              inputMode="decimal"
              value={cost}
              onChange={(event) => {
                setCost(event.target.value);
              }}
            />
          </Field>
          <Field
            id="receive-supplier"
            label={t('shop.receive.supplier')}
            optional={t('common.optional')}
          >
            <Input
              id="receive-supplier"
              value={supplier}
              onChange={(event) => {
                setSupplier(event.target.value);
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
            {t('shop.receive.confirm')}
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}

/** Goods taken out without a sale, with the reason. */
export function WriteOffDialog({ locationId, products, onClose, onDone }: Props) {
  const t = useTranslations();
  const action = useApiAction();
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [line, setLine] = useState<LineDraft>({ productId: '', unitId: '', quantity: '1' });
  const [reason, setReason] = useState('');

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const quantity = wholeNumber(line.quantity);
    if (!line.productId || !line.unitId || quantity === null || !reason.trim()) {
      action.fail(t('shop.line.invalid'));
      return;
    }
    action.run(
      () =>
        api.post(
          '/shop/stock/write-offs',
          {
            locationId,
            reason: reason.trim(),
            lines: [{ productId: line.productId, unitId: line.unitId, quantity }],
          },
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
      title={t('shop.writeOff.title')}
      className="max-w-2xl"
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <LineFields
          idPrefix="write-off"
          products={products.filter((item) => (item.stock?.onHand ?? 0) > 0)}
          value={line}
          onChange={setLine}
        />
        <Field id="write-off-reason" label={t('shop.writeOff.reason')}>
          <Input
            id="write-off-reason"
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
            {t('shop.writeOff.confirm')}
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}

/** A stocktake: what was counted per product, in its base unit; blank ones are skipped. */
export function CountDialog({ locationId, products, onClose, onDone }: Props) {
  const t = useTranslations();
  const quantity = useQuantity();
  const action = useApiAction();
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const lines: StockCountInput['lines'] = [];
    for (const [productId, typed] of Object.entries(counted)) {
      if (typed.trim() === '') continue;
      const value = wholeNumber(typed, 0);
      if (value === null) {
        action.fail(t('shop.line.invalid'));
        return;
      }
      lines.push({ productId, counted: value });
    }
    if (lines.length === 0) {
      action.fail(t('shop.count.nothing'));
      return;
    }
    action.run(
      () =>
        api.post(
          '/shop/stock/counts',
          { locationId, ...(note.trim() ? { note: note.trim() } : {}), lines },
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
      title={t('shop.count.title')}
      description={t('shop.count.hint')}
      className="max-w-2xl"
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <ul className="flex flex-col divide-y rounded-lg border bg-card">
          {products.map((product) => (
            <li
              key={product.id}
              className="grid items-center gap-3 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_10rem]"
            >
              <label htmlFor={`count-${product.id}`} className="text-sm">
                <span className="font-medium">{product.name}</span>
                <span className="block text-muted-foreground">
                  {t('shop.count.booked', {
                    amount: quantity(product.stock?.onHand ?? 0, product.baseUnit),
                  })}
                </span>
              </label>
              <Input
                id={`count-${product.id}`}
                inputMode="numeric"
                placeholder={t(`shop.baseUnits.${product.baseUnit}`)}
                value={counted[product.id] ?? ''}
                onChange={(event) => {
                  setCounted((all) => ({ ...all, [product.id]: event.target.value }));
                }}
              />
            </li>
          ))}
        </ul>
        <Field id="count-note" label={t('shop.count.note')} optional={t('common.optional')}>
          <Input
            id="count-note"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </Field>
        <FormMessage error={action.error} />
        <FormActions>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={action.pending}>
            {t('shop.count.confirm')}
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}
