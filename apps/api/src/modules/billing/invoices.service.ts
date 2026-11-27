import {
  addDays,
  ErrorCode,
  type InvoiceCreateInput,
  type InvoiceDto,
  type InvoiceItemKind,
  type InvoiceKind,
  type InvoiceListQuery,
  type InvoicePayInput,
  type InvoiceStatus,
  type InvoiceVoidInput,
  localDate,
  type Page,
  type PaymentDto,
  type PaymentInput,
  startOfLocalDay,
} from '@gatefit/shared';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { Clock } from '../../common/clock/clock';
import { conflict, forbidden, notFound, unprocessable } from '../../common/errors/domain-errors';
import { FISCAL_PROVIDER, type FiscalProvider } from '../../common/fiscal/fiscal.provider';
import { canSeeLocation, type StaffCaller } from '../../common/http/staff-request';
import { pageArgs, toPage } from '../../common/pagination/paginate';
import type { TenantTransaction } from '../../common/prisma/prisma.service';
import type { Payment, Prisma } from '../../generated/prisma/client';
import type { DebtFacts } from '../members/member-status';
import { MembersService } from '../members/members.service';
import { OrganizationService } from '../tenancy/organization.service';
import { CashShiftsService } from './cash-shifts.service';

export const invoiceInclude = {
  location: { select: { id: true, name: true, timezone: true } },
  items: { orderBy: { id: 'asc' } },
} as const satisfies Prisma.InvoiceInclude;

export type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

const isoDate = (value: Date) => value.toISOString().slice(0, 10);

export const paymentInclude = {
  invoice: { select: { id: true, number: true } },
  member: { select: { id: true, firstName: true, lastName: true, phone: true } },
  location: { select: { id: true, name: true } },
  refunds: { select: { amountMinor: true } },
} as const satisfies Prisma.PaymentInclude;

export type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

const refunded = (row: { refunds: { amountMinor: bigint }[] }) =>
  row.refunds.reduce((sum, refund) => sum + refund.amountMinor, 0n);

export function toPaymentDto(row: PaymentRow): PaymentDto {
  return {
    id: row.id,
    invoice: row.invoice,
    member: row.member,
    location: row.location,
    cashShiftId: row.cashShiftId,
    method: row.method,
    externalId: row.externalId,
    amountMinor: row.amountMinor.toString(),
    refundedMinor: refunded(row).toString(),
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
  };
}

/** An invoice's status from its amounts; `credited` is taken off the total by returns. */
export function invoiceStatus(
  total: bigint,
  paid: bigint,
  voided: boolean,
  credited = 0n,
): InvoiceStatus {
  if (voided) {
    return 'void';
  }
  if (paid >= total - credited) {
    return 'paid';
  }
  return paid > 0n ? 'partially_paid' : 'open';
}

export function balanceOf(row: {
  totalMinor: bigint;
  creditedMinor: bigint;
  paidMinor: bigint;
  status: InvoiceStatus;
}) {
  return row.status === 'void' ? 0n : row.totalMinor - row.creditedMinor - row.paidMinor;
}

export interface ChargeItem {
  kind: InvoiceItemKind;
  description: string;
  quantity: number;
  unitMinor: bigint;
  membershipId?: string;
  freezeId?: string;
}

export interface ChargeInput {
  /** null: a shop sale to someone who is not a member; they must pay in full at once. */
  memberId: string | null;
  /** `shop`: what is owed does not make the member a debtor. Default `standard`. */
  kind?: InvoiceKind;
  locationId: string;
  items: ChargeItem[];
  /** Last day to pay; omitted: owed at once. */
  dueOn?: string;
  payment?: PaymentInput;
}

/**
 * Invoices and the money taken against them (docs/TZ.md F-4.1, F-4.3). Payments are only
 * ever added; an invoice's paid amount follows payments less refunds. An unpaid balance
 * past its due moment makes the member a debtor.
 */
@Injectable()
export class InvoicesService implements DebtFacts {
  constructor(
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly members: MembersService,
    private readonly organizations: OrganizationService,
    private readonly shifts: CashShiftsService,
    @Inject(FISCAL_PROVIDER) private readonly fiscal: FiscalProvider,
  ) {}

