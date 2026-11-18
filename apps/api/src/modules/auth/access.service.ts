import { Injectable } from '@nestjs/common';
import type { AccessContext, AuthContext } from '../../common/http/app-request';
import type { TenantTransaction } from '../../common/prisma/prisma.service';
import { StaffAccessService } from '../staff/staff-access.service';
import { SessionService } from './session.service';

/**
 * Loads what the caller may do, from the database, on every request (docs/TZ.md
 * section 9): a revoked session, a deactivated staff member or a changed role takes
 * effect immediately, not when the access token expires.
 */
@Injectable()
export class AccessService {
  constructor(
    private readonly sessions: SessionService,
    private readonly staffAccess: StaffAccessService,
  ) {}

  /** Null when the session is no longer valid or a staff session has no active staff record. */
  async load(tx: TenantTransaction, auth: AuthContext): Promise<AccessContext | null> {
    if (!(await this.sessions.isActive(tx, auth.sessionId))) {
      return null;
    }
    if (auth.audience === 'member') {
      return { staff: null };
    }

    const staff = await this.staffAccess.load(tx, auth.userId);
    return staff && { staff };
  }
}
