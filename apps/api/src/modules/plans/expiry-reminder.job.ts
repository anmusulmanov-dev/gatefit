import {
  addDays,
  EXPIRY_REMINDER_DAYS,
  EXPIRY_REMINDER_HOUR,
  formatCalendarDate,
  localDate,
  localTime,
} from '@gatefit/shared';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { Clock } from '../../common/clock/clock';
import { PrismaService, type TenantTransaction } from '../../common/prisma/prisma.service';
import { QueueService } from '../../common/queue/queue.service';
import { TenantDb } from '../../common/tenancy/tenant-db.service';
import type { Env } from '../../config/env';
import { MembersService } from '../members/members.service';
import { NotificationsService } from '../notifications/notifications.service';
import { membershipInclude } from './memberships.service';

const QUEUE_NAME = 'expiry-reminders';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Reminds members that their membership ends soon (docs/TZ.md F-7.2, MVP part): three
 * days before the last day, from 10:00 at the membership's location. Runs hourly, so each
 * time zone gets its turn; a reminder is sent once per membership and last day, however
 * often the job runs (CLAUDE.md rule 6). A membership extended by a freeze gets a new one.
 */
@Injectable()
export class ExpiryReminderJob implements OnModuleInit {
  private readonly logger = new Logger(ExpiryReminderJob.name);
  private queue!: Queue<object>;

  constructor(
    private readonly queues: QueueService,
    private readonly prisma: PrismaService,
    private readonly tenantDb: TenantDb,
    private readonly members: MembersService,
    private readonly notifications: NotificationsService,
    private readonly clock: Clock,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = this.queues.queue<object>(QUEUE_NAME);
    this.queues.worker<object>(QUEUE_NAME, () => this.run());
    if (this.config.get('NODE_ENV', { infer: true }) !== 'test') {
      await this.queue.upsertJobScheduler('hourly', { pattern: '5 * * * *', tz: 'UTC' });
    }
  }

  /** Returns how many reminders were queued. */
  async run(now: Date = this.clock.now()): Promise<number> {
    // Organization ids only, through a SECURITY DEFINER function (notifications_rls).
    const organizations = await this.prisma.$queryRaw<{ organization_id: string }[]>`
      SELECT organization_id FROM jobs_organizations_with_expiring_memberships(
        ${new Date(now.getTime() + (EXPIRY_REMINDER_DAYS - 1) * DAY_MS)},
        ${new Date(now.getTime() + (EXPIRY_REMINDER_DAYS + 2) * DAY_MS)})`;
    let queued = 0;
    for (const { organization_id: organizationId } of organizations) {
      try {
        queued += await this.tenantDb.run(organizationId, (tx) =>
          this.remind(tx, organizationId, now),
        );
      } catch (error) {
        this.logger.error(`Reminders of ${organizationId} failed: ${(error as Error).message}`);
      }
    }
    return queued;
  }

  private async remind(tx: TenantTransaction, organizationId: string, now: Date): Promise<number> {
    const rows = await tx.membership.findMany({
      where: {
        cancelledAt: null,
        deletedAt: null,
        status: { in: ['active', 'frozen'] },
        endsAt: {
          gt: new Date(now.getTime() + (EXPIRY_REMINDER_DAYS - 1) * DAY_MS),
          lte: new Date(now.getTime() + (EXPIRY_REMINDER_DAYS + 2) * DAY_MS),
        },
      },
      include: membershipInclude,
    });
    const due = rows.filter((row) => {
      const zone = row.location.timezone;
      const endsOn = row.endsOn.toISOString().slice(0, 10);
      return (
        endsOn === addDays(localDate(now, zone), EXPIRY_REMINDER_DAYS) &&
        Number(localTime(now, zone).slice(0, 2)) >= EXPIRY_REMINDER_HOUR
      );
    });
    const contacts = await this.members.contactsOf(
      tx,
      due.map((row) => row.memberId),
    );
    let queued = 0;
    for (const row of due) {
      const member = contacts.get(row.memberId);
      if (!member) {
        continue;
      }
      const endsOn = row.endsOn.toISOString().slice(0, 10);
      await this.notifications.send(tx, organizationId, {
        kind: 'expiry_reminder',
        template: 'expiry_reminder',
        memberId: member.id,
        to: member.phone,
        dedupeKey: `expiry:${row.id}:${endsOn}`,
        values: () => ({
          name: member.firstName,
          plan: row.planName,
          date: formatCalendarDate(endsOn),
          days: String(EXPIRY_REMINDER_DAYS),
        }),
      });
      queued += 1;
    }
    return queued;
  }
}
