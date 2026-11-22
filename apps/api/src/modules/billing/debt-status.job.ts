import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { Clock } from '../../common/clock/clock';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueueService } from '../../common/queue/queue.service';
import { TenantDb } from '../../common/tenancy/tenant-db.service';
import type { Env } from '../../config/env';
import { InvoicesService } from './invoices.service';

const QUEUE_NAME = 'debt-status';

/**
 * Hourly: members whose invoices passed their due moment unpaid become debtors (docs/TZ.md
 * 5.3). Each invoice is handled once; running again or late does no harm.
 */
@Injectable()
export class DebtStatusJob implements OnModuleInit {
  private readonly logger = new Logger(DebtStatusJob.name);
  private queue!: Queue<object>;

  constructor(
    private readonly queues: QueueService,
    private readonly prisma: PrismaService,
    private readonly tenantDb: TenantDb,
    private readonly invoices: InvoicesService,
    private readonly clock: Clock,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = this.queues.queue<object>(QUEUE_NAME);
    this.queues.worker<object>(QUEUE_NAME, () => this.run());
    if (this.config.get('NODE_ENV', { infer: true }) !== 'test') {
      await this.queue.upsertJobScheduler('hourly', { pattern: '0 * * * *', tz: 'UTC' });
    }
  }

  /** One pass over every organization with invoices just overdue. Returns invoices handled. */
  async run(now: Date = this.clock.now()): Promise<number> {
    // Organization ids only (SECURITY DEFINER, see the billing_rls migration); the work
    // happens inside each organization under RLS.
    const organizations = await this.prisma.$queryRaw<{ organization_id: string }[]>`
      SELECT organization_id FROM jobs_organizations_with_overdue_invoices(${now})`;
    let handled = 0;
    for (const { organization_id: organizationId } of organizations) {
      try {
        handled += await this.tenantDb.run(organizationId, (tx) =>
          this.invoices.markOverdue(tx, now),
        );
      } catch (error) {
        this.logger.error(
          `Overdue invoices of ${organizationId} failed: ${(error as Error).message}`,
        );
      }
    }
    return handled;
  }
}
