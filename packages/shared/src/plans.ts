import { z } from 'zod';
import { type InvoiceDto, paymentInputSchema, type PaymentDto } from './billing';
import { DURATION_UNITS, type DurationUnit } from './dates';
import { pageQuerySchema } from './pagination';
import { minorAmountSchema } from './platform';

// ---------------------------------------------------------------------------
// Plans (docs/TZ.md F-2.1, F-2.2)
// ---------------------------------------------------------------------------

/**
 * `duration`: unlimited visits for a period. `visits`: a number of visits within a period.
 * `single`: one visit. `trial`: a first try, once per member.
 */
export const PLAN_TYPES = ['duration', 'visits', 'single', 'trial'] as const;
export type PlanType = (typeof PLAN_TYPES)[number];

const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time as HH:MM');

/** Entry is allowed from `from` (inclusive) to `to` (exclusive), in the location's time. */
export const timeWindowSchema = z
  .object({ from: timeOfDaySchema, to: timeOfDaySchema.or(z.literal('24:00')) })
  .refine((window) => window.from < window.to, 'The window must end after it starts');

/** When and where a membership lets its holder in. Empty lists mean no restriction. */
export const planRestrictionsSchema = z.object({
  timeWindows: z.array(timeWindowSchema).max(4).default([]),
  /** ISO weekdays: 1 Monday ... 7 Sunday. */
  weekdays: z
    .array(z.number().int().min(1).max(7))
    .max(7)
    .transform((days) => [...new Set(days)].sort())
    .default([]),
  dailyVisitLimit: z.number().int().min(1).max(20).nullable().default(null),
  locationIds: z
    .array(z.uuid())
    .max(500)
    .transform((ids) => [...new Set(ids)])
    .default([]),
});
export type PlanRestrictions = z.infer<typeof planRestrictionsSchema>;

export const NO_RESTRICTIONS: PlanRestrictions = {
  timeWindows: [],
  weekdays: [],
  dailyVisitLimit: null,
  locationIds: [],
};

const planNameSchema = z.string().trim().min(1).max(80);
const descriptionSchema = z
  .string()
  .trim()
  .max(1000)
  .transform((value) => (value === '' ? null : value));

/** How a plan's memberships may be frozen. `maxDays` 0: they cannot be. */
export const planFreezeSchema = z.object({
  /** Days in all freezes of one membership together. */
  maxDays: z.number().int().min(0).max(365),
  /** How many separate freezes one membership allows. */
  maxTimes: z.number().int().min(0).max(50),
  /** The shortest freeze, in days. */
  minDays: z.number().int().min(1).max(365),
  /** Charged per freeze (taken in stage M4, with payments). */
  feeMinor: minorAmountSchema,
});
export type PlanFreeze = z.infer<typeof planFreezeSchema>;

export const NO_FREEZE: PlanFreeze = { maxDays: 0, maxTimes: 0, minDays: 1, feeMinor: '0' };

const planFields = {
  name: planNameSchema,
  description: descriptionSchema.nullish(),
  type: z.enum(PLAN_TYPES),
  durationValue: z.number().int().min(1).max(3650),
  durationUnit: z.enum(DURATION_UNITS),
  /** Visits the membership includes: required for `visits`, 1 for `single`, optional for `trial`. */
  visitLimit: z.number().int().min(1).max(1000).nullish(),
  priceMinor: minorAmountSchema,
  restrictions: planRestrictionsSchema.default(NO_RESTRICTIONS),
  freeze: planFreezeSchema.default(NO_FREEZE),
};

/** Rules that tie the fields of a plan together; shared by create and by the merged update. */
export function planShapeIssues(plan: {
  type: PlanType;
  visitLimit?: number | null;
  durationValue: number;
  durationUnit: DurationUnit;
}): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (plan.type === 'visits' && !plan.visitLimit) {
    issues.push({ path: 'visitLimit', message: 'A visits plan needs a number of visits' });
  }
  if (plan.type === 'duration' && plan.visitLimit) {
    issues.push({ path: 'visitLimit', message: 'A duration plan has unlimited visits' });
  }
  if (plan.type === 'single' && plan.visitLimit != null && plan.visitLimit !== 1) {
    issues.push({ path: 'visitLimit', message: 'A single visit is one visit' });
  }
  const days = { day: 1, month: 31, year: 366 }[plan.durationUnit] * plan.durationValue;
  if (days > 3660) {
    issues.push({ path: 'durationValue', message: 'A plan lasts at most ten years' });
  }
  return issues;
}

export const planCreateSchema = z.object(planFields).superRefine((plan, ctx) => {
  for (const issue of planShapeIssues(plan)) {
    ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
  }
});
export type PlanCreateInput = z.infer<typeof planCreateSchema>;

