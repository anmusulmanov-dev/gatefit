import { z } from 'zod';
import { pageQuerySchema } from './pagination';
import { minorAmountSchema } from './platform';

// Payments and the cash desk (docs/TZ.md F-4.1 to F-4.4). Amounts are strings of digits
// in the smallest unit of the organization's currency (CLAUDE.md rule 2).

/** `online` is reserved for v1 (docs/TZ.md F-4.5); the API does not accept it yet. */
export const PAYMENT_METHODS = ['cash', 'card_terminal', 'transfer', 'online'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Methods staff can record at the desk. */
export const DESK_PAYMENT_METHODS = ['cash', 'card_terminal', 'transfer'] as const;
export type DeskPaymentMethod = (typeof DESK_PAYMENT_METHODS)[number];

export const INVOICE_STATUSES = ['open', 'partially_paid', 'paid', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_ITEM_KINDS = ['membership', 'freeze_fee', 'other'] as const;
export type InvoiceItemKind = (typeof INVOICE_ITEM_KINDS)[number];

/** Header that every money-moving request carries (CLAUDE.md rule 6). */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
export const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{8,100}$/);

const positiveMinor = minorAmountSchema.refine((value) => value !== '0', 'Must be more than 0');
const reasonSchema = z.string().trim().min(1).max(500);

/** Money taken together with a sale or a fee. `amountMinor` "0" takes nothing (all on debt). */
export const paymentInputSchema = z.object({
  method: z.enum(DESK_PAYMENT_METHODS),
  amountMinor: minorAmountSchema,
  /** Terminal slip or transfer reference, if any. */
  externalId: z.string().trim().max(100).optional(),
});
export type PaymentInput = z.infer<typeof paymentInputSchema>;

/** What a sale or a freeze with a fee charges besides the item itself. */
export const chargeOptionsSchema = z.object({
  payment: paymentInputSchema.optional(),
  /** Last day to pay what is left, in the location's time zone. Omitted: owed at once. */
  dueOn: z.iso.date().optional(),
});

export const invoiceCreateSchema = z.object({
  memberId: z.uuid(),
  locationId: z.uuid(),
  items: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(200),
        quantity: z.number().int().min(1).max(1000),
        unitMinor: positiveMinor,
      }),
    )
    .min(1)
    .max(50),
  dueOn: z.iso.date().optional(),
});
export type InvoiceCreateInput = z.infer<typeof invoiceCreateSchema>;

export const invoicePaySchema = z.object({
  method: z.enum(DESK_PAYMENT_METHODS),
  amountMinor: positiveMinor,
  externalId: z.string().trim().max(100).optional(),
});
export type InvoicePayInput = z.infer<typeof invoicePaySchema>;

export const invoiceVoidSchema = z.object({ reason: reasonSchema });
export type InvoiceVoidInput = z.infer<typeof invoiceVoidSchema>;

export const invoiceListQuerySchema = pageQuerySchema.extend({
  memberId: z.uuid().optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
});
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;

export const refundCreateSchema = z.object({
  amountMinor: positiveMinor,
  reason: reasonSchema,
});
export type RefundCreateInput = z.infer<typeof refundCreateSchema>;

export const paymentListQuerySchema = pageQuerySchema.extend({
  /** Instants (ISO 8601): `from` inclusive, `to` exclusive. The client picks the day's bounds in its location's time zone. */
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  locationId: z.uuid().optional(),
  memberId: z.uuid().optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  cashShiftId: z.uuid().optional(),
});
export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>;

export const cashShiftOpenSchema = z.object({
  locationId: z.uuid(),
  /** Cash in the drawer when the shift starts. */
  openingMinor: minorAmountSchema,
});
export type CashShiftOpenInput = z.infer<typeof cashShiftOpenSchema>;

export const cashShiftCloseSchema = z.object({
  /** Cash counted in the drawer at the end. */
  countedMinor: minorAmountSchema,
  note: z.string().trim().max(500).optional(),
});
export type CashShiftCloseInput = z.infer<typeof cashShiftCloseSchema>;

export const cashShiftQuerySchema = z.object({ locationId: z.uuid() });
export type CashShiftQuery = z.infer<typeof cashShiftQuerySchema>;

export const cashShiftListQuerySchema = pageQuerySchema.extend({ locationId: z.uuid().optional() });
export type CashShiftListQuery = z.infer<typeof cashShiftListQuerySchema>;

export interface InvoiceItemDto {
  id: string;
  kind: InvoiceItemKind;
  description: string;
  quantity: number;
  unitMinor: string;
  totalMinor: string;
  membershipId: string | null;
}

export interface InvoiceDto {
  id: string;
  number: string;
  memberId: string;
  location: { id: string; name: string };
  status: InvoiceStatus;
  totalMinor: string;
  /** Paid less refunded. */
  paidMinor: string;
  /** Still owed; "0" once paid or void. */
  balanceMinor: string;
  currency: string;
  /** Last day to pay, if one was given. */
  dueOn: string | null;
  /** True when something is owed and the due moment has passed. */
  overdue: boolean;
  items: InvoiceItemDto[];
  voidReason: string | null;
  createdAt: string;
}

export interface PaymentDto {
  id: string;
  invoice: { id: string; number: string };
  member: { id: string; firstName: string; lastName: string; phone: string };
  location: { id: string; name: string };
  cashShiftId: string | null;
  method: PaymentMethod;
  externalId: string | null;
  amountMinor: string;
  refundedMinor: string;
  currency: string;
  createdAt: string;
}

export interface RefundDto {
  id: string;
  paymentId: string;
  amountMinor: string;
  currency: string;
  method: PaymentMethod;
  reason: string;
  createdAt: string;
}

export interface CashShiftTotalsDto {
  cashInMinor: string;
  cashRefundsMinor: string;
  /** Opening plus cash taken less cash refunded: what the drawer should hold. */
  expectedMinor: string;
  cardTerminalMinor: string;
  transferMinor: string;
  paymentsCount: number;
}

export interface CashShiftDto {
  id: string;
  location: { id: string; name: string };
  status: 'open' | 'closed';
  openingMinor: string;
  openedAt: string;
  closedAt: string | null;
  countedMinor: string | null;
  /** Counted less expected; negative when cash is missing. A signed integer string. */
  differenceMinor: string | null;
  note: string | null;
  currency: string;
  totals: CashShiftTotalsDto;
}

/** What a printed receipt or a receipt SMS shows. */
export interface ReceiptDto {
  organization: { name: string };
  location: { name: string; address: string | null };
  invoiceNumber: string;
  paymentId: string;
  paidAt: string;
  method: PaymentMethod;
  amountMinor: string;
  currency: string;
  member: { firstName: string; lastName: string; phone: string };
  items: { description: string; quantity: number; totalMinor: string }[];
  invoiceTotalMinor: string;
  balanceMinor: string;
}
