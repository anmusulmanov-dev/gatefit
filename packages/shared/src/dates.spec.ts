import {
  addDays,
  addMonths,
  daysBetween,
  isoWeekday,
  localDate,
  localTime,
  startOfLocalDay,
  termEndDate,
} from './dates';

describe('calendar arithmetic', () => {
  it('moves across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('clamps a missing day to the end of the month', () => {
    expect(addMonths('2026-01-31', 1)).toEqual({ date: '2026-02-28', clamped: true });
    expect(addMonths('2028-01-31', 1)).toEqual({ date: '2028-02-29', clamped: true });
    expect(addMonths('2026-01-15', 1)).toEqual({ date: '2026-02-15', clamped: false });
    expect(addMonths('2026-11-30', 3)).toEqual({ date: '2027-02-28', clamped: true });
    expect(addMonths('2028-02-29', 12)).toEqual({ date: '2029-02-28', clamped: true });
  });

  it('counts days between dates', () => {
    expect(daysBetween('2026-02-01', '2026-03-01')).toBe(28);
    expect(daysBetween('2028-02-01', '2028-03-01')).toBe(29);
    expect(daysBetween('2026-03-05', '2026-03-01')).toBe(-4);
  });

  it('knows weekdays', () => {
    expect(isoWeekday('2026-11-23')).toBe(1);
    expect(isoWeekday('2026-11-22')).toBe(7);
  });
});

describe('termEndDate', () => {
  it.each([
    ['2026-01-15', 1, 'month', '2026-02-14'],
    ['2026-01-01', 1, 'month', '2026-01-31'],
    ['2026-01-31', 1, 'month', '2026-02-28'],
    ['2028-01-31', 1, 'month', '2028-02-29'],
    ['2026-01-30', 1, 'month', '2026-02-28'],
    ['2026-03-31', 1, 'month', '2026-04-30'],
    ['2026-12-15', 3, 'month', '2027-03-14'],
    ['2026-11-22', 1, 'day', '2026-11-22'],
    ['2026-11-22', 30, 'day', '2026-12-21'],
    ['2028-02-28', 2, 'day', '2028-02-29'],
    ['2026-11-22', 1, 'year', '2027-11-21'],
    ['2028-02-29', 1, 'year', '2029-02-28'],
  ] as const)('%s + %i %s ends on %s', (start, value, unit, end) => {
    expect(termEndDate(start, value, unit)).toBe(end);
  });
});

describe('time zones', () => {
  it('finds the local date of an instant', () => {
    // 19:30 UTC is 00:30 the next day in Tashkent (UTC+5).
    expect(localDate(new Date('2026-11-22T19:30:00Z'), 'Asia/Tashkent')).toBe('2026-11-23');
    expect(localDate(new Date('2026-11-22T18:59:59Z'), 'Asia/Tashkent')).toBe('2026-11-22');
    expect(localDate(new Date('2026-11-23T03:00:00Z'), 'America/New_York')).toBe('2026-11-22');
    expect(localTime(new Date('2026-11-22T19:30:00Z'), 'Asia/Tashkent')).toBe('00:30');
  });

  it('finds local midnight', () => {
    expect(startOfLocalDay('2026-11-23', 'Asia/Tashkent').toISOString()).toBe(
      '2026-11-22T19:00:00.000Z',
    );
    expect(startOfLocalDay('2026-11-23', 'UTC').toISOString()).toBe('2026-11-23T00:00:00.000Z');
    expect(startOfLocalDay('2026-11-23', 'Asia/Kolkata').toISOString()).toBe(
      '2026-11-22T18:30:00.000Z',
    );
  });

  it('handles daylight saving on both sides', () => {
    // Berlin: UTC+1 in winter, UTC+2 in summer; the switch is at 02:00, not midnight.
    expect(startOfLocalDay('2026-03-29', 'Europe/Berlin').toISOString()).toBe(
      '2026-03-28T23:00:00.000Z',
    );
    expect(startOfLocalDay('2026-03-30', 'Europe/Berlin').toISOString()).toBe(
      '2026-03-29T22:00:00.000Z',
    );
    expect(startOfLocalDay('2026-10-26', 'Europe/Berlin').toISOString()).toBe(
      '2026-10-25T23:00:00.000Z',
    );
  });

  it('starts a day at the jump when clocks skip midnight', () => {
    // Santiago, Chile springs forward at 24:00 -> 01:00 on the first Sunday of September.
    const start = startOfLocalDay('2026-09-06', 'America/Santiago');
    expect(localDate(start, 'America/Santiago')).toBe('2026-09-06');
    expect(localTime(start, 'America/Santiago')).toBe('01:00');
    expect(localDate(new Date(start.getTime() - 1000), 'America/Santiago')).toBe('2026-09-05');
  });
});
