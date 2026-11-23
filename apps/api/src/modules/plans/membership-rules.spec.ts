import {
  checkFreeze,
  daysLeft,
  endFreeze,
  type FreezeSpan,
  freezeUsage,
  type MembershipTerms,
  nextStatusChange,
  statusOn,
} from './membership-rules';

const terms = (overrides: Partial<MembershipTerms> = {}): MembershipTerms => ({
  startsOn: '2026-11-01',
  endsOn: '2026-11-30',
  visitsLeft: null,
  cancelled: false,
  freezes: [],
  ...overrides,
});

const freeze = (startsOn: string, endsOn: string, days: number, cancelled = false): FreezeSpan => ({
  startsOn,
  endsOn,
  days,
  cancelled,
});

const limits = { maxDays: 30, maxTimes: 2, minDays: 3 };

describe('statusOn', () => {
  it('follows the calendar', () => {
    expect(statusOn(terms(), '2026-10-31')).toBe('scheduled');
    expect(statusOn(terms(), '2026-11-01')).toBe('active');
    expect(statusOn(terms(), '2026-11-30')).toBe('active');
    expect(statusOn(terms(), '2026-12-01')).toBe('expired');
  });

  it('is frozen on frozen days only', () => {
    const t = terms({ freezes: [freeze('2026-11-10', '2026-11-12', 3)] });
    expect(statusOn(t, '2026-11-09')).toBe('active');
    expect(statusOn(t, '2026-11-10')).toBe('frozen');
    expect(statusOn(t, '2026-11-12')).toBe('frozen');
    expect(statusOn(t, '2026-11-13')).toBe('active');
  });

  it('ignores cancelled freezes', () => {
    const t = terms({ freezes: [freeze('2026-11-10', '2026-11-12', 3, true)] });
    expect(statusOn(t, '2026-11-11')).toBe('active');
  });

  it('ends when visits run out or it is cancelled', () => {
    expect(statusOn(terms({ visitsLeft: 0 }), '2026-11-05')).toBe('expired');
    expect(statusOn(terms({ cancelled: true }), '2026-11-05')).toBe('cancelled');
  });
});

describe('nextStatusChange', () => {
  const tz = 'Asia/Tashkent';

  it('is the next local midnight that changes something', () => {
    // Before the start: the start.
    expect(nextStatusChange(terms(), new Date('2026-10-20T00:00:00Z'), tz)?.toISOString()).toBe(
      '2026-10-31T19:00:00.000Z',
    );
    // During: midnight after the last day, in Tashkent.
    expect(nextStatusChange(terms(), new Date('2026-11-15T00:00:00Z'), tz)?.toISOString()).toBe(
      '2026-11-30T19:00:00.000Z',
    );
  });

  it('stops at freeze boundaries', () => {
    const t = terms({ freezes: [freeze('2026-11-10', '2026-11-12', 3)] });
    expect(nextStatusChange(t, new Date('2026-11-05T00:00:00Z'), tz)?.toISOString()).toBe(
      '2026-11-09T19:00:00.000Z',
    );
    expect(nextStatusChange(t, new Date('2026-11-10T00:00:00Z'), tz)?.toISOString()).toBe(
      '2026-11-12T19:00:00.000Z',
    );
  });

  it('is null once final', () => {
    expect(nextStatusChange(terms({ cancelled: true }), new Date('2026-11-05'), tz)).toBeNull();
    expect(nextStatusChange(terms(), new Date('2026-12-05T00:00:00Z'), tz)).toBeNull();
  });
});

describe('daysLeft', () => {
  it('counts today', () => {
    expect(daysLeft('active', '2026-11-30', '2026-11-30')).toBe(1);
    expect(daysLeft('frozen', '2026-11-30', '2026-11-21')).toBe(10);
    expect(daysLeft('expired', '2026-11-30', '2026-12-01')).toBeNull();
    expect(daysLeft('scheduled', '2026-11-30', '2026-10-01')).toBeNull();
  });
});

