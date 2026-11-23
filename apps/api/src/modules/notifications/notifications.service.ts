import { messages, resolveLocale } from '@gatefit/i18n';
import {
  ErrorCode,
  type NotificationDto,
  type NotificationKind,
  type NotificationListQuery,
  type NotificationTemplateDto,
  type NotificationTemplateKey,
  NOTIFICATION_TEMPLATE_KEYS,
  type Page,
  renderTemplate,
  TEMPLATE_LOCALES,
  TEMPLATE_VARIABLES,
  type TemplateLocale,
  templateVariables,
} from '@gatefit/shared';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { AuditService } from '../../common/audit/audit.service';
import { Clock } from '../../common/clock/clock';
import { unprocessable } from '../../common/errors/domain-errors';
import type { StaffCaller } from '../../common/http/staff-request';
import { pageArgs, toPage } from '../../common/pagination/paginate';
import type { TenantTransaction } from '../../common/prisma/prisma.service';
import { QueueService } from '../../common/queue/queue.service';
import { SMS_PROVIDER, type SmsProvider } from '../../common/sms/sms.provider';
import { TenantDb } from '../../common/tenancy/tenant-db.service';
import type { Notification } from '../../generated/prisma/client';
import { MembersService } from '../members/members.service';
import { OrganizationService } from '../tenancy/organization.service';

const QUEUE_NAME = 'notifications';
/** One try now, then again after 1, 5 and 30 minutes (docs/ADR/0011-notifications.md). */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;
const ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/** Standard texts in the catalogue, by template. */
const CATALOGUE_KEYS: Record<NotificationTemplateKey, 'receipt' | 'expiryReminder'> = {
  payment_receipt: 'receipt',
  expiry_reminder: 'expiryReminder',
};

interface DeliveryJob {
  organizationId: string;
  notificationId: string;
}

export interface OutgoingMessage {
  kind: NotificationKind;
  template: NotificationTemplateKey;
  memberId: string | null;
  to: string;
  /** Placeholder values, given the language the message goes out in (amounts, dates). */
  values: (locale: TemplateLocale) => Record<string, string>;
  /** Sends the message once only: a second call with the same key does nothing. */
  dedupeKey?: string;
}