/** Changes apply to memberships sold afterwards; sold ones keep their terms. */
export const planUpdateSchema = z
  .object({
    name: planFields.name.optional(),
    description: descriptionSchema.nullable().optional(),
    type: planFields.type.optional(),
    durationValue: planFields.durationValue.optional(),
    durationUnit: planFields.durationUnit.optional(),
    visitLimit: z.number().int().min(1).max(1000).nullable().optional(),
    priceMinor: minorAmountSchema.optional(),
    restrictions: planRestrictionsSchema.optional(),
    freeze: planFreezeSchema.optional(),
    /** An inactive plan is no longer sold; memberships already sold are not affected. */
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');
export type PlanUpdateInput = z.infer<typeof planUpdateSchema>;

export const planListQuerySchema = pageQuerySchema.extend({
  /** `true`: only plans on sale; `false`: only withdrawn ones; omitted: all. */
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  type: z.enum(PLAN_TYPES).optional(),
});
export type PlanListQuery = z.infer<typeof planListQuerySchema>;

export interface PlanDto {
  id: string;
  name: string;
  description: string | null;
  type: PlanType;
  durationValue: number;
  durationUnit: DurationUnit;
  visitLimit: number | null;
  priceMinor: string;
  currency: string;
  restrictions: PlanRestrictions;
  freeze: PlanFreeze;
  isActive: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Memberships (docs/TZ.md F-2.3, F-2.4)
// ---------------------------------------------------------------------------

/**
 * `scheduled`: starts later. `frozen`: a freeze covers today. `expired`: past its last day
 * (or out of visits). `cancelled`: ended by staff.
 */
export const MEMBERSHIP_STATUSES = [
  'scheduled',
  'active',
  'frozen',
  'expired',
  'cancelled',
] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/** Whether a membership was frozen at the desk on staff's decision or at the member's request. */
export const FREEZE_SOURCES = ['staff', 'member_request'] as const;
export type FreezeSource = (typeof FREEZE_SOURCES)[number];

const calendarDateSchema = z.iso.date();
const reasonSchema = z.string().trim().min(1).max(500);

export const membershipSellSchema = z.object({
  planId: z.uuid(),
  /** Where it is sold; its time zone decides the dates. Defaults to the member's home location. */
  locationId: z.uuid().optional(),
  /** First day, in the location's time zone. Defaults to today there. */
  startsOn: calendarDateSchema.optional(),
  /** Money taken now; without it, or with "0", the whole price is owed. */
  payment: paymentInputSchema.optional(),
  /** Last day to pay what is left; omitted: owed at once. */
  dueOn: calendarDateSchema.optional(),
});
export type MembershipSellInput = z.infer<typeof membershipSellSchema>;

export const membershipFreezeSchema = z.object({
  /** First frozen day, today or later. */
  startsOn: calendarDateSchema,
  days: z.number().int().min(1).max(365),
  reason: reasonSchema,
  source: z.enum(FREEZE_SOURCES).default('staff'),
  /** Pays the plan's freeze fee now, if it has one; otherwise the fee is owed. */
  payment: paymentInputSchema.optional(),
});
export type MembershipFreezeInput = z.infer<typeof membershipFreezeSchema>;

export const membershipCancelSchema = z.object({ reason: reasonSchema });
export type MembershipCancelInput = z.infer<typeof membershipCancelSchema>;

export interface MembershipFreezeDto {
  id: string;
  startsOn: string;
  /** Last frozen day; earlier than planned when the freeze was ended early. */
  endsOn: string;
  days: number;
  reason: string;
  source: FreezeSource;
  feeMinor: string;
  currency: string;
  endedEarly: boolean;
  createdAt: string;
}

export interface MembershipDto {
  id: string;
  memberId: string;
  plan: { id: string; name: string; type: PlanType };
  location: { id: string; name: string; timezone: string };
  status: MembershipStatus;
  /** First and last day (inclusive) in the location's time zone. */
  startsOn: string;
  endsOn: string;
  /** The instant it ends: midnight after `endsOn` in the location's time zone. */
  endsAt: string;
  /** Days left including today, while active or frozen; null otherwise. */
  daysLeft: number | null;
  visitLimit: number | null;
  visitsLeft: number | null;
  priceMinor: string;
  currency: string;
  restrictions: PlanRestrictions;
  freeze: PlanFreeze & { daysUsed: number; timesUsed: number };
  freezes: MembershipFreezeDto[];
  cancelledAt: string | null;
  cancelReason: string | null;
  /** The import that brought it in from another system; null when sold here. */
  importId: string | null;
  createdAt: string;
}

/** The membership a member's card and the member list show: the one in force that ends first. */
export interface MembershipSummaryDto {
  id: string;
  planName: string;
  status: MembershipStatus;
  endsOn: string;
  daysLeft: number | null;
  visitsLeft: number | null;
}

/** What selling a membership returns: the membership, its invoice (none for a free plan) and the payment taken. */
export interface SaleDto {
  membership: MembershipDto;
  invoice: InvoiceDto | null;
  payment: PaymentDto | null;
}
