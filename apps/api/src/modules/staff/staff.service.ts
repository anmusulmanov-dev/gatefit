import {
  ErrorCode,
  type Page,
  type StaffCreateInput,
  type StaffDto,
  type StaffListQuery,
  type StaffUpdateInput,
} from '@gatefit/shared';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { Clock } from '../../common/clock/clock';
import { conflict, forbidden, notFound, unprocessable } from '../../common/errors/domain-errors';
import { holdsAll, type StaffCaller } from '../../common/http/staff-request';
import { uuidv7 } from '../../common/ids/uuid-v7';
import { pageArgs, toPage } from '../../common/pagination/paginate';
import type { TenantTransaction } from '../../common/prisma/prisma.service';
import { PasswordService } from '../../common/security/password.service';

const staffInclude = {
  user: { select: { phone: true } },
  role: { select: { id: true, name: true, isSystem: true } },
  locations: { select: { location: { select: { id: true, name: true, deletedAt: true } } } },
} as const;

interface StaffRow {
  id: string;
  firstName: string;
  lastName: string;
  position: string | null;
  status: 'active' | 'inactive';
  mustChangePassword: boolean;
  user: { phone: string };
  role: { id: string; name: string; isSystem: boolean };
  locations: { location: { id: string; name: string; deletedAt: Date | null } }[];
}

/** A staff member as rules need to see them: who they are and how powerful their role is. */
export interface StaffTarget {
  id: string;
  userId: string;
  status: 'active' | 'inactive';
  role: { id: string; name: string; isSystem: boolean; permissions: string[] };
}

const isOwner = (role: { name: string; isSystem: boolean }) =>
  role.isSystem && role.name === 'owner';

const escalation = (message: string) => forbidden(ErrorCode.PERMISSION_ESCALATION, message);

/** Staff of an organization: who works there, in which role and at which locations. */
@Injectable()
export class StaffService {
  constructor(
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly clock: Clock,
  ) {}

  async list(tx: TenantTransaction, query: StaffListQuery): Promise<Page<StaffDto>> {
    const page = pageArgs(query);
    const rows = await tx.staff.findMany({
      ...page,
      where: { ...page.where, deletedAt: null, status: query.status },
      include: staffInclude,
    });
    const enrolled = await this.totpEnrolled(
      tx,
      rows.map((row) => row.id),
    );
    return toPage(rows, query, (row) => this.toDto(row, enrolled));
  }

  /**
   * Adds a staff member with a temporary password that they must replace at first
   * sign-in. The person is identified by phone; if they already have a Gatefit identity
   * (as staff elsewhere or as a member) it is reused, with credentials of their own here.
   */
  async create(
    tx: TenantTransaction,
    caller: StaffCaller,
    input: StaffCreateInput,
  ): Promise<StaffDto> {
    const { organizationId } = caller;
    const role = await this.findRole(tx, input.roleId);
    if (!holdsAll(caller, role.permissions)) {
      throw escalation('You can only assign a role whose permissions you hold yourself');
    }
    await this.assertLocations(tx, input.locationIds);

    const [user] = await tx.$queryRaw<{ id: string | null }[]>`
      SELECT auth_find_or_create_user(${uuidv7(this.clock.now())}::uuid, ${input.phone}) AS id`;
    if (!user?.id) {
      throw unprocessable(ErrorCode.INVALID_REFERENCE, 'This phone number cannot be used');
    }
    // Checked up front rather than by catching the unique violation: a failed statement
    // would abort the request's transaction.
    const existing = await tx.staff.findFirst({ where: { userId: user.id } });
    if (existing) {
      throw conflict(ErrorCode.STAFF_EXISTS, 'A staff member with this phone already exists');
    }

    const staff = await tx.staff.create({
      data: {
        organizationId,
        userId: user.id,
        roleId: role.id,
        firstName: input.firstName,
        lastName: input.lastName,
        position: input.position ?? null,
        passwordHash: await this.passwords.hash(input.temporaryPassword),
        mustChangePassword: true,
      },
    });
    await this.linkLocations(tx, organizationId, staff.id, input.locationIds);

    await this.audit.record(tx, organizationId, caller.actor, {
      action: 'staff.create',
      entity: 'staff',
      entityId: staff.id,
      after: { roleId: role.id, locationIds: input.locationIds },
    });
    return this.get(tx, staff.id);
  }