  async list(
    tx: TenantTransaction,
    caller: StaffCaller,
    query: InvoiceListQuery,
  ): Promise<Page<InvoiceDto>> {
    if (query.memberId) {
      await this.members.findVisible(tx, caller, query.memberId);
    }
    if (query.locationId && !canSeeLocation(caller, query.locationId)) {
      return { items: [], nextCursor: null };
    }
    const page = pageArgs(query, 'desc');
    const rows = await tx.invoice.findMany({
      ...page,
      where: {
        ...page.where,
        deletedAt: null,
        memberId: query.memberId,
        status: query.status,
        kind: query.kind,
        locationId:
          query.locationId ??
          (caller.locationIds === null ? undefined : { in: [...caller.locationIds] }),
      },
      include: invoiceInclude,
    });
    const now = this.clock.now();
    return toPage(rows, query, (row) => toInvoiceDto(row, now));
  }

  async get(tx: TenantTransaction, caller: StaffCaller, id: string): Promise<InvoiceDto> {
    return toInvoiceDto(await this.findVisible(tx, caller, id), this.clock.now());
  }

  /** A manual invoice for anything besides memberships and freezes. */
  async create(
    tx: TenantTransaction,
    caller: StaffCaller,
    input: InvoiceCreateInput,
  ): Promise<InvoiceDto> {
    const { invoice } = await this.charge(tx, caller, {
      memberId: input.memberId,
      locationId: input.locationId,
      dueOn: input.dueOn,
      items: input.items.map((item) => ({
        kind: 'other',
        description: item.description,
        quantity: item.quantity,
        unitMinor: BigInt(item.unitMinor),
      })),
    });
    return toInvoiceDto(invoice, this.clock.now());
  }