describe('checkFreeze', () => {
  const today = '2026-11-05';

  it('accepts a freeze within the limits', () => {
    expect(checkFreeze(terms(), limits, { startsOn: '2026-11-05', days: 10 }, today)).toBeNull();
  });

  it('refuses when the plan does not allow freezing', () => {
    expect(
      checkFreeze(terms(), { ...limits, maxDays: 0 }, { startsOn: today, days: 5 }, today),
    ).toEqual({ code: 'FREEZE_NOT_ALLOWED' });
  });

  it('refuses dates in the past or outside the membership', () => {
    const check = (startsOn: string) =>
      checkFreeze(terms(), limits, { startsOn, days: 5 }, today)?.code;
    expect(check('2026-11-04')).toBe('INVALID_FREEZE_DATES');
    expect(check('2026-12-01')).toBe('INVALID_FREEZE_DATES');
    expect(check('2026-11-30')).toBeUndefined();
  });

  it('enforces the shortest freeze, the count and the total days', () => {
    const used = terms({ freezes: [freeze('2026-11-06', '2026-11-25', 20)] });
    const check = (t: MembershipTerms, startsOn: string, days: number) =>
      checkFreeze(t, limits, { startsOn, days }, today)?.code;
    expect(check(terms(), today, 2)).toBe('FREEZE_LIMIT_EXCEEDED');
    expect(check(used, '2026-11-26', 11)).toBe('FREEZE_LIMIT_EXCEEDED');
    expect(check(used, '2026-11-26', 10)).toBeUndefined();
    const twice = terms({
      freezes: [freeze('2026-11-06', '2026-11-08', 3), freeze('2026-11-10', '2026-11-12', 3)],
    });
    expect(check(twice, '2026-11-20', 3)).toBe('FREEZE_LIMIT_EXCEEDED');
  });

  it('does not count cancelled freezes against the limits', () => {
    const t = terms({
      freezes: [freeze('2026-11-06', '2026-11-08', 3, true), freeze('2026-11-10', '2026-11-12', 3)],
    });
    expect(freezeUsage(t.freezes)).toEqual({ daysUsed: 3, timesUsed: 1 });
    expect(checkFreeze(t, limits, { startsOn: '2026-11-20', days: 3 }, today)).toBeNull();
  });

  it('refuses overlapping freezes, edge days included', () => {
    const existing = freeze('2026-11-10', '2026-11-14', 5);
    const t = terms({ freezes: [existing] });
    const check = (startsOn: string, days: number) =>
      checkFreeze(t, limits, { startsOn, days }, today);
    expect(check('2026-11-08', 3)).toEqual({ code: 'FREEZE_OVERLAP', with: existing });
    expect(check('2026-11-14', 3)).toEqual({ code: 'FREEZE_OVERLAP', with: existing });
    expect(check('2026-11-11', 3)?.code).toBe('FREEZE_OVERLAP');
    expect(check('2026-11-06', 4)).toBeNull();
    expect(check('2026-11-15', 3)).toBeNull();
  });
});

describe('endFreeze', () => {
  const current = freeze('2026-11-10', '2026-11-19', 10);
  const planned = freeze('2026-11-25', '2026-11-27', 3);

  it('ends a freeze in progress, keeping the days used', () => {
    expect(endFreeze([current, planned], '2026-11-13')).toEqual({
      kind: 'ended_early',
      freeze: current,
      endsOn: '2026-11-12',
      daysKept: 3,
      daysReturned: 7,
    });
  });

  it('drops a freeze that begins today or later', () => {
    expect(endFreeze([current], '2026-11-10')).toEqual({
      kind: 'cancelled',
      freeze: current,
      daysReturned: 10,
    });
    expect(endFreeze([current, planned], '2026-11-21')).toEqual({
      kind: 'cancelled',
      freeze: planned,
      daysReturned: 3,
    });
  });

  it('finds nothing to end', () => {
    expect(endFreeze([current], '2026-11-25')).toBeNull();
    expect(endFreeze([freeze('2026-11-25', '2026-11-27', 3, true)], '2026-11-21')).toBeNull();
  });
});
