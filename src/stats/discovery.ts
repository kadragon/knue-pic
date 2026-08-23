import type { PlaceRecord, PlacesDataset } from '../data/types';
import { computePlaceStats } from './place-stats';
import { resolveMonthsWindow, resolvePriorWindow } from './period';

/**
 * The 최근 뜨는 곳 column: the recent month measured against the month before it. Pure — dataset
 * in, list out; no DOM, no map.
 *
 * Its window is fixed by `docs/conventions.md` → Statistics Rules rather than chosen: the ranked
 * columns beside it already read 3개월 / 6개월 / 1년, and a trend measured over a year is not a
 * trend. The anchor is the dataset's `updatedAt` and nothing else.
 */

/** `docs/conventions.md` → Statistics Rules: one visit is not a trend. */
export const TRENDING_MIN_VISITS = 2;

export interface TrendingPlace {
  place: PlaceRecord;
  /** Visits inside the recent 1-month window; always `>= TRENDING_MIN_VISITS`. */
  recentVisits: number;
  /** Visits inside the month before that. */
  priorVisits: number;
  /** `priorVisits === 0` — the place has no prior-month figure to be compared against. */
  isNew: boolean;
  /**
   * `recentVisits - priorVisits`, or `null` when `isNew`.
   *
   * Omitted rather than reported for a new entrant: with no prior visits the honest statement is
   * "this is new", not "up N from zero", and a ratio would divide by zero outright
   * (`docs/conventions.md` → Statistics Rules). Same omission discipline as `rankDelta`.
   */
  visitDelta: number | null;
}

/**
 * Ordered by how much the place actually moved, then by the recent count, then by id for a stable
 * order. The sort key is the raw difference even for a new entrant — `visitDelta` is `null` only
 * so nothing *renders* an invented number; the ordering itself is measured, not invented.
 */
export function computeTrendingPlaces(dataset: PlacesDataset): TrendingPlace[] {
  const recentWindow = resolveMonthsWindow(1, dataset.updatedAt);
  // Delegated so the recent and prior windows tile exactly, with neither a shared day nor a gap.
  const priorWindow = resolvePriorWindow('1m', dataset.updatedAt);

  const trending: TrendingPlace[] = [];

  for (const place of dataset.places) {
    const recentVisits = computePlaceStats(place, recentWindow).visitCount;
    if (recentVisits < TRENDING_MIN_VISITS) continue;

    const priorVisits = computePlaceStats(place, priorWindow).visitCount;
    const isNew = priorVisits === 0;
    trending.push({
      place,
      recentVisits,
      priorVisits,
      isNew,
      visitDelta: isNew ? null : recentVisits - priorVisits,
    });
  }

  return trending.sort((a, b) => {
    const aChange = a.recentVisits - a.priorVisits;
    const bChange = b.recentVisits - b.priorVisits;
    if (aChange !== bChange) return bChange - aChange;
    if (a.recentVisits !== b.recentVisits) return b.recentVisits - a.recentVisits;
    return a.place.id < b.place.id ? -1 : 1;
  });
}
