import type { Period, PlaceRecord, PlacesDataset } from '../data/types';
import {
  computeMonthlyHistogram,
  histogramSpanFor,
  type HistogramSpan,
  type MonthlyHistogram,
} from './histogram';
import { computePlaceStats, type PlaceStats } from './place-stats';
import {
  isPriorWindowComplete,
  resolvePeriodWindow,
  resolvePriorWindow,
  type PeriodWindow,
} from './period';

/**
 * Orders places for one period window. Pure: dataset in, ranked list out — no DOM, no map.
 *
 * `place-stats.ts` deliberately does no ordering; this module is where the ranking rules in
 * `docs/conventions.md` → Statistics Rules live, and it is the only module that knows about them.
 */

/** Ranked over every place with at least one in-window visit, not only the visible cap. */
export interface RankedPlace {
  place: PlaceRecord;
  stats: PlaceStats;
  /** 1-based position in the full ranking for this window. */
  rank: number;
  /**
   * `priorRank - rank`, so a positive number means the place moved up.
   *
   * `null` means *omitted*, never "unchanged" — either the prior window falls outside the
   * dataset's retained range, or the place had no visits in it. Both are cases where a number
   * would be invented rather than measured.
   */
  rankDelta: number | null;
  /**
   * Visits per calendar month over the trailing `HISTOGRAM_MONTHS`, oldest first — the row's trend
   * bars.
   *
   * Deliberately *not* derived from the four period windows. Those all end at the dataset's anchor
   * and only differ in how far back they start, so their visit counts rise monotonically by
   * construction (`1m ≤ 3m ≤ 6m ≤ 1y`) and a shape drawn from them would slope up identically for
   * every place. Calendar months do not overlap, so a quiet stretch reads as a quiet stretch.
   *
   * It is the same series the detail card charts, so the row and the card can never disagree.
   */
  histogram: MonthlyHistogram;
}

export interface TopPlacesResult {
  /** Best first; capped at `limit` when the caller passes one. */
  entries: RankedPlace[];
  /**
   * The span every entry's trend bars cover — one fact about the charted window, stated once.
   *
   * A field rather than something a consumer reads off `entries[0]`: "every entry shares an anchor
   * and a month count" is an invariant of `computeTopPlaces`, not of the `TopPlacesResult` type, so
   * a result assembled any other way — merged lists, partially recomputed entries — would have a
   * renderer label every row with the first row's span. Carrying the span here makes it something
   * such a caller has to state rather than something a view infers.
   */
  chartedSpan: HistogramSpan;
}

/**
 * The default cap for a caller that wants one. `src/ui/place-list.ts` passes no limit at all —
 * it pages through the whole ranking as the reader scrolls, so a cap there would be a ceiling
 * nobody could scroll past.
 */
export const TOP_PLACES_LIMIT = 20;

/** Everything a ranked entry has before its trend chart is attached, which happens after the cap. */
type RankedWindowEntry = Omit<RankedPlace, 'histogram'>;

/**
 * Ranking is by visit count alone; amount only ever separates places already tied on count and on
 * most recent visit (`docs/conventions.md` → Statistics Rules). The trailing `id` comparison is not
 * one of the product's tie-break rules — it is there so two places identical on all three real keys
 * still get a stable, reproducible order rather than one that depends on input order.
 */
function compareRanked(a: RankedWindowEntry, b: RankedWindowEntry): number {
  if (a.stats.visitCount !== b.stats.visitCount) return b.stats.visitCount - a.stats.visitCount;

  // Both are non-null: a place with no in-window visit never reaches the ranking.
  const aRecent = a.stats.mostRecentVisit ?? '';
  const bRecent = b.stats.mostRecentVisit ?? '';
  if (aRecent !== bRecent) return aRecent < bRecent ? 1 : -1;

  if (a.stats.totalAmount !== b.stats.totalAmount) return b.stats.totalAmount - a.stats.totalAmount;

  return a.place.id < b.place.id ? -1 : 1;
}

/**
 * Places with no visit in the window are dropped rather than ranked last: a place the dataset knows
 * about but nobody visited this period has no position, and showing it at rank 47 would read as a
 * standing worse than "not in this window at all".
 */
function rankWindow(places: PlaceRecord[], periodWindow: PeriodWindow): RankedWindowEntry[] {
  const ranked = places
    .map((place) => ({
      place,
      stats: computePlaceStats(place, periodWindow),
      rank: 0,
      rankDelta: null as number | null,
    }))
    .filter((entry) => entry.stats.visitCount > 0)
    .sort(compareRanked);

  for (const [index, entry] of ranked.entries()) {
    entry.rank = index + 1;
  }
  return ranked;
}

export function computeTopPlaces(
  dataset: PlacesDataset,
  basis: Period,
  limit?: number,
): TopPlacesResult {
  const ranked = rankWindow(dataset.places, resolvePeriodWindow(basis, dataset.updatedAt));
  const priorWindow = isPriorWindowComplete(basis, dataset.updatedAt)
    ? resolvePriorWindow(basis, dataset.updatedAt)
    : null;

  if (priorWindow) {
    // The prior ranking covers every place, not just the visible cap: a place that entered the
    // visible list has moved, and comparing against a truncated prior list
    // would report it as a new entrant instead.
    const priorRanks = new Map(
      rankWindow(dataset.places, priorWindow).map((entry) => [entry.place.id, entry.rank]),
    );

    for (const entry of ranked) {
      const priorRank = priorRanks.get(entry.place.id);
      entry.rankDelta = priorRank === undefined ? null : priorRank - entry.rank;
    }
  }

  // `undefined` means "no cap" rather than a number that happens to be large enough: the previous
  // spelling passed `dataset.places.length`, which is only ever ≥ the ranked count by coincidence
  // of `rankWindow` filtering the same list.
  // Attached after the cap, not before, so a capped caller pays only for the rows it asked for.
  // The page's own list passes no cap — it pages through the whole ranking — so this saves nothing
  // there; it is the ordering that keeps a cap meaningful rather than an optimisation the product
  // currently collects on.
  const visible = limit === undefined ? ranked : ranked.slice(0, limit);
  return {
    entries: visible.map((entry) => ({
      ...entry,
      histogram: computeMonthlyHistogram(entry.place, dataset.updatedAt),
    })),
    // Read from the same anchor and month count each row is charted with, so the span and the bars
    // it names cannot drift apart.
    chartedSpan: histogramSpanFor(dataset.updatedAt),
  };
}
