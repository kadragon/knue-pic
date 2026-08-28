import { describe, expect, it } from 'vitest';
import type { PlaceRecord } from '../data/types';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import { monthKey } from '../data/iso-date';
import { RETAINED_MONTHS } from './period';
import {
  HISTOGRAM_MONTHS,
  chartedMonths,
  computeMonthlyHistogram,
  histogramSpan,
  histogramSpanFor,
} from './histogram';

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

  it('never draws a bar older than the published file retains', () => {
    // A bar past the retention floor could only ever render empty, which reads as a month nobody
    // visited rather than as a month the file does not carry.
    expect(HISTOGRAM_MONTHS).toBeLessThanOrEqual(RETAINED_MONTHS);
  });

  it('draws the span it is asked for', () => {
    const buckets = computeMonthlyHistogram(findPlace('restaurant_000001'), '2026-08-01', 6);

    expect(buckets).toHaveLength(6);
    expect(buckets.at(-1)?.month).toBe('2026-08');
  });

  it('counts each transaction into its calendar month', () => {
    // 000001: 2026-07-20, 2026-07-05, 2026-05-12, 2025-11-03
    const byMonth = new Map(
      computeMonthlyHistogram(findPlace('restaurant_000001'), '2026-08-01').map((bucket) => [
        bucket.month,
        bucket.visitCount,
      ]),
    );

    expect(byMonth.get(monthKey(2026, 7))).toBe(2);
    expect(byMonth.get(monthKey(2026, 5))).toBe(1);
    expect(byMonth.get(monthKey(2025, 11))).toBe(1);
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

    expect(byMonth.get(monthKey(2026, 8))).toBe(1);
    expect(buckets.reduce((total, bucket) => total + bucket.visitCount, 0)).toBe(1);
  });

  it('rejects a malformed transaction date instead of bucketing it as NaN', () => {
    const broken: PlaceRecord = { ...findPlace('restaurant_000002'), transactions: [
      { date: '2026-13-01', amount: 1000 },
    ] };

    expect(() => computeMonthlyHistogram(broken, '2026-08-01')).toThrow(RangeError);
  });
});

describe('charted months and their span', () => {
  it('refuses a month count that would chart nothing', () => {
    // The non-emptiness `MonthlyHistogram` states is only true if the producer refuses to build an
    // empty series; every label derived from one reads its ends without an empty branch.
    expect(() => chartedMonths('2026-08-01', 0)).toThrow(RangeError);
    expect(() => chartedMonths('2026-08-01', -1)).toThrow(RangeError);
    // The integer half of the guard too, or weakening it to a bare `monthCount < 1` would still
    // pass: a fractional count charts a fractional number of bars, and `NaN` charts none at all.
    expect(() => chartedMonths('2026-08-01', 1.5)).toThrow(RangeError);
    expect(() => chartedMonths('2026-08-01', Number.NaN)).toThrow(RangeError);
    expect(() => chartedMonths('2026-08-01', Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => computeMonthlyHistogram(findPlace('restaurant_000001'), '2026-08-01', 0)).toThrow(
      RangeError,
    );
  });

  it('names the same span whether it is read from the window or from the drawn bars', () => {
    const buckets = computeMonthlyHistogram(findPlace('restaurant_000001'), '2026-08-01');

    // The two are used in different places — a list states its span once from the anchor, a detail
    // card states it from the series it drew — so a drift between them is a caption naming months
    // the chart beside it does not draw.
    expect(histogramSpanFor('2026-08-01')).toEqual(histogramSpan(buckets));
    expect(histogramSpanFor('2026-08-01')).toEqual({ first: '2025-09', last: '2026-08' });
  });

  it('states one month as both ends when only one is charted', () => {
    expect(histogramSpanFor('2026-08-01', 1)).toEqual({ first: '2026-08', last: '2026-08' });
  });
});
