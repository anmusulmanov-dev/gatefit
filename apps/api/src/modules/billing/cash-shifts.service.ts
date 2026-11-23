import {
  type CashShiftCloseInput,
  type CashShiftDto,
  type CashShiftListQuery,
  type CashShiftOpenInput,
  type CashShiftTotalsDto,
  ErrorCode,
  type Page,
} from '@gatefit/shared';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { Clock } from '../../common/clock/clock';
import { conflict, forbidden, notFound, unprocessable } from '../../common/errors/domain-errors';
import { canSeeLocation, type StaffCaller } from '../../common/http/staff-request';
import { pageArgs, toPage } from '../../common/pagination/paginate';
import type { TenantTransaction } from '../../common/prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { OrganizationService } from '../tenancy/organization.service';

const shiftInclude = { location: { select: { id: true, name: true } } } as const;
type ShiftRow = Prisma.CashShiftGetPayload<{ include: typeof shiftInclude }>;

export interface ShiftTotals {
  cashIn: bigint;
  cashRefunds: bigint;
  cardTerminal: bigint;
  transfer: bigint;
  paymentsCount: number;
}

/** What the drawer should hold: opening plus cash taken less cash given back. */
export function expectedCash(opening: bigint, totals: ShiftTotals): bigint {
  return opening + totals.cashIn - totals.cashRefunds;
}

/**
 * Cash desk shifts (docs/TZ.md F-4.4). A location has at most one open shift; cash can be
 * taken or refunded only while it is open. Card and transfer payments made during a shift
 * are linked to it and reported apart from the drawer.
 */
@Injectable()
export class CashShiftsService {
  constructor(
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly organizations: OrganizationService,
  ) {}

