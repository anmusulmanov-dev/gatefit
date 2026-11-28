import { randomInt } from 'node:crypto';
import { messages, resolveLocale } from '@gatefit/i18n';
import {
  ErrorCode,
  type MemberDeskCodeDto,
  type OtpRequestInput,
  type OtpVerifyInput,
} from '@gatefit/shared';
import { Inject, Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock/clock';
import { CryptoService } from '../../common/crypto/crypto.service';
import type { AppException } from '../../common/errors/app.exception';
import { AuditService } from '../../common/audit/audit.service';
import { conflict } from '../../common/errors/domain-errors';
import type { StaffCaller } from '../../common/http/staff-request';
import type { TenantTransaction } from '../../common/prisma/prisma.service';
import type { ResolvedTenant } from '../../common/http/app-request';
import { uuidv7 } from '../../common/ids/uuid-v7';
import { RateLimiter } from '../../common/rate-limit/rate-limiter.service';
import { SMS_PROVIDER, type SmsProvider } from '../../common/sms/sms.provider';
import { TenantDb } from '../../common/tenancy/tenant-db.service';
import { MemberAccountsService } from '../members/member-accounts.service';
import { MembersService } from '../members/members.service';
import {
  DESK_OTP_TTL_SECONDS,
  OTP_MAX_ATTEMPTS,
  OTP_REQUEST_LIMIT,
  OTP_TTL_SECONDS,
} from './auth.constants';
import type { SessionTokens } from './auth.cookies';
import { invalidOtp, otpAttemptsExceeded, otpExpired } from './auth.errors';
import { type ClientMeta, SessionService } from './session.service';

const OTP_PURPOSE = 'otp-code';

type VerifyOutcome = { tokens: SessionTokens } | { error: AppException };

/** Member sign-in with a one-time code, sent by SMS or handed out at the front desk. */
@Injectable()
export class OtpService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly sessions: SessionService,
    private readonly crypto: CryptoService,
    private readonly rateLimiter: RateLimiter,
    private readonly clock: Clock,
    private readonly memberAccounts: MemberAccountsService,
    private readonly members: MembersService,
    private readonly audit: AuditService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  /**
   * Sends a fresh code and invalidates earlier ones, but only to a member of the club.
   * The answer is the same either way: it says nothing about whether the phone is known.
   */
  async request(tenant: ResolvedTenant, input: OtpRequestInput): Promise<void> {
    await this.rateLimiter.consume(`otp-request:${tenant.id}:${input.phone}`, OTP_REQUEST_LIMIT);

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');

    const isMember = await this.tenantDb.run(tenant.id, async (tx) => {
      if (!(await this.memberAccounts.findByPhone(tx, input.phone))) {
        return false;
      }
      await this.replaceCode(tx, tenant.id, input.phone, code, OTP_TTL_SECONDS);
      return true;
    });
    if (!isMember) {
      return;
    }

    const template = messages[resolveLocale(tenant.locale)].sms.otp;
    await this.sms.send(input.phone, template.replace('{code}', code));
  }

  /**
   * A fresh code for a member, shown to the receptionist instead of being sent by SMS.
   * It replaces earlier codes, so the member must use this one. Audited: whoever holds the
   * code can sign in as the member.
   */
  async issueAtDesk(
    tx: TenantTransaction,
    caller: StaffCaller,
    memberId: string,
  ): Promise<MemberDeskCodeDto> {
    // Not found outside the caller's branches.
    const member = await this.members.get(tx, caller, memberId);
    if (member.archived) {
      throw conflict(ErrorCode.MEMBER_ARCHIVED, 'Restore the member before they sign in');
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const expiresAt = await this.replaceCode(
      tx,
      caller.organizationId,
      member.phone,
      code,
      DESK_OTP_TTL_SECONDS,
    );
    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'member.sign_in_code.issue',
      entity: 'member',
      entityId: member.id,
    });
    return { code, expiresAt: expiresAt.toISOString() };
  }

  /** Signs the member in when the code matches. A code works once and allows five guesses. */
  async verify(
    tenant: ResolvedTenant,
    input: OtpVerifyInput,
    meta: ClientMeta,
  ): Promise<SessionTokens> {
    const now = this.clock.now();

    // A wrong guess must stay counted, so failures are returned from the transaction
    // (which then commits) rather than thrown inside it (which would roll back).
    const outcome = await this.tenantDb.run(tenant.id, async (tx): Promise<VerifyOutcome> => {
      const otp = await tx.otpCode.findFirst({
        where: { phone: input.phone, consumedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      if (!otp) {
        return { error: invalidOtp() };
      }
      if (otp.expiresAt <= now) {
        return { error: otpExpired() };
      }

      // Count the attempt first and atomically: parallel guesses cannot exceed the limit.
      const counted = await tx.otpCode.updateMany({
        where: { id: otp.id, attempts: { lt: OTP_MAX_ATTEMPTS } },
        data: { attempts: { increment: 1 } },
      });
      if (counted.count === 0) {
        return { error: otpAttemptsExceeded() };
      }

      const expected = this.hashCode(tenant.id, input.phone, input.code);
      if (!this.crypto.digestsEqual(otp.codeHash, expected)) {
        return { error: invalidOtp() };
      }

      await tx.otpCode.update({ where: { id: otp.id }, data: { consumedAt: now } });

      // Archived since the code was sent: no sign-in.
      const member = await this.memberAccounts.findByPhone(tx, input.phone);
      if (!member) {
        return { error: invalidOtp() };
      }
      const [user] = await tx.$queryRaw<{ id: string | null }[]>`
        SELECT auth_find_or_create_user(${uuidv7(now)}::uuid, ${input.phone}) AS id`;
      if (!user?.id) {
        return { error: invalidOtp() };
      }
      await this.memberAccounts.linkUser(tx, member, user.id);

      const tokens = await this.sessions.issue(
        tx,
        tenant.id,
        { userId: user.id, audience: 'member' },
        meta,
      );
      return { tokens };
    });

    if ('error' in outcome) {
      throw outcome.error;
    }
    return outcome.tokens;
  }

  /** Stores a code for the phone and voids the earlier ones. Returns when it expires. */
  private async replaceCode(
    tx: TenantTransaction,
    organizationId: string,
    phone: string,
    code: string,
    ttlSeconds: number,
  ): Promise<Date> {
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    await tx.otpCode.updateMany({
      where: { phone, consumedAt: null },
      data: { consumedAt: now },
    });
    await tx.otpCode.create({
      data: {
        organizationId,
        phone,
        // Six digits are trivially brute-forced from a plain hash, hence the keyed one.
        codeHash: this.hashCode(organizationId, phone, code),
        expiresAt,
      },
    });
    return expiresAt;
  }

  // Bound to the organization and phone: a hash cannot be replayed for another number.
  private hashCode(organizationId: string, phone: string, code: string): string {
    return this.crypto.hmac(OTP_PURPOSE, `${organizationId}:${phone}:${code}`);
  }
}
