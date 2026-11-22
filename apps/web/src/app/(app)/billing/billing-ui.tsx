'use client';

import {
  currencyDigits,
  decimalToMinor,
  DESK_PAYMENT_METHODS,
  type DeskPaymentMethod,
  type InvoiceItemKind,
  type InvoiceStatus,
  minorToDecimal,
  type PaymentMethod,
} from '@gatefit/shared';
import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';

const invoiceTone: Record<InvoiceStatus, 'neutral' | 'positive' | 'warning' | 'muted'> = {
  open: 'warning',
  partially_paid: 'warning',
  paid: 'positive',
  void: 'muted',
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const t = useTranslations('billing.invoiceStatus');
  return <Badge tone={invoiceTone[status]}>{t(status)}</Badge>;
}

export function useMethodName() {
  const t = useTranslations('billing.methods');
  return (method: PaymentMethod) => t(method);
}

/** An invoice line as staff read it: a freeze fee says so, whatever plan it belongs to. */
export function useItemLabel() {
  const t = useTranslations('billing.items');
  return (item: { kind: InvoiceItemKind; description: string }) =>
    item.kind === 'freeze_fee' ? t('freezeFee', { plan: item.description }) : item.description;
}

export function PaymentMethodSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: DeskPaymentMethod;
  onChange: (method: DeskPaymentMethod) => void;
}) {
  const methodName = useMethodName();
  return (
    <Select
      id={id}
      value={value}
      onChange={(event) => {
        onChange(event.target.value as DeskPaymentMethod);
      }}
    >
      {DESK_PAYMENT_METHODS.map((method) => (
        <option key={method} value={method}>
          {methodName(method)}
        </option>
      ))}
    </Select>
  );
}

/** Minor units ("4500000") as a person types them ("45000.00"), and back. */
export function toTyped(minor: string, currency: string): string {
  return minorToDecimal(minor, currencyDigits(currency));
}

/** What a person typed as minor units, or null when it is not an amount. */
export function fromTyped(typed: string, currency: string): string | null {
  return decimalToMinor(typed, currencyDigits(currency));
}

/** Minor-unit comparison without floating point: both are strings of digits. */
export function compareMinor(a: string, b: string): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x === y ? 0 : x < y ? -1 : 1;
}

/** Opens the printable receipt of a payment in a new tab. */
export function openReceipt(paymentId: string) {
  window.open(`/receipts/${paymentId}`, '_blank', 'noopener');
}
