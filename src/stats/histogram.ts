import type { PlaceRecord } from '../data/types';
import { formatIsoDate, parseIsoDate } from '../data/iso-date';

/**
 * Visits per calendar month for one place, for the detail card's monthly chart. Pure — no DOM.
 *
 * Bucketing is by calendar month (`YYYY-MM`) rather than by the half-open windows
 * `src/stats/period.ts` builds, because a bar chart is read against month names: a bar labelled
 * 2026년 3월 has to mean March, not "the 31 days after March 1".
 *
 * The chart shows the most recent `HISTOGRAM_MONTHS`, which is fewer than the file retains: the
 * older months exist to be ranked, not to be charted.
 */

export interface HistogramBucket {
  /** `YYYY-MM`. */
  month: string;
  visitCount: number;
}

function monthKey(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/**
 * How many monthly bars the detail card draws.
 *
 * Its own constant, not `RETAINED_MONTHS`. That one is a claim about how far back the *data* goes
 * and reads 15; sharing it would silently redraw this chart with fifteen bars, and
 * `docs/architecture.md` -> Rolling window states that the retained window is deliberately wider
 * than the span this chart draws. The separation is what lets the retained window widen again
 * without touching the chart.
 */
export const HISTOGRAM_MONTHS = 12;

/**
 * `monthCount` buckets, oldest first, ending with the anchor's own month.
 *
 * Months with no visit keep a zero bucket instead of being dropped: a gap is a fact about the
 * place, and collapsing it would space the remaining bars evenly and turn an interrupted run into
 * a steady one.
 */
export function computeMonthlyHistogram(
  place: PlaceRecord,
  anchor: string,
  monthCount: number = HISTOGRAM_MONTHS,
): HistogramBucket[] {
  const end = parseIsoDate(anchor);

  const buckets: HistogramBucket[] = [];
  const byMonth = new Map<string, HistogramBucket>();

  for (let offset = monthCount - 1; offset >= 0; offset -= 1) {
    const shifted = end.year * 12 + (end.month - 1) - offset;
    const bucket = { month: monthKey(Math.floor(shifted / 12), (shifted % 12) + 1), visitCount: 0 };
    buckets.push(bucket);
    byMonth.set(bucket.month, bucket);
  }

  const anchorIso = formatIsoDate(end);

  for (const transaction of place.transactions) {
    // Parsed rather than sliced so a malformed date fails here the same way it fails everywhere
    // else in `src/stats/`, instead of quietly landing in a `NaN-NaN` bucket nothing renders.
    const date = parseIsoDate(transaction.date);

    // A visit later in the anchor's own month is past the end of every other window on the page,
    // so charting it would make the last bar disagree with the figures printed beside it. ISO
    // dates sort lexicographically, so no further parsing is needed for the comparison.
    if (formatIsoDate(date) > anchorIso) continue;

    const bucket = byMonth.get(monthKey(date.year, date.month));
    if (bucket) bucket.visitCount += 1;
  }

  return buckets;
}
