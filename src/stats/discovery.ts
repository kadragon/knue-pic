import type { PlaceRecord, PlacesDataset } from '../data/types';
import { computePlaceStats } from './place-stats';
import { isWithinWindow, resolveMonthsWindow, resolvePriorWindow } from './period';

/**
 * The two discovery sections that do not follow the period selector: 요즘 많이 가는 곳 and
 * 새로 발견된 곳. Pure — dataset in, lists out; no DOM, no map.
 *
 * Both windows are fixed by `docs/conventions.md` → Statistics Rules rather than chosen by the
 * user: trending is the recent month against the month before it, and newly seen is judged over
 * the full retained window. Making either follow the 1m/6m/1y selector would change what the
 * section means — "요즘" over a year is not a recent trend — so the anchor is the dataset's
 * `updatedAt` and nothing else.
 */

/** `docs/conventions.md` → Statistics Rules: one visit is not a trend. */
export const TRENDING_MIN_VISITS = 2;

/** A place counts as newly seen when its *first ever* visit lands inside this many months. */
export const NEWLY_SEEN_MONTHS = 2;

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

export interface NewlySeenPlace {
  place: PlaceRecord;
  /** Earliest transaction date in the whole record, not just the recent window. */
  firstVisit: string;
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

/**
 * A place whose first visit falls inside the last `NEWLY_SEEN_MONTHS`.
 *
 * "First" is read across every transaction the record holds, not the selected period: a place
 * visited once last March and again last week has been known for months, and calling it newly
 * discovered because the 1-month window is all we looked at would be wrong. The published file is
 * trimmed to 12 months, so this is "first seen in the retained data" — which is the strongest
 * claim the dataset supports.
 */
export function computeNewlySeenPlaces(dataset: PlacesDataset): NewlySeenPlace[] {
  const window = resolveMonthsWindow(NEWLY_SEEN_MONTHS, dataset.updatedAt);
  const newlySeen: NewlySeenPlace[] = [];

  for (const place of dataset.places) {
    let firstVisit: string | null = null;
    for (const transaction of place.transactions) {
      if (firstVisit === null || transaction.date < firstVisit) firstVisit = transaction.date;
    }

    // A place with no transactions at all has never been visited, so it was never discovered.
    if (firstVisit === null) continue;
    if (!isWithinWindow(firstVisit, window)) continue;

    newlySeen.push({ place, firstVisit });
  }

  return newlySeen.sort((a, b) => {
    if (a.firstVisit !== b.firstVisit) return a.firstVisit < b.firstVisit ? 1 : -1;
    return a.place.id < b.place.id ? -1 : 1;
  });
}
