import { normalizeDate, normalizePhone, suggestMapping, validateRows } from './member-rows';

const options = { country: 'UZ', today: '2026-11-21', taken: new Set<string>() };

describe('normalizePhone', () => {
  it.each([
    ['+998 90 123 45 67', '+998901234567'],
    ['90 123-45-67', '+998901234567'],
    ['(90) 1234567', '+998901234567'],
    ['998901234567', '+998901234567'],
    ['+7 916 123-45-67', '+79161234567'],
  ])('reads %s', (raw, expected) => {
    expect(normalizePhone(raw, 'UZ')).toBe(expected);
  });

  it.each(['', '12345', 'call me', '+998 12'])('rejects %p', (raw) => {
    expect(normalizePhone(raw, 'UZ')).toBeNull();
  });
});

describe('normalizeDate', () => {
  it.each([
    ['1990-05-17', '1990-05-17'],
    ['17.05.1990', '1990-05-17'],
    ['7/5/1990', '1990-05-07'],
  ])('reads %s', (raw, expected) => {
    expect(normalizeDate(raw, '2026-11-21')).toBe(expected);
  });

  it.each(['31.02.1990', '1990-13-01', '01.01.1899', '01.01.2030', 'May 1990'])(
    'rejects %s',
    (raw) => {
      expect(normalizeDate(raw, '2026-11-21')).toBeNull();
    },
  );
});

describe('suggestMapping', () => {
  it('recognises our own column names in every language and common spellings', () => {
    expect(suggestMapping(['Familiya', 'Ism', 'Telefon', "Tug'ilgan sana", 'Jins'])).toEqual({
      lastName: 0,
      firstName: 1,
      phone: 2,
      birthDate: 3,
      gender: 4,
    });
    expect(suggestMapping(['ФИО', 'Номер телефона', 'Дата рождения'])).toEqual({
      fullName: 0,
      phone: 1,
      birthDate: 2,
    });
    expect(suggestMapping(['Phone', 'Unknown', 'phone'])).toEqual({ phone: 0 });
  });
});

describe('validateRows', () => {
  const mapping = { fullName: 0, phone: 1, birthDate: 2, gender: 3 };

  it('turns good rows into members, the family name first in a full name', () => {
    const result = validateRows(
      [['Karimov Aziz Bahodirovich', '90 123 45 67', '17.05.1990', 'Erkak']],
      mapping,
      options,
    );
    expect(result.errors).toEqual([]);
    expect(result.candidates).toEqual([
      {
        row: 2,
        firstName: 'Aziz Bahodirovich',
        lastName: 'Karimov',
        phone: '+998901234567',
        birthDate: '1990-05-17',
        gender: 'male',
        source: 'import',
        notes: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
      },
    ]);
  });

  it('reports every problem with its spreadsheet row', () => {
    const result = validateRows(
      [
        ['Karimov Aziz', '901234567', '', ''],
        ['Rahimova Madina', '+998 90 123 45 67', '', ''],
        ['Solo', '', '1990-02-30', 'x'],
        ['Yusupov Timur', '+998 93 000 00 00', '', ''],
      ],
      mapping,
      { ...options, taken: new Set(['+998930000000']) },
    );
    expect(result.candidates.map((candidate) => candidate.row)).toEqual([2]);
    expect(result.errors).toEqual([
      { row: 3, field: 'phone', code: 'PHONE_REPEATED' },
      { row: 4, field: 'firstName', code: 'NAME_REQUIRED' },
      { row: 4, field: 'phone', code: 'PHONE_REQUIRED' },
      { row: 4, field: 'birthDate', code: 'BIRTH_DATE_INVALID' },
      { row: 4, field: 'gender', code: 'GENDER_INVALID' },
      { row: 5, field: 'phone', code: 'PHONE_EXISTS' },
    ]);
  });

  it('uses separate name columns and limits lengths', () => {
    const result = validateRows(
      [['Aziz', 'Karimov', '901234567', 'x'.repeat(2001)]],
      { firstName: 0, lastName: 1, phone: 2, notes: 3 },
      options,
    );
    expect(result.errors).toEqual([{ row: 2, field: 'notes', code: 'TOO_LONG' }]);
  });
});
