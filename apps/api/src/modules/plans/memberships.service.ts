import {
  addDays,
  daysBetween,
  ErrorCode,
  localDate,
  type MembershipCancelInput,
  type MembershipDto,
  type MembershipFreezeDto,
  type MembershipFreezeInput,
  type MembershipSellInput,
  type MembershipStatus,
  type MembershipSummaryDto,
  type Page,
  type PageQuery,
  startOfLocalDay,
  termEndDate,
} from '@gatefit/shared';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { Clock } from '../../common/clock/clock';
import { conflict, forbidden, notFound, unprocessable } from '../../common/errors/domain-errors';
import { canSeeLocation, type StaffCaller } from '../../common/http/staff-request';
import { pageArgs, toPage } from '../../common/pagination/paginate';
import type { TenantTransaction } from '../../common/prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import type { MembershipFacts } from '../members/member-status';
import { MembersService } from '../members/members.service';
import { OrganizationService } from '../tenancy/organization.service';
import {
  checkFreeze,
  daysLeft,
  endFreeze,
  type FreezeSpan,
  freezeUsage,
  type MembershipTerms,
  nextStatusChange,
  statusOn,
} from './membership-rules';
import { PlansService, readRestrictions } from './plans.service';

/** How far back a sale may be dated (paper records brought in) and how far ahead. */
export const SELL_DAYS_BACK = 31;
export const SELL_DAYS_AHEAD = 90;

/** Memberships the status job handles per round inside one organization. */
const DUE_BATCH = 500;

export const membershipInclude = {
  location: { select: { id: true, name: true, timezone: true } },
  freezes: { where: { deletedAt: null }, orderBy: { startsOn: 'asc' } },
} as const satisfies Prisma.MembershipInclude;

export type MembershipRow = Prisma.MembershipGetPayload<{ include: typeof membershipInclude }>;
type FreezeRow = MembershipRow['freezes'][number];

/** `YYYY-MM-DD` of a DATE column (read as midnight UTC) and back. */
const isoDate = (value: Date) => value.toISOString().slice(0, 10);
const dateColumn = (value: string) => new Date(`${value}T00:00:00Z`);

function freezeSpan(row: FreezeRow): FreezeSpan {
  return {
    startsOn: isoDate(row.startsOn),
    endsOn: isoDate(row.endsOn),
    days: row.days,
    cancelled: row.cancelledAt !== null,
  };
}

function termsOf(row: MembershipRow): MembershipTerms {
  return {
    startsOn: isoDate(row.startsOn),
    endsOn: isoDate(row.endsOn),
    visitsLeft: row.visitsLeft,
    cancelled: row.cancelledAt !== null,
    freezes: row.freezes.map(freezeSpan),
  };
}

/**
 * Memberships: selling a plan to a member, freezing and cancelling (docs/TZ.md F-2.3,
 * F-2.4). Dates follow the time zone of the location the membership was sold at. Staff
 * see a membership when they may see its member (docs/ADR/0006-member-visibility.md).
 */
@Injectable()
export class MembershipsService implements MembershipFacts {
  constructor(
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly members: MembersService,
    private readonly plans: PlansService,
    private readonly organizations: OrganizationService,
  ) {}

  async listForMember(
    tx: TenantTransaction,
    caller: StaffCaller,
    memberId: string,
    query: PageQuery,
  ): Promise<Page<MembershipDto>> {
    await this.members.findVisible(tx, caller, memberId);
    const page = pageArgs(query, 'desc');
    const rows = await tx.membership.findMany({
      ...page,
      where: { ...page.where, memberId, deletedAt: null },
      include: membershipInclude,
    });
    const now = this.clock.now();
    return toPage(rows, query, (row) => toMembershipDto(row, now));
  }

  async get(tx: TenantTransaction, caller: StaffCaller, id: string): Promise<MembershipDto> {
    return toMembershipDto(await this.findVisible(tx, caller, id), this.clock.now());
  }

