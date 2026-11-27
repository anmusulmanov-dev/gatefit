import { locales, messages } from '@gatefit/i18n';
import {
  addDays,
  decimalToMinor,
  MEMBERSHIP_IMPORT_FIELDS,
  type MembershipImportField,
  type MembershipImportMapping,
  type MembershipImportRowErrorDto,
  type PlanType,
} from '@gatefit/shared';
import { normalizePhone, parseCalendarDate } from '../../members/import/member-rows';

/** How far ahead an imported membership may start, as for a sale. */
export const IMPORT_DAYS_AHEAD = 90;
/** Earliest first day accepted: older dates are typing mistakes. */
const EARLIEST_START = '2000-01-01';

export interface ImportPlan {
  id: string;
  name: string;
  type: PlanType;
  /** Visits a membership of this plan holds; null: unlimited. */
  visitLimit: number | null;
  /** Locations it is valid at; empty: all. */
  locationIds: readonly string[];
}

export interface ImportMember {
  id: string;
  homeLocationId: string;
  archived: boolean;
}

export interface ImportLocation {
  id: string;
  name: string;
  timezone: string;
}

export interface MembershipSpan {
  startsOn: string;
  endsOn: string;
}

/** A row that passed validation, ready to become a membership. */
export interface MembershipCandidate {
  /** One-based spreadsheet row. */
  row: number;
  memberId: string;
  plan: ImportPlan;
  location: ImportLocation;
  startsOn: string;
  endsOn: string;
  visitsLeft: number | null;
  /** Still owed for it; 0n when nothing is. */
  debtMinor: bigint;
  dueOn: string | null;
}

export interface MembershipRowContext {
  country: string;
  /** Minor-unit digits of the organization's currency. */
  currencyDigits: number;
  /** Visible members by phone (international format). */
  members: ReadonlyMap<string, ImportMember>;
  plans: readonly ImportPlan[];
  locations: readonly ImportLocation[];
  /** Whether the uploader works at the location. */
  canSee: (locationId: string) => boolean;
  /** Memberships members already have (not cancelled), by member id. */
  existing: ReadonlyMap<string, readonly MembershipSpan[]>;
  /** Today in a time zone. */
  today: (timeZone: string) => string;
}

export interface ValidatedMembershipRows {
  candidates: MembershipCandidate[];
  errors: MembershipImportRowErrorDto[];
}

