import type { Period } from '../data/types';

/**
 * Turns a period selector into a concrete date range.
 *
 * The anchor is the dataset's own `updatedAt`, never the wall clock: the published file is a
 * static monthly snapshot, so anchoring on it keeps every statistic reproducible by hand from
 * the JSON regardless of when the page is opened. Nothing here reads `Date.now()`.
 *
 * All arithmetic runs in UTC on `YYYY-MM-DD` strings, so a viewer's timezone cannot shift a
 * transaction across a window boundary.
 */

/** Inclusive on both ends. */
export interface PeriodWindow {
  start: string;
  end: string;
}

const MONTHS_BACK: Record<Period, number> = { '1m': 1, '6m': 6, '1y': 12 };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function parseIsoDate(iso: string): CalendarDate {
  const match = ISO_DATE.exec(iso);
  const [, year, month, day] = match ?? [];
  if (year === undefined || month === undefined || day === undefined) {
    throw new RangeError(`Expected an ISO YYYY-MM-DD date, got "${iso}"`);
  }
  return { year: Number(year), month: Number(month), day: Number(day) };
}

/** Last calendar day of a 1-based month, leap years included. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatIsoDate({ year, month, day }: CalendarDate): string {
  return [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-');
}

/**
 * Steps back whole calendar months, clamping the day to the target month's length so that
 * March 31 minus one month is February 28 (or 29) rather than rolling forward into March.
 */
function subtractMonths(date: CalendarDate, months: number): CalendarDate {
  const shifted = date.year * 12 + (date.month - 1) - months;
  const year = Math.floor(shifted / 12);
  const month = (shifted % 12) + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

export function resolvePeriodWindow(period: Period, anchor: string): PeriodWindow {
  const end = parseIsoDate(anchor);
  return { start: formatIsoDate(subtractMonths(end, MONTHS_BACK[period])), end: formatIsoDate(end) };
}

/** ISO dates sort lexicographically, so no parsing is needed beyond validating the input. */
export function isWithinWindow(date: string, periodWindow: PeriodWindow): boolean {
  const iso = formatIsoDate(parseIsoDate(date));
  return iso >= periodWindow.start && iso <= periodWindow.end;
}
