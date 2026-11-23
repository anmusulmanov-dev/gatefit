import { decideEntry, type EntryContext, type EntryMembership, entryRefusal } from './access-rules';
import { accessTokenFresh, base64Url, parseAccessToken } from './access';
import { NO_RESTRICTIONS } from './plans';

const LOCATION = '00000000-0000-7000-8000-000000000001';
const OTHER = '00000000-0000-7000-8000-000000000002';
// 2026-11-25 (Wednesday) 10:30 in Tashkent.
const NOW = new Date('2026-11-25T05:30:00Z');

const membership = (overrides: Partial<EntryMembership> = {}): EntryMembership => ({
  id: 'm1',
  planName: 'Monthly',
  planType: 'duration',
  startsOn: '2026-11-01',
  endsOn: '2026-11-30',
  visitsLeft: null,
  timeZone: 'Asia/Tashkent',
  restrictions: NO_RESTRICTIONS,
  freezes: [],
  ...overrides,
});

const context = (overrides: Partial<EntryContext> = {}): EntryContext => ({
  locationId: LOCATION,
  locationTimeZone: 'Asia/Tashkent',
  now: NOW,
  visitsToday: () => 0,
  ...overrides,
});

describe('entryRefusal', () => {
  it('lets an active membership in', () => {
    expect(entryRefusal(membership(), context())).toBeNull();
  });

  it.each([
    [{ endsOn: '2026-11-24' }, 'membership_expired'],
    [{ visitsLeft: 0 }, 'membership_expired'],
    [{ startsOn: '2026-11-26' }, 'membership_not_started'],
    [{ freezes: [{ startsOn: '2026-11-25', endsOn: '2026-11-27' }] }, 'membership_frozen'],
  ] as const)('refuses %p with %s', (overrides, reason) => {
    expect(entryRefusal(membership(overrides), context())).toBe(reason);
  });

  it('counts the last day in the membership time zone', () => {
    // 2026-11-30 23:30 in Tashkent is still the last day.
    expect(
      entryRefusal(membership(), context({ now: new Date('2026-11-30T18:30:00Z') })),
    ).toBeNull();
    expect(entryRefusal(membership(), context({ now: new Date('2026-11-30T19:00:00Z') }))).toBe(
      'membership_expired',
    );
  });

  it('applies location, weekday, hours and the daily limit', () => {
    const restricted = (restrictions: Partial<EntryMembership['restrictions']>) =>
      membership({ restrictions: { ...NO_RESTRICTIONS, ...restrictions } });
    expect(entryRefusal(restricted({ locationIds: [OTHER] }), context())).toBe('wrong_location');
    expect(entryRefusal(restricted({ weekdays: [1, 2] }), context())).toBe('wrong_day');
    expect(entryRefusal(restricted({ weekdays: [3] }), context())).toBeNull();
    expect(
      entryRefusal(restricted({ timeWindows: [{ from: '06:00', to: '10:30' }] }), context()),
    ).toBe('outside_hours');
    expect(
      entryRefusal(restricted({ timeWindows: [{ from: '10:30', to: '12:00' }] }), context()),
    ).toBeNull();
    expect(
      entryRefusal(restricted({ dailyVisitLimit: 2 }), context({ visitsToday: () => 2 })),
    ).toBe('daily_limit');
  });
});

describe('decideEntry', () => {
  it('refuses blocked members and debtors first', () => {
    expect(decideEntry('blocked', [membership()], context())).toMatchObject({
      allowed: false,
      reason: 'member_blocked',
    });
    expect(decideEntry('debtor', [membership()], context())).toMatchObject({ reason: 'debt' });
  });

  it('prefers unlimited, then the one that ends first', () => {
    const visits = membership({ id: 'visits', visitsLeft: 5, endsOn: '2026-11-26' });
    const late = membership({ id: 'late', endsOn: '2026-12-31' });
    const soon = membership({ id: 'soon', endsOn: '2026-11-28' });
    const decision = decideEntry('active', [visits, late, soon], context());
    expect(decision).toMatchObject({ allowed: true, membership: { id: 'soon' } });
  });

  it('shows the refusal closest to working', () => {
    const expired = membership({ id: 'old', endsOn: '2026-10-31' });
    const frozen = membership({
      id: 'frozen',
      freezes: [{ startsOn: '2026-11-20', endsOn: '2026-11-30' }],
    });
    expect(decideEntry('active', [expired, frozen], context())).toMatchObject({
      allowed: false,
      reason: 'membership_frozen',
      membership: { id: 'frozen' },
    });
    expect(decideEntry('inactive', [], context())).toMatchObject({ reason: 'no_membership' });
  });
});

describe('access token format', () => {
  it('round-trips base64url', () => {
    const bytes = Uint8Array.from([0, 1, 250, 251, 252, 253, 254, 255]);
    expect(base64Url.decode(base64Url.encode(bytes))).toEqual(bytes);
    expect(base64Url.decode('not base64!')).toBeNull();
  });

  it('rejects malformed codes', () => {
    expect(parseAccessToken('')).toBeNull();
    expect(parseAccessToken('gf1.abc')).toBeNull();
    expect(parseAccessToken(`xx1.${base64Url.encode(new Uint8Array(4))}.sig`)).toBeNull();
    const payload = base64Url.encode(new TextEncoder().encode('{"o":"x"}'));
    expect(parseAccessToken(`gf1.${payload}.${base64Url.encode(new Uint8Array(64))}`)).toBeNull();
  });

  it('accepts codes for 60 seconds and a little clock skew', () => {
    const issued = Math.floor(NOW.getTime() / 1000);
    expect(accessTokenFresh(issued, new Date(NOW.getTime() + 60_000))).toBe(true);
    expect(accessTokenFresh(issued, new Date(NOW.getTime() + 61_000))).toBe(false);
    expect(accessTokenFresh(issued + 5, NOW)).toBe(true);
    expect(accessTokenFresh(issued + 6, NOW)).toBe(false);
  });
});
