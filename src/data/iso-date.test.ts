import { describe, expect, it } from 'vitest';

import { isMonthKey, monthKey } from './iso-date';
import type { MonthKey } from './iso-date';

describe('monthKey', () => {
  it('zero-pads both halves', () => {
    expect(monthKey(2026, 8)).toBe('2026-08');
    expect(monthKey(2026, 12)).toBe('2026-12');
  });

  it('rejects a month outside 1-12 rather than formatting one that does not exist', () => {
    expect(() => monthKey(2026, 0)).toThrow(RangeError);
    expect(() => monthKey(2026, 13)).toThrow(RangeError);
    expect(() => monthKey(2026, -1)).toThrow(RangeError);
  });

  it('rejects a year outside 0000-9999 rather than padding one into a malformed key', () => {
    // `padStart` pads, it does not truncate: without this guard `monthKey(-1, 8)` returned
    // `'00-1-08'` — a value `isMonthKey` below reports false for and `monthLabel` renders with a
    // blank year. The bound is what makes the `as MonthKey` cast agree with `MONTH_KEY`.
    expect(() => monthKey(-1, 8)).toThrow(RangeError);
    expect(() => monthKey(10000, 8)).toThrow(RangeError);
    expect(monthKey(0, 1)).toBe('0000-01');
    expect(monthKey(9999, 12)).toBe('9999-12');
  });

  it('rejects a non-integer year or month', () => {
    expect(() => monthKey(2026, 1.5)).toThrow(RangeError);
    expect(() => monthKey(2026.5, 1)).toThrow(RangeError);
    expect(() => monthKey(2026, NaN)).toThrow(RangeError);
    expect(() => monthKey(Infinity, 1)).toThrow(RangeError);
  });
});

describe('isMonthKey', () => {
  it('accepts a zero-padded YYYY-MM', () => {
    expect(isMonthKey('2026-08')).toBe(true);
    expect(isMonthKey('2025-09')).toBe(true);
    expect(isMonthKey('2019-01')).toBe(true);
    expect(isMonthKey('2026-10')).toBe(true);
  });

  it('rejects the shapes that used to render as a month', () => {
    expect(isMonthKey('')).toBe(false);
    expect(isMonthKey('2026-8')).toBe(false);
    expect(isMonthKey('2026-00')).toBe(false);
    expect(isMonthKey('2026-13')).toBe(false);
    expect(isMonthKey('2026-08-01')).toBe(false);
    expect(isMonthKey('abc')).toBe(false);
  });

  it('rejects a malformed year, which nothing in the type system now checks', () => {
    // `MONTH_KEY`'s `\d{4}` is the *only* place that knows a year is four digits: the brand rejects
    // these four the same way it rejects a well-formed `'2026-08'` — because they are string
    // literals — so it discriminates nothing about their shape. Each was assignable to the old
    // `${number}`-based type and rendered `년 1월`, `1e3년 8월`, `1.5년 8월`, `12345년 8월`; loosen
    // `MONTH_KEY`'s year half and only these assertions fail.
    expect(isMonthKey('-1-08')).toBe(false);
    expect(isMonthKey('1e3-08')).toBe(false);
    expect(isMonthKey('1.5-08')).toBe(false);
    expect(isMonthKey('12345-08')).toBe(false);
  });

  it('rejects a non-string without throwing', () => {
    expect(isMonthKey(undefined)).toBe(false);
    expect(isMonthKey(null)).toBe(false);
    expect(isMonthKey(202608)).toBe(false);
    expect(isMonthKey({ first: '2026-08' })).toBe(false);
  });
});

/**
 * The type half of the guarantee — and the whole of what the type promises. `MonthKey` is a
 * nominal brand, so it rejects every string literal alike: a well-formed `'2026-08'` exactly as
 * firmly as `''`. That is one fact, asserted once below. A probe per malformed shape would read as
 * a shape rule the type does not have — the shape rule is `MONTH_KEY`'s, and the `isMonthKey`
 * cases above are what hold it.
 */
describe('MonthKey is reachable only through the constructor', () => {
  it('rejects every string literal, well-formed or not', () => {
    const valid: MonthKey = monthKey(2026, 8);

    // @ts-expect-error the shape the app builds is still not a `MonthKey` until `monthKey` mints it
    const wellFormed: MonthKey = '2026-08';
    // @ts-expect-error the blank that rendered `년 NaN월` falls to the same rule, not a second one
    const blank: MonthKey = '';

    expect([valid, wellFormed, blank]).toHaveLength(3);
  });
});
