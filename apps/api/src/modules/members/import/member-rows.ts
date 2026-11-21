import { locales, messages } from '@gatefit/i18n';
import {
  type Gender,
  GENDERS,
  IMPORT_FIELDS,
  type ImportField,
  type ImportMapping,
  type ImportRowErrorDto,
  MEMBER_SOURCES,
  type MemberSource,
} from '@gatefit/shared';
import { type CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js';

/** A row that passed validation, ready to become a member. */
export interface MemberCandidate {
  /** One-based spreadsheet row. */
  row: number;
  firstName: string;
  lastName: string;
  phone: string;
  birthDate: string | null;
  gender: Gender | null;
  source: MemberSource;
  notes: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
}

export interface ValidatedRows {
  candidates: MemberCandidate[];
  errors: ImportRowErrorDto[];
}

const LIMITS: Partial<Record<ImportField, number>> = {
  firstName: 80,
  lastName: 80,
  fullName: 200,
  notes: 2000,
  emergencyContactName: 120,
};

const normalizeHeader = (header: string) =>
  header
    .toLowerCase()
    .replace(/[ʻʼ‘’`']/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim();

/** Header spellings recognised for each field, beyond the column names of our own files. */
const EXTRA_HEADERS: Partial<Record<ImportField, string[]>> = {
  fullName: ['fio', 'f i o', 'f i sh', 'full name', 'name', 'ism familiya', 'фио', 'ф и о'],
  firstName: ['first name', 'firstname', 'given name', 'ismi', 'имя'],
  lastName: ['last name', 'lastname', 'surname', 'familiyasi', 'фамилия'],
  phone: ['phone', 'phone number', 'mobile', 'tel', 'telefon raqami', 'телефон', 'номер телефона'],
  birthDate: ['birth date', 'birthday', 'date of birth', 'dob', 'дата рождения', 'день рождения'],
  gender: ['gender', 'sex', 'jinsi', 'пол'],
  notes: ['notes', 'note', 'comment', 'izohlar', 'комментарий', 'примечание'],
};

const KNOWN_HEADERS: [string, ImportField][] = (() => {
  const known = new Map<string, ImportField>();
  for (const locale of locales) {
    const columns = messages[locale].memberFile.columns as Record<string, string>;
    for (const [field, label] of Object.entries(columns)) {
      if (isImportField(field)) {
        known.set(normalizeHeader(label), field);
      }
    }
  }
  for (const [field, spellings] of Object.entries(EXTRA_HEADERS)) {
    for (const spelling of spellings) {
      known.set(normalizeHeader(spelling), field as ImportField);
    }
  }
  return [...known.entries()];
})();

function isImportField(value: string): value is ImportField {
  return (IMPORT_FIELDS as readonly string[]).includes(value);
}

/** A first guess of what each column means, from its header. Each field gets one column. */
export function suggestMapping(headers: string[]): Partial<Record<ImportField, number>> {
  const mapping: Partial<Record<ImportField, number>> = {};
  headers.forEach((header, column) => {
    const normalized = normalizeHeader(header);
    const field = KNOWN_HEADERS.find(([spelling]) => spelling === normalized)?.[1];
    if (field && mapping[field] === undefined) {
      mapping[field] = column;
    }
  });
  // Separate name columns are more precise than a combined one.
  if (mapping.firstName !== undefined && mapping.lastName !== undefined) {
    delete mapping.fullName;
  }
  return mapping;
}

const GENDER_WORDS: Record<string, Gender> = {};
for (const locale of locales) {
  for (const gender of GENDERS) {
    GENDER_WORDS[messages[locale].memberFile.gender[gender].toLowerCase()] = gender;
  }
}
Object.assign(GENDER_WORDS, {
  m: 'male',
  male: 'male',
  e: 'male',
  erkak: 'male',
  м: 'male',
  муж: 'male',
  f: 'female',
  female: 'female',
  a: 'female',
  ayol: 'female',
  ж: 'female',
  жен: 'female',
});

const SOURCE_WORDS: Record<string, MemberSource> = {};
for (const locale of locales) {
  for (const source of MEMBER_SOURCES) {
    SOURCE_WORDS[messages[locale].memberFile.source[source].toLowerCase()] = source;
  }
}
for (const source of MEMBER_SOURCES) {
  SOURCE_WORDS[source] = source;
}

/**
 * A phone as people write it, in international format. Numbers without a `+` are read in
 * the organization's country; a number that already starts with a country code (as Excel
 * keeps 998901234567) is accepted too.
 */
export function normalizePhone(raw: string, country: string): string | null {
  const text = raw.trim();
  if (text === '') {
    return null;
  }
  const attempts = text.startsWith('+') ? [text] : [text, `+${text.replace(/\D/g, '')}`];
  for (const attempt of attempts) {
    const parsed = parsePhoneNumberFromString(attempt, country as CountryCode);
    if (parsed?.isValid()) {
      return parsed.number;
    }
  }
  return null;
}

/** `YYYY-MM-DD`, `DD.MM.YYYY` or `DD/MM/YYYY`; null when it is not a real past date. */
export function normalizeDate(raw: string, today: string): string | null {
  const text = raw.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const dotted = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(text);
  const [year, month, day] = iso
    ? [iso[1], iso[2], iso[3]]
    : dotted
      ? [dotted[3], dotted[2], dotted[1]]
      : [];
  if (!year || !month || !day) {
    return null;
  }
  const value = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return null;
  }
  return value >= '1900-01-01' && value <= today ? value : null;
}

/**
 * Checks every row against the mapping. Phones repeated in the file and phones that
 * already belong to a member (`taken`) are errors; the first occurrence in the file wins.
 */
export function validateRows(
  rows: string[][],
  mapping: ImportMapping,
  options: { country: string; today: string; taken: ReadonlySet<string> },
): ValidatedRows {
  const candidates: MemberCandidate[] = [];
  const errors: ImportRowErrorDto[] = [];
  const seen = new Set<string>();

  rows.forEach((cells, index) => {
    const row = index + 2;
    const rowErrors: ImportRowErrorDto[] = [];
    const fail = (field: ImportField | null, code: ImportRowErrorDto['code']) =>
      rowErrors.push({ row, field, code });
    const read = (field: ImportField): string => {
      const column = mapping[field];
      const value = column === undefined ? '' : (cells[column] ?? '').trim();
      const limit = LIMITS[field];
      if (limit !== undefined && value.length > limit) {
        fail(field, 'TOO_LONG');
      }
      return value;
    };
    const optional = (value: string) => (value === '' ? null : value);

    let firstName = read('firstName');
    let lastName = read('lastName');
    const fullName = read('fullName');
    if ((!firstName || !lastName) && fullName) {
      // "Karimov Aziz Bahodirovich": family name first, as Uzbek and Russian lists write it.
      const [family = '', given = '', ...rest] = fullName.split(/\s+/);
      lastName ||= family;
      firstName ||= [given, ...rest].join(' ');
    }
    if (!firstName || !lastName) {
      fail(firstName || lastName ? (firstName ? 'lastName' : 'firstName') : null, 'NAME_REQUIRED');
    }

    const rawPhone = read('phone');
    const phone = normalizePhone(rawPhone, options.country);
    if (!rawPhone) {
      fail('phone', 'PHONE_REQUIRED');
    } else if (!phone) {
      fail('phone', 'PHONE_INVALID');
    } else if (seen.has(phone)) {
      fail('phone', 'PHONE_REPEATED');
    } else if (options.taken.has(phone)) {
      fail('phone', 'PHONE_EXISTS');
    }
    if (phone) {
      seen.add(phone);
    }

    const rawBirthDate = read('birthDate');
    const birthDate = rawBirthDate ? normalizeDate(rawBirthDate, options.today) : null;
    if (rawBirthDate && !birthDate) {
      fail('birthDate', 'BIRTH_DATE_INVALID');
    }

    const rawGender = read('gender').toLowerCase();
    const gender = rawGender ? (GENDER_WORDS[rawGender] ?? null) : null;
    if (rawGender && !gender) {
      fail('gender', 'GENDER_INVALID');
    }

    const rawSource = read('source').toLowerCase();
    const source = rawSource ? (SOURCE_WORDS[rawSource] ?? null) : 'import';
    if (!source) {
      fail('source', 'SOURCE_INVALID');
    }

    const rawEmergencyPhone = read('emergencyContactPhone');
    const emergencyContactPhone = rawEmergencyPhone
      ? normalizePhone(rawEmergencyPhone, options.country)
      : null;
    if (rawEmergencyPhone && !emergencyContactPhone) {
      fail('emergencyContactPhone', 'PHONE_INVALID');
    }

    const notes = optional(read('notes'));
    const emergencyContactName = optional(read('emergencyContactName'));

    if (rowErrors.length > 0 || !phone || !source) {
      errors.push(...rowErrors);
      return;
    }
    candidates.push({
      row,
      firstName,
      lastName,
      phone,
      birthDate,
      gender,
      source,
      notes,
      emergencyContactName,
      emergencyContactPhone,
    });
  });

  return { candidates, errors };
}