  /**
   * Bills a member and, optionally, takes a payment at once, all in the caller's
   * transaction. Used for sales, freeze fees and manual invoices.
   */
  async charge(
    tx: TenantTransaction,
    caller: StaffCaller,
    input: ChargeInput,
  ): Promise<{ invoice: InvoiceRow; payment: Payment | null; itemIds: string[] }> {
    const member = input.memberId
      ? await this.members.findEditable(tx, caller, input.memberId)
      : null;
    const location = await this.organizations.findLocation(tx, input.locationId);
    if (!location) {
      throw unprocessable(ErrorCode.INVALID_REFERENCE, 'Unknown location');
    }
    if (!canSeeLocation(caller, location.id)) {
      throw forbidden(ErrorCode.LOCATION_NOT_ASSIGNED, 'You do not work at this location');
    }
    const now = this.clock.now();
    const today = localDate(now, location.timezone);
    if (input.dueOn && input.dueOn < today) {
      throw unprocessable(ErrorCode.INVALID_DUE_DATE, 'The due date is in the past');
    }
    const dueAt = input.dueOn ? startOfLocalDay(addDays(input.dueOn, 1), location.timezone) : now;
    const total = input.items.reduce(
      (sum, item) => sum + item.unitMinor * BigInt(item.quantity),
      0n,
    );
    if (!member && (input.payment === undefined || BigInt(input.payment.amountMinor) !== total)) {
      throw unprocessable(
        ErrorCode.WALK_IN_FULL_PAYMENT,
        'Someone who is not a member pays the whole amount at once',
        { totalMinor: total.toString() },
      );
    }

    const invoice = await tx.invoice.create({
      data: {
        organizationId: caller.organizationId,
        number: await this.nextNumber(tx, caller.organizationId, Number(today.slice(0, 4))),
        kind: input.kind ?? 'standard',
        memberId: member?.id ?? null,
        locationId: location.id,
        currency: await this.organizations.currency(tx, caller.organizationId),
        totalMinor: total,
        status: invoiceStatus(total, 0n, false),
        dueOn: input.dueOn ? new Date(`${input.dueOn}T00:00:00Z`) : null,
        dueAt,
        // Owed at once: the member's status is brought up to date below, not by the job.
        overdueMarkedAt: dueAt <= now ? now : null,
        createdBy: caller.actor.userId,
      },
    });
    // One by one, so the caller learns which line got which id.
    const itemIds: string[] = [];
    for (const item of input.items) {
      const row = await tx.invoiceItem.create({
        data: {
          organizationId: caller.organizationId,
          invoiceId: invoice.id,
          kind: item.kind,
          description: item.description,
          quantity: item.quantity,
          unitMinor: item.unitMinor,
          totalMinor: item.unitMinor * BigInt(item.quantity),
          membershipId: item.membershipId ?? null,
          freezeId: item.freezeId ?? null,
        },
        select: { id: true },
      });
      itemIds.push(row.id);
    }
    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'invoice.create',
      entity: 'invoice',
      entityId: invoice.id,
      after: {
        number: invoice.number,
        kind: invoice.kind,
        memberId: member?.id ?? null,
        totalMinor: total.toString(),
        currency: invoice.currency,
        dueOn: input.dueOn ?? null,
      },
    });

    let payment: Payment | null = null;
    if (input.payment && input.payment.amountMinor !== '0') {
      payment = await this.takePayment(tx, caller, invoice.id, input.payment);
    } else if (member) {
      await this.members.refreshStatus(tx, member.id);
    }
    return { invoice: await this.reload(tx, invoice.id), payment, itemIds };
  }

  /** Records money received against an invoice; partial payments are allowed. */
  async pay(
    tx: TenantTransaction,
    caller: StaffCaller,
    id: string,
    input: InvoicePayInput,
  ): Promise<InvoiceDto> {
    await this.findVisible(tx, caller, id);
    await this.takePayment(tx, caller, id, input);
    return toInvoiceDto(await this.reload(tx, id), this.clock.now());
  }

  /** Writes off what is still owed, with a reason. Money already paid stays paid. */
  async void(
    tx: TenantTransaction,
    caller: StaffCaller,
    id: string,
    input: InvoiceVoidInput,
  ): Promise<InvoiceDto> {
    await this.findVisible(tx, caller, id);
    await this.voidLocked(tx, caller, id, input.reason);
    return toInvoiceDto(await this.reload(tx, id), this.clock.now());
  }

  /**
   * Writes off what is still owed for a membership and its freeze fees; called when the
   * membership is cancelled.
   */
  async voidForMembership(
    tx: TenantTransaction,
    caller: StaffCaller,
    membershipId: string,
    reason: string,
  ): Promise<void> {
    const items = await tx.invoiceItem.findMany({
      where: { membershipId },
      select: { invoiceId: true },
    });
    const ids = [...new Set(items.map((item) => item.invoiceId))];
    const open = await tx.invoice.findMany({
      where: { id: { in: ids }, status: { in: ['open', 'partially_paid'] } },
      select: { id: true },
    });
    for (const { id } of open) {
      await this.voidLocked(tx, caller, id, reason);
    }
  }

  /** Whether the member owes money past its due moment (DebtFacts, for member status). */
  async isDebtor(tx: TenantTransaction, memberId: string): Promise<boolean> {
    const overdue = await tx.invoice.findFirst({
      where: {
        memberId,
        // Money owed for goods does not stop a member at the door.
        kind: 'standard',
        deletedAt: null,
        status: { in: ['open', 'partially_paid'] },
        dueAt: { lte: this.clock.now() },
      },
      select: { id: true },
    });
    return overdue !== null;
  }

  /**
   * Members whose invoices became overdue by `now` get their status brought in line, once
   * per invoice. Safe to run again. Returns how many invoices were handled.
   */
  async markOverdue(tx: TenantTransaction, now: Date): Promise<number> {
    const due = await tx.invoice.findMany({
      where: {
        dueAt: { lte: now },
        overdueMarkedAt: null,
        kind: 'standard',
        memberId: { not: null },
        status: { in: ['open', 'partially_paid'] },
        deletedAt: null,
      },
      select: { id: true, memberId: true },
      take: 1000,
    });
    for (const memberId of new Set(due.map((row) => row.memberId))) {
      if (memberId) {
        await this.members.refreshStatus(tx, memberId);
      }
    }
    if (due.length > 0) {
      await tx.invoice.updateMany({
        where: { id: { in: due.map((row) => row.id) }, overdueMarkedAt: null },
        data: { overdueMarkedAt: now },
      });
    }
    return due.length;
  }

  /**
   * Takes a payment against an invoice: checks the balance, links the open cash shift
   * (required for cash), updates the paid amount and the member's status.
   */
  async takePayment(
    tx: TenantTransaction,
    caller: StaffCaller,
    invoiceId: string,
    input: PaymentInput,
  ): Promise<Payment> {
    const invoice = await this.lock(tx, invoiceId);
    if (invoice.status === 'void') {
      throw conflict(ErrorCode.INVOICE_VOID, 'This invoice was written off');
    }
    const balance = balanceOf(invoice);
    if (balance === 0n) {
      throw conflict(ErrorCode.INVOICE_PAID, 'This invoice is already paid');
    }
    const amount = BigInt(input.amountMinor);
    if (amount <= 0n || amount > balance) {
      throw unprocessable(ErrorCode.AMOUNT_EXCEEDS_BALANCE, 'The amount is more than is owed', {
        balanceMinor: balance.toString(),
      });
    }
    const shiftId = await this.shifts.openShiftId(tx, invoice.locationId);
    if (input.method === 'cash' && !shiftId) {
      throw conflict(ErrorCode.CASH_SHIFT_NOT_OPEN, 'Open a cash shift to take cash');
    }

    const payment = await tx.payment.create({
      data: {
        organizationId: caller.organizationId,
        invoiceId,
        memberId: invoice.memberId,
        locationId: invoice.locationId,
        cashShiftId: shiftId,
        method: input.method,
        externalId: input.externalId || null,
        amountMinor: amount,
        currency: invoice.currency,
        receivedBy: caller.actor.userId,
      },
    });
    const paid = invoice.paidMinor + amount;
    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        paidMinor: paid,
        status: invoiceStatus(invoice.totalMinor, paid, false, invoice.creditedMinor),
      },
    });
    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'payment.create',
      entity: 'payment',
      entityId: payment.id,
      after: {
        invoiceId,
        method: payment.method,
        amountMinor: amount.toString(),
        currency: payment.currency,
        cashShiftId: shiftId,
      },
    });
    await this.fiscal.register({
      organizationId: caller.organizationId,
      kind: 'payment',
      id: payment.id,
      amountMinor: amount,
      currency: payment.currency,
      items: invoice.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        totalMinor: item.totalMinor,
      })),
    });
    if (invoice.memberId) {
      await this.members.refreshStatus(tx, invoice.memberId);
    }
    return payment;
  }

  /** A payment as the journal shows it. */
  async paymentDto(tx: TenantTransaction, id: string): Promise<PaymentDto> {
    return toPaymentDto(
      await tx.payment.findUniqueOrThrow({ where: { id }, include: paymentInclude }),
    );
  }

  /** The invoice's latest payment, for its receipt; null when nothing was paid. */
  async latestPayment(tx: TenantTransaction, invoiceId: string): Promise<PaymentDto | null> {
    const row = await tx.payment.findFirst({
      where: { invoiceId },
      orderBy: { id: 'desc' },
      include: paymentInclude,
    });
    return row && toPaymentDto(row);
  }

  /** Locks the invoice row for the rest of the transaction and reads it. */
  async lock(tx: TenantTransaction, id: string): Promise<InvoiceRow> {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${id}::uuid FOR UPDATE`;
    return this.reload(tx, id);
  }

  async findVisible(tx: TenantTransaction, caller: StaffCaller, id: string): Promise<InvoiceRow> {
    const row = await tx.invoice.findFirst({
      where: { id, deletedAt: null },
      include: invoiceInclude,
    });
    if (!row || !canSeeLocation(caller, row.locationId)) {
      throw notFound('Invoice');
    }
    return row;
  }

  private async voidLocked(
    tx: TenantTransaction,
    caller: StaffCaller,
    id: string,
    reason: string,
  ): Promise<void> {
    const invoice = await this.lock(tx, id);
    if (invoice.status === 'void') {
      throw conflict(ErrorCode.INVOICE_VOID, 'This invoice was already written off');
    }
    if (invoice.status === 'paid') {
      throw conflict(ErrorCode.INVOICE_PAID, 'Nothing is owed on this invoice');
    }
    await tx.invoice.update({
      where: { id },
      data: {
        status: 'void',
        voidedAt: this.clock.now(),
        voidedBy: caller.actor.userId,
        voidReason: reason,
      },
    });
    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'invoice.void',
      entity: 'invoice',
      entityId: id,
      before: { status: invoice.status, balanceMinor: balanceOf(invoice).toString() },
      after: { status: 'void', reason },
    });
    if (invoice.memberId) {
      await this.members.refreshStatus(tx, invoice.memberId);
    }
  }

  /**
   * Takes `amount` off what the invoice asks for, as goods come back. Only what is left
   * owed can be credited; the caller gives back any money paid beyond the new total first.
   */
  async credit(
    tx: TenantTransaction,
    caller: StaffCaller,
    id: string,
    amount: bigint,
    reason: string,
  ): Promise<void> {
    const invoice = await this.lock(tx, id);
    if (invoice.status === 'void') {
      throw conflict(ErrorCode.INVOICE_VOID, 'This invoice was written off');
    }
    const credited = invoice.creditedMinor + amount;
    if (amount <= 0n || invoice.paidMinor > invoice.totalMinor - credited) {
      throw new Error('credit() needs the money paid beyond the new total given back first');
    }
    await tx.invoice.update({
      where: { id },
      data: {
        creditedMinor: credited,
        status: invoiceStatus(invoice.totalMinor, invoice.paidMinor, false, credited),
      },
    });
    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'invoice.credit',
      entity: 'invoice',
      entityId: id,
      before: { creditedMinor: invoice.creditedMinor.toString() },
      after: { creditedMinor: credited.toString(), amountMinor: amount.toString(), reason },
    });
    if (invoice.memberId) {
      await this.members.refreshStatus(tx, invoice.memberId);
    }
  }

  private reload(tx: TenantTransaction, id: string): Promise<InvoiceRow> {
    return tx.invoice.findUniqueOrThrow({ where: { id }, include: invoiceInclude });
  }

  /** 2026-000001: numbers run per organization and year, without gaps on commit. */
  private async nextNumber(tx: TenantTransaction, organizationId: string, year: number) {
    const [row] = await tx.$queryRaw<{ last: number }[]>`
      INSERT INTO invoice_counters (organization_id, year, last)
      VALUES (${organizationId}::uuid, ${year}, 1)
      ON CONFLICT (organization_id, year)
      DO UPDATE SET last = invoice_counters.last + 1
      RETURNING last`;
    return `${String(year)}-${String(row?.last ?? 1).padStart(6, '0')}`;
  }
}

export function toInvoiceDto(row: InvoiceRow, now: Date): InvoiceDto {
  const balance = balanceOf(row);
  return {
    id: row.id,
    number: row.number,
    kind: row.kind,
    memberId: row.memberId,
    location: { id: row.location.id, name: row.location.name },
    status: row.status,
    totalMinor: row.totalMinor.toString(),
    creditedMinor: row.creditedMinor.toString(),
    paidMinor: row.paidMinor.toString(),
    balanceMinor: balance.toString(),
    currency: row.currency,
    dueOn: row.dueOn ? isoDate(row.dueOn) : null,
    // No due date: owed from the moment of sale.
    overdue: balance > 0n && (row.dueOn === null || row.dueAt <= now),
    items: row.items.map((item) => ({
      id: item.id,
      kind: item.kind,
      description: item.description,
      quantity: item.quantity,
      unitMinor: item.unitMinor.toString(),
      totalMinor: item.totalMinor.toString(),
      membershipId: item.membershipId,
    })),
    voidReason: row.voidReason,
    createdAt: row.createdAt.toISOString(),
  };
}
