/**
 * ISO `YYYY-MM-DD` parsing shared by the loader and the stats layer.
 *
 * There is exactly one definition of "a valid date" in this app on purpose. `src/stats/` throws on
 * a date it cannot parse rather than dropping the row, so a loader that validated dates by its own
 * slightly different rule would let a value through that later blows up mid-render. Both sides call
 * the functions below.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

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
