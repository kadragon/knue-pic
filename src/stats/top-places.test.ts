import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import type { PlaceRecord, PlacesDataset } from '../data/types';
import { computeMonthlyHistogram, HISTOGRAM_MONTHS, histogramSpan } from './histogram';
import { computeTopPlaces, TOP_PLACES_LIMIT } from './top-places';

/**
 * The real function, counted. Whether the histogram is attached before or after the cap is not
 * observable in the returned entries — a capped result holds `limit` entries either way — so the
 * only thing that differs between the two orderings is how many times this is called. Spying is
 * what makes that difference assertable; the wrapper delegates, so every other test in this file
 * sees the genuine series.
 */
vi.mock('./histogram', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./histogram')>();
  return { ...actual, computeMonthlyHistogram: vi.fn(actual.computeMonthlyHistogram) };
});

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

  it('caps the list at the configured limit while ranking everyone', () => {
    const placeCount = TOP_PLACES_LIMIT + 4;
    const dataset: PlacesDataset = {
      updatedAt: '2026-08-01',
      places: Array.from({ length: placeCount }, (_, index) =>
        // Descending visit counts: `placeCount` visits for the first place down to 1 for the last.
        // Visits are spread across two months so a limit past 29 cannot build an invalid July date.
        place(
          `restaurant_${String(index + 1).padStart(6, '0')}`,
          Array.from({ length: placeCount - index }, (__, visit) => ({
            date: visit < 28 ? `2026-07-${String(visit + 2).padStart(2, '0')}` : `2026-08-${String(visit - 26).padStart(2, '0')}`,
            amount: 1000,
          })),
        ),
      ),
    };

    const { entries } = computeTopPlaces(dataset, '1m', TOP_PLACES_LIMIT);

    expect(entries).toHaveLength(TOP_PLACES_LIMIT);
    expect(entries[0]?.place.id).toBe('restaurant_000001');
    expect(entries[TOP_PLACES_LIMIT - 1]?.rank).toBe(TOP_PLACES_LIMIT);

    // No limit means the whole ranking, not a large default: the list pages through it as the
    // reader scrolls, so a default cap would be a ceiling nobody could scroll past.
    expect(computeTopPlaces(dataset, '1m').entries).toHaveLength(placeCount);
  });

  it('honours an explicit limit', () => {
    expect(computeTopPlaces(SAMPLE_DATASET, '1y', 3).entries).toHaveLength(3);
  });
});

describe('computeTopPlaces rank delta', () => {
  it('omits every delta when the prior window predates the retained range', () => {
    const result = computeTopPlaces(SAMPLE_DATASET, '1y');

    expect(result.entries.every((entry) => entry.rankDelta === null)).toBe(true);
  });

  it('reports 0 for an unchanged rank and null for a place absent from the prior window', () => {
    // Prior 1m window is 2026-06-01 → 2026-07-01; only 000006 has a visit in it (07-01), at rank 1,
    // and it is rank 1 in the current window too.
    const result = computeTopPlaces(SAMPLE_DATASET, '1m');
    const byId = new Map(result.entries.map((entry) => [entry.place.id, entry]));

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

  it('compares against the whole prior ranking, not only the visible cap', () => {
    const dataset: PlacesDataset = {
      updatedAt: '2026-08-01',
      places: [
        // 000001 sat at prior rank 11 behind busier places, then led the current window.
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

describe('computeTopPlaces trend chart', () => {
  it('attaches the same monthly series the detail card charts', () => {
    const entry = computeTopPlaces(SAMPLE_DATASET, '1y').entries[0]!;

    expect(entry.histogram).toEqual(computeMonthlyHistogram(entry.place, SAMPLE_DATASET.updatedAt));
    expect(entry.histogram).toHaveLength(HISTOGRAM_MONTHS);
    expect(entry.histogram.at(-1)?.month).toBe(SAMPLE_DATASET.updatedAt.slice(0, 7));
  });

  it('states the charted span once, and every row is charted over it', () => {
    // The span is the list's fact, not the first row's. Checked against all of them so the field
    // cannot quietly become a copy of `entries[0]`.
    const result = computeTopPlaces(SAMPLE_DATASET, '1y');

    expect(result.entries.length).toBeGreaterThan(1);
    expect(result.chartedSpan).toEqual({ first: '2025-09', last: '2026-08' });
    for (const entry of result.entries) {
      expect(histogramSpan(entry.histogram)).toEqual(result.chartedSpan);
    }
  });

  it('charts only as many places as the cap kept', () => {
    const charted = vi.mocked(computeMonthlyHistogram);

    charted.mockClear();
    const uncapped = computeTopPlaces(SAMPLE_DATASET, '1y');
    const uncappedCalls = charted.mock.calls.length;

    charted.mockClear();
    const capped = computeTopPlaces(SAMPLE_DATASET, '1y', 2);
    const cappedCalls = charted.mock.calls.length;

    // Counting calls, not entries: `capped.entries` is 2 long under either ordering, so an
    // assertion over the returned array cannot tell "attached after the slice" from "attached
    // before it". The call count is the only place the two differ.
    expect(uncapped.entries.length).toBeGreaterThan(2);
    expect(uncappedCalls).toBe(uncapped.entries.length);
    expect(cappedCalls).toBe(2);
    expect(capped.entries).toHaveLength(2);
  });
});
