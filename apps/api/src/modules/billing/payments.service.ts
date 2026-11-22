import { messages, resolveLocale } from '@gatefit/i18n';
import {
  ErrorCode,
  formatMinor,
  type Page,
  type PaymentDto,
  type PaymentListQuery,
  type ReceiptDto,
  type RefundCreateInput,
  type RefundDto,
} from '@gatefit/shared';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { conflict, notFound, unprocessable } from '../../common/errors/domain-errors';
import { FISCAL_PROVIDER, type FiscalProvider } from '../../common/fiscal/fiscal.provider';
import { canSeeLocation, type StaffCaller } from '../../common/http/staff-request';
import { pageArgs, toPage } from '../../common/pagination/paginate';
import type { TenantTransaction } from '../../common/prisma/prisma.service';
import { SMS_PROVIDER, type SmsProvider } from '../../common/sms/sms.provider';
import { MembersService } from '../members/members.service';
import { OrganizationService } from '../tenancy/organization.service';
import { CashShiftsService } from './cash-shifts.service';
import {
  balanceOf,
  invoiceStatus,
  InvoicesService,
  paymentInclude,
  toPaymentDto,
} from './invoices.service';

/**
 * The payments journal, refunds and receipts (docs/TZ.md F-4.2, F-4.3). Staff see the
 * payments of the locations they work at; organization-wide roles see all.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly audit: AuditService,
    private readonly invoices: InvoicesService,
    private readonly shifts: CashShiftsService,
    private readonly members: MembersService,
    private readonly organizations: OrganizationService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(FISCAL_PROVIDER) private readonly fiscal: FiscalProvider,
  ) {}

  async list(
    tx: TenantTransaction,
    caller: StaffCaller,
    query: PaymentListQuery,
  ): Promise<Page<PaymentDto>> {
    if (query.locationId && !canSeeLocation(caller, query.locationId)) {
      return { items: [], nextCursor: null };
    }
    const page = pageArgs(query, 'desc');
    const rows = await tx.payment.findMany({
      ...page,
      where: {
        ...page.where,
        locationId:
          query.locationId ??
          (caller.locationIds === null ? undefined : { in: [...caller.locationIds] }),
        memberId: query.memberId,
        method: query.method,
        cashShiftId: query.cashShiftId,
        createdAt: {
          gte: query.from ? new Date(query.from) : undefined,
          lt: query.to ? new Date(query.to) : undefined,
        },
      },
      include: paymentInclude,
    });
    return toPage(rows, query, toPaymentDto);
  }

  async get(tx: TenantTransaction, caller: StaffCaller, id: string): Promise<PaymentDto> {
    return toPaymentDto(await this.findVisible(tx, caller, id));
  }

  /**
   * Gives money back, at most what is left of the payment. Cash comes out of the open
   * shift's drawer. The membership is not cancelled here; that is a separate action.
   */
  async refund(
    tx: TenantTransaction,
    caller: StaffCaller,
    id: string,
    input: RefundCreateInput,
  ): Promise<RefundDto> {
    const payment = await this.findVisible(tx, caller, id);
    const invoice = await this.invoices.lock(tx, payment.invoiceId);
    // Re-read the refunds under the invoice lock: two refunds cannot both pass the check.
    const done = await tx.refund.aggregate({
      where: { paymentId: id },
      _sum: { amountMinor: true },
    });
    const left = payment.amountMinor - (done._sum.amountMinor ?? 0n);
    const amount = BigInt(input.amountMinor);
    if (amount > left) {
      throw unprocessable(ErrorCode.REFUND_EXCEEDS_PAYMENT, 'More than is left of the payment', {
        refundableMinor: left.toString(),
      });
    }
    const shiftId = await this.shifts.openShiftId(tx, payment.locationId);
    if (payment.method === 'cash' && !shiftId) {
      throw conflict(ErrorCode.CASH_SHIFT_NOT_OPEN, 'Open a cash shift to give cash back');
    }

    const refund = await tx.refund.create({
      data: {
        organizationId: caller.organizationId,
        paymentId: id,
        invoiceId: invoice.id,
        locationId: payment.locationId,
        cashShiftId: shiftId,
        method: payment.method,
        amountMinor: amount,
        currency: payment.currency,
        reason: input.reason,
        refundedBy: caller.actor.userId,
      },
    });
    const paid = invoice.paidMinor - amount;
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        paidMinor: paid,
        status: invoiceStatus(invoice.totalMinor, paid, invoice.status === 'void'),
      },
    });
    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'refund.create',
      entity: 'payment',
      entityId: id,
      after: {
        refundId: refund.id,
        amountMinor: amount.toString(),
        currency: refund.currency,
        method: refund.method,
        reason: input.reason,
      },
    });
    await this.fiscal.register({
      organizationId: caller.organizationId,
      kind: 'refund',
      id: refund.id,
      amountMinor: amount,
      currency: refund.currency,
      items: [{ description: input.reason, quantity: 1, totalMinor: amount }],
    });
    await this.members.refreshStatus(tx, payment.memberId);
    return {
      id: refund.id,
      paymentId: id,
      amountMinor: amount.toString(),
      currency: refund.currency,
      method: refund.method,
      reason: refund.reason,
      createdAt: refund.createdAt.toISOString(),
    };
  }

  async receipt(tx: TenantTransaction, caller: StaffCaller, id: string): Promise<ReceiptDto> {
    const payment = await this.findVisible(tx, caller, id);
    const [invoice, organization, location] = await Promise.all([
      this.invoices.findVisible(tx, caller, payment.invoiceId),
      this.organizations.get(tx, caller.organizationId),
      tx.location.findUniqueOrThrow({
        where: { id: payment.locationId },
        select: { name: true, address: true },
      }),
    ]);
    return {
      organization: { name: organization.name },
      location,
      invoiceNumber: invoice.number,
      paymentId: payment.id,
      paidAt: payment.createdAt.toISOString(),
      method: payment.method,
      amountMinor: payment.amountMinor.toString(),
      currency: payment.currency,
      member: {
        firstName: payment.member.firstName,
        lastName: payment.member.lastName,
        phone: payment.member.phone,
      },
      items: invoice.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        totalMinor: item.totalMinor.toString(),
      })),
      invoiceTotalMinor: invoice.totalMinor.toString(),
      balanceMinor: balanceOf(invoice).toString(),
    };
  }

  /** Texts the receipt to the member, in the organization's language. Only when staff ask. */
  async sendReceiptSms(tx: TenantTransaction, caller: StaffCaller, id: string): Promise<void> {
    const receipt = await this.receipt(tx, caller, id);
    const organization = await this.organizations.get(tx, caller.organizationId);
    const locale = resolveLocale(organization.locale);
    const text = messages[locale].sms.receipt
      .replace('{organization}', receipt.organization.name)
      .replace('{amount}', formatMinor(receipt.amountMinor, receipt.currency, locale))
      .replace('{number}', receipt.invoiceNumber)
      .replace('{balance}', formatMinor(receipt.balanceMinor, receipt.currency, locale));
    await this.sms.send(receipt.member.phone, text);
  }

  private async findVisible(tx: TenantTransaction, caller: StaffCaller, id: string) {
    const row = await tx.payment.findFirst({ where: { id }, include: paymentInclude });
    if (!row || !canSeeLocation(caller, row.locationId)) {
      throw notFound('Payment');
    }
    return row;
  }
}
