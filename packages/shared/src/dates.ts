// Calendar dates and time zones without a date library. A calendar date travels as
// `YYYY-MM-DD` and means a day in some location's time zone; an instant is a Date (UTC).
// Calendar arithmetic is done on UTC midnights, which have no daylight saving.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function parts(date: string): [number, number, number] {
  const match = ISO_DATE.exec(date);
  if (!match) {
    throw new Error(`Not a calendar date: ${date}`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function toUtc(date: string): number {
  const [year, month, day] = parts(date);
  return Date.UTC(year, month - 1, day);
}

/** Days in a month (1-12) of a year, leap years included. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `date` moved by `days` (negative goes back). */
export function addDays(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

/**
 * The same day `months` later. A day the target month lacks is clamped to its last day:
 * 31 January + 1 month is 28 (or 29) February. `clamped` says whether that happened.
 */
export function addMonths(date: string, months: number): { date: string; clamped: boolean } {
  const [year, month, day] = parts(date);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  const lastDay = daysInMonth(targetYear, targetMonth);
  const targetDay = Math.min(day, lastDay);
  return {
    date: fromUtc(Date.UTC(targetYear, targetMonth - 1, targetDay)),
    clamped: targetDay !== day,
  };
}

/** Whole days from `from` to `to`: 0 for the same day, negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** ISO weekday of a calendar date: 1 Monday ... 7 Sunday. */
export function isoWeekday(date: string): number {
  const day = new Date(toUtc(date)).getUTCDay();
  return day === 0 ? 7 : day;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Wall-clock fields of an instant in a time zone. */
function wallClock(instant: Date, timeZone: string) {
  const fields: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') {
      fields[part.type] = Number(part.value);
    }
  }
  return {
    year: fields.year ?? 0,
    month: fields.month ?? 1,
    day: fields.day ?? 1,
    hour: fields.hour ?? 0,
    minute: fields.minute ?? 0,
    second: fields.second ?? 0,
  };
}

/** The calendar date it is at `instant` in the time zone. */
export function localDate(instant: Date, timeZone: string): string {
  const { year, month, day } = wallClock(instant, timeZone);
  return fromUtc(Date.UTC(year, month - 1, day));
}

/** `HH:MM` it is at `instant` in the time zone. */
export function localTime(instant: Date, timeZone: string): string {
  const { hour, minute } = wallClock(instant, timeZone);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** How far the zone's wall clock is ahead of UTC at `instant`, in milliseconds. */
function offsetAt(instant: Date, timeZone: string): number {
  const w = wallClock(instant, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The first instant of a calendar date in the time zone: its midnight, or, where a
 * daylight-saving jump skips midnight, the first moment that exists on that date.
 */
export function startOfLocalDay(date: string, timeZone: string): Date {
  const midnightUtc = toUtc(date);
  // Two passes settle the offset even when the guess lands across a transition.
  let guess = midnightUtc - offsetAt(new Date(midnightUtc), timeZone);
  guess = midnightUtc - offsetAt(new Date(guess), timeZone);
  if (localDate(new Date(guess), timeZone) >= date) {
    return new Date(guess);
  }
  // Midnight does not exist (clocks jumped forward over it): the day starts at the jump.
  // Transitions fall on whole minutes; find the first minute whose local date is `date`.
  const MINUTE = 60_000;
  let before = Math.floor(guess / MINUTE);
  let after = before + 24 * 60;
  while (after - before > 1) {
    const middle = Math.floor((before + after) / 2);
    if (localDate(new Date(middle * MINUTE), timeZone) < date) {
      before = middle;
    } else {
      after = middle;
    }
  }
  return new Date(after * MINUTE);
}

export const DURATION_UNITS = ['day', 'month', 'year'] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];

/**
 * The last day (inclusive) of a term that starts on `startsOn` and lasts `value` units.
 * 15 January + 1 month runs to 14 February. When the month has no such day the term runs
 * to the end of the month: 31 January + 1 month runs to 28 (29) February.
 */
export function termEndDate(startsOn: string, value: number, unit: DurationUnit): string {
  if (unit === 'day') {
    return addDays(startsOn, value - 1);
  }
  const next = addMonths(startsOn, unit === 'year' ? value * 12 : value);
  return next.clamped ? next.date : addDays(next.date, -1);
}

/** `DD.MM.YYYY` of a calendar date: plain and the same in every language, for SMS texts. */
export function formatCalendarDate(date: string): string {
  const [year = '', month = '', day = ''] = date.split('-');
  return `${day}.${month}.${year}`;
}
