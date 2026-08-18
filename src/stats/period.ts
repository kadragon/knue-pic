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

/**
 * Half-open: `start` is **excluded**, `end` is included.
 *
 * That asymmetry is what lets consecutive windows tile without overlapping. `docs/architecture.md`
 * defines the prior period as the immediately preceding window of the same length, so if both ends
 * were inclusive the two windows would share their boundary day and the rank-delta and trending
 * work would count that day's transactions twice. It also keeps a `1m` window at 31 days rather
 * than 32.
 */
export interface PeriodWindow {
  /** Exclusive lower bound — the day the window starts *after*. */
  start: string;
  /** Inclusive upper bound — normally the dataset's `updatedAt`. */
  end: string;
}

const MONTHS_BACK: Record<Period, number> = { '1m': 1, '6m': 6, '1y': 12 };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/**
 * Shape *and* calendar validity. A date like `2026-02-30` matches the pattern but does not exist;
 * letting it through would yield a plausible-looking window computed from a day that never
 * happened, which is exactly the "wrong but reasonable" failure no test catches.
 */
function parseIsoDate(iso: string): CalendarDate {
  const match = ISO_DATE.exec(iso);
  const [, rawYear, rawMonth, rawDay] = match ?? [];
  if (rawYear === undefined || rawMonth === undefined || rawDay === undefined) {
    throw new RangeError(`Expected an ISO YYYY-MM-DD date, got "${iso}"`);
  }

  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`Not a real calendar date: "${iso}"`);
  }

  return { year, month, day };
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
  // `period` is typed, but it reaches here from a URL param or persisted state at runtime. An
  // unknown value would make `MONTHS_BACK[period]` undefined and the arithmetic NaN, and a
  // `NaN`-formatted start sorts below every real year — so the window would silently widen to
  // the whole dataset and inflate every total instead of failing.
  const monthsBack = MONTHS_BACK[period] as number | undefined;
  if (monthsBack === undefined) {
    throw new RangeError(`Unknown period: "${period}"`);
  }

  const end = parseIsoDate(anchor);
  return { start: formatIsoDate(subtractMonths(end, monthsBack)), end: formatIsoDate(end) };
}

/**
 * ISO dates sort lexicographically, so no parsing is needed beyond validating the input.
 * `start` is exclusive and `end` inclusive — see `PeriodWindow`.
 */
export function isWithinWindow(date: string, periodWindow: PeriodWindow): boolean {
  const iso = formatIsoDate(parseIsoDate(date));
  return iso > periodWindow.start && iso <= periodWindow.end;
}
