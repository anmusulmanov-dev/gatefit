import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock/clock';
import type { PlatformAdminContext } from './platform.http';
import { PlatformPrismaService } from './platform-prisma.service';

// Kept in sync with the cookie lifetime in platform.http.ts.
const SESSION_TTL_SECONDS = 12 * 60 * 60;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Platform sessions are deliberately simple: one opaque token, checked against the
 * database on every request, valid for a working day. No refresh, no JWT: an operator
 * signs in again with their authenticator, and revoking a session is immediate.
 */
@Injectable()
export class PlatformSessionService {
  constructor(
    private readonly db: PlatformPrismaService,
    private readonly clock: Clock,
  ) {}

  /** Starts a session and returns its token, which is shown to the client only once. */
  async start(
    adminId: string,
    meta: { ip: string | undefined; userAgent: string | undefined },
  ): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.db.platformSession.create({
      data: {
        adminId,
        tokenHash: hashToken(token),
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 255),
        expiresAt: new Date(this.clock.now().getTime() + SESSION_TTL_SECONDS * 1000),
      },
    });
    return token;
  }

  /** The operator behind a token, or null if it is unknown, expired, revoked or they were deactivated. */
  async resolve(token: string | undefined): Promise<PlatformAdminContext | null> {
    if (!token) {
      return null;
    }
    const session = await this.db.platformSession.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { admin: { select: { status: true } } },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= this.clock.now() ||
      session.admin.status !== 'active'
    ) {
      return null;
    }
    return { id: session.adminId, sessionId: session.id };
  }

  async end(sessionId: string): Promise<void> {
    await this.db.platformSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });
  }
}
