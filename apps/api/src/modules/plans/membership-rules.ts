import {
  addDays,
  daysBetween,
  type MembershipStatus,
  type PlanFreeze,
  startOfLocalDay,
} from '@gatefit/shared';

// Pure rules of memberships and freezes (docs/TZ.md F-2.3, F-2.4). Dates are calendar days
// (`YYYY-MM-DD`) in the time zone of the location the membership was sold at; "today" is
// that zone's date now. Nothing here reads the clock or the database.

export interface FreezeSpan {
  startsOn: string;
  /** Last frozen day, inclusive. */
  endsOn: string;
  days: number;
  cancelled: boolean;
}

export interface MembershipTerms {
  startsOn: string;
  endsOn: string;
  visitsLeft: number | null;
  cancelled: boolean;
  freezes: readonly FreezeSpan[];
}

/** Freezes that count: not cancelled before they began. */
export function countedFreezes(freezes: readonly FreezeSpan[]): FreezeSpan[] {
  return freezes.filter((freeze) => !freeze.cancelled && freeze.days > 0);
}

/** The status a membership has on a given day. */
export function statusOn(terms: MembershipTerms, today: string): MembershipStatus {
  if (terms.cancelled) {
    return 'cancelled';
  }
  if (today > terms.endsOn || terms.visitsLeft === 0) {
    return 'expired';
  }
  if (today < terms.startsOn) {
    return 'scheduled';
  }
  const frozen = countedFreezes(terms.freezes).some(
    (freeze) => freeze.startsOn <= today && today <= freeze.endsOn,
  );
  return frozen ? 'frozen' : 'active';
}

/**
 * When the status will next change by itself: the start, a freeze beginning or ending, or
 * the end, whichever comes first after `now`. null once the status is final.
 */
export function nextStatusChange(terms: MembershipTerms, now: Date, timeZone: string): Date | null {
  if (terms.cancelled || terms.visitsLeft === 0) {
    return null;
  }
  const days = [terms.startsOn, addDays(terms.endsOn, 1)];
  for (const freeze of countedFreezes(terms.freezes)) {
    days.push(freeze.startsOn, addDays(freeze.endsOn, 1));
  }
  const instants = days
    .map((day) => startOfLocalDay(day, timeZone))
    .filter((instant) => instant.getTime() > now.getTime())
    .sort((a, b) => a.getTime() - b.getTime());
  return instants[0] ?? null;
}

/** Days left, today included, while the membership is in force; null otherwise. */
export function daysLeft(status: MembershipStatus, endsOn: string, today: string): number | null {
  return status === 'active' || status === 'frozen' ? daysBetween(today, endsOn) + 1 : null;
}

export type FreezeRefusal =
  | { code: 'FREEZE_NOT_ALLOWED' }
  | { code: 'INVALID_FREEZE_DATES' }
  | { code: 'FREEZE_LIMIT_EXCEEDED' }
  | { code: 'FREEZE_OVERLAP'; with: FreezeSpan };

export interface FreezeUsage {
  daysUsed: number;
  timesUsed: number;
}

export function freezeUsage(freezes: readonly FreezeSpan[]): FreezeUsage {
  const counted = countedFreezes(freezes);
  return {
    daysUsed: counted.reduce((sum, freeze) => sum + freeze.days, 0),
    timesUsed: counted.length,
  };
}

/**
 * Whether a new freeze of `days` days from `startsOn` may be added. It must begin today or
 * later, within the membership, respect the plan's limits and not overlap another freeze.
 */
export function checkFreeze(
  terms: MembershipTerms,
  limits: Omit<PlanFreeze, 'feeMinor'>,
  request: { startsOn: string; days: number },
  today: string,
): FreezeRefusal | null {
  if (limits.maxDays === 0 || limits.maxTimes === 0) {
    return { code: 'FREEZE_NOT_ALLOWED' };
  }
  if (
    request.startsOn < today ||
    request.startsOn < terms.startsOn ||
    request.startsOn > terms.endsOn
  ) {
    return { code: 'INVALID_FREEZE_DATES' };
  }
  const usage = freezeUsage(terms.freezes);
  if (
    request.days < limits.minDays ||
    usage.timesUsed + 1 > limits.maxTimes ||
    usage.daysUsed + request.days > limits.maxDays
  ) {
    return { code: 'FREEZE_LIMIT_EXCEEDED' };
  }
  const endsOn = addDays(request.startsOn, request.days - 1);
  const overlapping = countedFreezes(terms.freezes).find(
    (freeze) => freeze.startsOn <= endsOn && request.startsOn <= freeze.endsOn,
  );
  return overlapping ? { code: 'FREEZE_OVERLAP', with: overlapping } : null;
}

export type FreezeEnding =
  /** It began before today: it keeps the days up to yesterday. */
  | {
      kind: 'ended_early';
      freeze: FreezeSpan;
      endsOn: string;
      daysKept: number;
      daysReturned: number;
    }
  /** It begins today or later: it is dropped entirely. */
  | { kind: 'cancelled'; freeze: FreezeSpan; daysReturned: number };

/**
 * Ending a freeze: the one in progress, otherwise the next planned one. The membership's
 * last day moves back by the days returned. null when there is nothing to end.
 */
export function endFreeze(freezes: readonly FreezeSpan[], today: string): FreezeEnding | null {
  const counted = countedFreezes(freezes).sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  const current = counted.find((freeze) => freeze.startsOn <= today && today <= freeze.endsOn);
  if (current && current.startsOn < today) {
    const daysKept = daysBetween(current.startsOn, today);
    return {
      kind: 'ended_early',
      freeze: current,
      endsOn: addDays(today, -1),
      daysKept,
      daysReturned: current.days - daysKept,
    };
  }
  const next = current ?? counted.find((freeze) => freeze.startsOn > today);
  return next ? { kind: 'cancelled', freeze: next, daysReturned: next.days } : null;
}
