import { isPermission, type Permission } from '@gatefit/shared';
import { Injectable } from '@nestjs/common';
import type { AccessContext } from '../../common/http/app-request';
import type { TenantTransaction } from '../../common/prisma/prisma.service';

type StaffAccess = NonNullable<AccessContext['staff']>;

/** What a staff member may do: their role, its permissions and their locations. */
@Injectable()
export class StaffAccessService {
  /** Null when the user has no active staff record in the current organization. */
  async load(tx: TenantTransaction, userId: string): Promise<StaffAccess | null> {
    const staff = await tx.staff.findFirst({
      where: { userId, status: 'active', deletedAt: null, role: { deletedAt: null } },
      include: {
        role: { include: { permissions: true } },
        locations: { include: { location: true } },
      },
    });
    if (!staff) {
      return null;
    }

    return {
      id: staff.id,
      role: { id: staff.role.id, name: staff.role.name, isSystem: staff.role.isSystem },
      permissions: new Set<Permission>(
        staff.role.permissions.map((row) => row.permission).filter(isPermission),
      ),
      locations: staff.locations
        .map((link) => link.location)
        .filter((location) => !location.deletedAt)
        .map(({ id, name, timezone }) => ({ id, name, timezone })),
    };
  }
}
