import type { SessionAudience } from '@gatefit/shared';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { z } from 'zod';
import { Clock } from '../../common/clock/clock';
import type { AuthContext } from '../../common/http/app-request';
import type { Env } from '../../config/env';
import { ACCESS_TOKEN_TTL_SECONDS, TOTP_SETUP_TOKEN_TTL_SECONDS } from './auth.constants';

const accessClaims = z.object({
  sub: z.uuid(),
  org: z.uuid(),
  sid: z.uuid(),
  aud: z.enum(['staff', 'member']),
});

const totpSetupClaims = z.object({ sub: z.uuid(), org: z.uuid() });

const totpEnrollClaims = z.object({
  sub: z.uuid(),
  org: z.uuid(),
  /** The new secret, encrypted: the client carries it but cannot read or change it. */
  sec: z.string(),
  /** True when enrolment is part of signing in and should end with a session. */
  login: z.boolean(),
});

export type TotpEnrollClaims = z.infer<typeof totpEnrollClaims>;

const TOTP_SETUP_AUDIENCE = 'totp-setup';
const TOTP_ENROLL_AUDIENCE = 'totp-enroll';

/**
 * Signs and verifies our JWTs. Each kind of token has its own audience, so one can never
 * be accepted in place of another. Time comes from Clock, not from the JWT library.
 */
@Injectable()
export class TokenService {
  private readonly secret: string;

  constructor(
    private readonly jwt: JwtService,
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
  ) {
    this.secret = config.get('JWT_SECRET', { infer: true });
  }

  signAccess(auth: AuthContext, organizationId: string): string {
    return this.sign(
      auth.audience,
      { sub: auth.userId, org: organizationId, sid: auth.sessionId },
      ACCESS_TOKEN_TTL_SECONDS,
    );
  }

  /** Returns the caller and their organization, or null for a missing, forged or expired token. */
  verifyAccess(
    token: string | undefined,
    audience: SessionAudience,
  ): (AuthContext & { organizationId: string }) | null {
    const claims = this.verify(token, audience, accessClaims);
    return claims
      ? {
          userId: claims.sub,
          sessionId: claims.sid,
          audience: claims.aud,
          organizationId: claims.org,
        }
      : null;
  }

  signTotpSetup(userId: string, organizationId: string): string {
    return this.sign(
      TOTP_SETUP_AUDIENCE,
      { sub: userId, org: organizationId },
      TOTP_SETUP_TOKEN_TTL_SECONDS,
    );
  }

  verifyTotpSetup(token: string): { userId: string; organizationId: string } | null {
    const claims = this.verify(token, TOTP_SETUP_AUDIENCE, totpSetupClaims);
    return claims ? { userId: claims.sub, organizationId: claims.org } : null;
  }

  signTotpEnroll(claims: TotpEnrollClaims): string {
    return this.sign(TOTP_ENROLL_AUDIENCE, claims, TOTP_SETUP_TOKEN_TTL_SECONDS);
  }

  verifyTotpEnroll(token: string): TotpEnrollClaims | null {
    return this.verify(token, TOTP_ENROLL_AUDIENCE, totpEnrollClaims);
  }

  private sign(audience: string, claims: Record<string, unknown>, ttlSeconds: number): string {
    const issuedAt = this.clock.nowSeconds();
    return this.jwt.sign(
      { ...claims, aud: audience, iat: issuedAt, exp: issuedAt + ttlSeconds },
      { secret: this.secret, algorithm: 'HS256' },
    );
  }

  private verify<Claims>(
    token: string | undefined,
    audience: string,
    schema: z.ZodType<Claims>,
  ): Claims | null {
    if (!token) {
      return null;
    }
    try {
      const payload: unknown = this.jwt.verify(token, {
        secret: this.secret,
        algorithms: ['HS256'],
        audience,
        clockTimestamp: this.clock.nowSeconds(),
      });
      const parsed = schema.safeParse(payload);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
}
