import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { Clock } from '../../common/clock/clock';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueueService } from '../../common/queue/queue.service';
import { TenantDb } from '../../common/tenancy/tenant-db.service';
import type { Env } from '../../config/env';
import { MembershipsService } from './memberships.service';

const QUEUE_NAME = 'membership-status';

/**
 * The hourly job of docs/TZ.md 5.3: memberships start, freeze, thaw and expire at midnight
 * in their location's time zone, and members' statuses follow. Each membership carries the
 * moment its status next changes, so a run touches only those whose moment has come.
 * Running it twice, or late, does no harm (CLAUDE.md rule 6).
 */
@Injectable()
export class MembershipStatusJob implements OnModuleInit {
  private readonly logger = new Logger(MembershipStatusJob.name);
  private queue!: Queue<object>;

  constructor(
    private readonly queues: QueueService,
    private readonly prisma: PrismaService,
    private readonly tenantDb: TenantDb,
    private readonly memberships: MembershipsService,
    private readonly clock: Clock,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = this.queues.queue<object>(QUEUE_NAME);
    this.queues.worker<object>(QUEUE_NAME, () => this.run());
    // Tests call run() themselves; a schedule there would only leave keys in Redis.
    if (this.config.get('NODE_ENV', { infer: true }) !== 'test') {
      await this.queue.upsertJobScheduler('hourly', { pattern: '0 * * * *', tz: 'UTC' });
    }
  }

  /** One pass over every organization with memberships due. Returns statuses changed. */
  async run(now: Date = this.clock.now()): Promise<number> {
    // The only cross-organization read: ids of organizations with work, nothing else
    // (a SECURITY DEFINER function, see the memberships_rls migration). The work itself
    // happens inside each organization, under RLS.
    const organizations = await this.prisma.$queryRaw<{ organization_id: string }[]>`
      SELECT organization_id FROM jobs_organizations_with_due_memberships(${now})`;
    let changed = 0;
    for (const { organization_id: organizationId } of organizations) {
      try {
        changed += await this.tenantDb.run(organizationId, (tx) =>
          this.memberships.applyDueChanges(tx, organizationId, now),
        );
      } catch (error) {
        // One organization's failure must not hold up the others; the next run retries.
        this.logger.error(
          `Membership statuses of ${organizationId} failed: ${(error as Error).message}`,
        );
      }
    }
    return changed;
  }
}
