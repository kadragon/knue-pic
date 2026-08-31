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
 * would count that day's transactions twice. It also keeps a `1m` window one day shorter than the
 * same span with both ends included; the span itself is 28-31 days, set by the anchor rather than
 * fixed — 2026-03-15 gives 28, and a month-end anchor gives its own month's length through the
 * day-clamping in `subtractMonths` (2026-03-31 starts at 2026-02-28, so 31).
 */
export interface PeriodWindow {
  /** Exclusive lower bound — the day the window starts *after*. */
  start: string;
  /** Inclusive upper bound — normally the dataset's `updatedAt`. */
  end: string;
}

const MONTHS_BACK: Record<Period, number> = { '1m': 1, '3m': 3, '6m': 6, '1y': 12 };

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

/**
 * The window covering the `months` calendar months up to (and including) `anchor`.
 *
 * The period selector is not the only consumer of a month window: the detail card's histogram
 * spans `HISTOGRAM_MONTHS` of the retained months (`src/stats/histogram.ts`). Exposing the month
 * count directly
 * keeps all of them on the same clamping rule as `resolvePeriodWindow`, which delegates here — a
 * second hand-rolled subtraction is exactly how a window ends up one day off from the one a
 * statistic is compared against.
 */
export function resolveMonthsWindow(months: number, anchor: string): PeriodWindow {
  const end = parseIsoDate(anchor);
  return { start: formatIsoDate(subtractMonths(end, months)), end: formatIsoDate(end) };
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
 * `start` is stepped back from the **anchor**, twice the period's length, rather than from the
 * current window's start. Both spellings look equivalent, but day clamping is not associative:
 * stepping 6 months twice from 2026-08-31 lands on 2025-08-28 (clamped to February on the way),
 * while stepping 12 months once lands on 2025-08-31. Only the second agrees with the retention
 * floor below, which is likewise one step from the anchor — and a three-day disagreement there is
 * enough to declare a fully retained window incomplete and silently drop every rank delta.
 */
export function resolvePriorWindow(period: Period, anchor: string): PeriodWindow {
  // Delegated so the unknown-period guard lives in one place.
  const current = resolvePeriodWindow(period, anchor);
  const start = subtractMonths(parseIsoDate(anchor), MONTHS_BACK[period] * 2);
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
  return resolvePriorWindow(period, anchor).start >= retentionFloor(anchor);
}

/**
 * The oldest day the dataset is claimed to cover, anchored to a **month** rather than a day.
 *
 * The collector publishes whole calendar months (`collector/validate.py` → `ROLLING_WINDOW_MONTHS`,
 * whose floor is the first day of the month `ROLLING_WINDOW_MONTHS - 1` back), so the earliest day
 * the file can hold is that month's first. Stepping `RETAINED_MONTHS` whole months back from the
 * anchor instead lands up to a month earlier — 2025-05-25 against a file that starts 2025-06-01 —
 * and every day in that sliver is claimed but absent. It was slack while `RETAINED_MONTHS` sat
 * below the collector's window; now that the two agree it is an over-claim, so the floor is
 * computed the way its producer computes it.
 */
function retentionFloor(anchor: string): string {
  const { year, month } = subtractMonths(parseIsoDate(anchor), RETAINED_MONTHS - 1);
  return formatIsoDate({ year, month, day: 1 });
}
