import { isPermission, type Permission } from '@gatefit/shared';
import { Injectable } from '@nestjs/common';
import type { AccessContext, AuthContext } from '../../common/http/app-request';
import type { TenantTransaction } from '../../common/prisma/prisma.service';
import { SessionService } from './session.service';

/**
 * Loads what the caller may do, from the database, on every request (docs/TZ.md
 * section 9): a revoked session, a deactivated staff member or a changed role takes
 * effect immediately, not when the access token expires.
 */
@Injectable()
export class AccessService {
  constructor(private readonly sessions: SessionService) {}

  /** Null when the session is no longer valid or a staff session has no active staff record. */
  async load(tx: TenantTransaction, auth: AuthContext): Promise<AccessContext | null> {
    if (!(await this.sessions.isActive(tx, auth.sessionId))) {
      return null;
    }
    if (auth.audience === 'member') {
      return { staff: null };
    }

    const staff = await tx.staff.findFirst({
      where: { userId: auth.userId, status: 'active', deletedAt: null },
      include: {
        role: { include: { permissions: true } },
        locations: { include: { location: true } },
      },
    });
    if (!staff || staff.role.deletedAt) {
      return null;
    }

    return {
      staff: {
        id: staff.id,
        role: { id: staff.role.id, name: staff.role.name, isSystem: staff.role.isSystem },
        permissions: new Set<Permission>(
          staff.role.permissions.map((row) => row.permission).filter(isPermission),
        ),
        locations: staff.locations
          .map((link) => link.location)
          .filter((location) => !location.deletedAt)
          .map(({ id, name, timezone }) => ({ id, name, timezone })),
      },
    };
  }
}
