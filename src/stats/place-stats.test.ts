import { describe, expect, it } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import type { Period, PlaceRecord } from '../data/types';
import { computePlaceStats } from './place-stats';
import { resolvePeriodWindow } from './period';

/**
 * Every expected value below is derived by hand from `sample-dataset.ts` and written as a
 * literal — recomputing it in the test would only re-assert the implementation.
 */

function place(id: string): PlaceRecord {
  const found = SAMPLE_DATASET.places.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Fixture is missing ${id}`);
  return found;
}

function statsFor(id: string, period: Period) {
  return computePlaceStats(place(id), resolvePeriodWindow(period, SAMPLE_DATASET.updatedAt));
}

describe('computePlaceStats', () => {
  it('counts only the visits inside the selected window (한밭식당)', () => {
    // 2026-07-20 45,000 · 2026-07-05 32,000 · 2026-05-12 29,000 · 2025-11-03 51,000
    expect(statsFor('restaurant_000001', '1m')).toEqual({
      visitCount: 2,
      totalAmount: 77000,
      averageAmount: 38500,
      mostRecentVisit: '2026-07-20',
    });
    expect(statsFor('restaurant_000001', '6m')).toEqual({
      visitCount: 3,
      totalAmount: 106000,
      averageAmount: 35333, // 106,000 / 3 = 35,333.33… → whole won
      mostRecentVisit: '2026-07-20',
    });
    expect(statsFor('restaurant_000001', '1y')).toEqual({
      visitCount: 4,
      totalAmount: 157000,
      averageAmount: 39250,
      mostRecentVisit: '2026-07-20',
    });
  });

  it('handles a place with exactly one transaction (청람카페)', () => {
    const expected = {
      visitCount: 1,
      totalAmount: 12000,
      averageAmount: 12000,
      mostRecentVisit: '2026-07-15',
    };

    expect(statsFor('restaurant_000002', '1m')).toEqual(expected);
    expect(statsFor('restaurant_000002', '6m')).toEqual(expected);
    expect(statsFor('restaurant_000002', '1y')).toEqual(expected);
  });

  it('returns zero and null — never NaN or Infinity — for an empty window (황새울분식)', () => {
    // Only 2025-09-10 18,000 and 2025-12-22 0, both outside 1m and 6m.
    const empty = {
      visitCount: 0,
      totalAmount: 0,
      averageAmount: 0,
      mostRecentVisit: null,
    };

    expect(statsFor('restaurant_000003', '1m')).toEqual(empty);
    expect(statsFor('restaurant_000003', '6m')).toEqual(empty);

    const yearly = statsFor('restaurant_000003', '1y');
    expect(yearly).toEqual({
      visitCount: 2,
      totalAmount: 18000,
      averageAmount: 9000, // a zero-amount payment still counts as a visit
      mostRecentVisit: '2025-12-22',
    });
    expect(Number.isFinite(yearly.averageAmount)).toBe(true);
  });

  it('separates two places that tie on visit count and most recent visit', () => {
    const bunsik = statsFor('restaurant_000004', '1m');
    const jungsik = statsFor('restaurant_000005', '1m');

    expect(bunsik).toEqual({
      visitCount: 2,
      totalAmount: 40000,
      averageAmount: 20000,
      mostRecentVisit: '2026-07-22',
    });
    expect(jungsik).toEqual({
      visitCount: 2,
      totalAmount: 56000,
      averageAmount: 28000,
      mostRecentVisit: '2026-07-22',
    });

    // The first two tie-break levels are exhausted; only total amount still separates them.
    expect(bunsik.visitCount).toBe(jungsik.visitCount);
    expect(bunsik.mostRecentVisit).toBe(jungsik.mostRecentVisit);
    expect(bunsik.totalAmount).not.toBe(jungsik.totalAmount);
  });

  it('includes transactions landing exactly on a window boundary (새터말칼국수)', () => {
    // 2026-08-01 15,000 (window end) · 2026-07-01 13,000 (1m start) ·
    // 2026-06-30 11,000 (one day earlier) · 2025-08-01 9,000 (1y start)
    expect(statsFor('restaurant_000006', '1m')).toEqual({
      visitCount: 2,
      totalAmount: 28000,
      averageAmount: 14000,
      mostRecentVisit: '2026-08-01',
    });
    expect(statsFor('restaurant_000006', '6m')).toEqual({
      visitCount: 3,
      totalAmount: 39000,
      averageAmount: 13000,
      mostRecentVisit: '2026-08-01',
    });
    expect(statsFor('restaurant_000006', '1y')).toEqual({
      visitCount: 4,
      totalAmount: 48000,
      averageAmount: 12000,
      mostRecentVisit: '2026-08-01',
    });
  });

  it('reads the most recent visit from dates, not from transaction order', () => {
    const unordered: PlaceRecord = {
      ...place('restaurant_000001'),
      transactions: [
        { date: '2026-07-05', amount: 32000 },
        { date: '2026-07-20', amount: 45000 },
      ],
    };

    const stats = computePlaceStats(
      unordered,
      resolvePeriodWindow('1m', SAMPLE_DATASET.updatedAt),
    );

    expect(stats.mostRecentVisit).toBe('2026-07-20');
  });
});