  /**
   * Edits a staff member. Changing a role or status is a permission change, so on top of
   * `staff.manage` the caller must hold everything the old and the new role grant, cannot
   * do it to themselves, and cannot leave the organization without an active owner.
   */
  async update(
    tx: TenantTransaction,
    caller: StaffCaller,
    staffId: string,
    input: StaffUpdateInput,
  ): Promise<StaffDto> {
    const { organizationId } = caller;
    const target = await this.findTarget(tx, staffId);
    const before = await this.get(tx, staffId);

    const roleChanges = input.roleId !== undefined && input.roleId !== target.role.id;
    const statusChanges = input.status !== undefined && input.status !== target.status;

    let newRoleId = target.role.id;
    if (roleChanges || statusChanges) {
      if (target.id === caller.staffId) {
        throw forbidden(ErrorCode.CANNOT_MODIFY_SELF, 'You cannot change your own role or status');
      }
      if (!holdsAll(caller, target.role.permissions)) {
        throw escalation('You cannot change someone whose role is more powerful than yours');
      }

      let keepsOwnerRole = isOwner(target.role);
      if (roleChanges && input.roleId) {
        const role = await this.findRole(tx, input.roleId);
        if (!holdsAll(caller, role.permissions)) {
          throw escalation('You can only assign a role whose permissions you hold yourself');
        }
        newRoleId = role.id;
        keepsOwnerRole = isOwner(role);
      }

      const losesOwner =
        isOwner(target.role) &&
        target.status === 'active' &&
        (!keepsOwnerRole || input.status === 'inactive');
      if (losesOwner && (await this.countOtherActiveOwners(tx, target.id)) === 0) {
        throw conflict(ErrorCode.LAST_OWNER, 'The organization must keep at least one owner');
      }
    }

    if (input.locationIds) {
      await this.assertLocations(tx, input.locationIds);
      await tx.staffLocation.deleteMany({ where: { staffId } });
      await this.linkLocations(tx, organizationId, staffId, input.locationIds);
    }
    await tx.staff.update({
      where: { id: staffId },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        position: input.position,
        roleId: newRoleId,
        status: input.status,
      },
    });

    const after = await this.get(tx, staffId);
    if (roleChanges || statusChanges || input.locationIds) {
      const snapshot = (staff: StaffDto) => ({
        roleId: staff.role.id,
        status: staff.status,
        locationIds: staff.locations.map((location) => location.id),
      });
      await this.audit.record(tx, organizationId, caller.actor, {
        action: 'staff.update',
        entity: 'staff',
        entityId: staffId,
        before: snapshot(before),
        after: snapshot(after),
      });
    }
    return after;
  }

  /** Loads a staff member for a rule check. Throws 404 when they are not in this organization. */
  async findTarget(tx: TenantTransaction, staffId: string): Promise<StaffTarget> {
    const staff = await tx.staff.findFirst({
      where: { id: staffId, deletedAt: null },
      select: {
        id: true,
        userId: true,
        status: true,
        role: {
          select: {
            id: true,
            name: true,
            isSystem: true,
            permissions: { select: { permission: true } },
          },
        },
      },
    });
    if (!staff) {
      throw notFound('Staff member');
    }
    return {
      ...staff,
      role: { ...staff.role, permissions: staff.role.permissions.map((row) => row.permission) },
    };
  }

  private async get(tx: TenantTransaction, staffId: string): Promise<StaffDto> {
    const row = await tx.staff.findUniqueOrThrow({ where: { id: staffId }, include: staffInclude });
    return this.toDto(row, await this.totpEnrolled(tx, [staffId]));
  }

  private toDto(row: StaffRow, totpEnrolled: ReadonlySet<string>): StaffDto {
    return {
      id: row.id,
      phone: row.user.phone,
      firstName: row.firstName,
      lastName: row.lastName,
      position: row.position,
      status: row.status,
      role: row.role,
      locations: row.locations
        .map((link) => link.location)
        .filter((location) => !location.deletedAt)
        .map(({ id, name }) => ({ id, name })),
      totpEnabled: totpEnrolled.has(row.id),
      mustChangePassword: row.mustChangePassword,
    };
  }

  // Answers "has an authenticator" without ever loading the secret itself.
  private async totpEnrolled(tx: TenantTransaction, staffIds: string[]): Promise<Set<string>> {
    const rows = await tx.staff.findMany({
      where: { id: { in: staffIds }, totpSecret: { not: null } },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }

  private async findRole(
    tx: TenantTransaction,
    roleId: string,
  ): Promise<{ id: string; name: string; isSystem: boolean; permissions: string[] }> {
    const role = await tx.role.findFirst({
      where: { id: roleId, deletedAt: null },
      include: { permissions: { select: { permission: true } } },
    });
    if (!role) {
      throw unprocessable(ErrorCode.INVALID_REFERENCE, 'Role does not exist', { field: 'roleId' });
    }
    return { ...role, permissions: role.permissions.map((row) => row.permission) };
  }

  private async assertLocations(tx: TenantTransaction, locationIds: string[]): Promise<void> {
    const found = await tx.location.count({ where: { id: { in: locationIds }, deletedAt: null } });
    if (found !== locationIds.length) {
      throw unprocessable(ErrorCode.INVALID_REFERENCE, 'A location does not exist', {
        field: 'locationIds',
      });
    }
  }

  private async linkLocations(
    tx: TenantTransaction,
    organizationId: string,
    staffId: string,
    locationIds: string[],
  ): Promise<void> {
    await tx.staffLocation.createMany({
      data: locationIds.map((locationId) => ({ organizationId, staffId, locationId })),
    });
  }

  private countOtherActiveOwners(tx: TenantTransaction, exceptStaffId: string): Promise<number> {
    return tx.staff.count({
      where: {
        id: { not: exceptStaffId },
        status: 'active',
        deletedAt: null,
        role: { isSystem: true, name: 'owner', deletedAt: null },
      },
    });
  }
}
