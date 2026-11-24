import {
  type BrandingDto,
  ErrorCode,
  type LocationCreateInput,
  type LocationDto,
  type LocationUpdateInput,
  type OrganizationDto,
  type OrganizationUpdateInput,
  workingHoursSchema,
} from '@gatefit/shared';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { Clock } from '../../common/clock/clock';
import { conflict, isUniqueViolation, notFound } from '../../common/errors/domain-errors';
import type { StaffCaller } from '../../common/http/staff-request';
import type { TenantTransaction } from '../../common/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { EntitlementsService } from '../entitlements/entitlements.service';

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  country: string;
  currency: string;
  locale: string;
  theme: OrganizationDto['theme'];
  status: 'trial' | 'active' | 'blocked';
  trialEndsAt: Date | null;
}

interface LocationRow {
  id: string;
  name: string;
  address: string | null;
  timezone: string;
  workingHours: unknown;
  deletedAt: Date | null;
}

function toOrganizationDto(row: OrganizationRow, plan: OrganizationDto['plan']): OrganizationDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    country: row.country,
    currency: row.currency,
    locale: row.locale,
    theme: row.theme,
    status: row.status,
    trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
    plan,
  };
}

function toLocationDto(row: LocationRow): LocationDto {
  // Stored as JSONB: re-validated on the way out rather than trusted.
  const workingHours = workingHoursSchema.safeParse(row.workingHours);
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    timezone: row.timezone,
    workingHours: workingHours.success ? workingHours.data : null,
    archived: row.deletedAt !== null,
  };
}

const nameTaken = () =>
  conflict(ErrorCode.LOCATION_NAME_TAKEN, 'A location with this name already exists');

/** An organization's own settings and its locations. */
@Injectable()
export class OrganizationService {
  constructor(
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly entitlements: EntitlementsService,
  ) {}

  async get(tx: TenantTransaction, organizationId: string): Promise<OrganizationDto> {
    const [row, plan] = await Promise.all([
      tx.organization.findUniqueOrThrow({ where: { id: organizationId } }),
      this.entitlements.forOrganization(tx, organizationId),
    ]);
    return toOrganizationDto(row, plan);
  }

  /** The name and look shown before sign-in (login pages, member app). */
  async branding(tx: TenantTransaction, organizationId: string): Promise<BrandingDto> {
    const row = await tx.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true, theme: true },
    });
    return { name: row.name, theme: row.theme };
  }

  /** Changes the name, default language or theme. Country and currency belong to the platform. */
  async update(
    tx: TenantTransaction,
    caller: StaffCaller,
    input: OrganizationUpdateInput,
  ): Promise<OrganizationDto> {
    const before = await this.get(tx, caller.organizationId);
    const updated = await tx.organization.update({
      where: { id: caller.organizationId },
      data: { name: input.name, locale: input.locale, theme: input.theme },
    });

    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'organization.update',
      entity: 'organization',
      entityId: caller.organizationId,
      before: { name: before.name, locale: before.locale, theme: before.theme },
      after: { name: updated.name, locale: updated.locale, theme: updated.theme },
    });
    return toOrganizationDto(updated, before.plan);
  }

  /** The organization's currency (ISO 4217), which its prices are in. */
  async currency(tx: TenantTransaction, organizationId: string): Promise<string> {
    const row = await tx.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { currency: true },
    });
    return row.currency;
  }

  /** A location that is not archived, or null. */
  async findLocation(tx: TenantTransaction, id: string): Promise<LocationDto | null> {
    const row = await tx.location.findFirst({ where: { id, deletedAt: null } });
    return row ? toLocationDto(row) : null;
  }

  /** Ids of the given locations that exist and are not archived. */
  async existingLocationIds(tx: TenantTransaction, ids: readonly string[]): Promise<string[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await tx.location.findMany({
      where: { id: { in: [...ids] }, deletedAt: null },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async listLocations(tx: TenantTransaction, includeArchived: boolean): Promise<LocationDto[]> {
    const rows = await tx.location.findMany({
      where: includeArchived ? {} : { deletedAt: null },
      orderBy: { id: 'asc' },
    });
    return rows.map(toLocationDto);
  }

  async createLocation(
    tx: TenantTransaction,
    caller: StaffCaller,
    input: LocationCreateInput,
  ): Promise<LocationDto> {
    // Checked up front: a unique violation would abort the request's transaction.
    await this.assertNameFree(tx, input.name);
    const row = await tx.location.create({
      data: {
        organizationId: caller.organizationId,
        name: input.name,
        address: input.address ?? null,
        timezone: input.timezone,
        workingHours: input.workingHours ?? Prisma.DbNull,
      },
    });
    return toLocationDto(row);
  }

  /** Edits a location, archives it or brings it back. Archived locations keep their history. */
  async updateLocation(
    tx: TenantTransaction,
    locationId: string,
    input: LocationUpdateInput,
  ): Promise<LocationDto> {
    const existing = await tx.location.findUnique({ where: { id: locationId } });
    if (!existing) {
      throw notFound('Location');
    }
    if (input.name !== undefined && input.name !== existing.name) {
      await this.assertNameFree(tx, input.name);
    }

    try {
      const row = await tx.location.update({
        where: { id: locationId },
        data: {
          name: input.name,
          address: input.address,
          timezone: input.timezone,
          workingHours: input.workingHours === null ? Prisma.DbNull : input.workingHours,
          deletedAt:
            input.archived === undefined ? undefined : input.archived ? this.clock.now() : null,
        },
      });
      return toLocationDto(row);
    } catch (error) {
      throw isUniqueViolation(error) ? nameTaken() : error;
    }
  }

  private async assertNameFree(tx: TenantTransaction, name: string): Promise<void> {
    // Archived locations keep their name: restoring one must not create a duplicate.
    if (await tx.location.findFirst({ where: { name } })) {
      throw nameTaken();
    }
  }
}
