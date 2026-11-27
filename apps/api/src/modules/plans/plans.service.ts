import {
  ErrorCode,
  type Page,
  type PlanCreateInput,
  type PlanDto,
  type PlanListQuery,
  type PlanRestrictions,
  planRestrictionsSchema,
  planShapeIssues,
  type PlanUpdateInput,
} from '@gatefit/shared';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { notFound, unprocessable } from '../../common/errors/domain-errors';
import type { StaffCaller } from '../../common/http/staff-request';
import { pageArgs, toPage } from '../../common/pagination/paginate';
import type { TenantTransaction } from '../../common/prisma/prisma.service';
import type { Plan } from '../../generated/prisma/client';
import { OrganizationService } from '../tenancy/organization.service';

/** Restrictions as stored; rows written by older code are read leniently. */
export function readRestrictions(value: unknown): PlanRestrictions {
  const parsed = planRestrictionsSchema.safeParse(value);
  return parsed.success
    ? parsed.data
    : { timeWindows: [], weekdays: [], dailyVisitLimit: null, locationIds: [] };
}

export function toPlanDto(row: Plan): PlanDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    durationValue: row.durationValue,
    durationUnit: row.durationUnit,
    visitLimit: row.visitLimit,
    priceMinor: row.priceMinor.toString(),
    currency: row.currency,
    restrictions: readRestrictions(row.restrictions),
    freeze: {
      maxDays: row.freezeMaxDays,
      maxTimes: row.freezeMaxTimes,
      minDays: row.freezeMinDays,
      feeMinor: row.freezeFeeMinor.toString(),
    },
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Fields whose change the audit trail records by name. */
const PLAN_FIELDS = [
  'name',
  'description',
  'type',
  'durationValue',
  'durationUnit',
  'visitLimit',
  'priceMinor',
  'restrictions',
  'freeze',
  'isActive',
] as const;

/**
 * The tariffs a club sells (docs/TZ.md F-2.1, F-2.2). Prices are in the organization's
 * currency. Plans are never deleted: one no longer sold is made inactive.
 */
@Injectable()
export class PlansService {
  constructor(
    private readonly audit: AuditService,
    private readonly organizations: OrganizationService,
  ) {}

  async list(tx: TenantTransaction, query: PlanListQuery): Promise<Page<PlanDto>> {
    const page = pageArgs(query);
    const rows = await tx.plan.findMany({
      ...page,
      where: { ...page.where, deletedAt: null, isActive: query.active, type: query.type },
    });
    return toPage(rows, query, toPlanDto);
  }

  async get(tx: TenantTransaction, id: string): Promise<PlanDto> {
    return toPlanDto(await this.find(tx, id));
  }

  /** A plan that has not been deleted, for selling and showing. */
  /** Every plan that is not deleted, inactive ones too (imports refer to them by name). */
  async listAll(tx: TenantTransaction): Promise<Plan[]> {
    return tx.plan.findMany({ where: { deletedAt: null }, orderBy: { id: 'asc' } });
  }

  async find(tx: TenantTransaction, id: string): Promise<Plan> {
    const row = await tx.plan.findFirst({ where: { id, deletedAt: null } });
    if (!row) {
      throw notFound('Plan');
    }
    return row;
  }

  async create(
    tx: TenantTransaction,
    caller: StaffCaller,
    input: PlanCreateInput,
  ): Promise<PlanDto> {
    await this.assertLocations(tx, input.restrictions.locationIds);
    const currency = await this.organizations.currency(tx, caller.organizationId);
    const row = await tx.plan.create({
      data: {
        organizationId: caller.organizationId,
        name: input.name,
        description: input.description ?? null,
        type: input.type,
        durationValue: input.durationValue,
        durationUnit: input.durationUnit,
        visitLimit: visitLimitFor(input.type, input.visitLimit ?? null),
        priceMinor: BigInt(input.priceMinor),
        currency,
        restrictions: input.restrictions,
        freezeMaxDays: input.freeze.maxDays,
        freezeMaxTimes: input.freeze.maxTimes,
        freezeMinDays: input.freeze.minDays,
        freezeFeeMinor: BigInt(input.freeze.feeMinor),
      },
    });
    const dto = toPlanDto(row);
    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'plan.create',
      entity: 'plan',
      entityId: row.id,
      after: { name: dto.name, type: dto.type, priceMinor: dto.priceMinor, currency },
    });
    return dto;
  }

  /** Edits a plan. Memberships already sold keep the terms they were sold with. */
  async update(
    tx: TenantTransaction,
    caller: StaffCaller,
    id: string,
    input: PlanUpdateInput,
  ): Promise<PlanDto> {
    const before = toPlanDto(await this.find(tx, id));
    const merged = {
      type: input.type ?? before.type,
      durationValue: input.durationValue ?? before.durationValue,
      durationUnit: input.durationUnit ?? before.durationUnit,
      visitLimit: input.visitLimit === undefined ? before.visitLimit : input.visitLimit,
    };
    // A plan changed to "duration" drops its visit limit rather than failing.
    if (input.type === 'duration' && input.visitLimit === undefined) {
      merged.visitLimit = null;
    }
    const issues = planShapeIssues(merged);
    if (issues.length > 0) {
      throw unprocessable(ErrorCode.VALIDATION_FAILED, 'The plan is not consistent', {
        issues,
      });
    }
    if (input.restrictions) {
      await this.assertLocations(tx, input.restrictions.locationIds);
    }

    const row = await tx.plan.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        type: input.type,
        durationValue: input.durationValue,
        durationUnit: input.durationUnit,
        visitLimit: visitLimitFor(merged.type, merged.visitLimit),
        priceMinor: input.priceMinor === undefined ? undefined : BigInt(input.priceMinor),
        restrictions: input.restrictions,
        freezeMaxDays: input.freeze?.maxDays,
        freezeMaxTimes: input.freeze?.maxTimes,
        freezeMinDays: input.freeze?.minDays,
        freezeFeeMinor: input.freeze ? BigInt(input.freeze.feeMinor) : undefined,
        isActive: input.isActive,
      },
    });
    const after = toPlanDto(row);
    const changed = PLAN_FIELDS.filter(
      (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
    );
    if (changed.length > 0) {
      await this.audit.record(tx, caller.organizationId, caller.actor, {
        action: 'plan.update',
        entity: 'plan',
        entityId: id,
        before: { priceMinor: before.priceMinor, isActive: before.isActive },
        after: { fields: changed, priceMinor: after.priceMinor, isActive: after.isActive },
      });
    }
    return after;
  }

  private async assertLocations(tx: TenantTransaction, ids: readonly string[]): Promise<void> {
    const existing = await this.organizations.existingLocationIds(tx, ids);
    if (existing.length !== ids.length) {
      throw unprocessable(ErrorCode.INVALID_REFERENCE, 'Unknown location in the restrictions');
    }
  }
}

/** A single visit is always one visit; a duration plan has no limit. */
function visitLimitFor(type: PlanDto['type'], visitLimit: number | null): number | null {
  if (type === 'single') {
    return 1;
  }
  return type === 'duration' ? null : visitLimit;
}
