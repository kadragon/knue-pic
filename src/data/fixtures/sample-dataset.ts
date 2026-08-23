import type { PlacesDataset } from '../types';

/**
 * Hand-authored stand-in for `data/places.json`, which the Python collector does not yet produce.
 *
 * Small enough to verify every statistic by hand, and shaped to exercise the edge cases in
 * `docs/conventions.md` → Statistics Rules. Anchored on a fixed `updatedAt` so period windows —
 * and therefore every expected value in the stats tests — are deterministic.
 *
 * Windows are half-open — the start day is excluded, the end day included (see
 * `src/stats/period.ts`). With `updatedAt` at 2026-08-01 that gives:
 *   1m           → after 2026-07-01, through 2026-08-01
 *   3m           → after 2026-05-01, through 2026-08-01
 *   6m           → after 2026-02-01, through 2026-08-01
 *   1y           → after 2025-08-01, through 2026-08-01
 *   lastYearMonth → after 2025-07-31, through 2025-08-31 (the whole of 2025-08)
 *
 * Coverage by place:
 *   000001 visits spread across all three window boundaries; 6m average is fractional (rounding)
 *   000002 exactly one transaction
 *   000003 no visits in the 1m or 6m window (divide-by-zero guard) and one zero-amount payment
 *   000004 ties 000005 on visit count and most recent date; only total amount separates them
 *   000005 the other half of that tie
 *   000006 transactions on the excluded start day, the day after it, and the included end day —
 *          and that excluded 1y start day, 2025-08-01, is the fixture's only 작년 같은 달 visit,
 *          so the two windows cannot be confused for one another
 *
 * Every date sits inside the rolling window the published file is trimmed to.
 */
export const SAMPLE_DATASET: PlacesDataset = {
  updatedAt: '2026-08-01',
  places: [
    {
      id: 'restaurant_000001',
      name: '한밭식당',
      category: '한식',
      kind: 'restaurant',
      address: '충북 청주시 흥덕구 강내면 태성탑연로 111',
      lat: 36.6012,
      lng: 127.2934,
      naverUrl: 'https://map.naver.com/p/search/한밭식당',
      transactions: [
        { date: '2026-07-20', amount: 45000 },
        { date: '2026-07-05', amount: 32000 },
        { date: '2026-05-12', amount: 29000 },
        { date: '2025-11-03', amount: 51000 },
      ],
    },
    {
      id: 'restaurant_000002',
      name: '청람카페',
      category: '카페',
      kind: 'cafe',
      address: '충북 청주시 흥덕구 강내면 태성탑연로 285',
      lat: 36.5978,
      lng: 127.2901,
      naverUrl: 'https://map.naver.com/p/search/청람카페',
      transactions: [{ date: '2026-07-15', amount: 12000 }],
    },
    {
      id: 'restaurant_000003',
      name: '황새울분식',
      category: '기타',
      kind: 'other',
      address: '충북 청주시 흥덕구 강내면 학천길 24',
      lat: 36.6045,
      lng: 127.3018,
      naverUrl: 'https://map.naver.com/p/search/황새울분식',
      transactions: [
        { date: '2025-09-10', amount: 18000 },
        { date: '2025-12-22', amount: 0 },
      ],
    },
    {
      id: 'restaurant_000004',
      name: '교원분식',
      category: '분식',
      kind: 'restaurant',
      address: '충북 청주시 흥덕구 강내면 태성탑연로 302',
      lat: 36.5991,
      lng: 127.2887,
      naverUrl: 'https://map.naver.com/p/search/교원분식',
      transactions: [
        { date: '2026-07-22', amount: 21000 },
        { date: '2026-07-08', amount: 19000 },
      ],
    },
    {
      id: 'restaurant_000005',
      name: '다래정',
      category: '중식',
      kind: 'restaurant',
      address: '충북 청주시 흥덕구 강내면 태성탑연로 268',
      lat: 36.6003,
      lng: 127.2919,
      naverUrl: 'https://map.naver.com/p/search/다래정',
      transactions: [
        { date: '2026-07-22', amount: 30000 },
        { date: '2026-07-02', amount: 26000 },
      ],
    },
    {
      id: 'restaurant_000006',
      name: '새터말칼국수',
      category: '한식',
      kind: 'restaurant',
      address: '충북 청주시 흥덕구 강내면 학천길 58',
      lat: 36.6067,
      lng: 127.3052,
      naverUrl: 'https://map.naver.com/p/search/새터말칼국수',
      transactions: [
        { date: '2026-08-01', amount: 15000 }, // window end — included
        { date: '2026-07-02', amount: 14000 }, // day after the 1m start — included
        { date: '2026-07-01', amount: 13000 }, // exactly the 1m start — excluded from 1m
        { date: '2025-08-01', amount: 9000 }, // exactly the 1y start — excluded from 1y
      ],
    },
  ],
};
