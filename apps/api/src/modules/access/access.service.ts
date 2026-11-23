import {
  type AccessDenyReason,
  type AccessExitInput,
  type AccessManualInput,
  type AccessMembershipDto,
  type AccessResultDto,
  type AccessSyncInput,
  type AccessSyncResultDto,
  type AccessVerifyInput,
  type CheckInDto,
  type CheckInListQuery,
  decideEntry,
  type EntryDecision,
  type EntryMembership,
  entryDaysLeft,
  ErrorCode,
  type LocationDto,
  localDate,
  OCCUPANCY_HOURS,
  type OccupancyDto,
  OFFLINE_SYNC_MAX_AGE_HOURS,
  type OfflineSnapshotDto,
  type Page,
  QR_CLOCK_SKEW_SECONDS,
  type QrTokenDto,
  REPEAT_SCAN_SECONDS,
  startOfLocalDay,
} from '@gatefit/shared';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { Clock } from '../../common/clock/clock';
import { forbidden, notFound, unprocessable } from '../../common/errors/domain-errors';
import { canSeeLocation, type StaffCaller } from '../../common/http/staff-request';
import { uuidv7 } from '../../common/ids/uuid-v7';
import { pageArgs, toPage } from '../../common/pagination/paginate';
import type { TenantTransaction } from '../../common/prisma/prisma.service';
import { TenantDb } from '../../common/tenancy/tenant-db.service';
import type { CheckIn, Prisma } from '../../generated/prisma/client';
import { type EntryProfile, MembersService } from '../members/members.service';
import { MembershipsService } from '../plans/memberships.service';
import { OrganizationService } from '../tenancy/organization.service';
import { AccessEventsService } from './access-events.service';
import { AccessTokensService } from './access-tokens.service';

const HOUR_MS = 60 * 60 * 1000;

type CheckInRow = Pick<
  CheckIn,
  | 'id'
  | 'at'
  | 'locationId'
  | 'memberId'
  | 'membershipId'
  | 'direction'
  | 'method'
  | 'result'
  | 'denyReason'
  | 'note'
>;

/**
 * Entry control (docs/TZ.md F-3.1 to F-3.4, docs/ADR/0010-access.md): member QR codes,
 * the reception desk's checks, entries by hand, the journal and who is inside. Owns the
 * check_ins table; members and memberships are reached through their services.
 */
