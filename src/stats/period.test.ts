import { describe, expect, it } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import type { Period } from '../data/types';
import {
  LAST_YEAR_MONTH,
  isPriorWindowComplete,
  isWithinWindow,
  lastYearMonthOf,
  resolveBasisWindow,
  resolveLastYearMonthWindow,
  resolvePeriodWindow,
  resolvePriorWindow,
} from './period';

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
    expect(() => resolvePeriodWindow('2y' as Period, '2026-08-01')).toThrow(RangeError);
    expect(() => resolvePeriodWindow('' as Period, '2026-08-01')).toThrow(RangeError);
    // `lastYearMonth` is a `StatBasis`, not a `Period`: it must not fall through to the month
    // arithmetic, which has no month count for it.
    expect(() => resolvePeriodWindow(LAST_YEAR_MONTH as unknown as Period, '2026-08-01')).toThrow(
      RangeError,
    );
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

describe('resolvePriorWindow', () => {
  it('tiles immediately before the current window with no shared day', () => {
    const anchor = SAMPLE_DATASET.updatedAt;

    expect(resolvePriorWindow('1m', anchor)).toEqual({ start: '2026-06-01', end: '2026-07-01' });
    expect(resolvePriorWindow('6m', anchor)).toEqual({ start: '2025-08-01', end: '2026-02-01' });
    expect(resolvePriorWindow('1y', anchor)).toEqual({ start: '2024-08-01', end: '2025-08-01' });
  });

  it('makes the prior end the current start, so a boundary day is counted once', () => {
    const anchor = SAMPLE_DATASET.updatedAt;
    const boundary = resolvePeriodWindow('1m', anchor).start;

    expect(resolvePriorWindow('1m', anchor).end).toBe(boundary);
    // Half-open: the shared date belongs to the prior window alone.
    expect(isWithinWindow(boundary, resolvePriorWindow('1m', anchor))).toBe(true);
    expect(isWithinWindow(boundary, resolvePeriodWindow('1m', anchor))).toBe(false);
  });

  it('rejects an unknown period rather than widening the window', () => {
    expect(() => resolvePriorWindow('2y' as Period, '2026-08-01')).toThrow(RangeError);
  });
});

describe('isPriorWindowComplete', () => {
  it('accepts the windows the 12-month retained file can cover', () => {
    const anchor = SAMPLE_DATASET.updatedAt;

    expect(isPriorWindowComplete('1m', anchor)).toBe(true);
    // Prior 6m starts exactly on the retention floor — the whole window is retained.
    expect(isPriorWindowComplete('6m', anchor)).toBe(true);
  });

  it('rejects the 1y prior window, which lies entirely before the retention floor', () => {
    expect(isPriorWindowComplete('1y', SAMPLE_DATASET.updatedAt)).toBe(false);
    expect(isPriorWindowComplete('1y', '2030-01-15')).toBe(false);
  });
});

describe('month-end anchors', () => {
  // Day clamping is not associative, so a prior window derived by two steps instead of one drifts
  // away from the retention floor and reports a fully retained window as incomplete.
  it('keeps the prior window aligned with the retention floor at a month-end anchor', () => {
    for (const anchor of ['2026-08-31', '2026-05-31', '2026-03-31', '2026-07-31', '2026-01-31']) {
      expect(isPriorWindowComplete('1m', anchor)).toBe(true);
      expect(isPriorWindowComplete('6m', anchor)).toBe(true);
      expect(isPriorWindowComplete('1y', anchor)).toBe(false);
    }
  });

  it('steps the prior start back from the anchor, not from the current start', () => {
    // Two 6-month steps from 2026-08-31 would clamp through February and land on 2025-08-28.
    expect(resolvePriorWindow('6m', '2026-08-31')).toEqual({
      start: '2025-08-31',
      end: '2026-02-28',
    });
  });

  it('still leaves the prior end on the current start, so no day is counted twice', () => {
    for (const anchor of ['2026-08-31', '2026-03-31']) {
      for (const period of ['1m', '6m', '1y'] as Period[]) {
        expect(resolvePriorWindow(period, anchor).end).toBe(
          resolvePeriodWindow(period, anchor).start,
        );
      }
    }
  });
});

describe('resolveLastYearMonthWindow', () => {
  it('covers the whole calendar month twelve months back', () => {
    // Half-open like every other window: the last day of the month before is excluded, and the
    // month's own last day is included. A day-anchored window would straddle two months and could
    // not be checked against the disclosure it came from.
    expect(resolveLastYearMonthWindow('2026-08-22')).toEqual({
      start: '2025-07-31',
      end: '2025-08-31',
    });
  });

  it('does not move with the anchor day within its month', () => {
    expect(resolveLastYearMonthWindow('2026-08-01')).toEqual(
      resolveLastYearMonthWindow('2026-08-31'),
    );
  });

  it('ends on the real last day of a short or leap February', () => {
    expect(resolveLastYearMonthWindow('2027-02-15').end).toBe('2026-02-28');
    expect(resolveLastYearMonthWindow('2029-02-15').end).toBe('2028-02-29');
  });

  it('crosses the year boundary on the month, not on the anchor', () => {
    expect(lastYearMonthOf('2026-01-15')).toEqual({ year: 2025, month: 1 });
    expect(resolveLastYearMonthWindow('2026-01-15')).toEqual({
      start: '2024-12-31',
      end: '2025-01-31',
    });
  });

  it('is a window no `Period` produces', () => {
    // The 1y window ends at the anchor and *excludes* its own start day, which is the last day of
    // this one. Sharing a boundary is the point: the two tile rather than overlap.
    const yearly = resolvePeriodWindow('1y', '2026-08-22');
    const lastYear = resolveLastYearMonthWindow('2026-08-22');
    expect(lastYear.end < yearly.start).toBe(false);
    expect(isWithinWindow('2025-08-01', lastYear)).toBe(true);
    expect(isWithinWindow('2025-08-01', yearly)).toBe(false);
  });
});

describe('resolveBasisWindow', () => {
  it('routes a period to its own resolver', () => {
    expect(resolveBasisWindow('3m', '2026-08-22')).toEqual(resolvePeriodWindow('3m', '2026-08-22'));
  });

  it('routes the calendar month to its own', () => {
    expect(resolveBasisWindow(LAST_YEAR_MONTH, '2026-08-22')).toEqual(
      resolveLastYearMonthWindow('2026-08-22'),
    );
  });
});
