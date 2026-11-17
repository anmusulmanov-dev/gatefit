import {
  ErrorCode,
  type Page,
  type PlatformOrganizationCreateInput,
  type PlatformOrganizationDetailDto,
  type PlatformOrganizationDto,
  type PlatformOrganizationListQuery,
  type PlatformOrganizationUpdateInput,
  type StaffPasswordResetInput,
  SYSTEM_ROLE_PERMISSIONS,
  SYSTEM_ROLES,
} from '@gatefit/shared';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { Clock } from '../../common/clock/clock';
import { conflict, notFound, unprocessable } from '../../common/errors/domain-errors';
import { pageArgs, toPage } from '../../common/pagination/paginate';
import { PasswordService } from '../../common/security/password.service';
import { TenantDb } from '../../common/tenancy/tenant-db.service';
import type { Prisma } from '../../generated/prisma/client';
import { SessionService } from '../auth/session.service';
import { StaffCredentialsService } from '../staff/staff-credentials.service';
import { PlatformPrismaService, type PlatformTransaction } from './platform-prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

const listInclude = {
  saasPlan: { select: { id: true, key: true, name: true } },
  _count: {
    select: {
      locations: { where: { deletedAt: null } },
      staff: { where: { deletedAt: null, status: 'active' } },
    },
  },
} as const;

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  country: string;
  currency: string;
  locale: string;
  status: 'trial' | 'active' | 'blocked';
  trialEndsAt: Date | null;
  createdAt: Date;
  saasPlan: { id: string; key: string; name: string } | null;
  _count: { locations: number; staff: number };
}

function toDto(row: OrganizationRow): PlatformOrganizationDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    country: row.country,
    currency: row.currency,
    locale: row.locale,
    status: row.status,
    trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    plan: row.saasPlan,
    locationCount: row._count.locations,
    staffCount: row._count.staff,
  };
}

/** Meaningful fields of an organization for a before/after audit record. */
function auditView(row: OrganizationRow): Prisma.InputJsonObject {
  return {
    name: row.name,
    locale: row.locale,
    country: row.country,
    currency: row.currency,
    status: row.status,
    trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
    planId: row.saasPlan?.id ?? null,
  };
}

/**
 * Organizations as the platform manages them: create, block, set the trial and the plan.
 * Runs on the platform connection, outside row-level security.
 */
@Injectable()
export class PlatformOrganizationsService {
  constructor(
    private readonly db: PlatformPrismaService,
    private readonly tenantDb: TenantDb,
    private readonly credentials: StaffCredentialsService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly clock: Clock,
  ) {}

  async list(query: PlatformOrganizationListQuery): Promise<Page<PlatformOrganizationDto>> {
    const page = pageArgs(query);
    const rows = await this.db.organization.findMany({
      ...page,
      where: {
        ...page.where,
        deletedAt: null,
        status: query.status,
        ...(query.search
          ? {
              OR: [
                { name: { startsWith: query.search, mode: 'insensitive' } },
                { slug: { startsWith: query.search.toLowerCase() } },
              ],
            }
          : {}),
      },
      include: listInclude,
    });
    return toPage(rows, query, toDto);
  }

  async get(organizationId: string): Promise<PlatformOrganizationDetailDto> {
    const row = await this.find(this.db, organizationId);
    const subscription = await this.db.saasSubscription.findFirst({
      where: { organizationId, endsAt: null },
      orderBy: { startsAt: 'desc' },
      select: { billingPeriod: true },
    });
    const owners = await this.db.staff.findMany({
      where: {
        organizationId,
        deletedAt: null,
        role: { isSystem: true, name: 'owner' },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        status: true,
        totpSecret: true,
        user: { select: { phone: true } },
      },
      orderBy: { id: 'asc' },
    });

    return {
      ...toDto(row),
      billingPeriod: subscription?.billingPeriod ?? null,
      owners: owners.map((owner) => ({
        staffId: owner.id,
        phone: owner.user.phone,
        firstName: owner.firstName,
        lastName: owner.lastName,
        status: owner.status,
        totpEnabled: owner.totpSecret !== null,
      })),
    };
  }

