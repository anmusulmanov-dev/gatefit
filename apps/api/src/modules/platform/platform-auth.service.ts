import type {
  PlatformLoginInput,
  PlatformMeResponse,
  TotpConfirmInput,
  TotpSetupResponse,
} from '@gatefit/shared';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RateLimiter } from '../../common/rate-limit/rate-limiter.service';
import { PasswordService } from '../../common/security/password.service';
import { LOGIN_LIMIT, TOTP_LIMIT, TOTP_SETUP_TOKEN_TTL_SECONDS } from '../auth/auth.constants';
import {
  invalidCredentials,
  invalidTotp,
  totpAlreadyEnabled,
  totpRequired,
  totpSetupRequired,
  unauthorized,
} from '../auth/auth.errors';
import { TokenService } from '../auth/token.service';
import { TotpService } from '../auth/totp.service';
import { PlatformPrismaService } from './platform-prisma.service';
import { PlatformSessionService } from './platform-session.service';

// Its own purpose and audiences: nothing made for a tenant sign-in works here, or back.
const TOTP_PURPOSE = 'platform-totp-secret';
const SETUP_AUDIENCE = 'platform-totp-setup';
const ENROLL_AUDIENCE = 'platform-totp-enroll';

const setupClaims = z.object({ sub: z.uuid() });
const enrollClaims = z.object({ sub: z.uuid(), sec: z.string() });

interface ClientMeta {
  ip: string | undefined;
  userAgent: string | undefined;
}

/**
 * Sign-in of platform operators: phone, password and, always, an authenticator code.
 * An operator without an authenticator must enrol one before their first session.
 */
@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly db: PlatformPrismaService,
    private readonly sessions: PlatformSessionService,
    private readonly passwords: PasswordService,
    private readonly totp: TotpService,
    private readonly tokens: TokenService,
    private readonly crypto: CryptoService,
    private readonly rateLimiter: RateLimiter,
  ) {}

  /** Returns a session token. Throws INVALID_CREDENTIALS, TOTP_REQUIRED, INVALID_TOTP or TOTP_SETUP_REQUIRED. */
  async login(input: PlatformLoginInput, meta: ClientMeta): Promise<string> {
    const loginKey = `platform-login:${input.phone}`;
    await this.rateLimiter.consume(loginKey, LOGIN_LIMIT);

    const admin = await this.db.platformAdmin.findFirst({
      where: { phone: input.phone, status: 'active' },
    });
    const passwordOk = await this.passwords.verify(admin?.passwordHash, input.password);
    if (!admin || !passwordOk) {
      throw invalidCredentials();
    }

    if (!admin.totpSecret) {
      throw totpSetupRequired(
        this.tokens.signPurpose(SETUP_AUDIENCE, { sub: admin.id }, TOTP_SETUP_TOKEN_TTL_SECONDS),
      );
    }
    if (!input.totpCode) {
      throw totpRequired();
    }
    await this.rateLimiter.consume(`platform-totp:${admin.id}`, TOTP_LIMIT);
    const secret = this.crypto.decrypt(TOTP_PURPOSE, admin.totpSecret);
    if (!(await this.totp.verify(admin.id, secret, input.totpCode))) {
      throw invalidTotp();
    }

    await Promise.all([
      this.rateLimiter.reset(loginKey),
      this.rateLimiter.reset(`platform-totp:${admin.id}`),
    ]);
    return this.sessions.start(admin.id, meta);
  }

  /** Starts authenticator enrolment for an operator who has just proved their password. */
  async beginTotpSetup(setupToken: string): Promise<TotpSetupResponse> {
    const claims = this.tokens.verifyPurpose(SETUP_AUDIENCE, setupToken, setupClaims);
    const admin = claims
      ? await this.db.platformAdmin.findFirst({ where: { id: claims.sub, status: 'active' } })
      : null;
    if (!admin) {
      throw unauthorized('Setup token is invalid or expired');
    }
    if (admin.totpSecret) {
      throw totpAlreadyEnabled();
    }

    const { secret, otpauthUrl } = this.totp.createSecret('platform');
    const enrollToken = this.tokens.signPurpose(
      ENROLL_AUDIENCE,
      { sub: admin.id, sec: this.crypto.encrypt(TOTP_PURPOSE, secret) },
      TOTP_SETUP_TOKEN_TTL_SECONDS,
    );
    return { secret, otpauthUrl, enrollToken };
  }

  /** Stores the authenticator once the first code is confirmed, and signs the operator in. */
  async confirmTotpSetup(input: TotpConfirmInput, meta: ClientMeta): Promise<string> {
    const claims = this.tokens.verifyPurpose(ENROLL_AUDIENCE, input.enrollToken, enrollClaims);
    if (!claims) {
      throw unauthorized('Enrol token is invalid or expired');
    }

    await this.rateLimiter.consume(`platform-totp:${claims.sub}`, TOTP_LIMIT);
    const secret = this.crypto.decrypt(TOTP_PURPOSE, claims.sec);
    if (!(await this.totp.verify(claims.sub, secret, input.code))) {
      throw invalidTotp();
    }

    // Never replaces an existing authenticator.
    const enrolled = await this.db.platformAdmin.updateMany({
      where: { id: claims.sub, status: 'active', totpSecret: null },
      data: { totpSecret: claims.sec },
    });
    if (enrolled.count === 0) {
      throw totpAlreadyEnabled();
    }
    return this.sessions.start(claims.sub, meta);
  }

  async me(adminId: string): Promise<PlatformMeResponse> {
    return this.db.platformAdmin.findUniqueOrThrow({
      where: { id: adminId },
      select: { id: true, phone: true, name: true },
    });
  }
}
