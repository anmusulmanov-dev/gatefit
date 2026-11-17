import {
  type StaffLoginInput,
  TOTP_REQUIRED_ROLES,
  type TotpConfirmInput,
  type TotpSetupResponse,
} from '@gatefit/shared';
import { Injectable } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import type { ResolvedTenant } from '../../common/http/app-request';
import { RateLimiter } from '../../common/rate-limit/rate-limiter.service';
import { TenantDb } from '../../common/tenancy/tenant-db.service';
import type { TenantTransaction } from '../../common/prisma/prisma.service';
import { LOGIN_LIMIT, TOTP_LIMIT } from './auth.constants';
import type { SessionTokens } from './auth.cookies';
import {
  invalidCredentials,
  invalidTotp,
  totpAlreadyEnabled,
  totpRequired,
  totpSetupRequired,
  unauthorized,
} from './auth.errors';
import { PasswordService } from './password.service';
import { type ClientMeta, SessionService } from './session.service';
import { TokenService } from './token.service';
import { TotpService } from './totp.service';

const TOTP_PURPOSE = 'totp-secret';

interface StaffCredentials {
  user_id: string;
  staff_id: string;
  password_hash: string | null;
  totp_secret: string | null;
  role_name: string;
  role_is_system: boolean;
}

function mustUseTotp(credentials: StaffCredentials): boolean {
  return (
    credentials.role_is_system &&
    (TOTP_REQUIRED_ROLES as readonly string[]).includes(credentials.role_name)
  );
}

/** Staff sign-in: phone and password, plus an authenticator code where required. */
@Injectable()
export class StaffAuthService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly passwords: PasswordService,
    private readonly totp: TotpService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly crypto: CryptoService,
    private readonly rateLimiter: RateLimiter,
  ) {}

  /**
   * Signs a staff member in. Throws INVALID_CREDENTIALS, TOTP_REQUIRED (send the code
   * with the same phone and password), INVALID_TOTP, or TOTP_SETUP_REQUIRED carrying a
   * setup token when the role demands a second factor that is not set up yet.
   */
  async login(
    tenant: ResolvedTenant,
    input: StaffLoginInput,
    meta: ClientMeta,
  ): Promise<SessionTokens> {
    const loginKey = `login:${tenant.id}:${input.phone}`;
    await this.rateLimiter.consume(loginKey, LOGIN_LIMIT);

    const credentials = await this.tenantDb.run(tenant.id, (tx) =>
      this.findCredentials(tx, { phone: input.phone }),
    );

    // Hashing runs outside the transaction so it does not hold a database connection.
    const passwordOk = await this.passwords.verify(credentials?.password_hash, input.password);
    if (!credentials || !passwordOk) {
      throw invalidCredentials();
    }

    if (!credentials.totp_secret) {
      if (mustUseTotp(credentials)) {
        throw totpSetupRequired(this.tokens.signTotpSetup(credentials.user_id, tenant.id));
      }
    } else {
      if (!input.totpCode) {
        throw totpRequired();
      }
      await this.rateLimiter.consume(`totp:${credentials.user_id}`, TOTP_LIMIT);
      const secret = this.crypto.decrypt(TOTP_PURPOSE, credentials.totp_secret);
      if (!(await this.totp.verify(credentials.user_id, secret, input.totpCode))) {
        throw invalidTotp();
      }
    }

    // Only failed attempts count towards the limits.
    await Promise.all([
      this.rateLimiter.reset(loginKey),
      this.rateLimiter.reset(`totp:${credentials.user_id}`),
    ]);
    return this.startSession(tenant.id, credentials.user_id, meta);
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

    const credentials = await this.tenantDb.run(tenant.id, (tx) =>
      this.findCredentials(tx, { userId }),
    );
    if (!credentials) {
      throw unauthorized();
    }
    if (credentials.totp_secret) {
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
      const [row] = await tx.$queryRaw<{ enrolled: boolean }[]>`
        SELECT auth_enroll_totp(${claims.sub}::uuid, ${claims.sec}) AS enrolled`;
      return row?.enrolled === true;
    });
    if (!enrolled) {
      throw totpAlreadyEnabled();
    }

    return claims.login ? this.startSession(tenant.id, claims.sub, meta) : null;
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

  /** Active staff member of the current organization, or undefined. */
  private async findCredentials(
    tx: TenantTransaction,
    by: { phone: string } | { userId: string },
  ): Promise<StaffCredentials | undefined> {
    const rows =
      'phone' in by
        ? await tx.$queryRaw<StaffCredentials[]>`
            SELECT * FROM auth_staff_credentials(${by.phone}, NULL)`
        : await tx.$queryRaw<StaffCredentials[]>`
            SELECT * FROM auth_staff_credentials(NULL, ${by.userId}::uuid)`;
    return rows[0];
  }
}
