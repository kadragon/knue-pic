import { describe, expect, it } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
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
});

describe('isWithinWindow', () => {
  const monthly = resolvePeriodWindow('1m', SAMPLE_DATASET.updatedAt);

  it('includes both boundary days', () => {
    expect(isWithinWindow('2026-07-01', monthly)).toBe(true);
    expect(isWithinWindow('2026-08-01', monthly)).toBe(true);
  });

  it('excludes the day on either side of the window', () => {
    expect(isWithinWindow('2026-06-30', monthly)).toBe(false);
    expect(isWithinWindow('2026-08-02', monthly)).toBe(false);
  });

  it('includes a date inside the window', () => {
    expect(isWithinWindow('2026-07-15', monthly)).toBe(true);
  });
});
