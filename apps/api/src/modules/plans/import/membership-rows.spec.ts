import {
  type MembershipRowContext,
  normalizeName,
  suggestMembershipMapping,
  validateMembershipRows,
} from './membership-rows';

const ONE = { id: 'loc-1', name: 'Chilonzor', timezone: 'Asia/Tashkent' };
const TWO = { id: 'loc-2', name: 'Yunusobod', timezone: 'Asia/Tashkent' };
const MONTHLY = {
  id: 'plan-1',
  name: 'Oylik',
  type: 'duration' as const,
  visitLimit: null,
  locationIds: [],
};
const VISITS = {
  id: 'plan-2',
  name: '10 ta',
  type: 'visits' as const,
  visitLimit: 10,
  locationIds: ['loc-1'],
};
const PHONE = '+998901234567';

function context(overrides: Partial<MembershipRowContext> = {}): MembershipRowContext {
  return {
    country: 'UZ',
    currencyDigits: 2,
    members: new Map([[PHONE, { id: 'm-1', homeLocationId: ONE.id, archived: false }]]),
    plans: [MONTHLY, VISITS],
    locations: [ONE, TWO],
    canSee: () => true,
    existing: new Map(),
    today: () => '2026-11-27',
    ...overrides,
  };
}

const mapping = {
  phone: 0,
  plan: 1,
  startsOn: 2,
  endsOn: 3,
  visitsLeft: 4,
  debt: 5,
  dueOn: 6,
  location: 7,
};
const row = (cells: Partial<Record<keyof typeof mapping, string>>) => {
  const out = Array<string>(8).fill('');
  for (const [field, value] of Object.entries(cells)) {
    out[mapping[field as keyof typeof mapping]] = value;
  }
  return out;
};
const base = { phone: '90 123 45 67', plan: 'oylik', startsOn: '01.10.2026', endsOn: '31.12.2026' };

describe('membership rows', () => {
  it('reads a valid row with the member, plan, home location and dates', () => {
    const { candidates, errors } = validateMembershipRows([row(base)], mapping, context());
    expect(errors).toEqual([]);
    expect(candidates).toEqual([
      expect.objectContaining({
        row: 2,
        memberId: 'm-1',
        plan: MONTHLY,
        location: ONE,
        startsOn: '2026-10-01',
        endsOn: '2026-12-31',
        visitsLeft: null,
        debtMinor: 0n,
        dueOn: null,
      }),
    ]);
  });

  it('reads the debt in minor units and its due date', () => {
    const { candidates } = validateMembershipRows(
      [row({ ...base, debt: '150 000,50', dueOn: '2026-12-10' })],
      mapping,
      context(),
    );
    expect(candidates[0]).toMatchObject({ debtMinor: 15000050n, dueOn: '2026-12-10' });
  });

  it('checks visits against the plan and the plan against the location', () => {
    const codes = (cells: Partial<Record<keyof typeof mapping, string>>) =>
      validateMembershipRows([row({ ...base, ...cells })], mapping, context()).errors.map(
        (error) => error.code,
      );
    expect(codes({ plan: '10 ta', visitsLeft: '4' })).toEqual([]);
    expect(codes({ plan: '10 ta' })).toEqual(['VISITS_REQUIRED']);
    expect(codes({ plan: '10 ta', visitsLeft: '0' })).toEqual(['VISITS_INVALID']);
    expect(codes({ plan: '10 ta', visitsLeft: '2.5' })).toEqual(['VISITS_INVALID']);
    expect(codes({ plan: '10 ta', visitsLeft: '3', location: 'yunusobod' })).toEqual([
      'PLAN_NOT_AT_LOCATION',
    ]);
    expect(codes({ visitsLeft: '3' })).toEqual(['VISITS_NOT_APPLICABLE']);
    expect(codes({ endsOn: '26.11.2026' })).toEqual(['ALREADY_ENDED']);
    expect(codes({ startsOn: '2027-03-01', endsOn: '2027-04-01' })).toEqual([
      'START_TOO_FAR_AHEAD',
    ]);
    expect(codes({ debt: '10', dueOn: '2026-11-01' })).toEqual(['DUE_DATE_INVALID']);
  });

  it('refuses plans with the same name, archived members and unseen locations', () => {
    const codes = (rowContext: MembershipRowContext) =>
      validateMembershipRows([row(base)], mapping, rowContext).errors.map((error) => error.code);
    expect(
      codes(context({ plans: [MONTHLY, { ...MONTHLY, id: 'plan-3', name: ' OYLIK' }] })),
    ).toEqual(['PLAN_AMBIGUOUS']);
    expect(
      codes(
        context({
          members: new Map([[PHONE, { id: 'm-1', homeLocationId: ONE.id, archived: true }]]),
        }),
      ),
    ).toEqual(['MEMBER_ARCHIVED']);
    expect(codes(context({ canSee: () => false }))).toEqual(['LOCATION_NOT_ASSIGNED']);
  });

  it('refuses a row overlapping a membership the member holds or an earlier row', () => {
    const held = context({
      existing: new Map([['m-1', [{ startsOn: '2026-12-31', endsOn: '2027-01-30' }]]]),
    });
    expect(validateMembershipRows([row(base)], mapping, held).errors).toEqual([
      { row: 2, field: null, code: 'OVERLAP' },
    ]);
    const twice = validateMembershipRows(
      [row(base), row({ ...base, startsOn: '2027-01-01', endsOn: '2027-01-31' }), row(base)],
      mapping,
      context(),
    );
    expect(twice.candidates.map((candidate) => candidate.row)).toEqual([2, 3]);
    expect(twice.errors).toEqual([{ row: 4, field: null, code: 'OVERLAP' }]);
  });

  it('suggests a mapping from headers in any language', () => {
    expect(
      suggestMembershipMapping([
        'Телефон',
        'Tarif',
        'Start date',
        'Tugash sanasi',
        'Qarz',
        'Филиал',
      ]),
    ).toEqual({ phone: 0, plan: 1, startsOn: 2, endsOn: 3, debt: 4, location: 5 });
  });

  it('compares names without case, extra spaces or apostrophe variants', () => {
    expect(normalizeName('  10 ta  Mashg‘ulot ')).toBe(normalizeName("10 ta mashg'ulot"));
  });
});