  /** Sells a plan to a member. It starts today in the location's time zone unless dated. */
  async sell(
    tx: TenantTransaction,
    caller: StaffCaller,
    memberId: string,
    input: MembershipSellInput,
  ): Promise<MembershipDto> {
    const member = await this.members.findEditable(tx, caller, memberId);
    const plan = await this.plans.find(tx, input.planId);
    if (!plan.isActive) {
      throw unprocessable(ErrorCode.PLAN_INACTIVE, 'This plan is no longer sold');
    }
    const locationId = input.locationId ?? member.homeLocationId;
    const location = await this.organizations.findLocation(tx, locationId);
    if (!location) {
      throw unprocessable(ErrorCode.INVALID_REFERENCE, 'Unknown location');
    }
    if (!canSeeLocation(caller, locationId)) {
      throw forbidden(
        ErrorCode.LOCATION_NOT_ASSIGNED,
        'You can only sell at locations you work at',
      );
    }
    const restrictions = readRestrictions(plan.restrictions);
    if (restrictions.locationIds.length > 0 && !restrictions.locationIds.includes(locationId)) {
      throw unprocessable(ErrorCode.PLAN_NOT_AT_LOCATION, 'This plan is not valid at the location');
    }
    if (plan.type === 'trial') {
      const used = await tx.membership.findFirst({
        where: { memberId, planType: 'trial', cancelledAt: null, deletedAt: null },
        select: { id: true },
      });
      if (used) {
        throw conflict(ErrorCode.TRIAL_ALREADY_USED, 'The member has already had a trial');
      }
    }

    const now = this.clock.now();
    const today = localDate(now, location.timezone);
    const startsOn = input.startsOn ?? today;
    const offset = daysBetween(today, startsOn);
    const endsOn = termEndDate(startsOn, plan.durationValue, plan.durationUnit);
    if (offset < -SELL_DAYS_BACK || offset > SELL_DAYS_AHEAD || endsOn < today) {
      throw unprocessable(
        ErrorCode.INVALID_START_DATE,
        `Start within ${SELL_DAYS_BACK} days back and ${SELL_DAYS_AHEAD} days ahead, and end today or later`,
        {
          minStartsOn: addDays(today, -SELL_DAYS_BACK),
          maxStartsOn: addDays(today, SELL_DAYS_AHEAD),
        },
      );
    }
    const visitLimit = plan.type === 'single' ? 1 : plan.visitLimit;
    const terms: MembershipTerms = {
      startsOn,
      endsOn,
      visitsLeft: visitLimit,
      cancelled: false,
      freezes: [],
    };

    const row = await tx.membership.create({
      data: {
        organizationId: caller.organizationId,
        memberId,
        planId: plan.id,
        locationId,
        planName: plan.name,
        planType: plan.type,
        visitLimit,
        priceMinor: plan.priceMinor,
        currency: plan.currency,
        restrictions,
        freezeMaxDays: plan.freezeMaxDays,
        freezeMaxTimes: plan.freezeMaxTimes,
        freezeMinDays: plan.freezeMinDays,
        freezeFeeMinor: plan.freezeFeeMinor,
        startsOn: dateColumn(startsOn),
        endsOn: dateColumn(endsOn),
        startsAt: startOfLocalDay(startsOn, location.timezone),
        endsAt: startOfLocalDay(addDays(endsOn, 1), location.timezone),
        visitsLeft: visitLimit,
        status: statusOn(terms, today),
        statusChangesAt: nextStatusChange(terms, now, location.timezone),
        soldBy: caller.actor.userId,
      },
      include: membershipInclude,
    });

    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'membership.sell',
      entity: 'membership',
      entityId: row.id,
      after: {
        memberId,
        planId: plan.id,
        locationId,
        priceMinor: row.priceMinor.toString(),
        currency: row.currency,
        startsOn,
        endsOn,
        status: row.status,
      },
    });
    await this.refreshMember(tx, memberId);
    return toMembershipDto(row, now);
  }

  /** Freezes a membership from a day on; its last day moves later by the frozen days. */
  async freeze(
    tx: TenantTransaction,
    caller: StaffCaller,
    id: string,
    input: MembershipFreezeInput,
  ): Promise<MembershipDto> {
    const row = await this.findChangeable(tx, caller, id);
    const timeZone = row.location.timezone;
    const now = this.clock.now();
    const today = localDate(now, timeZone);
    const terms = termsOf(row);
    const status = statusOn(terms, today);
    if (status !== 'active' && status !== 'frozen') {
      throw conflict(ErrorCode.MEMBERSHIP_NOT_IN_FORCE, 'Only a membership in force can be frozen');
    }

    const limits = {
      maxDays: row.freezeMaxDays,
      maxTimes: row.freezeMaxTimes,
      minDays: row.freezeMinDays,
    };
    const refusal = checkFreeze(terms, limits, input, today);
    if (refusal) {
      const usage = freezeUsage(terms.freezes);
      switch (refusal.code) {
        case 'FREEZE_NOT_ALLOWED':
          throw unprocessable(ErrorCode.FREEZE_NOT_ALLOWED, 'This plan cannot be frozen');
        case 'INVALID_FREEZE_DATES':
          throw unprocessable(
            ErrorCode.INVALID_FREEZE_DATES,
            'A freeze starts today or later, before the membership ends',
            {
              minStartsOn: today > terms.startsOn ? today : terms.startsOn,
              maxStartsOn: terms.endsOn,
            },
          );
        case 'FREEZE_LIMIT_EXCEEDED':
          throw unprocessable(ErrorCode.FREEZE_LIMIT_EXCEEDED, 'The freeze is outside the limits', {
            ...limits,
            ...usage,
          });
        case 'FREEZE_OVERLAP':
          throw conflict(ErrorCode.FREEZE_OVERLAP, 'Another freeze covers some of these days', {
            startsOn: refusal.with.startsOn,
            endsOn: refusal.with.endsOn,
          });
      }
    }

    const freezeEndsOn = addDays(input.startsOn, input.days - 1);
    const created = await tx.membershipFreeze.create({
      data: {
        organizationId: caller.organizationId,
        membershipId: id,
        startsOn: dateColumn(input.startsOn),
        endsOn: dateColumn(freezeEndsOn),
        startsAt: startOfLocalDay(input.startsOn, timeZone),
        endsAt: startOfLocalDay(addDays(freezeEndsOn, 1), timeZone),
        days: input.days,
        reason: input.reason,
        source: input.source,
        feeMinor: row.freezeFeeMinor,
        currency: row.currency,
        createdBy: caller.actor.userId,
      },
    });
    const updated = await this.moveEnd(tx, row, input.days, now, [freezeSpan(created)]);

    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'membership.freeze',
      entity: 'membership',
      entityId: id,
      before: { endsOn: terms.endsOn, status: row.status },
      after: {
        freezeId: created.id,
        startsOn: input.startsOn,
        days: input.days,
        source: input.source,
        feeMinor: created.feeMinor.toString(),
        endsOn: isoDate(updated.endsOn),
        status: updated.status,
      },
    });
    await this.refreshMember(tx, row.memberId);
    return toMembershipDto(updated, now);
  }

  /**
   * Ends the freeze in progress (keeping the days used) or, if none, drops the next planned
   * one. The membership's last day moves back by the days given back.
   */
  async unfreeze(tx: TenantTransaction, caller: StaffCaller, id: string): Promise<MembershipDto> {
    const row = await this.findChangeable(tx, caller, id);
    const timeZone = row.location.timezone;
    const now = this.clock.now();
    const today = localDate(now, timeZone);
    const terms = termsOf(row);
    if (terms.cancelled || statusOn(terms, today) === 'expired') {
      throw conflict(ErrorCode.MEMBERSHIP_NOT_IN_FORCE, 'The membership is no longer in force');
    }
    const ending = endFreeze(terms.freezes, today);
    const freezeRow =
      ending &&
      row.freezes.find(
        (f) => isoDate(f.startsOn) === ending.freeze.startsOn && f.cancelledAt === null,
      );
    if (!ending || !freezeRow) {
      throw conflict(ErrorCode.NO_FREEZE_TO_END, 'There is no freeze to end');
    }

    const changed =
      ending.kind === 'ended_early'
        ? await tx.membershipFreeze.update({
            where: { id: freezeRow.id },
            data: {
              endsOn: dateColumn(ending.endsOn),
              endsAt: startOfLocalDay(today, timeZone),
              days: ending.daysKept,
              endedEarlyAt: now,
            },
          })
        : await tx.membershipFreeze.update({
            where: { id: freezeRow.id },
            data: { cancelledAt: now },
          });
    const others = row.freezes.filter((f) => f.id !== freezeRow.id).map(freezeSpan);
    const updated = await this.moveEnd(
      tx,
      row,
      -ending.daysReturned,
      now,
      [...others, freezeSpan(changed)],
      true,
    );

    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'membership.unfreeze',
      entity: 'membership',
      entityId: id,
      before: { endsOn: terms.endsOn, status: row.status },
      after: {
        freezeId: freezeRow.id,
        kind: ending.kind,
        daysReturned: ending.daysReturned,
        endsOn: isoDate(updated.endsOn),
        status: updated.status,
      },
    });
    await this.refreshMember(tx, row.memberId);
    return toMembershipDto(updated, now);
  }

  /** Ends a membership before its time. Refunds belong to payments (stage M4). */
  async cancel(
    tx: TenantTransaction,
    caller: StaffCaller,
    id: string,
    input: MembershipCancelInput,
  ): Promise<MembershipDto> {
    const row = await this.findChangeable(tx, caller, id);
    const now = this.clock.now();
    const today = localDate(now, row.location.timezone);
    const before = statusOn(termsOf(row), today);
    if (before === 'cancelled' || before === 'expired') {
      throw conflict(ErrorCode.MEMBERSHIP_NOT_IN_FORCE, 'The membership has already ended');
    }
    const updated = await tx.membership.update({
      where: { id },
      data: {
        status: 'cancelled',
        statusChangesAt: null,
        cancelledAt: now,
        cancelledBy: caller.actor.userId,
        cancelReason: input.reason,
      },
      include: membershipInclude,
    });
    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'membership.cancel',
      entity: 'membership',
      entityId: id,
      before: { status: before },
      after: { status: 'cancelled', reason: input.reason },
    });
    await this.refreshMember(tx, row.memberId);
    return toMembershipDto(updated, now);
  }

  /**
   * Brings memberships whose status was due to change by `now` up to date, inside the
   * current organization. Safe to run again or alongside another run: a row is updated
   * only if it still holds what was read. Returns how many changed status.
   */
  async applyDueChanges(tx: TenantTransaction, organizationId: string, now: Date): Promise<number> {
    let changedCount = 0;
    const seen = new Set<string>();
    for (;;) {
      const rows = await tx.membership.findMany({
        where: { statusChangesAt: { lte: now }, deletedAt: null, id: { notIn: [...seen] } },
        include: membershipInclude,
        orderBy: { id: 'asc' },
        take: DUE_BATCH,
      });
      const members = new Set<string>();
      for (const row of rows) {
        seen.add(row.id);
        const terms = termsOf(row);
        const timeZone = row.location.timezone;
        const status = statusOn(terms, localDate(now, timeZone));
        const { count } = await tx.membership.updateMany({
          where: { id: row.id, status: row.status, statusChangesAt: row.statusChangesAt },
          data: { status, statusChangesAt: nextStatusChange(terms, now, timeZone) },
        });
        if (count === 1 && status !== row.status) {
          changedCount += 1;
          members.add(row.memberId);
          await this.audit.record(tx, organizationId, null, {
            action: 'membership.status',
            entity: 'membership',
            entityId: row.id,
            before: { status: row.status },
            after: { status },
          });
        }
      }
      for (const memberId of members) {
        await this.refreshMember(tx, memberId);
      }
      if (rows.length < DUE_BATCH) {
        return changedCount;
      }
    }
  }

  // --- MembershipFacts, for the members module ---

  async statusesOf(tx: TenantTransaction, memberId: string): Promise<MembershipStatus[]> {
    const rows = await tx.membership.findMany({
      where: { memberId, deletedAt: null },
      select: { status: true },
    });
    return rows.map((row) => row.status);
  }

  async summariesOf(
    tx: TenantTransaction,
    memberIds: readonly string[],
  ): Promise<Map<string, MembershipSummaryDto>> {
    const summaries = new Map<string, MembershipSummaryDto>();
    if (memberIds.length === 0) {
      return summaries;
    }
    const rows = await tx.membership.findMany({
      where: {
        memberId: { in: [...memberIds] },
        deletedAt: null,
        status: { in: ['active', 'frozen', 'scheduled'] },
      },
      include: { location: { select: { timezone: true } } },
      // In force before scheduled, then the one that ends first (docs/TZ.md section 6).
      orderBy: [{ startsOn: 'asc' }, { endsOn: 'asc' }],
    });
    const now = this.clock.now();
    const rank = (status: MembershipStatus) => (status === 'scheduled' ? 1 : 0);
    for (const row of rows) {
      const current = summaries.get(row.memberId);
      const endsOn = isoDate(row.endsOn);
      if (
        current &&
        (rank(current.status) < rank(row.status) ||
          (rank(current.status) === rank(row.status) && current.endsOn <= endsOn))
      ) {
        continue;
      }
      summaries.set(row.memberId, {
        id: row.id,
        planName: row.planName,
        status: row.status,
        endsOn,
        daysLeft: daysLeft(row.status, endsOn, localDate(now, row.location.timezone)),
        visitsLeft: row.visitsLeft,
      });
    }
    return summaries;
  }

  // --- helpers ---

  /** Moves the last day by `days` (negative: earlier) and recomputes the status. */
  private async moveEnd(
    tx: TenantTransaction,
    row: MembershipRow,
    days: number,
    now: Date,
    freezes: FreezeSpan[],
    replaceFreezes = false,
  ): Promise<MembershipRow> {
    const timeZone = row.location.timezone;
    const endsOn = addDays(isoDate(row.endsOn), days);
    const terms: MembershipTerms = {
      ...termsOf(row),
      endsOn,
      freezes: replaceFreezes ? freezes : [...row.freezes.map(freezeSpan), ...freezes],
    };
    return tx.membership.update({
      where: { id: row.id },
      data: {
        endsOn: dateColumn(endsOn),
        endsAt: startOfLocalDay(addDays(endsOn, 1), timeZone),
        status: statusOn(terms, localDate(now, timeZone)),
        statusChangesAt: nextStatusChange(terms, now, timeZone),
      },
      include: membershipInclude,
    });
  }

  private async refreshMember(tx: TenantTransaction, memberId: string): Promise<void> {
    await this.members.refreshStatus(tx, memberId, await this.statusesOf(tx, memberId));
  }

  private async findVisible(
    tx: TenantTransaction,
    caller: StaffCaller,
    id: string,
  ): Promise<MembershipRow> {
    const row = await tx.membership.findFirst({
      where: { id, deletedAt: null },
      include: membershipInclude,
    });
    if (!row) {
      throw notFound('Membership');
    }
    // 404 when the member is out of the caller's sight, as for the member itself.
    await this.members.findVisible(tx, caller, row.memberId);
    return row;
  }

  /** A visible membership whose member is not archived. */
  private async findChangeable(
    tx: TenantTransaction,
    caller: StaffCaller,
    id: string,
  ): Promise<MembershipRow> {
    const row = await this.findVisible(tx, caller, id);
    await this.members.findEditable(tx, caller, row.memberId);
    return row;
  }
}

