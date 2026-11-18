import {
  ErrorCode,
  isPermission,
  type RoleCreateInput,
  type RoleDto,
  type RoleUpdateInput,
} from '@gatefit/shared';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { Clock } from '../../common/clock/clock';
import {
  conflict,
  forbidden,
  isUniqueViolation,
  notFound,
} from '../../common/errors/domain-errors';
import { holdsAll, type StaffCaller } from '../../common/http/staff-request';
import type { TenantTransaction } from '../../common/prisma/prisma.service';

const roleInclude = {
  permissions: { select: { permission: true } },
  _count: { select: { staff: { where: { status: 'active', deletedAt: null } } } },
} as const;

interface RoleRow {
  id: string;
  name: string;
  isSystem: boolean;
  permissions: { permission: string }[];
  _count: { staff: number };
}

function toDto(role: RoleRow): RoleDto {
  return {
    id: role.id,
    name: role.name,
    isSystem: role.isSystem,
    permissions: role.permissions
      .map((row) => row.permission)
      .filter(isPermission)
      .sort(),
    staffCount: role._count.staff,
  };
}

const escalation = () =>
  forbidden(
    ErrorCode.PERMISSION_ESCALATION,
    'A role may only contain permissions that you hold yourself',
  );

/** Roles of an organization: the standard ones plus those it defines itself. */
@Injectable()
export class RolesService {
  constructor(
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async list(tx: TenantTransaction): Promise<RoleDto[]> {
    const roles = await tx.role.findMany({
      where: { deletedAt: null },
      include: roleInclude,
      // Standard roles first, then the organization's own in creation order.
      orderBy: [{ isSystem: 'desc' }, { id: 'asc' }],
    });
    return roles.map(toDto);
  }

  /** Creates a custom role. Its permissions cannot exceed the caller's own. */
  async create(
    tx: TenantTransaction,
    caller: StaffCaller,
    input: RoleCreateInput,
  ): Promise<RoleDto> {
    if (!holdsAll(caller, input.permissions)) {
      throw escalation();
    }

    const { organizationId } = caller;
    let roleId: string;
    try {
      const role = await tx.role.create({ data: { organizationId, name: input.name } });
      roleId = role.id;
    } catch (error) {
      throw isUniqueViolation(error)
        ? conflict(ErrorCode.ROLE_NAME_TAKEN, 'A role with this name already exists')
        : error;
    }
    await tx.rolePermission.createMany({
      data: input.permissions.map((permission) => ({ organizationId, roleId, permission })),
    });

    await this.audit.record(tx, organizationId, caller.actor, {
      action: 'role.create',
      entity: 'role',
      entityId: roleId,
      after: { name: input.name, permissions: input.permissions },
    });
    return this.get(tx, roleId);
  }

  /**
   * Renames a custom role, replaces its permissions or archives it. Standard roles are
   * fixed. The caller must hold everything the role grants, before and after the change:
   * nobody can edit a role more powerful than themselves or make one so.
   */
  async update(
    tx: TenantTransaction,
    caller: StaffCaller,
    roleId: string,
    input: RoleUpdateInput,
  ): Promise<RoleDto> {
    const role = await tx.role.findFirst({
      where: { id: roleId, deletedAt: null },
      include: { permissions: { select: { permission: true } } },
    });
    if (!role) {
      throw notFound('Role');
    }
    if (role.isSystem) {
      throw forbidden(ErrorCode.SYSTEM_ROLE_IMMUTABLE, 'Standard roles cannot be changed');
    }

    const before = role.permissions.map((row) => row.permission).sort();
    const after = input.permissions ? [...input.permissions].sort() : before;
    if (!holdsAll(caller, before) || !holdsAll(caller, after)) {
      throw escalation();
    }

    const { organizationId } = caller;
    if (input.archived) {
      // Inactive staff still hold their role, so they count too.
      const holders = await tx.staff.count({ where: { roleId, deletedAt: null } });
      if (holders > 0) {
        throw conflict(ErrorCode.ROLE_IN_USE, 'The role is still assigned to staff');
      }
      await tx.role.update({ where: { id: roleId }, data: { deletedAt: this.clock.now() } });
      await this.audit.record(tx, organizationId, caller.actor, {
        action: 'role.archive',
        entity: 'role',
        entityId: roleId,
        before: { name: role.name, permissions: before },
      });
      return toDto({ ...role, _count: { staff: 0 } });
    }

    if (input.name !== undefined && input.name !== role.name) {
      try {
        await tx.role.update({ where: { id: roleId }, data: { name: input.name } });
      } catch (error) {
        throw isUniqueViolation(error)
          ? conflict(ErrorCode.ROLE_NAME_TAKEN, 'A role with this name already exists')
          : error;
      }
    }
    if (input.permissions) {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.rolePermission.createMany({
        data: input.permissions.map((permission) => ({ organizationId, roleId, permission })),
      });
    }

    await this.audit.record(tx, organizationId, caller.actor, {
      action: 'role.update',
      entity: 'role',
      entityId: roleId,
      before: { name: role.name, permissions: before },
      after: { name: input.name ?? role.name, permissions: after },
    });
    return this.get(tx, roleId);
  }

  private async get(tx: TenantTransaction, roleId: string): Promise<RoleDto> {
    return toDto(await tx.role.findUniqueOrThrow({ where: { id: roleId }, include: roleInclude }));
  }
}