  async open(
    tx: TenantTransaction,
    caller: StaffCaller,
    input: CashShiftOpenInput,
  ): Promise<CashShiftDto> {
    await this.assertLocation(tx, caller, input.locationId);
    // Checked first: a unique violation would abort the request's transaction.
    if (await this.openShiftId(tx, input.locationId, false)) {
      throw conflict(ErrorCode.CASH_SHIFT_ALREADY_OPEN, 'A shift is already open here');
    }
    const row = await tx.cashShift.create({
      data: {
        organizationId: caller.organizationId,
        locationId: input.locationId,
        openingMinor: BigInt(input.openingMinor),
        currency: await this.organizations.currency(tx, caller.organizationId),
        openedBy: caller.actor.userId,
        openedAt: this.clock.now(),
      },
      include: shiftInclude,
    });
    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'cash_shift.open',
      entity: 'cash_shift',
      entityId: row.id,
      after: { locationId: row.locationId, openingMinor: input.openingMinor },
    });
    return this.toDto(tx, row);
  }

  /** The open shift at a location, or null. */
  async current(
    tx: TenantTransaction,
    caller: StaffCaller,
    locationId: string,
  ): Promise<CashShiftDto | null> {
    await this.assertLocation(tx, caller, locationId);
    const row = await tx.cashShift.findFirst({
      where: { locationId, status: 'open', deletedAt: null },
      include: shiftInclude,
    });
    return row ? this.toDto(tx, row) : null;
  }

  async get(tx: TenantTransaction, caller: StaffCaller, id: string): Promise<CashShiftDto> {
    return this.toDto(tx, await this.findVisible(tx, caller, id));
  }

  async list(
    tx: TenantTransaction,
    caller: StaffCaller,
    query: CashShiftListQuery,
  ): Promise<Page<CashShiftDto>> {
    if (query.locationId && !canSeeLocation(caller, query.locationId)) {
      return { items: [], nextCursor: null };
    }
    const page = pageArgs(query, 'desc');
    const rows = await tx.cashShift.findMany({
      ...page,
      where: {
        ...page.where,
        deletedAt: null,
        locationId:
          query.locationId ??
          (caller.locationIds === null ? undefined : { in: [...caller.locationIds] }),
      },
      include: shiftInclude,
    });
    const { nextCursor } = toPage(rows, query, (row) => row.id);
    const items = await Promise.all(rows.slice(0, query.limit).map((row) => this.toDto(tx, row)));
    return { items, nextCursor };
  }

  /** Closes the shift with the cash counted; the difference from what was expected is kept. */
  async close(
    tx: TenantTransaction,
    caller: StaffCaller,
    id: string,
    input: CashShiftCloseInput,
  ): Promise<CashShiftDto> {
    await this.findVisible(tx, caller, id);
    // Payments attach to an open shift under the same lock, so none slip in mid-close.
    await tx.$queryRaw`SELECT id FROM cash_shifts WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.cashShift.findUniqueOrThrow({ where: { id }, include: shiftInclude });
    if (row.status !== 'open') {
      throw conflict(ErrorCode.CASH_SHIFT_CLOSED, 'This shift is already closed');
    }
    const totals = await this.totals(tx, id);
    const expected = expectedCash(row.openingMinor, totals);
    const counted = BigInt(input.countedMinor);
    const closed = await tx.cashShift.update({
      where: { id },
      data: {
        status: 'closed',
        closedBy: caller.actor.userId,
        closedAt: this.clock.now(),
        countedMinor: counted,
        expectedMinor: expected,
        differenceMinor: counted - expected,
        note: input.note || null,
      },
      include: shiftInclude,
    });
    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'cash_shift.close',
      entity: 'cash_shift',
      entityId: id,
      after: {
        expectedMinor: expected.toString(),
        countedMinor: counted.toString(),
        differenceMinor: (counted - expected).toString(),
      },
    });
    return this.toDto(tx, closed);
  }

  /**
   * The open shift at a location, locked for this transaction, or null. Callers taking or
   * refunding money use it so a shift cannot close underneath them.
   */
  async openShiftId(
    tx: TenantTransaction,
    locationId: string,
    lock = true,
  ): Promise<string | null> {
    const rows = lock
      ? await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM cash_shifts
          WHERE location_id = ${locationId}::uuid AND status = 'open' AND deleted_at IS NULL
          FOR UPDATE`
      : await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM cash_shifts
          WHERE location_id = ${locationId}::uuid AND status = 'open' AND deleted_at IS NULL`;
    return rows[0]?.id ?? null;
  }

  async totals(tx: TenantTransaction, shiftId: string): Promise<ShiftTotals> {
    const [payments, refunds] = await Promise.all([
      tx.payment.groupBy({
        by: ['method'],
        where: { cashShiftId: shiftId, status: 'succeeded' },
        _sum: { amountMinor: true },
        _count: { _all: true },
      }),
      tx.refund.aggregate({
        where: { cashShiftId: shiftId, method: 'cash' },
        _sum: { amountMinor: true },
      }),
    ]);
    const sum = (method: string) =>
      payments.find((row) => row.method === method)?._sum.amountMinor ?? 0n;
    return {
      cashIn: sum('cash'),
      cashRefunds: refunds._sum.amountMinor ?? 0n,
      cardTerminal: sum('card_terminal'),
      transfer: sum('transfer'),
      paymentsCount: payments.reduce((count, row) => count + row._count._all, 0),
    };
  }

  private async toDto(tx: TenantTransaction, row: ShiftRow): Promise<CashShiftDto> {
    const totals = await this.totals(tx, row.id);
    const dto: CashShiftTotalsDto = {
      cashInMinor: totals.cashIn.toString(),
      cashRefundsMinor: totals.cashRefunds.toString(),
      expectedMinor: (row.expectedMinor ?? expectedCash(row.openingMinor, totals)).toString(),
      cardTerminalMinor: totals.cardTerminal.toString(),
      transferMinor: totals.transfer.toString(),
      paymentsCount: totals.paymentsCount,
    };
    return {
      id: row.id,
      location: row.location,
      status: row.status,
      openingMinor: row.openingMinor.toString(),
      openedAt: row.openedAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
      countedMinor: row.countedMinor?.toString() ?? null,
      differenceMinor: row.differenceMinor?.toString() ?? null,
      note: row.note,
      currency: row.currency,
      totals: dto,
    };
  }

  private async findVisible(tx: TenantTransaction, caller: StaffCaller, id: string) {
    const row = await tx.cashShift.findFirst({
      where: { id, deletedAt: null },
      include: shiftInclude,
    });
    if (!row || !canSeeLocation(caller, row.locationId)) {
      throw notFound('Cash shift');
    }
    return row;
  }

  private async assertLocation(
    tx: TenantTransaction,
    caller: StaffCaller,
    locationId: string,
  ): Promise<void> {
    if (!(await this.organizations.findLocation(tx, locationId))) {
      throw unprocessable(ErrorCode.INVALID_REFERENCE, 'Unknown location');
    }
    if (!canSeeLocation(caller, locationId)) {
      throw forbidden(ErrorCode.LOCATION_NOT_ASSIGNED, 'You do not work at this location');
    }
  }
}
