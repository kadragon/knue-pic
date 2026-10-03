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
 * were inclusive the two windows would share their boundary day and the rank-delta comparison
 * would count that day's transactions twice.
 *
 * A window covers whole calendar months: `start` is the **last day** of the month `N` months
 * before the anchor's, so the window opens on the first day of a month. The anchor is always a
 * month end in a published file (`collector/validate.py` check 6), which makes `1m` exactly the
 * anchor's own month — the same days the detail card's histogram draws as that month's bar. A
 * day-stepped window disagreed with the bar: from 2026-09-30 it opened after 2026-08-30 and so
 * counted Aug 31 under 최근 1개월. An anchor that is not a month end (a test fixture, a hand-built
 * file) still works; its own month is simply counted month-to-date.
 */
export interface PeriodWindow {
  /** Exclusive lower bound — the day the window starts *after*. */
  start: string;
  /** Inclusive upper bound — normally the dataset's `updatedAt`. */
  end: string;
}

const MONTHS_BACK: Record<Period, number> = { '1m': 1, '3m': 3, '6m': 6, '1y': 12 };

/**
 * The last day of the month `months` calendar months before `date`'s month — the exclusive lower
 * bound of a window covering those whole months. The day of `date` plays no part, so no clamping
 * is involved and two windows built from one anchor always agree on where a month starts.
 */
function monthEndBefore(date: CalendarDate, months: number): CalendarDate {
  const shifted = date.year * 12 + (date.month - 1) - months;
  const year = Math.floor(shifted / 12);
  const month = (shifted % 12) + 1;
  return { year, month, day: daysInMonth(year, month) };
}

/**
 * The window covering the `months` calendar months up to (and including) `anchor`.
 *
 * The period selector is not the only consumer of a month window: the detail card's histogram
 * spans `HISTOGRAM_MONTHS` of the retained months (`src/stats/histogram.ts`). Exposing the month
 * count directly
 * keeps all of them on the same month boundaries as `resolvePeriodWindow`, which delegates here — a
 * second hand-rolled subtraction is exactly how a window ends up one day off from the one a
 * statistic is compared against.
 */
export function resolveMonthsWindow(months: number, anchor: string): PeriodWindow {
  const end = parseIsoDate(anchor);
  return { start: formatIsoDate(monthEndBefore(end, months)), end: formatIsoDate(end) };
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

  return resolveMonthsWindow(monthsBack, anchor);
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
 * How many months back the browser may assume the dataset actually covers.
 *
 * Anything before that floor is simply absent, so a window reaching past it is incomplete no
 * matter how many transactions happen to fall inside it.
 *
 * Matches the collector's `ROLLING_WINDOW_MONTHS`, which is 15. This constant is not a
 * configuration knob but a *claim* —
 * `isPriorWindowComplete` reads it as "there is data this far back" — so it may only be raised
 * once the months exist: the 2025-06/07/08 backfill landed with this change, and `data/places.json`
 * now spans 15 months. Raising it over uncollected months would have every place count 0 visits
 * there and render invented ▼ rank drops.
 */
export const RETAINED_MONTHS = 15;

/**
 * The window immediately preceding `period`'s own.
 *
 * Because windows are half-open, the prior window's inclusive `end` **is** the current window's
 * exclusive `start`: the two tile with neither a shared day nor a gap, which is what makes a rank
 * comparison between them honest.
 *
 * `start` is the month end `2N` months before the anchor's month, so the prior window is likewise
 * `N` whole months.
 */
export function resolvePriorWindow(period: Period, anchor: string): PeriodWindow {
  // Delegated so the unknown-period guard lives in one place.
  const current = resolvePeriodWindow(period, anchor);
  const start = monthEndBefore(parseIsoDate(anchor), MONTHS_BACK[period] * 2);
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
  return resolvePriorWindow(period, anchor).start >= retainedWindow(anchor).start;
}

/**
 * The range the dataset is claimed to cover: the `RETAINED_MONTHS` whole months up to the anchor.
 *
 * The collector publishes whole calendar months (`collector/validate.py` → `ROLLING_WINDOW_MONTHS`,
 * whose floor is the first day of the month `ROLLING_WINDOW_MONTHS - 1` back), and that is exactly
 * the window `resolveMonthsWindow` builds for the same count — both bounds exclusive at the same
 * month end, so comparing two `start`s compares the first day each one covers.
 */
function retainedWindow(anchor: string): PeriodWindow {
  return resolveMonthsWindow(RETAINED_MONTHS, anchor);
}
