import { z } from 'zod';
import { pageQuerySchema } from './pagination';

// Messages to members (docs/TZ.md F-4.2, F-7.2 for MVP) and the daily summary (F-8.1).

/** Messages a club can word itself. Sign-in codes are fixed: their wording is a safety matter. */
export const NOTIFICATION_TEMPLATE_KEYS = ['payment_receipt', 'expiry_reminder'] as const;
export type NotificationTemplateKey = (typeof NOTIFICATION_TEMPLATE_KEYS)[number];

/** What each template may mention, as `{name}` in its text. */
export const TEMPLATE_VARIABLES: Record<NotificationTemplateKey, readonly string[]> = {
  payment_receipt: ['organization', 'amount', 'number', 'balance'],
  expiry_reminder: ['organization', 'name', 'plan', 'date', 'days'],
};

export const TEMPLATE_LOCALES = ['uz', 'ru', 'en'] as const;
export type TemplateLocale = (typeof TEMPLATE_LOCALES)[number];

/** An SMS longer than this is split into several and costs more. */
export const TEMPLATE_MAX_LENGTH = 500;

/** Days before a membership's last day when the reminder goes out. */
export const EXPIRY_REMINDER_DAYS = 3;
/** Local hour at the membership's location when reminders go out. */
export const EXPIRY_REMINDER_HOUR = 10;

export const NOTIFICATION_STATUSES = ['queued', 'sent', 'failed'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const NOTIFICATION_KINDS = ['payment_receipt', 'expiry_reminder'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Placeholders a text uses, in order of appearance. */
export function templateVariables(body: string): string[] {
  return [...body.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '');
}

/** Fills `{name}` placeholders; unknown ones stay as they are. */
export function renderTemplate(body: string, values: Record<string, string>): string {
  return body.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

/** `null` goes back to the standard wording. */
export const notificationTemplateUpdateSchema = z.object({
  body: z.string().trim().min(1).max(TEMPLATE_MAX_LENGTH).nullable(),
});
export type NotificationTemplateUpdateInput = z.infer<typeof notificationTemplateUpdateSchema>;

export const notificationListQuerySchema = pageQuerySchema.extend({
  memberId: z.uuid().optional(),
  status: z.enum(NOTIFICATION_STATUSES).optional(),
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

export const dailyReportQuerySchema = z.object({
  locationId: z.uuid(),
  /** The location's calendar day; today there when omitted. */
  date: z.iso.date().optional(),
});
export type DailyReportQuery = z.infer<typeof dailyReportQuerySchema>;

export interface NotificationTemplateDto {
  key: NotificationTemplateKey;
  locale: TemplateLocale;
  body: string;
  /** True while the club uses the standard wording. */
  isDefault: boolean;
  variables: readonly string[];
}

export interface NotificationDto {
  id: string;
  kind: NotificationKind;
  channel: 'sms';
  memberId: string | null;
  to: string;
  body: string;
  status: NotificationStatus;
  attempts: number;
  sentAt: string | null;
  createdAt: string;
}

export interface DailyRevenueLineDto {
  method: string;
  count: number;
  amountMinor: string;
}

export interface ExpiringMembershipDto {
  membershipId: string;
  member: { id: string; firstName: string; lastName: string; phone: string };
  planName: string;
  endsOn: string;
}

/** One location's day (docs/TZ.md F-8.1). */
export interface DailyReportDto {
  date: string;
  location: { id: string; name: string; timezone: string };
  currency: string;
  /** Taken that day, by method. */
  revenue: DailyRevenueLineDto[];
  refundsMinor: string;
  /** Taken less given back. */
  netMinor: string;
  newMembers: number;
  visits: { entries: number; members: number; refused: number };
  /** Memberships of this location whose last day is within the next 7 days. */
  expiring: ExpiringMembershipDto[];
}
