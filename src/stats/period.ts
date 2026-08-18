import type { Period } from '../data/types';
import { daysInMonth, formatIsoDate, parseIsoDate, type CalendarDate } from '../data/iso-date';

/**
 * Turns a period selector into a concrete date range.
 *
 * The anchor is the dataset's own `updatedAt`, never the wall clock: the published file is a
 * static monthly snapshot, so anchoring on it keeps every statistic reproducible by hand from
 * the JSON regardless of when the page is opened. Nothing here reads `Date.now()`.
 *
 * All arithmetic runs in UTC on `YYYY-MM-DD` strings, so a viewer's timezone cannot shift a
 * transaction across a window boundary. Date validity itself lives in `src/data/iso-date.ts`,
 * shared with the loader so both agree on what a usable date is.
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

/**
 * The published file keeps the most recent 12 months (`docs/architecture.md` → Rolling window).
 * Anything before that floor is simply absent from the dataset, so a window reaching past it is
 * incomplete no matter how many transactions happen to fall inside it.
 */
const RETAINED_MONTHS = 12;

/**
 * The window immediately preceding `period`'s own, same length.
 *
 * Because windows are half-open, the prior window's inclusive `end` **is** the current window's
 * exclusive `start`: the two tile with neither a shared day nor a gap, which is what makes a rank
 * comparison between them honest.
 */
export function resolvePriorWindow(period: Period, anchor: string): PeriodWindow {
  // Delegated so the unknown-period guard lives in one place.
  const current = resolvePeriodWindow(period, anchor);
  const monthsBack = MONTHS_BACK[period];
  const start = subtractMonths(parseIsoDate(current.start), monthsBack);
  return { start: formatIsoDate(start), end: current.start };
}

/**
 * Whether the prior window lies entirely inside the dataset's retained range.
 *
 * `docs/conventions.md` → Statistics Rules: a rank delta is *omitted*, never zero, when the prior
 * window's data is incomplete. Judged from the retention floor rather than from the earliest date
 * present, so the answer is a property of the period and the anchor alone — one place's stale
 * transaction cannot make an under-covered window look complete. In practice `1m` and `6m` compare
 * against retained data and `1y` never can.
 */
export function isPriorWindowComplete(period: Period, anchor: string): boolean {
  const floor = subtractMonths(parseIsoDate(anchor), RETAINED_MONTHS);
  return resolvePriorWindow(period, anchor).start >= formatIsoDate(floor);
}
