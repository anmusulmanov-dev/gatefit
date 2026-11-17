import { ErrorCode, type StaffPasswordResetInput } from '@gatefit/shared';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { forbidden } from '../../common/errors/domain-errors';
import { holdsAll, type StaffCaller } from '../../common/http/staff-request';
import type { TenantTransaction } from '../../common/prisma/prisma.service';
import { PasswordService } from '../../common/security/password.service';
import { StaffCredentialsService } from '../staff/staff-credentials.service';
import { StaffService, type StaffTarget } from '../staff/staff.service';
import { SessionService } from './session.service';

/**
 * Resetting another staff member's credentials. Whoever can do this can sign in as that
 * person, so the rules are stricter than for editing a profile.
 */
@Injectable()
export class StaffSecurityService {
  constructor(
    private readonly staff: StaffService,
    private readonly credentials: StaffCredentialsService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /** Gives the staff member a temporary password, to be replaced at their next sign-in. */
  async resetPassword(
    tx: TenantTransaction,
    caller: StaffCaller,
    staffId: string,
    input: StaffPasswordResetInput,
  ): Promise<void> {
    const target = await this.authorize(tx, caller, staffId);

    const passwordHash = await this.passwords.hash(input.temporaryPassword);
    await this.credentials.setPassword(tx, target.id, passwordHash, true);
    await this.sessions.revokeStaffSessions(tx, target.userId);

    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'staff.password_reset',
      entity: 'staff',
      entityId: target.id,
    });
  }

  /** Removes the staff member's authenticator so they can enrol a new one. */
  async resetTotp(tx: TenantTransaction, caller: StaffCaller, staffId: string): Promise<void> {
    const target = await this.authorize(tx, caller, staffId);

    await this.credentials.clearTotp(tx, target.id);
    await this.sessions.revokeStaffSessions(tx, target.userId);

    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'staff.totp_reset',
      entity: 'staff',
      entityId: target.id,
    });
  }

  private async authorize(
    tx: TenantTransaction,
    caller: StaffCaller,
    staffId: string,
  ): Promise<StaffTarget> {
    const target = await this.staff.findTarget(tx, staffId);

    if (target.id === caller.staffId) {
      throw forbidden(
        ErrorCode.CANNOT_MODIFY_SELF,
        'Use the password change form for your own account',
      );
    }
    // An owner's credentials are the keys to the whole organization: only the platform
    // may reset them, after verifying the person out of band.
    if (target.role.isSystem && target.role.name === 'owner') {
      throw forbidden(
        ErrorCode.PERMISSION_ESCALATION,
        "An owner's credentials can only be reset by Gatefit support",
      );
    }
    if (!holdsAll(caller, target.role.permissions)) {
      throw forbidden(
        ErrorCode.PERMISSION_ESCALATION,
        'You cannot reset credentials of someone whose role is more powerful than yours',
      );
    }
    return target;
  }
}
