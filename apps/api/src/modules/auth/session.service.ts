import { createHash, randomBytes } from 'node:crypto';
import type { SessionAudience } from '@gatefit/shared';
import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock/clock';
import { uuidv7 } from '../../common/ids/uuid-v7';
import { TenantDb } from '../../common/tenancy/tenant-db.service';
import type { TenantTransaction } from '../../common/prisma/prisma.service';
import { REFRESH_REUSE_GRACE_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from './auth.constants';
import type { SessionTokens } from './auth.cookies';
import { TokenService } from './token.service';

export interface ClientMeta {
  ip: string | undefined;
  userAgent: string | undefined;
}

interface NewSession {
  userId: string;
  audience: SessionAudience;
  /** Omitted for a fresh sign-in; passed on when rotating within a family. */
  familyId?: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Refresh-token sessions: issue, rotate, revoke. */
@Injectable()
export class SessionService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly tokens: TokenService,
    private readonly clock: Clock,
  ) {}

  /** Creates a session inside the caller's tenant transaction and returns its token pair. */
  async issue(
    tx: TenantTransaction,
    organizationId: string,
    session: NewSession,
    meta: ClientMeta,
  ): Promise<SessionTokens> {
    const now = this.clock.now();
    // 256 random bits: unguessable, so a plain SHA-256 is enough to store it.
    const refreshToken = randomBytes(32).toString('base64url');

    const created = await tx.session.create({
      data: {
        organizationId,
        userId: session.userId,
        audience: session.audience,
        familyId: session.familyId ?? uuidv7(now),
        refreshTokenHash: hashToken(refreshToken),
        userAgent: meta.userAgent?.slice(0, 255),
        ip: meta.ip,
        expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      },
    });

    const accessToken = this.tokens.signAccess(
      { userId: session.userId, sessionId: created.id, audience: session.audience },
      organizationId,
    );
    return { accessToken, refreshToken };
  }

  /**
   * Exchanges a refresh token for a new pair. Each token works once. Presenting a used
   * token again means it was copied: the whole family is revoked, signing out both the
   * thief and the owner. Returns null whenever the token cannot be honoured.
   */
  async rotate(
    organizationId: string,
    audience: SessionAudience,
    refreshToken: string,
    meta: ClientMeta,
  ): Promise<SessionTokens | null> {
    const now = this.clock.now();

    // The revocation below must be committed even though the caller gets a refusal,
    // so the outcome is returned from the transaction instead of thrown inside it.
    return this.tenantDb.run(organizationId, async (tx) => {
      const session = await tx.session.findUnique({
        where: { refreshTokenHash: hashToken(refreshToken) },
      });
      if (
        !session ||
        session.audience !== audience ||
        session.revokedAt ||
        session.expiresAt <= now
      ) {
        return null;
      }

      // Claim the token atomically: of two concurrent requests only one gets count 1.
      const claimed = session.rotatedAt
        ? { count: 0 }
        : await tx.session.updateMany({
            where: { id: session.id, rotatedAt: null },
            data: { rotatedAt: now },
          });

      if (claimed.count === 0) {
        const current = await tx.session.findUniqueOrThrow({ where: { id: session.id } });
        const usedAt = current.rotatedAt ?? now;
        const withinGrace = now.getTime() - usedAt.getTime() <= REFRESH_REUSE_GRACE_SECONDS * 1000;
        if (!withinGrace) {
          await this.revokeFamily(tx, session.familyId);
        }
        return null;
      }

      return this.issue(
        tx,
        organizationId,
        { userId: session.userId, audience, familyId: session.familyId },
        meta,
      );
    });
  }

  /** Signs out the device that holds this refresh token. Unknown tokens are ignored. */
  async revokeByRefreshToken(organizationId: string, refreshToken: string): Promise<void> {
    await this.tenantDb.run(organizationId, async (tx) => {
      const session = await tx.session.findUnique({
        where: { refreshTokenHash: hashToken(refreshToken) },
      });
      if (session) {
        await this.revokeFamily(tx, session.familyId);
      }
    });
  }

  /** Signs the user out everywhere within the current organization. */
  async revokeAllForUser(tx: TenantTransaction, userId: string): Promise<void> {
    await tx.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });
  }

  /** Ends every staff session of the user, e.g. after their credentials were reset. */
  async revokeStaffSessions(tx: TenantTransaction, userId: string): Promise<void> {
    await tx.session.updateMany({
      where: { userId, audience: 'staff', revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });
  }

  /** Ends the user's other staff sessions and keeps the one making this request. */
  async revokeOtherStaffSessions(
    tx: TenantTransaction,
    userId: string,
    currentSessionId: string,
  ): Promise<void> {
    const current = await tx.session.findUnique({ where: { id: currentSessionId } });
    await tx.session.updateMany({
      where: {
        userId,
        audience: 'staff',
        revokedAt: null,
        ...(current ? { familyId: { not: current.familyId } } : {}),
      },
      data: { revokedAt: this.clock.now() },
    });
  }

  /** True while the session behind an access token has not been revoked or expired. */
  async isActive(tx: TenantTransaction, sessionId: string): Promise<boolean> {
    const session = await tx.session.findUnique({ where: { id: sessionId } });
    return !!session && !session.revokedAt && session.expiresAt > this.clock.now();
  }

  private async revokeFamily(tx: TenantTransaction, familyId: string): Promise<void> {
    await tx.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });
  }
}
