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

  it('rejects a non-string without throwing', () => {
    expect(isMonthKey(undefined)).toBe(false);
    expect(isMonthKey(null)).toBe(false);
    expect(isMonthKey(202608)).toBe(false);
    expect(isMonthKey({ first: '2026-08' })).toBe(false);
  });
});

/**
 * The type half of the guarantee. `isMonthKey`'s runtime checks above would all still pass if
 * `MonthKey` were widened back to `string`, so the branding is asserted here instead: each line
 * fails the build if the assignment ever starts compiling.
 */
describe('MonthKey rejects a malformed month at compile time', () => {
  it('accepts a zero-padded literal and nothing else', () => {
    const valid: MonthKey = '2026-08';

    // @ts-expect-error a blank month is what rendered `년 NaN월`
    const blank: MonthKey = '';
    // @ts-expect-error an unpadded month is not the shape the charts build
    const unpadded: MonthKey = '2026-8';
    // @ts-expect-error month 13 does not exist
    const overflow: MonthKey = '2026-13';
    // @ts-expect-error a full ISO date is a different shape
    const fullDate: MonthKey = '2026-08-01';

    expect([valid, blank, unpadded, overflow, fullDate]).toHaveLength(5);
  });
});
