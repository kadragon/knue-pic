import { PLACE_KINDS, type Period, type PlaceKind, type PlacesDataset } from '../data/types';
import { resolvePeriodWindow } from './period';
import { computePlaceStats } from './place-stats';

/**
 * Whole-window counts for the summary line and the 업종 chips. Pure — no DOM.
 *
 * A place counts when it has at least one in-window visit, the same predicate the ranked list
 * filters on (`./top-places.ts` → `rankWindow`), so the summary's N곳 and the list's own counter
 * can never name two different numbers for one window. Visits are transactions, as everywhere else
 * (`./place-stats.ts`).
 */
export interface WindowSummary {
  placeCount: number;
  visitCount: number;
}

/** Over whatever `dataset` holds — pass the 업종-narrowed dataset to count under the filter. */
export function computeWindowSummary(dataset: PlacesDataset, period: Period): WindowSummary {
  const periodWindow = resolvePeriodWindow(period, dataset.updatedAt);
  let placeCount = 0;
  let visitCount = 0;
  for (const place of dataset.places) {
    const visits = computePlaceStats(place, periodWindow).visitCount;
    if (visits === 0) continue;
    placeCount += 1;
    visitCount += visits;
  }
  return { placeCount, visitCount };
}

/**
 * In-window places per kind, every kind present even at zero. Takes the *unfiltered* dataset: a
 * chip states what pressing it would show, which does not depend on the kind currently pressed.
 */
export function computeKindPlaceCounts(
  dataset: PlacesDataset,
  period: Period,
): Record<PlaceKind, number> {
  const periodWindow = resolvePeriodWindow(period, dataset.updatedAt);
  const counts = Object.fromEntries(PLACE_KINDS.map((kind) => [kind, 0])) as Record<
    PlaceKind,
    number
  >;
  for (const place of dataset.places) {
    if (computePlaceStats(place, periodWindow).visitCount > 0) counts[place.kind] += 1;
  }
  return counts;
}
