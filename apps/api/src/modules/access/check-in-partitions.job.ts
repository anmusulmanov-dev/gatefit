import { addMonths, localDate } from '@gatefit/shared';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { Clock } from '../../common/clock/clock';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueueService } from '../../common/queue/queue.service';
import type { Env } from '../../config/env';

const QUEUE_NAME = 'check-in-partitions';
/** Months created ahead of the current one. */
const MONTHS_AHEAD = 3;

/**
 * check_ins is partitioned by month (docs/TZ.md section 6). Once a day this makes sure the
 * next months exist, through a SECURITY DEFINER function of the access_rls migration: the
 * API role cannot create tables itself. Creating what exists does nothing.
 */
@Injectable()
export class CheckInPartitionsJob implements OnModuleInit {
  private readonly logger = new Logger(CheckInPartitionsJob.name);
  private queue!: Queue<object>;

  constructor(
    private readonly queues: QueueService,
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = this.queues.queue<object>(QUEUE_NAME);
    this.queues.worker<object>(QUEUE_NAME, () => this.run());
    if (this.config.get('NODE_ENV', { infer: true }) !== 'test') {
      await this.queue.upsertJobScheduler('daily', { pattern: '15 3 * * *', tz: 'UTC' });
    }
  }

  /** Returns how many partitions were created. */
  async run(now: Date = this.clock.now()): Promise<number> {
    const today = localDate(now, 'UTC');
    const until = addMonths(today, MONTHS_AHEAD).date;
    const [row] = await this.prisma.$queryRaw<{ created: number }[]>`
      SELECT access_ensure_check_in_partitions(${today}::date, ${until}::date) AS created`;
    const created = row?.created ?? 0;
    if (created > 0) {
      this.logger.log(`Created ${String(created)} check-in partitions up to ${until}`);
    }
    return created;
  }
}