/** Lower case, one space, Uzbek apostrophes made alike: how names are compared. */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ʻʼ‘’`']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const EXTRA_HEADERS: Partial<Record<MembershipImportField, string[]>> = {
  phone: ['phone', 'telefon', 'tel', 'телефон', 'mobile'],
  plan: ['plan', 'tarif', 'abonement', 'тариф', 'абонемент', 'membership'],
  startsOn: ['start', 'start date', 'boshlanish', 'начало', 'дата начала'],
  endsOn: ['end', 'end date', 'tugash', 'конец', 'окончание', 'дата окончания'],
  visitsLeft: ['visits left', 'visits', 'tashriflar', 'остаток посещений', 'посещения'],
  debt: ['debt', 'qarz', 'долг'],
  dueOn: ['due date', 'due', "to'lov muddati", 'срок оплаты'],
  location: ['location', 'branch', 'filial', 'филиал'],
};

const KNOWN_HEADERS: [string, MembershipImportField][] = (() => {
  const known = new Map<string, MembershipImportField>();
  for (const locale of locales) {
    const columns = messages[locale].membershipFile.columns as Record<string, string>;
    for (const [field, label] of Object.entries(columns)) {
      if ((MEMBERSHIP_IMPORT_FIELDS as readonly string[]).includes(field)) {
        known.set(normalizeHeader(label), field as MembershipImportField);
      }
    }
  }
  for (const [field, spellings] of Object.entries(EXTRA_HEADERS)) {
    for (const spelling of spellings) {
      known.set(normalizeHeader(spelling), field as MembershipImportField);
    }
  }
  return [...known.entries()];
})();

function normalizeHeader(header: string): string {
  return normalizeName(header)
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim();
}

/** A first guess of what each column means, from its header. Each field gets one column. */
export function suggestMembershipMapping(
  headers: string[],
): Partial<Record<MembershipImportField, number>> {
  const mapping: Partial<Record<MembershipImportField, number>> = {};
  headers.forEach((header, column) => {
    const normalized = normalizeHeader(header);
    const field = KNOWN_HEADERS.find(([spelling]) => spelling === normalized)?.[1];
    if (field && mapping[field] === undefined) {
      mapping[field] = column;
    }
  });
  return mapping;
}

function overlaps(a: MembershipSpan, b: MembershipSpan): boolean {
  return a.startsOn <= b.endsOn && b.startsOn <= a.endsOn;
}

/**
 * Checks every row against the mapping and what the organization holds. A row overlapping
 * a membership the member already has, or an earlier row of the file, is refused.
 */
export function validateMembershipRows(
  rows: string[][],
  mapping: MembershipImportMapping,
  context: MembershipRowContext,
): ValidatedMembershipRows {
  const candidates: MembershipCandidate[] = [];
  const errors: MembershipImportRowErrorDto[] = [];
  const plansByName = new Map<string, ImportPlan[]>();
  for (const plan of context.plans) {
    const key = normalizeName(plan.name);
    plansByName.set(key, [...(plansByName.get(key) ?? []), plan]);
  }
  const locationsByName = new Map(
    context.locations.map((location) => [normalizeName(location.name), location]),
  );
  const locationsById = new Map(context.locations.map((location) => [location.id, location]));
  const inFile = new Map<string, MembershipSpan[]>();

  rows.forEach((cells, index) => {
    const row = index + 2;
    const rowErrors: MembershipImportRowErrorDto[] = [];
    const fail = (field: MembershipImportField | null, code: MembershipImportRowErrorDto['code']) =>
      rowErrors.push({ row, field, code });
    const read = (field: MembershipImportField): string => {
      const column = mapping[field];
      return column === undefined ? '' : (cells[column] ?? '').trim();
    };

    // Member
    const rawPhone = read('phone');
    const phone = rawPhone ? normalizePhone(rawPhone, context.country) : null;
    const member = phone ? context.members.get(phone) : undefined;
    if (!rawPhone) {
      fail('phone', 'PHONE_REQUIRED');
    } else if (!phone) {
      fail('phone', 'PHONE_INVALID');
    } else if (!member) {
      fail('phone', 'MEMBER_NOT_FOUND');
    } else if (member.archived) {
      fail('phone', 'MEMBER_ARCHIVED');
    }

    // Plan
    const rawPlan = read('plan');
    const matches = rawPlan ? (plansByName.get(normalizeName(rawPlan)) ?? []) : [];
    const plan = matches.length === 1 ? matches[0] : undefined;
    if (!rawPlan) {
      fail('plan', 'PLAN_REQUIRED');
    } else if (matches.length === 0) {
      fail('plan', 'PLAN_NOT_FOUND');
    } else if (matches.length > 1) {
      fail('plan', 'PLAN_AMBIGUOUS');
    }

    // Location: the named one, or the member's home location.
    const rawLocation = read('location');
    let location: ImportLocation | undefined;
    if (rawLocation) {
      location = locationsByName.get(normalizeName(rawLocation));
      if (!location) {
        fail('location', 'LOCATION_NOT_FOUND');
      }
    } else if (member) {
      location = locationsById.get(member.homeLocationId);
    }
    if (location && !context.canSee(location.id)) {
      fail('location', 'LOCATION_NOT_ASSIGNED');
      location = undefined;
    }
    if (
      location &&
      plan &&
      plan.locationIds.length > 0 &&
      !plan.locationIds.includes(location.id)
    ) {
      fail('location', 'PLAN_NOT_AT_LOCATION');
    }

    // Dates, in the location's time zone.
    const date = (field: 'startsOn' | 'endsOn'): string | null => {
      const raw = read(field);
      if (!raw) {
        fail(field, 'DATE_REQUIRED');
        return null;
      }
      const value = parseCalendarDate(raw);
      if (!value || value < EARLIEST_START) {
        fail(field, 'DATE_INVALID');
        return null;
      }
      return value;
    };
    const startsOn = date('startsOn');
    const endsOn = date('endsOn');
    const today = location ? context.today(location.timezone) : null;
    if (startsOn && endsOn) {
      if (endsOn < startsOn) {
        fail('endsOn', 'END_BEFORE_START');
      } else if (today && endsOn < today) {
        fail('endsOn', 'ALREADY_ENDED');
      } else if (today && startsOn > addDays(today, IMPORT_DAYS_AHEAD)) {
        fail('startsOn', 'START_TOO_FAR_AHEAD');
      }
    }

    // Visits left, for plans that count them.
    const rawVisits = read('visitsLeft');
    let visitsLeft: number | null = null;
    if (plan) {
      if (plan.visitLimit === null) {
        if (rawVisits) {
          fail('visitsLeft', 'VISITS_NOT_APPLICABLE');
        }
      } else if (!rawVisits) {
        fail('visitsLeft', 'VISITS_REQUIRED');
      } else {
        const visits = /^\d+$/.test(rawVisits) ? Number(rawVisits) : NaN;
        if (!Number.isInteger(visits) || visits < 1 || visits > plan.visitLimit) {
          fail('visitsLeft', 'VISITS_INVALID');
        } else {
          visitsLeft = visits;
        }
      }
    }

    // Money still owed, and by when.
    const rawDebt = read('debt');
    let debtMinor = 0n;
    if (rawDebt) {
      const minor = decimalToMinor(rawDebt, context.currencyDigits);
      if (minor === null) {
        fail('debt', 'DEBT_INVALID');
      } else {
        debtMinor = BigInt(minor);
      }
    }
    const rawDue = read('dueOn');
    let dueOn: string | null = null;
    if (rawDue && debtMinor > 0n) {
      dueOn = parseCalendarDate(rawDue);
      if (!dueOn || (today && dueOn < today)) {
        fail('dueOn', 'DUE_DATE_INVALID');
      }
    }

    if (rowErrors.length > 0 || !member || !plan || !location || !startsOn || !endsOn) {
      errors.push(...rowErrors);
      return;
    }

    const span = { startsOn, endsOn };
    const earlier = inFile.get(member.id) ?? [];
    const held = context.existing.get(member.id) ?? [];
    if (
      held.some((other) => overlaps(other, span)) ||
      earlier.some((other) => overlaps(other, span))
    ) {
      errors.push({ row, field: null, code: 'OVERLAP' });
      return;
    }
    inFile.set(member.id, [...earlier, span]);
    candidates.push({
      row,
      memberId: member.id,
      plan,
      location,
      startsOn,
      endsOn,
      visitsLeft,
      debtMinor,
      dueOn,
    });
  });

  return { candidates, errors };
}