@Injectable()
export class AccessService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly tokens: AccessTokensService,
    private readonly events: AccessEventsService,
    private readonly members: MembersService,
    private readonly memberships: MembershipsService,
    private readonly organizations: OrganizationService,
  ) {}

  /** The signed-in member's current code. */
  async qr(tx: TenantTransaction, organizationId: string, userId: string): Promise<QrTokenDto> {
    const memberId = await this.members.memberIdOfUser(tx, userId);
    if (!memberId) {
      throw notFound('Member');
    }
    return this.tokens.issue(organizationId, memberId, this.clock.now());
  }

  /** A scanned code at a desk: decides, records the entry and tells the location's screens. */
  async verify(
    tx: TenantTransaction,
    caller: StaffCaller,
    input: AccessVerifyInput,
  ): Promise<AccessResultDto> {
    const location = await this.assertLocation(tx, caller, input.locationId);
    const now = this.clock.now();
    const token = this.tokens.check(caller.organizationId, input.token, now);
    if (!token.ok && token.reason === 'invalid_code') {
      return refusal('invalid_code', null);
    }
    const profile = (await this.members.entryProfiles(tx, { ids: [token.memberId] }, true)).get(
      token.memberId,
    );
    if (!profile || profile.archived) {
      return refusal('member_not_found', null);
    }
    if (!token.ok) {
      const row = await this.record(tx, caller, location, profile, {
        method: 'qr',
        decision: { allowed: false, reason: 'expired_code', membership: null },
        at: now,
      });
      return this.result(row, profile, null, now, false);
    }

    const repeat = await this.recentEntry(tx, profile.id, location.id, now);
    const memberships = await this.entryMembershipsOf(tx, profile.id, now);
    if (repeat) {
      const membership = memberships.find((item) => item.id === repeat.membershipId) ?? null;
      return this.result(repeat, profile, membership, now, true);
    }

    const decision = await this.decide(tx, profile, memberships, location, now);
    const row = await this.record(tx, caller, location, profile, {
      method: 'qr',
      decision,
      at: now,
    });
    const membership = decision.membership && (await this.spendVisit(tx, decision, now));
    return this.result(row, profile, membership, now, false);
  }

  /**
   * Staff let a member in by hand, with a reason (docs/TZ.md F-3.4). It is their call: the
   * entry is recorded as allowed even when the rules would refuse, and audited.
   */
  async manual(
    tx: TenantTransaction,
    caller: StaffCaller,
    input: AccessManualInput,
  ): Promise<AccessResultDto> {
    const location = await this.assertLocation(tx, caller, input.locationId);
    const profile = await this.profileOf(tx, input.memberId);
    const now = this.clock.now();
    const memberships = await this.entryMembershipsOf(tx, profile.id, now);
    const decision = await this.decide(tx, profile, memberships, location, now);
    const row = await this.record(tx, caller, location, profile, {
      method: 'manual',
      decision: decision.allowed ? decision : { allowed: true, membership: null },
      at: now,
      note: input.reason,
    });
    const membership = decision.allowed ? await this.spendVisit(tx, decision, now) : null;
    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'check_in.manual',
      entity: 'check_in',
      entityId: row.id,
      after: {
        memberId: profile.id,
        locationId: location.id,
        reason: input.reason,
        // What the rules would have said: the override is visible in the audit trail.
        refusal: decision.allowed ? null : decision.reason,
      },
    });
    return this.result(row, profile, membership, now, false);
  }

  /** Staff mark a member as gone, so they no longer count as inside. */
  async exit(
    tx: TenantTransaction,
    caller: StaffCaller,
    input: AccessExitInput,
  ): Promise<CheckInDto> {
    const location = await this.assertLocation(tx, caller, input.locationId);
    const profile = await this.profileOf(tx, input.memberId);
    const row = await this.record(tx, caller, location, profile, {
      method: 'manual',
      decision: { allowed: true, membership: null },
      at: this.clock.now(),
      direction: 'out',
    });
    return toCheckInDto(row, location, profile);
  }

  async list(
    tx: TenantTransaction,
    caller: StaffCaller,
    query: CheckInListQuery,
  ): Promise<Page<CheckInDto>> {
    if (query.locationId && !canSeeLocation(caller, query.locationId)) {
      throw forbidden(ErrorCode.LOCATION_NOT_ASSIGNED, 'You do not work at this location');
    }
    const page = pageArgs(query, 'desc');
    const where: Prisma.CheckInWhereInput = {
      ...page.where,
      locationId:
        query.locationId ?? (caller.locationIds ? { in: [...caller.locationIds] } : undefined),
      memberId: query.memberId,
      result: query.result,
      at: {
        gte: query.from ? new Date(query.from) : undefined,
        lt: query.to ? new Date(query.to) : undefined,
      },
    };
    const rows = await tx.checkIn.findMany({ ...page, where });
    const [locations, profiles] = await Promise.all([
      this.locationsById(tx),
      this.members.entryProfiles(tx, { ids: [...new Set(rows.map((row) => row.memberId))] }, false),
    ]);
    return toPage(rows, query, (row) =>
      toCheckInDto(row, locations.get(row.locationId), profiles.get(row.memberId)),
    );
  }

  async occupancy(
    tx: TenantTransaction,
    caller: StaffCaller,
    locationId: string,
  ): Promise<OccupancyDto> {
    await this.assertLocation(tx, caller, locationId);
    return this.occupancyOf(tx, locationId, this.clock.now());
  }

  /** What a reception screen keeps to decide on its own while offline. */
  async snapshot(
    tx: TenantTransaction,
    caller: StaffCaller,
    locationId: string,
  ): Promise<OfflineSnapshotDto> {
    const location = await this.assertLocation(tx, caller, locationId);
    const now = this.clock.now();
    const memberships = await this.memberships.entryMemberships(tx, { locationId }, now);
    const profiles = await this.members.entryProfiles(tx, { ids: [...memberships.keys()] }, false);
    return {
      generatedAt: now.toISOString(),
      location: { id: location.id, name: location.name, timezone: location.timezone },
      ...this.tokens.publicKey(caller.organizationId),
      members: [...memberships.entries()].flatMap(([memberId, list]) => {
        const profile = profiles.get(memberId);
        return profile && !profile.archived
          ? [
              {
                id: profile.id,
                firstName: profile.firstName,
                lastName: profile.lastName,
                status: profile.status,
                memberships: list,
              },
            ]
          : [];
      }),
    };
  }

  /** Entries a reception screen decided while offline. Resending a batch records nothing twice. */
  async sync(
    tx: TenantTransaction,
    caller: StaffCaller,
    input: AccessSyncInput,
  ): Promise<AccessSyncResultDto> {
    const location = await this.assertLocation(tx, caller, input.locationId);
    const now = this.clock.now();
    const oldest = now.getTime() - OFFLINE_SYNC_MAX_AGE_HOURS * HOUR_MS;
    const newest = now.getTime() + QR_CLOCK_SKEW_SECONDS * 1000;
    const tooOld = input.checkIns.find((item) => {
      const at = new Date(item.at).getTime();
      return at < oldest || at > newest;
    });
    if (tooOld) {
      throw unprocessable(ErrorCode.VALIDATION_FAILED, 'An entry is too old or in the future', {
        id: tooOld.id,
      });
    }
    const memberIds = [...new Set(input.checkIns.map((item) => item.memberId))];
    const [profiles, memberships] = await Promise.all([
      this.members.entryProfiles(tx, { ids: memberIds }, false),
      this.memberships.entryMemberships(tx, { memberIds }, new Date(oldest)),
    ]);
    let recorded = 0;
    for (const item of input.checkIns) {
      if (!profiles.has(item.memberId)) {
        continue;
      }
      const owned = memberships.get(item.memberId)?.some((m) => m.id === item.membershipId);
      const membershipId = owned ? item.membershipId : null;
      const { count } = await tx.checkIn.createMany({
        data: [
          {
            id: item.id,
            organizationId: caller.organizationId,
            at: new Date(item.at),
            locationId: location.id,
            memberId: item.memberId,
            membershipId,
            direction: 'in',
            method: 'qr_offline',
            result: item.result,
            denyReason: item.result === 'denied' ? (item.denyReason ?? 'invalid_code') : null,
            recordedBy: caller.actor.userId,
          },
        ],
        skipDuplicates: true,
      });
      if (count === 1) {
        recorded += 1;
        if (item.result === 'allowed' && membershipId) {
          await this.memberships.takeVisit(tx, membershipId, now);
        }
      }
    }
    return { recorded, duplicates: input.checkIns.length - recorded };
  }

  /** Entries at a location in a time range, for the daily report. */
  async dayVisits(
    tx: TenantTransaction,
    locationId: string,
    from: Date,
    to: Date,
  ): Promise<{ entries: number; members: number; refused: number }> {
    const where = { locationId, direction: 'in' as const, at: { gte: from, lt: to } };
    const [entries, members, refused] = await Promise.all([
      tx.checkIn.count({ where: { ...where, result: 'allowed' } }),
      tx.checkIn.groupBy({ by: ['memberId'], where: { ...where, result: 'allowed' } }),
      tx.checkIn.count({ where: { ...where, result: 'denied' } }),
    ]);
    return { entries, members: members.length, refused };
  }

  // --- helpers ---

  private async decide(
    tx: TenantTransaction,
    profile: EntryProfile,
    memberships: EntryMembership[],
    location: LocationDto,
    now: Date,
  ): Promise<EntryDecision> {
    const visits = await this.visitsToday(tx, profile.id, location, now);
    return decideEntry(profile.status, memberships, {
      locationId: location.id,
      locationTimeZone: location.timezone,
      now,
      visitsToday: (membershipId) => visits.get(membershipId) ?? 0,
    });
  }

  private async entryMembershipsOf(
    tx: TenantTransaction,
    memberId: string,
    now: Date,
  ): Promise<EntryMembership[]> {
    return (
      (await this.memberships.entryMemberships(tx, { memberIds: [memberId] }, now)).get(memberId) ??
      []
    );
  }

  /** Entries let in today (the location's day), per membership. */
  private async visitsToday(
    tx: TenantTransaction,
    memberId: string,
    location: LocationDto,
    now: Date,
  ): Promise<Map<string, number>> {
    const since = startOfLocalDay(localDate(now, location.timezone), location.timezone);
    const rows = await tx.checkIn.groupBy({
      by: ['membershipId'],
      where: { memberId, result: 'allowed', direction: 'in', at: { gte: since } },
      _count: { _all: true },
    });
    const visits = new Map<string, number>();
    for (const row of rows) {
      if (row.membershipId) {
        visits.set(row.membershipId, row._count._all);
      }
    }
    return visits;
  }

  /** The member's entry here a moment ago, if any: a second scan is not a second visit. */
  private async recentEntry(
    tx: TenantTransaction,
    memberId: string,
    locationId: string,
    now: Date,
  ): Promise<CheckInRow | null> {
    return tx.checkIn.findFirst({
      where: {
        memberId,
        locationId,
        result: 'allowed',
        direction: 'in',
        at: { gt: new Date(now.getTime() - REPEAT_SCAN_SECONDS * 1000), lte: now },
      },
      orderBy: { at: 'desc' },
    });
  }

  /** Spends a visit when the chosen membership counts them; returns it as it is now. */
  private async spendVisit(
    tx: TenantTransaction,
    decision: EntryDecision,
    now: Date,
  ): Promise<EntryMembership | null> {
    const membership = decision.membership;
    if (!decision.allowed || !membership || membership.visitsLeft === null) {
      return membership;
    }
    const visitsLeft = await this.memberships.takeVisit(tx, membership.id, now);
    return { ...membership, visitsLeft };
  }

  private async record(
    tx: TenantTransaction,
    caller: StaffCaller,
    location: LocationDto,
    profile: EntryProfile,
    entry: {
      method: 'qr' | 'manual';
      decision: { allowed: true; membership: EntryMembership | null } | EntryDecision;
      at: Date;
      note?: string;
      direction?: 'in' | 'out';
    },
  ): Promise<CheckInRow> {
    const { decision } = entry;
    const row = await tx.checkIn.create({
      data: {
        id: uuidv7(entry.at),
        organizationId: caller.organizationId,
        at: entry.at,
        locationId: location.id,
        memberId: profile.id,
        membershipId: decision.allowed ? (decision.membership?.id ?? null) : null,
        direction: entry.direction ?? 'in',
        method: entry.method,
        result: decision.allowed ? 'allowed' : 'denied',
        denyReason: decision.allowed ? null : decision.reason,
        note: entry.note ?? null,
        recordedBy: caller.actor.userId,
      },
    });
    const occupancy = await this.occupancyOf(tx, location.id, entry.at);
    const event = { checkIn: toCheckInDto(row, location, profile), occupancy };
    const organizationId = caller.organizationId;
    this.tenantDb.afterCommit(() => {
      this.events.publish(organizationId, event);
    });
    return row;
  }

  private async occupancyOf(
    tx: TenantTransaction,
    locationId: string,
    now: Date,
  ): Promise<OccupancyDto> {
    const since = new Date(now.getTime() - OCCUPANCY_HOURS * HOUR_MS);
    // Everyone whose latest allowed movement here in the last hours was coming in.
    const [row] = await tx.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM (
        SELECT DISTINCT ON (member_id) direction
        FROM check_ins
        WHERE location_id = ${locationId}::uuid AND result = 'allowed'
          AND at > ${since} AND at <= ${now}
        ORDER BY member_id, at DESC
      ) latest
      WHERE direction = 'in'`;
    return { locationId, count: Number(row?.count ?? 0) };
  }

  private result(
    row: CheckInRow,
    profile: EntryProfile,
    membership: EntryMembership | null,
    now: Date,
    repeat: boolean,
  ): AccessResultDto {
    return {
      allowed: row.result === 'allowed',
      reason: (row.denyReason as AccessDenyReason | null) ?? null,
      member: {
        id: profile.id,
        firstName: profile.firstName,
        lastName: profile.lastName,
        photoUrl: profile.photoUrl,
      },
      membership: membership && toAccessMembership(membership, now),
      checkInId: row.id,
      repeat,
    };
  }

  private async profileOf(tx: TenantTransaction, memberId: string): Promise<EntryProfile> {
    const profile = (await this.members.entryProfiles(tx, { ids: [memberId] }, true)).get(memberId);
    if (!profile || profile.archived) {
      throw notFound('Member');
    }
    return profile;
  }

  private async locationsById(tx: TenantTransaction): Promise<Map<string, LocationDto>> {
    const locations = await this.organizations.listLocations(tx, true);
    return new Map(locations.map((location) => [location.id, location]));
  }

  private async assertLocation(
    tx: TenantTransaction,
    caller: StaffCaller,
    locationId: string,
  ): Promise<LocationDto> {
    const location = await this.organizations.findLocation(tx, locationId);
    if (!location) {
      throw unprocessable(ErrorCode.INVALID_REFERENCE, 'Unknown location');
    }
    if (!canSeeLocation(caller, locationId)) {
      throw forbidden(ErrorCode.LOCATION_NOT_ASSIGNED, 'You do not work at this location');
    }
    return location;
  }
}

function refusal(reason: AccessDenyReason, member: null): AccessResultDto {
  return { allowed: false, reason, member, membership: null, checkInId: null, repeat: false };
}

function toAccessMembership(membership: EntryMembership, now: Date): AccessMembershipDto {
  return {
    id: membership.id,
    planName: membership.planName,
    planType: membership.planType,
    endsOn: membership.endsOn,
    daysLeft: entryDaysLeft(membership, now),
    visitsLeft: membership.visitsLeft,
  };
}

function toCheckInDto(
  row: CheckInRow,
  location: { id: string; name: string } | undefined,
  profile: { id: string; firstName: string; lastName: string } | undefined,
): CheckInDto {
  return {
    id: row.id,
    at: row.at.toISOString(),
    location: { id: row.locationId, name: location?.name ?? '' },
    member: {
      id: row.memberId,
      firstName: profile?.firstName ?? '',
      lastName: profile?.lastName ?? '',
    },
    membershipId: row.membershipId,
    direction: row.direction,
    method: row.method,
    result: row.result,
    denyReason: (row.denyReason as AccessDenyReason | null) ?? null,
    note: row.note,
  };
}
