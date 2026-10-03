import { describe, expect, it } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import { computeKindPlaceCounts, computeWindowSummary } from './window-summary';
import { filterByKind } from './search';
import { computeTopPlaces } from './top-places';

/*
 * Every expected value is counted by hand from the fixture's comment block. 1m runs after
 * 2026-07-01 through 2026-08-01: 000001 has 2 visits, 000002 1, 000003 none, 000004 2, 000005 2,
 * and 000006 2 (its 07-01 visit sits on the excluded start day).
 */
describe('computeWindowSummary', () => {
  it('counts places with an in-window visit and the visits themselves', () => {
    expect(computeWindowSummary(SAMPLE_DATASET, '1m')).toEqual({ placeCount: 5, visitCount: 9 });
    // 6m adds 000001's 05-12 and 000006's 07-01; 000003 is still empty.
    expect(computeWindowSummary(SAMPLE_DATASET, '6m')).toEqual({ placeCount: 5, visitCount: 11 });
    // 1y reaches 000003's two visits; 000006's 2025-08-01 is the excluded start day.
    expect(computeWindowSummary(SAMPLE_DATASET, '1y')).toEqual({ placeCount: 6, visitCount: 14 });
  });

  it('counts only what the 업종 filter left', () => {
    expect(computeWindowSummary(filterByKind(SAMPLE_DATASET, 'cafe'), '1m')).toEqual({
      placeCount: 1,
      visitCount: 1,
    });
    expect(computeWindowSummary(filterByKind(SAMPLE_DATASET, 'lunchbox'), '1y')).toEqual({
      placeCount: 0,
      visitCount: 0,
    });
  });

  it('agrees with the ranked list on how many places are in the window', () => {
    // The summary's N곳 and the list's "N곳 중" counter are read side by side on the page.
    for (const period of ['1m', '3m', '6m', '1y'] as const) {
      expect(computeWindowSummary(SAMPLE_DATASET, period).placeCount).toBe(
        computeTopPlaces(SAMPLE_DATASET, period).entries.length,
      );
    }
  });
});

describe('computeKindPlaceCounts', () => {
  it('counts in-window places per kind, zero included', () => {
    expect(computeKindPlaceCounts(SAMPLE_DATASET, '1m')).toEqual({
      restaurant: 4,
      cafe: 1,
      lunchbox: 0,
      other: 0,
    });
    expect(computeKindPlaceCounts(SAMPLE_DATASET, '1y')).toEqual({
      restaurant: 4,
      cafe: 1,
      lunchbox: 0,
      other: 1,
    });
  });

  it('sums to the unfiltered summary, so the 전체 chip and the kinds never disagree', () => {
    const counts = computeKindPlaceCounts(SAMPLE_DATASET, '6m');
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(computeWindowSummary(SAMPLE_DATASET, '6m').placeCount);
  });
});
