import { describe, expect, it } from 'vitest';
import type { PlaceRecord } from '../data/types';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import { LAST_YEAR_MONTH } from './period';
import { HISTOGRAM_MONTHS, computeMonthlyHistogram, histogramMonthsFor } from './histogram';

function findPlace(id: string): PlaceRecord {
  const place = SAMPLE_DATASET.places.find((candidate) => candidate.id === id);
  if (!place) throw new Error(`fixture is missing ${id}`);
  return place;
}

describe('computeMonthlyHistogram', () => {
  it('returns twelve buckets ending with the anchor month, oldest first', () => {
    const buckets = computeMonthlyHistogram(findPlace('restaurant_000001'), '2026-08-01');

    expect(buckets).toHaveLength(12);
    expect(buckets[0]?.month).toBe('2025-09');
    expect(buckets.at(-1)?.month).toBe('2026-08');
  });

  it('reaches the 작년 같은 달 month when asked for that basis span', () => {
    const buckets = computeMonthlyHistogram(
      findPlace('restaurant_000001'),
      '2026-08-01',
      histogramMonthsFor(LAST_YEAR_MONTH),
    );

    expect(buckets).toHaveLength(13);
    // The month the 작년 같은 달 column ranks — twelve back from the anchor, one outside the
    // default span.
    expect(buckets[0]?.month).toBe('2025-08');
    expect(buckets.at(-1)?.month).toBe('2026-08');
  });

  it('keeps every other basis on the default span', () => {
    for (const basis of ['1m', '3m', '6m', '1y'] as const) {
      expect(histogramMonthsFor(basis)).toBe(HISTOGRAM_MONTHS);
    }
  });

  it('counts each transaction into its calendar month', () => {
    // 000001: 2026-07-20, 2026-07-05, 2026-05-12, 2025-11-03
    const byMonth = new Map(
      computeMonthlyHistogram(findPlace('restaurant_000001'), '2026-08-01').map((bucket) => [
        bucket.month,
        bucket.visitCount,
      ]),
    );

    expect(byMonth.get('2026-07')).toBe(2);
    expect(byMonth.get('2026-05')).toBe(1);
    expect(byMonth.get('2025-11')).toBe(1);
  });

  it('keeps a zero bucket for a month with no visit rather than dropping it', () => {
    const buckets = computeMonthlyHistogram(findPlace('restaurant_000002'), '2026-08-01');

    // A single visit in 2026-07 — every other month must still be present, at zero.
    expect(buckets.filter((bucket) => bucket.visitCount === 0)).toHaveLength(11);
    expect(buckets.map((bucket) => bucket.month)).toContain('2026-06');
  });

  it('leaves out a transaction older than the twelve charted months', () => {
    // 000006 holds 2025-08-01, one month before the first bucket at this anchor.
    const buckets = computeMonthlyHistogram(findPlace('restaurant_000006'), '2026-08-01');

    expect(buckets.map((bucket) => bucket.month)).not.toContain('2025-08');
    expect(buckets.reduce((total, bucket) => total + bucket.visitCount, 0)).toBe(3);
  });

  it('crosses the year boundary without losing a month', () => {
    const buckets = computeMonthlyHistogram(findPlace('restaurant_000003'), '2026-02-01');

    expect(buckets[0]?.month).toBe('2025-03');
    expect(buckets.at(-1)?.month).toBe('2026-02');
    expect(new Set(buckets.map((bucket) => bucket.month)).size).toBe(12);
  });

  it('leaves out a visit later in the anchor month than the anchor itself', () => {
    const place: PlaceRecord = {
      ...findPlace('restaurant_000002'),
      transactions: [
        { date: '2026-08-10', amount: 1000 }, // on or before the anchor
        { date: '2026-08-20', amount: 1000 }, // after it — outside every other window on the page
      ],
    };

    const buckets = computeMonthlyHistogram(place, '2026-08-15');
    const byMonth = new Map(buckets.map((bucket) => [bucket.month, bucket.visitCount]));

    expect(byMonth.get('2026-08')).toBe(1);
    expect(buckets.reduce((total, bucket) => total + bucket.visitCount, 0)).toBe(1);
  });

  it('rejects a malformed transaction date instead of bucketing it as NaN', () => {
    const broken: PlaceRecord = { ...findPlace('restaurant_000002'), transactions: [
      { date: '2026-13-01', amount: 1000 },
    ] };

    expect(() => computeMonthlyHistogram(broken, '2026-08-01')).toThrow(RangeError);
  });
});
