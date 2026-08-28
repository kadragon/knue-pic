/**
 * ISO `YYYY-MM-DD` parsing shared by the loader and the stats layer.
 *
 * There is exactly one definition of "a valid date" in this app on purpose. `src/stats/` throws on
 * a date it cannot parse rather than dropping the row, so a loader that validated dates by its own
 * slightly different rule would let a value through that later blows up mid-render. Both sides call
 * the functions below.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/** Last calendar day of a 1-based month, leap years included. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Shape *and* calendar validity. A date like `2026-02-30` matches the pattern but does not exist;
 * letting it through would yield a plausible-looking window computed from a day that never
 * happened, which is exactly the "wrong but reasonable" failure no test catches.
 */
export function parseIsoDate(iso: string): CalendarDate {
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

export function formatIsoDate({ year, month, day }: CalendarDate): string {
  return [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-');
}

/** True when `value` is a string naming a real calendar day. Never throws. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    parseIsoDate(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * The two-digit month half of a `YYYY-MM` key. Written out rather than derived from `${number}`
 * because `${number}` accepts `8` and `13` as readily as `08`, which is the whole point of the
 * shape being checked. Both halves cannot be spelled digit-by-digit — the resulting union is a
 * million members and past what TypeScript will expand.
 */
type MonthOfYear = '01' | '02' | '03' | '04' | '05' | '06' | '07' | '08' | '09' | '10' | '11' | '12';

/**
 * A calendar month as `YYYY-MM`, checked by its type rather than by discipline at the call sites.
 *
 * `src/stats/histogram.ts` buckets and spans by month, and `src/ui/place-labels.ts` renders a
 * month by splitting on `-` and calling `Number` on the halves — so a value that is merely a
 * `string` renders `년 NaN월` for `''`, and nothing but convention stopped one from being written.
 * Every month a chart or a span carries is this type, so the blank case does not exist to answer.
 */
export type MonthKey = `${number}-${MonthOfYear}`;

/**
 * `2026`, `8` -> `2026-08`. The only way to build a `MonthKey` from numbers.
 *
 * The cast is unavoidable — `padStart` returns `string`, so the template widens and TypeScript
 * cannot see the shape it just produced — which is why the range is checked first. Without the
 * check the cast would assert a shape nothing verified, and `RangeError` is how a month that does
 * not exist already fails in `parseIsoDate` above.
 */
export function monthKey(year: number, month: number): MonthKey {
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new RangeError(`Expected integer year and month, got ${year}-${month}`);
  }
  if (month < 1 || month > 12) {
    throw new RangeError(`Not a real calendar month: ${month}`);
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}` as MonthKey;
}

/** True when `value` is a string naming a real calendar month. Never throws. */
export function isMonthKey(value: unknown): value is MonthKey {
  return typeof value === 'string' && MONTH_KEY.test(value);
}