  /**
   * Opens a new organization, ready to use: its first location, the standard roles with
   * their permissions, and an owner with a temporary password. All or nothing.
   */
  async create(
    adminId: string,
    ip: string | undefined,
    input: PlatformOrganizationCreateInput,
  ): Promise<PlatformOrganizationDetailDto> {
    if (await this.db.organization.findUnique({ where: { slug: input.slug } })) {
      throw conflict(ErrorCode.SLUG_TAKEN, 'This address is already taken');
    }
    const plan = await this.findAssignablePlan(input.planId);
    const passwordHash = await this.passwords.hash(input.owner.temporaryPassword);
    const now = this.clock.now();

    const organizationId = await this.db.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: input.name,
          slug: input.slug,
          country: input.country,
          currency: input.currency,
          locale: input.locale,
          saasPlanId: plan.id,
          status: input.trialDays > 0 ? 'trial' : 'active',
          trialEndsAt:
            input.trialDays > 0 ? new Date(now.getTime() + input.trialDays * DAY_MS) : null,
        },
      });
      const id = organization.id;

      await tx.saasSubscription.create({
        data: {
          organizationId: id,
          saasPlanId: plan.id,
          billingPeriod: input.billingPeriod,
          startsAt: now,
        },
      });

      const location = await tx.location.create({
        data: {
          organizationId: id,
          name: input.location.name,
          address: input.location.address ?? null,
          timezone: input.location.timezone,
        },
      });

      let ownerRoleId = '';
      for (const name of SYSTEM_ROLES) {
        const role = await tx.role.create({ data: { organizationId: id, name, isSystem: true } });
        await tx.rolePermission.createMany({
          data: SYSTEM_ROLE_PERMISSIONS[name].map((permission) => ({
            organizationId: id,
            roleId: role.id,
            permission,
          })),
        });
        if (name === 'owner') {
          ownerRoleId = role.id;
        }
      }

      // The owner may already have a Gatefit identity (staff or member elsewhere).
      const user = await tx.user.upsert({
        where: { phone: input.owner.phone },
        update: {},
        create: { phone: input.owner.phone },
      });
      const staff = await tx.staff.create({
        data: {
          organizationId: id,
          userId: user.id,
          roleId: ownerRoleId,
          firstName: input.owner.firstName,
          lastName: input.owner.lastName,
          passwordHash,
          mustChangePassword: true,
        },
      });
      await tx.staffLocation.create({
        data: { organizationId: id, staffId: staff.id, locationId: location.id },
      });

      if (input.offerVersion) {
        // Recorded by the operator on the customer's behalf; the audit entry below says who.
        await tx.consent.create({
          data: {
            organizationId: id,
            userId: user.id,
            type: 'offer',
            version: input.offerVersion,
            at: now,
          },
        });
      }

      await this.record(tx, id, adminId, ip, 'platform.organization.create', {
        after: {
          name: input.name,
          slug: input.slug,
          planId: plan.id,
          trialDays: input.trialDays,
          ownerStaffId: staff.id,
          offerVersion: input.offerVersion ?? null,
        },
      });
      return id;
    });

    return this.get(organizationId);
  }

  /** Blocks or unblocks, sets the trial end, assigns a plan, or corrects country and currency. */
  async update(
    adminId: string,
    ip: string | undefined,
    organizationId: string,
    input: PlatformOrganizationUpdateInput,
  ): Promise<PlatformOrganizationDetailDto> {
    const before = await this.find(this.db, organizationId);
    const planChanges = input.planId !== undefined && input.planId !== before.saasPlan?.id;
    const plan = planChanges && input.planId ? await this.findAssignablePlan(input.planId) : null;
    const now = this.clock.now();

    await this.db.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id: organizationId },
        data: {
          name: input.name,
          locale: input.locale,
          country: input.country,
          currency: input.currency,
          status: input.status,
          trialEndsAt:
            input.trialEndsAt === undefined
              ? undefined
              : input.trialEndsAt === null
                ? null
                : new Date(input.trialEndsAt),
          saasPlanId: plan?.id,
        },
      });

      // A new plan or billing period closes the current subscription and opens another.
      if (plan || input.billingPeriod) {
        const current = await tx.saasSubscription.findFirst({
          where: { organizationId, endsAt: null },
          orderBy: { startsAt: 'desc' },
        });
        const saasPlanId = plan?.id ?? current?.saasPlanId;
        const billingPeriod = input.billingPeriod ?? current?.billingPeriod ?? 'monthly';
        const changed =
          saasPlanId !== current?.saasPlanId || billingPeriod !== current?.billingPeriod;
        if (saasPlanId && changed) {
          await tx.saasSubscription.updateMany({
            where: { organizationId, endsAt: null },
            data: { endsAt: now },
          });
          await tx.saasSubscription.create({
            data: { organizationId, saasPlanId, billingPeriod, startsAt: now },
          });
        }
      }

      const after = await this.find(tx, organizationId);
      await this.record(tx, organizationId, adminId, ip, 'platform.organization.update', {
        before: auditView(before),
        after: auditView(after),
      });
    });

    return this.get(organizationId);
  }

  /**
   * Gives a staff member of the organization a temporary password. This is how an owner
   * who is locked out gets back in: nobody inside the organization may reset an owner.
   */
  async resetStaffPassword(
    adminId: string,
    ip: string | undefined,
    organizationId: string,
    staffId: string,
    input: StaffPasswordResetInput,
  ): Promise<void> {
    const staff = await this.findStaff(organizationId, staffId);
    const passwordHash = await this.passwords.hash(input.temporaryPassword);

    // Done through the tenant's own services, inside its RLS scope.
    await this.tenantDb.run(organizationId, async (tx) => {
      await this.credentials.setPassword(tx, staff.id, passwordHash, true);
      await this.sessions.revokeStaffSessions(tx, staff.userId);
      await this.audit.record(
        tx,
        organizationId,
        { userId: adminId, ip },
        {
          action: 'platform.staff.password_reset',
          entity: 'staff',
          entityId: staff.id,
        },
      );
    });
  }

  /** Removes a staff member's authenticator so they can enrol a new one. */
  async resetStaffTotp(
    adminId: string,
    ip: string | undefined,
    organizationId: string,
    staffId: string,
  ): Promise<void> {
    const staff = await this.findStaff(organizationId, staffId);

    await this.tenantDb.run(organizationId, async (tx) => {
      await this.credentials.clearTotp(tx, staff.id);
      await this.sessions.revokeStaffSessions(tx, staff.userId);
      await this.audit.record(
        tx,
        organizationId,
        { userId: adminId, ip },
        {
          action: 'platform.staff.totp_reset',
          entity: 'staff',
          entityId: staff.id,
        },
      );
    });
  }

  private async find(
    db: PlatformPrismaService | PlatformTransaction,
    organizationId: string,
  ): Promise<OrganizationRow> {
    const row = await db.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      include: listInclude,
    });
    if (!row) {
      throw notFound('Organization');
    }
    return row;
  }

  private async findStaff(
    organizationId: string,
    staffId: string,
  ): Promise<{ id: string; userId: string }> {
    await this.find(this.db, organizationId);
    const staff = await this.db.staff.findFirst({
      where: { id: staffId, organizationId, deletedAt: null },
      select: { id: true, userId: true },
    });
    if (!staff) {
      throw notFound('Staff member');
    }
    return staff;
  }

  private async findAssignablePlan(planId: string): Promise<{ id: string }> {
    const plan = await this.db.saasPlan.findUnique({ where: { id: planId } });
    if (!plan) {
      throw unprocessable(ErrorCode.INVALID_REFERENCE, 'Plan does not exist', { field: 'planId' });
    }
    if (!plan.isActive) {
      throw unprocessable(ErrorCode.PLAN_INACTIVE, 'This plan is no longer offered');
    }
    return plan;
  }

  // The organization's own audit trail shows what the platform did to it, marked by the
  // `platform.` prefix. actor_id is then a platform_admins id, not a users id.
  private async record(
    tx: PlatformTransaction,
    organizationId: string,
    adminId: string,
    ip: string | undefined,
    action: string,
    change: { before?: Prisma.InputJsonValue; after?: Prisma.InputJsonValue },
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        organizationId,
        actorId: adminId,
        ip,
        action,
        entity: 'organization',
        entityId: organizationId,
        ...change,
      },
    });
  }
}
