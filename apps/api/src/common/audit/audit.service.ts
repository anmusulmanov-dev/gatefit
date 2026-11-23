import { Global, Injectable, Module } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { AppRequest } from '../http/app-request';
import type { TenantTransaction } from '../prisma/prisma.service';

/** Who performed an action, for the audit trail. */
export interface Actor {
  userId: string;
  ip: string | undefined;
}

export function actorOf(req: AppRequest): Actor {
  if (!req.auth) {
    throw new Error('actorOf() needs an authenticated request');
  }
  return { userId: req.auth.userId, ip: req.ip };
}

export interface AuditEntry {
  /** `<entity>.<verb>`, e.g. `role.update`. */
  action: string;
  entity: string;
  entityId?: string;
  /** State before and after, limited to what changed. Never credentials. */
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

/**
 * Writes to audit_logs (CLAUDE.md rule 5). The entry is part of the caller's transaction:
 * a change and its audit record are committed together or not at all.
 */
@Injectable()
export class AuditService {
  async record(
    tx: TenantTransaction,
    organizationId: string,
    /** null for a background job acting on its own. */
    actor: Actor | null,
    entry: AuditEntry,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        organizationId,
        actorId: actor?.userId ?? null,
        ip: actor?.ip,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        before: entry.before,
        after: entry.after,
      },
    });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
