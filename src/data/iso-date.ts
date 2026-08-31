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
 * A calendar month as `YYYY-MM`, checked by its type rather than by discipline at the call sites.
 *
 * `src/stats/histogram.ts` buckets and spans by month, and `src/ui/place-labels.ts` renders a
 * month by splitting on `-` and calling `Number` on the halves — so a value that is merely a
 * `string` renders `년 NaN월` for `''`, and nothing but convention stopped one from being written.
 *
 * A nominal brand rather than a template-literal type, because no template literal can say "four
 * digits": `${number}` is TypeScript's numeric-literal matcher, so the previous
 * `${number}-${MonthOfYear}` still admitted `'-1-08'`, `'1e3-08'`, `'1.5-08'` and `'12345-08'`,
 * each of which renders a blank or absurd year. Spelling the year out is not available either —
 * `${D}${D}${D}${D}-${MonthOfYear}` is 120,000 union members and TypeScript rejects it with
 * TS2590. The brand rejects every string literal alike — a well-formed `'2026-08'` as firmly as
 * `''` — so `MONTH_KEY` and `monthKey`'s guards below are the single definition of the shape, and
 * the only way to obtain a value of this type is to pass one of them.
 *
 * The brand stops implicit assignment, not a cast — `monthKey` itself forges one a few lines
 * below. So a forgery is what the guarantee rests on, and `local/no-monthkey-forgery` in
 * `eslint.config.js` confines them to this file. It reports a cast or angle-bracket assertion whose
 * value is not already assignable to what it claims to be, an `any` reaching a *declared* `MonthKey`
 * (an initializer, a class field, an annotated parameter default, a later assignment, a `return`),
 * an ambient `declare` that mints one with no cast at all, and a signature that promises one with no
 * body to check it.
 *
 * The rule resolves the *type* rather than matching the name, which is what closes the routes an
 * earlier text-matching version could not see: a type reached without naming it
 * (`Parameters<typeof monthLabel>[0]`), an alias whose right-hand side is a composite
 * (`type MK = MonthKey & {}`), one behind a conditional type, a type-parameter default
 * (`type Box<T = MonthKey> = T`), and — the cheapest of them — `const m: MonthKey = JSON.parse(raw)`,
 * where nothing is cast because `any` needs no cast. An alias is no longer banned on sight for the
 * same reason: it resolves to the same type, so it is caught where it is used to forge, not where
 * it is named.
 *
 * That is a floor, not a proof, and the difference is worth stating rather than rounding off. These
 * were run against the rule as it stands and report nothing:
 *
 * - an `any` handed straight to a parameter — `monthLabel(JSON.parse(raw))`, `new Holder(...)`,
 *   `take.call(undefined, ...)`. A visitor for this existed briefly and cost ~26s of a ~29s
 *   `npm run lint`, because judging every argument of every call means walking whole structural
 *   type graphs; the guard is not worth a 9x lint. `parseDataset` is what actually stands here.
 * - a value with no annotation of its own to check: a destructuring default
 *   (`const { m = JSON.parse(raw) } = o`) and a contextually-typed parameter default.
 * - a laundering through `never` (`const m: MonthKey = s as unknown as never`), which is not `any`
 *   and so passes the value check.
 * - a generic returning its own parameter (`function id<T>(x: any): T`, called as `id<MonthKey>(s)`),
 *   where no annotation in either body or call site names the brand.
 * - a `yield` in a `Generator<MonthKey>`, and a definite-assignment field (`class Q { m!: MonthKey }`),
 *   which promises one with no initializer to inspect.
 * - an `eslint-disable`, and any route through a file the rule does not lint.
 *
 * The list is what was probed, not a proof that nothing else remains. In the other direction there
 * is one known false positive: widening a `readonly` container of `MonthKey`s
 * (`b as HistogramBucket[]` where `b` is `readonly HistogramBucket[]`), which assignability refuses
 * in that direction. No file does this today; `as unknown as` is the escape if one ever needs to.
 *
 * Above all, the rule is no part of validating what the app reads: `JSON.parse` of
 * `data/places.json` is `any`, and `parseDataset(raw: unknown)` in `src/data/load.ts` is what
 * stands between that file and the rest of the app. The lint rule closing the `any` routes it can
 * see is not a reason to trust an unvalidated parse.
 *
 * `src/data/monthkey-cast.lint.test.ts` runs the real config over every route it claims to close
 * and every use it must leave legal, so a refactor cannot leave the guard reporting nothing.
 */
export type MonthKey = string & { readonly __monthKey: unique symbol };

/**
 * `2026`, `8` -> `2026-08`. The only way to build a `MonthKey` from numbers.
 *
 * The cast is unavoidable — a branded type is by construction not something a value can be seen to
 * have — which is why both halves are checked first. Without the checks the cast would assert a
 * shape nothing verified, and `RangeError` is how a month that does not exist already fails in
 * `parseIsoDate` above.
 *
 * The year is range-checked as well as the month, because `padStart` pads rather than truncates:
 * `monthKey(-1, 8)` would otherwise return `'00-1-08'` — a value this module's own `isMonthKey`
 * reports `false` for, and which renders as a blank year. The bound matches `MONTH_KEY` and
 * `parseIsoDate`'s own `\d{4}`, so the type guard, the parser and this constructor agree on what
 * a year is.
 */
export function monthKey(year: number, month: number): MonthKey {
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new RangeError(`Expected integer year and month, got ${year}-${month}`);
  }
  if (year < 0 || year > 9999) {
    throw new RangeError(`Not a four-digit calendar year: ${year}`);
  }
  if (month < 1 || month > 12) {
    throw new RangeError(`Not a real calendar month: ${month}`);
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}` as MonthKey;
}

/**
 * True when `value` is a string naming a real calendar month. Never throws.
 *
 * The only way to obtain a `MonthKey` from a string the app did not build itself, now that the
 * type is branded. It agrees exactly with `monthKey`'s guards above — check both together when
 * either changes.
 */
export function isMonthKey(value: unknown): value is MonthKey {
  return typeof value === 'string' && MONTH_KEY.test(value);
}
