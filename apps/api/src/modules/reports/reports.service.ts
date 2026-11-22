import {
  addDays,
  type DailyReportDto,
  type DailyReportQuery,
  ErrorCode,
  localDate,
  startOfLocalDay,
} from '@gatefit/shared';
import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock/clock';
import { forbidden, unprocessable } from '../../common/errors/domain-errors';
import { canSeeLocation, type StaffCaller } from '../../common/http/staff-request';
import type { TenantTransaction } from '../../common/prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { PaymentsService } from '../billing/payments.service';
import { MembersService } from '../members/members.service';
import { MembershipsService } from '../plans/memberships.service';
import { OrganizationService } from '../tenancy/organization.service';

/** How far ahead "ending soon" looks, in days after the report's day. */
const ENDING_SOON_DAYS = 7;

/**
 * The daily summary of a location (docs/TZ.md F-8.1). Owns no tables: every figure comes
 * from the module that owns it (CLAUDE.md rule 7). The day is the location's calendar day.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly clock: Clock,
    private readonly organizations: OrganizationService,
    private readonly payments: PaymentsService,
    private readonly members: MembersService,
    private readonly access: AccessService,
    private readonly memberships: MembershipsService,
  ) {}

  async daily(
    tx: TenantTransaction,
    caller: StaffCaller,
    query: DailyReportQuery,
  ): Promise<DailyReportDto> {
    const location = await this.organizations.findLocation(tx, query.locationId);
    if (!location) {
      throw unprocessable(ErrorCode.INVALID_REFERENCE, 'Unknown location');
    }
    if (!canSeeLocation(caller, location.id)) {
      throw forbidden(ErrorCode.LOCATION_NOT_ASSIGNED, 'You do not work at this location');
    }
    const zone = location.timezone;
    const date = query.date ?? localDate(this.clock.now(), zone);
    const from = startOfLocalDay(date, zone);
    const to = startOfLocalDay(addDays(date, 1), zone);
    const [currency, money, newMembers, visits, expiring] = await Promise.all([
      this.organizations.currency(tx, caller.organizationId),
      this.payments.dayTotals(tx, location.id, from, to),
      this.members.countAdded(tx, location.id, from, to),
      this.access.dayVisits(tx, location.id, from, to),
      this.memberships.endingBetween(tx, location.id, date, addDays(date, ENDING_SOON_DAYS)),
    ]);
    const taken = money.revenue.reduce((sum, line) => sum + BigInt(line.amountMinor), 0n);
    return {
      date,
      location: { id: location.id, name: location.name, timezone: zone },
      currency,
      revenue: money.revenue,
      refundsMinor: money.refundsMinor,
      netMinor: (taken - BigInt(money.refundsMinor)).toString(),
      newMembers,
      visits,
      expiring,
    };
  }
}