function toFreezeDto(row: FreezeRow): MembershipFreezeDto {
  return {
    id: row.id,
    startsOn: isoDate(row.startsOn),
    endsOn: isoDate(row.endsOn),
    days: row.days,
    reason: row.reason,
    source: row.source,
    feeMinor: row.feeMinor.toString(),
    currency: row.currency,
    endedEarly: row.endedEarlyAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toMembershipDto(row: MembershipRow, now: Date): MembershipDto {
  const terms = termsOf(row);
  const today = localDate(now, row.location.timezone);
  const counted = row.freezes.filter((freeze) => freeze.cancelledAt === null);
  return {
    id: row.id,
    memberId: row.memberId,
    plan: { id: row.planId, name: row.planName, type: row.planType },
    location: row.location,
    status: row.status,
    startsOn: terms.startsOn,
    endsOn: terms.endsOn,
    endsAt: row.endsAt.toISOString(),
    daysLeft: daysLeft(row.status, terms.endsOn, today),
    visitLimit: row.visitLimit,
    visitsLeft: row.visitsLeft,
    priceMinor: row.priceMinor.toString(),
    currency: row.currency,
    restrictions: readRestrictions(row.restrictions),
    freeze: {
      maxDays: row.freezeMaxDays,
      maxTimes: row.freezeMaxTimes,
      minDays: row.freezeMinDays,
      feeMinor: row.freezeFeeMinor.toString(),
      ...freezeUsage(terms.freezes),
    },
    freezes: counted.map(toFreezeDto),
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelReason: row.cancelReason,
    createdAt: row.createdAt.toISOString(),
  };
}
