import { describe, expect, it } from 'vitest';
import type { PlaceRecord, PlacesDataset } from '../data/types';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import { computeTrendingPlaces } from './discovery';

/**
 * `SAMPLE_DATASET` covers the window boundaries but every place in it is a first-time entrant in
 * the recent month, so it cannot exercise a place that has a prior-month figure. Rather than add
 * places to the shared fixture — whose expected values are hand-computed in the ranking tests —
 * the movement cases get their own tiny dataset on the same 2026-08-01 anchor.
 *
 * With that anchor the recent window is (2026-07-01, 2026-08-01] and the prior one is
 * (2026-06-01, 2026-07-01].
 */
function place(id: string, dates: string[]): PlaceRecord {
  return {
    id,
    name: `place-${id}`,
    category: '한식',
    kind: 'other',
    address: '충북 청주시 흥덕구 강내면',
    lat: 36.6,
    lng: 127.3,
    naverUrl: `https://map.naver.com/p/search/${id}`,
    transactions: dates.map((date) => ({ date, amount: 10000 })),
  };
}

const MOVEMENT_DATASET: PlacesDataset = {
  updatedAt: '2026-08-01',
  places: [
    // Up: 3 recent against 2 prior. The 2025 visit keeps it out of the newly-seen window.
    place('restaurant_000101', [
      '2025-10-05',
      '2026-06-15',
      '2026-06-20',
      '2026-07-10',
      '2026-07-18',
      '2026-07-25',
    ]),
    // Down: 2 recent against 3 prior — still trending-eligible, with a negative delta.
    place('restaurant_000102', [
      '2025-09-15',
      '2026-06-05',
      '2026-06-12',
      '2026-06-25',
      '2026-07-14',
      '2026-07-28',
    ]),
    // Below the two-visit floor in the recent window, however busy it was before.
    place('restaurant_000103', ['2026-06-03', '2026-06-09', '2026-07-11']),
  ],
};

describe('computeTrendingPlaces', () => {
  it('requires at least two visits in the recent month', () => {
    const trending = computeTrendingPlaces(MOVEMENT_DATASET);

    expect(trending.map((entry) => entry.place.id)).toEqual([
      'restaurant_000101',
      'restaurant_000102',
    ]);
  });

  it('reports the visit delta against the preceding month', () => {
    const [up, down] = computeTrendingPlaces(MOVEMENT_DATASET);

    expect(up).toMatchObject({ recentVisits: 3, priorVisits: 2, isNew: false, visitDelta: 1 });
    expect(down).toMatchObject({ recentVisits: 2, priorVisits: 3, isNew: false, visitDelta: -1 });
  });

  it('marks a place with no prior-month visit as new and omits the delta', () => {
    const trending = computeTrendingPlaces(SAMPLE_DATASET);
    // 000006 is the one fixture place with a prior-month visit — its 2026-07-01 payment falls on
    // the prior window's *included* end day, which is the same day the recent window excludes.
    const newEntrants = trending.filter((entry) => entry.place.id !== 'restaurant_000006');

    expect(newEntrants.length).toBeGreaterThan(0);
    for (const entry of newEntrants) {
      expect(entry.priorVisits).toBe(0);
      expect(entry.isNew).toBe(true);
      // Omitted, never a ratio: dividing by a zero prior count is what produces `Infinity`.
      expect(entry.visitDelta).toBeNull();
      expect(Number.isFinite(entry.recentVisits)).toBe(true);
    }
  });

  it('counts the recent window half-open — the start day is excluded, the end day included', () => {
    const trending = computeTrendingPlaces(SAMPLE_DATASET);
    const boundary = trending.find((entry) => entry.place.id === 'restaurant_000006');

    // 2026-08-01 and 2026-07-02 count; 2026-07-01 sits on the excluded start day.
    expect(boundary?.recentVisits).toBe(2);
  });

  it('orders by how much the place moved, then by the recent count', () => {
    const dataset: PlacesDataset = {
      updatedAt: '2026-08-01',
      places: [
        place('restaurant_000201', ['2026-07-10', '2026-07-20']),
        place('restaurant_000202', ['2026-07-05', '2026-07-12', '2026-07-19', '2026-07-26']),
      ],
    };

    expect(computeTrendingPlaces(dataset).map((entry) => entry.place.id)).toEqual([
      'restaurant_000202',
      'restaurant_000201',
    ]);
  });
});
