import {
  ErrorCode,
  isSaasModule,
  type PlanLimits,
  planLimitsSchema,
  type SaasModule,
} from '@gatefit/shared';
import { Global, Inject, Injectable, Module, SetMetadata } from '@nestjs/common';
import { forbidden } from '../../common/errors/domain-errors';
import type { TenantTransaction } from '../../common/prisma/prisma.service';

export const MODULE_KEY = 'gatefit:module';

/**
 * Marks an endpoint as part of a product module. On top of its permission check, the
 * organization's tariff must include the module (docs/TZ.md section 12).
 */
export const RequireModule = (module: SaasModule) => SetMetadata(MODULE_KEY, module);

/** What an organization's tariff gives it. */
export interface Entitlements {
  key: string;
  name: string;
  modules: SaasModule[];
  limits: PlanLimits;
}

export interface MemberLimitStatus {
  used: number;
  /** Null when the tariff does not limit active members. */
  limit: number | null;
  exceeded: boolean;
}

/** Counts active members of a location. The members module provides the real one. */
export interface ActiveMemberCounter {
  count(tx: TenantTransaction, locationId: string): Promise<number>;
}

export const ACTIVE_MEMBER_COUNTER = Symbol('ACTIVE_MEMBER_COUNTER');

// Until the members table exists (stage M2) no location has any.
const noMembersYet: ActiveMemberCounter = { count: () => Promise.resolve(0) };

/** Reads what the current organization's tariff includes. Tariffs are edited by the platform. */
@Injectable()
export class EntitlementsService {
  constructor(@Inject(ACTIVE_MEMBER_COUNTER) private readonly members: ActiveMemberCounter) {}

  /** Null when the platform has not assigned a tariff yet. */
  async forOrganization(
    tx: TenantTransaction,
    organizationId: string,
  ): Promise<Entitlements | null> {
    const organization = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { saasPlan: { select: { key: true, name: true, modules: true, limits: true } } },
    });
    const plan = organization?.saasPlan;
    if (!plan) {
      return null;
    }

    // Stored as JSON: anything unexpected is dropped rather than trusted.
    const limits = planLimitsSchema.safeParse(plan.limits);
    return {
      key: plan.key,
      name: plan.name,
      modules: Array.isArray(plan.modules) ? plan.modules.filter(isSaasModule) : [],
      limits: limits.success ? limits.data : { activeMembersPerLocation: null },
    };
  }

  /** Throws MODULE_NOT_AVAILABLE unless the organization's tariff includes the module. */
  async assertModule(
    tx: TenantTransaction,
    organizationId: string,
    module: SaasModule,
  ): Promise<void> {
    const entitlements = await this.forOrganization(tx, organizationId);
    if (!entitlements?.modules.includes(module)) {
      throw forbidden(ErrorCode.MODULE_NOT_AVAILABLE, 'Your plan does not include this feature');
    }
  }

  /**
   * How a location stands against its active-member limit. Going over never blocks work:
   * callers warn and ask the organization to upgrade (docs/TZ.md section 12).
   */
  async memberLimit(
    tx: TenantTransaction,
    organizationId: string,
    locationId: string,
  ): Promise<MemberLimitStatus> {
    const [entitlements, used] = await Promise.all([
      this.forOrganization(tx, organizationId),
      this.members.count(tx, locationId),
    ]);
    const limit = entitlements?.limits.activeMembersPerLocation ?? null;
    return { used, limit, exceeded: limit !== null && used > limit };
  }
}

@Global()
@Module({
  providers: [EntitlementsService, { provide: ACTIVE_MEMBER_COUNTER, useValue: noMembersYet }],
  exports: [EntitlementsService],
})
export class EntitlementsModule {}
