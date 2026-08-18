import { describe, expect, it } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import type { Period } from '../data/types';
import { isWithinWindow, resolvePeriodWindow } from './period';

describe('resolvePeriodWindow', () => {
  it('anchors every window on the dataset updatedAt', () => {
    const anchor = SAMPLE_DATASET.updatedAt;

    expect(resolvePeriodWindow('1m', anchor)).toEqual({ start: '2026-07-01', end: '2026-08-01' });
    expect(resolvePeriodWindow('6m', anchor)).toEqual({ start: '2026-02-01', end: '2026-08-01' });
    expect(resolvePeriodWindow('1y', anchor)).toEqual({ start: '2025-08-01', end: '2026-08-01' });
  });

  it('clamps to the last day when the target month is shorter than the anchor day', () => {
    expect(resolvePeriodWindow('1m', '2026-03-31').start).toBe('2026-02-28');
    expect(resolvePeriodWindow('1m', '2024-03-31').start).toBe('2024-02-29');
    expect(resolvePeriodWindow('1m', '2026-05-31').start).toBe('2026-04-30');
    expect(resolvePeriodWindow('6m', '2026-08-31').start).toBe('2026-02-28');
  });

  it('steps back across a year boundary', () => {
    expect(resolvePeriodWindow('6m', '2026-03-15').start).toBe('2025-09-15');
    expect(resolvePeriodWindow('1y', '2026-01-01').start).toBe('2025-01-01');
  });

  it('rejects a malformed anchor rather than guessing a window', () => {
    expect(() => resolvePeriodWindow('1m', '2026-8-1')).toThrow(RangeError);
    expect(() => resolvePeriodWindow('1m', 'not-a-date')).toThrow(RangeError);
  });

  it('rejects a date that matches the pattern but is not a real calendar day', () => {
    expect(() => resolvePeriodWindow('1m', '2026-02-30')).toThrow(RangeError);
    expect(() => resolvePeriodWindow('1m', '2026-13-01')).toThrow(RangeError);
    expect(() => resolvePeriodWindow('1m', '2026-00-10')).toThrow(RangeError);
    expect(() => resolvePeriodWindow('1m', '2026-04-31')).toThrow(RangeError);
    // 2026 is not a leap year, so this one is out by a day.
    expect(() => resolvePeriodWindow('1m', '2026-02-29')).toThrow(RangeError);
    expect(() => resolvePeriodWindow('1m', '2024-02-29')).not.toThrow();
  });

  it('rejects a period outside the union instead of widening the window', () => {
    // An off-union value would make the month arithmetic NaN, and a NaN-formatted start sorts
    // below every real year — the window would silently cover the whole dataset.
    expect(() => resolvePeriodWindow('3m' as Period, '2026-08-01')).toThrow(RangeError);
    expect(() => resolvePeriodWindow('' as Period, '2026-08-01')).toThrow(RangeError);
  });
});

describe('isWithinWindow', () => {
  const monthly = resolvePeriodWindow('1m', SAMPLE_DATASET.updatedAt);

  it('excludes the start day and includes the end day', () => {
    expect(isWithinWindow('2026-07-01', monthly)).toBe(false);
    expect(isWithinWindow('2026-07-02', monthly)).toBe(true);
    expect(isWithinWindow('2026-08-01', monthly)).toBe(true);
  });

  it('excludes the day beyond either side of the window', () => {
    expect(isWithinWindow('2026-06-30', monthly)).toBe(false);
    expect(isWithinWindow('2026-08-02', monthly)).toBe(false);
  });

  it('includes a date inside the window', () => {
    expect(isWithinWindow('2026-07-15', monthly)).toBe(true);
  });

  it('places the shared boundary day in exactly one of two adjacent windows', () => {
    // The prior period is the immediately preceding window of the same length
    // (docs/architecture.md). If both ends were inclusive, 2026-07-01 would land in both and the
    // rank-delta and trending work would count it twice.
    const previous = resolvePeriodWindow('1m', monthly.start);

    expect(isWithinWindow('2026-07-01', previous)).toBe(true);
    expect(isWithinWindow('2026-07-01', monthly)).toBe(false);
    expect(previous.end).toBe(monthly.start);
  });

  it('spans 31 days for 1m rather than 32', () => {
    const days = ['2026-07-01', '2026-07-02', '2026-08-01', '2026-08-02'].map((date) =>
      isWithinWindow(date, monthly),
    );

    expect(days).toEqual([false, true, true, false]);
  });
});
