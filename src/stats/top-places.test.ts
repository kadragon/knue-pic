import { describe, expect, it } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import type { PlaceRecord, PlacesDataset } from '../data/types';
import { LAST_YEAR_MONTH } from './period';
import { computeTopPlaces, TOP_PLACES_LIMIT } from './top-places';

/**
 * Expected orders below are computed by hand from `SAMPLE_DATASET` (`docs/eval-criteria.md` §1),
 * not copied from an implementation run. Anchor is 2026-08-01, windows half-open.
 */
function idsOf(dataset: PlacesDataset, period: Parameters<typeof computeTopPlaces>[1]): string[] {
  return computeTopPlaces(dataset, period).entries.map((entry) => entry.place.id);
}

function place(id: string, dates: { date: string; amount: number }[]): PlaceRecord {
  return {
    id,
    name: `가게 ${id}`,
    category: '기타',
    kind: 'other',
    address: '충북 청주시 흥덕구 강내면',
    lat: 36.6,
    lng: 127.3,
    naverUrl: `https://map.naver.com/p/search/${id}`,
    transactions: dates,
  };
}

describe('computeTopPlaces ordering', () => {
  it('ranks the 1m window by visit count, then most recent visit, then amount', () => {
    // 006/005/004/001 all have 2 visits: 006 is most recent (08-01); 005 and 004 tie on 07-22 and
    // are separated only by total amount (56000 > 40000); 001 is last on 07-20. 002 has 1 visit.
    expect(idsOf(SAMPLE_DATASET, '1m')).toEqual([
      'restaurant_000006',
      'restaurant_000005',
      'restaurant_000004',
      'restaurant_000001',
      'restaurant_000002',
    ]);
  });

  it('ranks the 6m window', () => {
    expect(idsOf(SAMPLE_DATASET, '6m')).toEqual([
      'restaurant_000006',
      'restaurant_000001',
      'restaurant_000005',
      'restaurant_000004',
      'restaurant_000002',
    ]);
  });

  it('ranks the 1y window', () => {
    expect(idsOf(SAMPLE_DATASET, '1y')).toEqual([
      'restaurant_000001',
      'restaurant_000006',
      'restaurant_000005',
      'restaurant_000004',
      'restaurant_000003',
      'restaurant_000002',
    ]);
  });

  it('never lets amount outrank visit count', () => {
    const dataset: PlacesDataset = {
      updatedAt: '2026-08-01',
      places: [
        // One very expensive visit versus two cheap ones on later dates.
        place('restaurant_000001', [{ date: '2026-07-25', amount: 900000 }]),
        place('restaurant_000002', [
          { date: '2026-07-10', amount: 1000 },
          { date: '2026-07-11', amount: 1000 },
        ]),
      ],
    };

    expect(idsOf(dataset, '1m')).toEqual(['restaurant_000002', 'restaurant_000001']);
  });

  it('drops places with no visit in the window instead of ranking them last', () => {
    // 000003's only transactions are in 2025, outside the 1m window.
    expect(idsOf(SAMPLE_DATASET, '1m')).not.toContain('restaurant_000003');
    expect(idsOf(SAMPLE_DATASET, '1y')).toContain('restaurant_000003');
  });

  it('assigns dense 1-based ranks', () => {
    const { entries } = computeTopPlaces(SAMPLE_DATASET, '1y');

    expect(entries.map((entry) => entry.rank)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('orders a full tie by id so the list is reproducible', () => {
    const dataset: PlacesDataset = {
      updatedAt: '2026-08-01',
      places: [
        place('restaurant_000009', [{ date: '2026-07-10', amount: 10000 }]),
        place('restaurant_000002', [{ date: '2026-07-10', amount: 10000 }]),
      ],
    };

    expect(idsOf(dataset, '1m')).toEqual(['restaurant_000002', 'restaurant_000009']);
  });

  it('caps the list at ten while ranking everyone', () => {
    const dataset: PlacesDataset = {
      updatedAt: '2026-08-01',
      places: Array.from({ length: 14 }, (_, index) =>
        // Descending visit counts: 14 visits for the first place down to 1 for the last.
        place(
          `restaurant_${String(index + 1).padStart(6, '0')}`,
          Array.from({ length: 14 - index }, (__, visit) => ({
            date: `2026-07-${String(visit + 2).padStart(2, '0')}`,
            amount: 1000,
          })),
        ),
      ),
    };

    const { entries } = computeTopPlaces(dataset, '1m');

    expect(entries).toHaveLength(TOP_PLACES_LIMIT);
    expect(entries[0]?.place.id).toBe('restaurant_000001');
    expect(entries[9]?.rank).toBe(10);
  });

  it('honours an explicit limit', () => {
    expect(computeTopPlaces(SAMPLE_DATASET, '1y', 3).entries).toHaveLength(3);
  });
});

describe('computeTopPlaces rank delta', () => {
  it('omits every delta when the prior window predates the retained range', () => {
    const result = computeTopPlaces(SAMPLE_DATASET, '1y');

    expect(result.priorWindowComplete).toBe(false);
    expect(result.entries.every((entry) => entry.rankDelta === null)).toBe(true);
  });

  it('reports 0 for an unchanged rank and null for a place absent from the prior window', () => {
    // Prior 1m window is 2026-06-01 → 2026-07-01; only 000006 has a visit in it (07-01), at rank 1,
    // and it is rank 1 in the current window too.
    const result = computeTopPlaces(SAMPLE_DATASET, '1m');
    const byId = new Map(result.entries.map((entry) => [entry.place.id, entry]));

    expect(result.priorWindowComplete).toBe(true);
    expect(byId.get('restaurant_000006')?.rankDelta).toBe(0);
    expect(byId.get('restaurant_000005')?.rankDelta).toBeNull();
    expect(byId.get('restaurant_000001')?.rankDelta).toBeNull();
  });

  it('computes the 6m delta against the prior 6m window', () => {
    // Prior 6m is 2025-08-01 → 2026-02-01: 000003 (2 visits) rank 1, 000001 (1 visit) rank 2.
    // 000001 is rank 2 in the current window as well.
    const byId = new Map(
      computeTopPlaces(SAMPLE_DATASET, '6m').entries.map((entry) => [entry.place.id, entry]),
    );

    expect(byId.get('restaurant_000001')?.rankDelta).toBe(0);
    expect(byId.get('restaurant_000006')?.rankDelta).toBeNull();
  });

  it('signs a delta negative when the place slipped down the ranking', () => {
    const dataset: PlacesDataset = {
      updatedAt: '2026-08-01',
      places: [
        // Prior 1m (2026-06-01 → 2026-07-01): A 1 visit (rank 1), B none.
        // Current 1m (2026-07-01 → 2026-08-01): B 2 visits (rank 1), A 1 visit (rank 2).
        place('restaurant_000001', [
          { date: '2026-06-15', amount: 1000 },
          { date: '2026-07-15', amount: 1000 },
        ]),
        place('restaurant_000002', [
          { date: '2026-07-10', amount: 1000 },
          { date: '2026-07-20', amount: 1000 },
        ]),
      ],
    };

    const byId = new Map(
      computeTopPlaces(dataset, '1m').entries.map((entry) => [entry.place.id, entry]),
    );

    expect(byId.get('restaurant_000001')?.rank).toBe(2);
    expect(byId.get('restaurant_000001')?.rankDelta).toBe(-1);
    expect(byId.get('restaurant_000002')?.rankDelta).toBeNull();
  });

  it('compares against the whole prior ranking, not only its top ten', () => {
    const dataset: PlacesDataset = {
      updatedAt: '2026-08-01',
      places: [
        // 000001 sat at prior rank 11 behind ten busier places, then led the current window.
        place('restaurant_000001', [
          { date: '2026-06-05', amount: 1000 },
          { date: '2026-07-05', amount: 1000 },
          { date: '2026-07-06', amount: 1000 },
          { date: '2026-07-07', amount: 1000 },
        ]),
        ...Array.from({ length: 10 }, (_, index) =>
          place(
            `restaurant_${String(index + 2).padStart(6, '0')}`,
            Array.from({ length: 3 }, (__, visit) => ({
              date: `2026-06-${String(visit + 10).padStart(2, '0')}`,
              amount: 1000,
            })),
          ),
        ),
      ],
    };

    const first = computeTopPlaces(dataset, '1m').entries[0];

    expect(first?.place.id).toBe('restaurant_000001');
    // Rank 11 → rank 1 is a real move; a truncated prior list would have reported `null`.
    expect(first?.rankDelta).toBe(10);
  });
});

describe('computeTopPlaces over 작년 같은 달', () => {
  it('ranks that calendar month alone, not a span ending at the anchor', () => {
    // 000006's 2025-08-01 payment is the fixture's only visit in 2025-08, and the 1y window
    // excludes it — so the two windows cannot be satisfied by the same list.
    expect(idsOf(SAMPLE_DATASET, LAST_YEAR_MONTH)).toEqual(['restaurant_000006']);
  });

  it('omits every rank delta, because the month before it was never published', () => {
    const result = computeTopPlaces(SAMPLE_DATASET, LAST_YEAR_MONTH);

    expect(result.priorWindowComplete).toBe(false);
    expect(result.entries.every((entry) => entry.rankDelta === null)).toBe(true);
  });

  it('ranks nothing at all when the month holds no visit', () => {
    // The state this column ships in until the older months are collected.
    const result = computeTopPlaces({ ...SAMPLE_DATASET, updatedAt: '2028-08-01' }, LAST_YEAR_MONTH);

    expect(result.entries).toEqual([]);
  });
});