/**
 * Messages to members (docs/TZ.md F-4.2, F-7.2 MVP): the wording comes from the club's
 * template or the standard text, in the organization's language; every message is logged
 * and sent through a queue that retries a failed send three times.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private queue!: Queue<DeliveryJob>;

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly queues: QueueService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly organizations: OrganizationService,
    private readonly members: MembersService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  onModuleInit(): void {
    this.queue = this.queues.queue<DeliveryJob>(QUEUE_NAME);
    this.queues.worker<DeliveryJob>(QUEUE_NAME, (job) => this.deliver(job.data, job.attemptsMade), {
      settings: {
        backoffStrategy: (attemptsMade: number) =>
          RETRY_DELAYS_MS[Math.min(attemptsMade, RETRY_DELAYS_MS.length) - 1] ?? 0,
      },
    });
  }

  /** Logs the message and sends it once the surrounding transaction commits. */
  async send(
    tx: TenantTransaction,
    organizationId: string,
    message: OutgoingMessage,
  ): Promise<NotificationDto> {
    if (message.dedupeKey) {
      const earlier = await tx.notification.findFirst({ where: { dedupeKey: message.dedupeKey } });
      if (earlier) {
        return toNotificationDto(earlier);
      }
    }
    const organization = await this.organizations.get(tx, organizationId);
    const locale: TemplateLocale = resolveLocale(organization.locale);
    const template = await this.templateBody(tx, message.template, locale);
    const row = await tx.notification.create({
      data: {
        organizationId,
        memberId: message.memberId,
        kind: message.kind,
        to: message.to,
        body: renderTemplate(template, {
          organization: organization.name,
          ...message.values(locale),
        }),
        dedupeKey: message.dedupeKey ?? null,
      },
    });
    this.tenantDb.afterCommit(() => {
      void this.queue
        .add(
          'send',
          { organizationId, notificationId: row.id },
          {
            jobId: row.id,
            attempts: ATTEMPTS,
            backoff: { type: 'custom' },
            removeOnComplete: true,
          },
        )
        .catch((error: unknown) => {
          this.logger.error(`Could not queue notification ${row.id}: ${(error as Error).message}`);
        });
    });
    return toNotificationDto(row);
  }

  /**
   * One try at sending a logged message. The provider is called outside any transaction;
   * a message already sent is not sent again. Throws so the queue retries.
   */
  async deliver(job: DeliveryJob, attemptsMade = 0): Promise<void> {
    const row = await this.tenantDb.run(job.organizationId, (tx) =>
      tx.notification.findUnique({ where: { id: job.notificationId } }),
    );
    if (!row || row.status === 'sent') {
      return;
    }
    try {
      await this.sms.send(row.to, row.body);
    } catch (error) {
      const last = attemptsMade + 1 >= ATTEMPTS;
      await this.tenantDb.run(job.organizationId, (tx) =>
        tx.notification.update({
          where: { id: row.id },
          data: {
            attempts: { increment: 1 },
            status: last ? 'failed' : 'queued',
            lastError: (error as Error).message.slice(0, 200),
          },
        }),
      );
      throw error;
    }
    await this.tenantDb.run(job.organizationId, (tx) =>
      tx.notification.update({
        where: { id: row.id },
        data: {
          attempts: { increment: 1 },
          status: 'sent',
          sentAt: this.clock.now(),
          lastError: null,
        },
      }),
    );
  }

  async list(
    tx: TenantTransaction,
    caller: StaffCaller,
    query: NotificationListQuery,
  ): Promise<Page<NotificationDto>> {
    if (query.memberId) {
      // 404 for a member the caller may not see (docs/ADR/0006-member-visibility.md).
      await this.members.findVisible(tx, caller, query.memberId);
    } else if (caller.locationIds !== null) {
      // Branch staff see messages of their own members only.
      return { items: [], nextCursor: null };
    }
    const page = pageArgs(query, 'desc');
    const rows = await tx.notification.findMany({
      ...page,
      where: { ...page.where, memberId: query.memberId, status: query.status },
    });
    return toPage(rows, query, toNotificationDto);
  }

  async templates(tx: TenantTransaction): Promise<NotificationTemplateDto[]> {
    const custom = await tx.notificationTemplate.findMany({ where: { body: { not: null } } });
    return NOTIFICATION_TEMPLATE_KEYS.flatMap((key) =>
      TEMPLATE_LOCALES.map((locale) => {
        const own = custom.find((row) => row.key === key && row.locale === locale)?.body;
        return {
          key,
          locale,
          body: own ?? standardText(key, locale),
          isDefault: !own,
          variables: TEMPLATE_VARIABLES[key],
        };
      }),
    );
  }

  /** Changes a template's wording; `null` goes back to the standard text. Audited. */
  async updateTemplate(
    tx: TenantTransaction,
    caller: StaffCaller,
    key: NotificationTemplateKey,
    locale: TemplateLocale,
    body: string | null,
  ): Promise<NotificationTemplateDto> {
    if (body !== null) {
      const unknown = templateVariables(body).filter(
        (name) => !TEMPLATE_VARIABLES[key].includes(name),
      );
      if (unknown.length > 0) {
        throw unprocessable(ErrorCode.INVALID_TEMPLATE, 'Unknown placeholder', { unknown });
      }
    }
    const before = await tx.notificationTemplate.findUnique({
      where: { organizationId_key_locale: { organizationId: caller.organizationId, key, locale } },
    });
    const saved = await tx.notificationTemplate.upsert({
      where: { organizationId_key_locale: { organizationId: caller.organizationId, key, locale } },
      create: {
        organizationId: caller.organizationId,
        key,
        locale,
        body,
        updatedBy: caller.actor.userId,
      },
      update: { body, updatedBy: caller.actor.userId },
    });
    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'notification_template.update',
      entity: 'notification_template',
      entityId: saved.id,
      before: { key, locale, body: before?.body ?? null },
      after: { key, locale, body },
    });
    return {
      key,
      locale,
      body: body ?? standardText(key, locale),
      isDefault: body === null,
      variables: TEMPLATE_VARIABLES[key],
    };
  }

  private async templateBody(
    tx: TenantTransaction,
    key: NotificationTemplateKey,
    locale: TemplateLocale,
  ): Promise<string> {
    const own = await tx.notificationTemplate.findFirst({ where: { key, locale } });
    return own?.body ?? standardText(key, locale);
  }
}

function standardText(key: NotificationTemplateKey, locale: TemplateLocale): string {
  return messages[locale].sms[CATALOGUE_KEYS[key]];
}

function toNotificationDto(row: Notification): NotificationDto {
  return {
    id: row.id,
    kind: row.kind as NotificationKind,
    channel: 'sms',
    memberId: row.memberId,
    to: row.to,
    body: row.body,
    status: row.status,
    attempts: row.attempts,
    sentAt: row.sentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
