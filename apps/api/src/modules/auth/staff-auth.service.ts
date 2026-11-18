import {
  type PasswordChangeInput,
  type PasswordSetInput,
  type StaffLoginInput,
  TOTP_REQUIRED_ROLES,
  type TotpConfirmInput,
  type TotpSetupResponse,
} from '@gatefit/shared';
import { Injectable } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import type { AuthContext, ResolvedTenant } from '../../common/http/app-request';
import type { TenantTransaction } from '../../common/prisma/prisma.service';
import { RateLimiter } from '../../common/rate-limit/rate-limiter.service';
import { PasswordService } from '../../common/security/password.service';
import { TenantDb } from '../../common/tenancy/tenant-db.service';
import { type StaffCredentials, StaffCredentialsService } from '../staff/staff-credentials.service';
import { LOGIN_LIMIT, TOTP_LIMIT } from './auth.constants';
import type { SessionTokens } from './auth.cookies';
import {
  invalidCredentials,
  invalidTotp,
  passwordChangeRequired,
  passwordUnchanged,
  totpAlreadyEnabled,
  totpRequired,
  totpSetupRequired,
  unauthorized,
} from './auth.errors';
import { type ClientMeta, SessionService } from './session.service';
import { TokenService } from './token.service';
import { TotpService } from './totp.service';

const TOTP_PURPOSE = 'totp-secret';

function mustUseTotp(credentials: StaffCredentials): boolean {
  return (
    credentials.role.isSystem &&
    (TOTP_REQUIRED_ROLES as readonly string[]).includes(credentials.role.name)
  );
}

