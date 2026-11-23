import type { AccessDenyReason } from './access';
import { daysBetween, isoWeekday, localDate, localTime } from './dates';
import type { PlanRestrictions, PlanType } from './plans';

// Who may come in (docs/TZ.md F-3.1, section 7 /access/verify). Pure: the API decides with
// it online and the reception screen offline, so both say the same thing.

/** A membership as the entry check sees it. Cancelled memberships are left out beforehand. */
export interface EntryMembership {
  id: string;
  planName: string;
  planType: PlanType;
  startsOn: string;
  /** Last day, inclusive. */
  endsOn: string;
  /** null: unlimited visits. */
  visitsLeft: number | null;
  /** Time zone of the location it was sold at: its days start there. */
  timeZone: string;
  restrictions: PlanRestrictions;
  /** Freezes that count (not cancelled), last day inclusive. */
  freezes: readonly { startsOn: string; endsOn: string }[];
}

export interface EntryContext {
  locationId: string;
  /** Time zone of the location being entered: weekdays and hours are read there. */
  locationTimeZone: string;
  now: Date;
  /** Visits already counted today (location's day) against this membership. */
  visitsToday: (membershipId: string) => number;
}

/** The member's status (packages/shared/src/members.ts): `blocked` and `debtor` are refused. */
export type MemberEntryStatus = string;

/** Why this membership does not let its holder in now; null when it does. */
export function entryRefusal(
  membership: EntryMembership,
  context: EntryContext,
): AccessDenyReason | null {
  const today = localDate(context.now, membership.timeZone);
  if (today > membership.endsOn || membership.visitsLeft === 0) {
    return 'membership_expired';
  }
  if (today < membership.startsOn) {
    return 'membership_not_started';
  }
  if (membership.freezes.some((freeze) => freeze.startsOn <= today && today <= freeze.endsOn)) {
    return 'membership_frozen';
  }
  const { restrictions } = membership;
  if (
    restrictions.locationIds.length > 0 &&
    !restrictions.locationIds.includes(context.locationId)
  ) {
    return 'wrong_location';
  }
  const hereToday = localDate(context.now, context.locationTimeZone);
  if (restrictions.weekdays.length > 0 && !restrictions.weekdays.includes(isoWeekday(hereToday))) {
    return 'wrong_day';
  }
  if (restrictions.timeWindows.length > 0) {
    const time = localTime(context.now, context.locationTimeZone);
    if (!restrictions.timeWindows.some((window) => window.from <= time && time < window.to)) {
      return 'outside_hours';
    }
  }
  if (
    restrictions.dailyVisitLimit !== null &&
    context.visitsToday(membership.id) >= restrictions.dailyVisitLimit
  ) {
    return 'daily_limit';
  }
  return null;
}

/**
 * Which refusal to show when no membership lets the member in: the one closest to working
 * (a frozen or out-of-hours membership says more than an expired one).
 */
const REFUSAL_RANK: Record<AccessDenyReason, number> = {
  daily_limit: 0,
  outside_hours: 1,
  wrong_day: 2,
  wrong_location: 3,
  membership_frozen: 4,
  membership_not_started: 5,
  membership_expired: 6,
  no_membership: 7,
  invalid_code: 8,
  expired_code: 8,
  member_not_found: 8,
  member_blocked: 8,
  debt: 8,
};

export type EntryDecision =
  | { allowed: true; membership: EntryMembership }
  | { allowed: false; reason: AccessDenyReason; membership: EntryMembership | null };

/**
 * The decision for a member. Blocked members and debtors are refused whatever they hold.
 * Of the memberships that let them in, unlimited ones go first (no visit is spent), then
 * the one that ends soonest.
 */
export function decideEntry(
  memberStatus: MemberEntryStatus,
  memberships: readonly EntryMembership[],
  context: EntryContext,
): EntryDecision {
  if (memberStatus === 'blocked') {
    return { allowed: false, reason: 'member_blocked', membership: null };
  }
  if (memberStatus === 'debtor') {
    return { allowed: false, reason: 'debt', membership: null };
  }
  const ordered = [...memberships].sort(
    (a, b) =>
      Number(a.visitsLeft !== null) - Number(b.visitsLeft !== null) ||
      a.endsOn.localeCompare(b.endsOn),
  );
  let refused: { reason: AccessDenyReason; membership: EntryMembership } | null = null;
  for (const membership of ordered) {
    const reason = entryRefusal(membership, context);
    if (reason === null) {
      return { allowed: true, membership };
    }
    if (!refused || REFUSAL_RANK[reason] < REFUSAL_RANK[refused.reason]) {
      refused = { reason, membership };
    }
  }
  return refused
    ? { allowed: false, reason: refused.reason, membership: refused.membership }
    : { allowed: false, reason: 'no_membership', membership: null };
}

/** Days left, today included, for a membership that let its holder in. */
export function entryDaysLeft(membership: EntryMembership, now: Date): number {
  return daysBetween(localDate(now, membership.timeZone), membership.endsOn) + 1;
}