/** Staff sign-in: phone and password, plus an authenticator code where required. */
@Injectable()
export class StaffAuthService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly credentials: StaffCredentialsService,
    private readonly passwords: PasswordService,
    private readonly totp: TotpService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly crypto: CryptoService,
    private readonly rateLimiter: RateLimiter,
  ) {}

  /**
   * Signs a staff member in. Throws INVALID_CREDENTIALS; PASSWORD_CHANGE_REQUIRED with a
   * change token when the password was chosen by someone else; TOTP_REQUIRED (send the
   * code with the same phone and password); INVALID_TOTP; or TOTP_SETUP_REQUIRED with a
   * setup token when the role demands a second factor that is not set up yet.
   */
  async login(
    tenant: ResolvedTenant,
    input: StaffLoginInput,
    meta: ClientMeta,
  ): Promise<SessionTokens> {
    const loginKey = `login:${tenant.id}:${input.phone}`;
    await this.rateLimiter.consume(loginKey, LOGIN_LIMIT);

    const staff = await this.tenantDb.run(tenant.id, (tx) =>
      this.credentials.findByPhone(tx, input.phone),
    );

    // Hashing runs outside the transaction so it does not hold a database connection.
    const passwordOk = await this.passwords.verify(staff?.passwordHash, input.password);
    if (!staff || !passwordOk) {
      throw invalidCredentials();
    }

    if (staff.mustChangePassword) {
      await this.rateLimiter.reset(loginKey);
      throw passwordChangeRequired(this.tokens.signPasswordChange(staff.userId, tenant.id));
    }

    if (!staff.totpSecret) {
      if (mustUseTotp(staff)) {
        throw totpSetupRequired(this.tokens.signTotpSetup(staff.userId, tenant.id));
      }
    } else {
      if (!input.totpCode) {
        throw totpRequired();
      }
      await this.rateLimiter.consume(`totp:${staff.userId}`, TOTP_LIMIT);
      const secret = this.crypto.decrypt(TOTP_PURPOSE, staff.totpSecret);
      if (!(await this.totp.verify(staff.userId, secret, input.totpCode))) {
        throw invalidTotp();
      }
    }

    // Only failed attempts count towards the limits.
    await Promise.all([
      this.rateLimiter.reset(loginKey),
      this.rateLimiter.reset(`totp:${staff.userId}`),
    ]);
    return this.startSession(tenant.id, staff.userId, meta);
  }

  /**
   * Replaces a temporary password, proving identity with the change token that sign-in
   * returned. It does not sign in: the client signs in again with the new password, which
   * then runs the usual second-factor checks.
   */
  async setPassword(tenant: ResolvedTenant, input: PasswordSetInput): Promise<void> {
    const claims = this.tokens.verifyPasswordChange(input.changeToken);
    if (claims?.organizationId !== tenant.id) {
      throw unauthorized('Change token is invalid or expired');
    }

    const staff = await this.tenantDb.run(tenant.id, (tx) =>
      this.credentials.findByUserId(tx, claims.userId),
    );
    // The flag is cleared by the first use, so a change token works once.
    if (!staff?.mustChangePassword) {
      throw unauthorized('Change token is invalid or expired');
    }

    await this.replacePassword(tenant.id, staff, input.newPassword);
  }

  /** A signed-in staff member changes their own password; their other devices are signed out. */
  async changePassword(
    tenant: ResolvedTenant,
    auth: AuthContext,
    input: PasswordChangeInput,
  ): Promise<void> {
    const staff = await this.tenantDb.run(tenant.id, (tx) =>
      this.credentials.findByUserId(tx, auth.userId),
    );
    const currentOk = await this.passwords.verify(staff?.passwordHash, input.currentPassword);
    if (!staff || !currentOk) {
      throw invalidCredentials();
    }

    await this.replacePassword(tenant.id, staff, input.newPassword, (tx) =>
      this.sessions.revokeOtherStaffSessions(tx, auth.userId, auth.sessionId),
    );
  }

  /**
   * Starts authenticator enrolment for a staff member identified either by a setup token
   * (from TOTP_SETUP_REQUIRED) or by their current session. Nothing is stored yet: the
   * new secret travels back to /auth/totp/confirm encrypted inside the enrol token.
   */
  async beginTotpSetup(
    tenant: ResolvedTenant,
    identity: { setupToken: string } | { sessionUserId: string },
  ): Promise<TotpSetupResponse> {
    let userId: string;
    if ('setupToken' in identity) {
      const claims = this.tokens.verifyTotpSetup(identity.setupToken);
      if (claims?.organizationId !== tenant.id) {
        throw unauthorized('Setup token is invalid or expired');
      }
      userId = claims.userId;
    } else {
      userId = identity.sessionUserId;
    }

    const staff = await this.tenantDb.run(tenant.id, (tx) =>
      this.credentials.findByUserId(tx, userId),
    );
    if (!staff) {
      throw unauthorized();
    }
    if (staff.totpSecret) {
      throw totpAlreadyEnabled();
    }

    const { secret, otpauthUrl } = this.totp.createSecret(tenant.slug);
    const enrollToken = this.tokens.signTotpEnroll({
      sub: userId,
      org: tenant.id,
      sec: this.crypto.encrypt(TOTP_PURPOSE, secret),
      login: 'setupToken' in identity,
    });
    return { secret, otpauthUrl, enrollToken };
  }

  /**
   * Finishes enrolment once the user proves the app works by entering a code. Returns a
   * session when enrolment was part of signing in, otherwise null.
   */
  async confirmTotpSetup(
    tenant: ResolvedTenant,
    input: TotpConfirmInput,
    meta: ClientMeta,
  ): Promise<SessionTokens | null> {
    const claims = this.tokens.verifyTotpEnroll(input.enrollToken);
    if (claims?.org !== tenant.id) {
      throw unauthorized('Enrol token is invalid or expired');
    }

    await this.rateLimiter.consume(`totp:${claims.sub}`, TOTP_LIMIT);
    const secret = this.crypto.decrypt(TOTP_PURPOSE, claims.sec);
    if (!(await this.totp.verify(claims.sub, secret, input.code))) {
      throw invalidTotp();
    }

    const enrolled = await this.tenantDb.run(tenant.id, async (tx) => {
      const staff = await this.credentials.findByUserId(tx, claims.sub);
      // Never overwrites an existing authenticator: replacing one requires a reset.
      return !!staff && this.credentials.enrollTotp(tx, staff.staffId, claims.sec);
    });
    if (!enrolled) {
      throw totpAlreadyEnabled();
    }

    return claims.login ? this.startSession(tenant.id, claims.sub, meta) : null;
  }

  private async replacePassword(
    organizationId: string,
    staff: StaffCredentials,
    newPassword: string,
    also?: (tx: TenantTransaction) => Promise<void>,
  ): Promise<void> {
    if (await this.passwords.verify(staff.passwordHash, newPassword)) {
      throw passwordUnchanged();
    }
    const passwordHash = await this.passwords.hash(newPassword);

    await this.tenantDb.run(organizationId, async (tx) => {
      await this.credentials.setPassword(tx, staff.staffId, passwordHash, false);
      await also?.(tx);
    });
  }

  private startSession(
    organizationId: string,
    userId: string,
    meta: ClientMeta,
  ): Promise<SessionTokens> {
    return this.tenantDb.run(organizationId, (tx) =>
      this.sessions.issue(tx, organizationId, { userId, audience: 'staff' }, meta),
    );
  }
}
