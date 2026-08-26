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

/**
 * A charted series, guaranteed non-empty by its own type.
 *
 * Every label derived from a series names its ends (`histogramSpan`), and an empty series has no
 * ends to name — the label would either invent a span or print a blank one. Stating the
 * non-emptiness here rather than in a doc comment is what lets `src/ui/place-labels.ts` read the
 * first and last bucket without an empty branch.
 */
export type MonthlyHistogram = readonly [HistogramBucket, ...HistogramBucket[]];

/** The two ends of a charted series, as `YYYY-MM`. */
export interface HistogramSpan {
  first: string;
  last: string;
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
 * The `YYYY-MM` months a chart anchored at `anchor` covers, oldest first.
 *
 * The single source for *which* months are charted: `computeMonthlyHistogram` buckets into them
 * and `histogramSpanFor` names their ends, so a span and the bars it labels can never be built
 * from two different month sequences.
 *
 * A `monthCount` below 1 is rejected rather than returning an empty sequence, which is what makes
 * `MonthlyHistogram` non-empty by construction instead of by convention. `RangeError` matches how
 * a malformed date already fails in this module.
 */
export function chartedMonths(
  anchor: string,
  monthCount: number = HISTOGRAM_MONTHS,
): readonly [string, ...string[]] {
  if (!Number.isInteger(monthCount) || monthCount < 1) {
    throw new RangeError(`monthCount must be an integer of at least 1, received ${monthCount}`);
  }

  const end = parseIsoDate(anchor);
  const monthAt = (offset: number): string => {
    const shifted = end.year * 12 + (end.month - 1) - offset;
    return monthKey(Math.floor(shifted / 12), (shifted % 12) + 1);
  };

  // The oldest month is placed before the loop rather than pushed inside it, so the tuple is
  // non-empty to the type checker without an assertion or an unreachable guard.
  const months: [string, ...string[]] = [monthAt(monthCount - 1)];
  for (let offset = monthCount - 2; offset >= 0; offset -= 1) months.push(monthAt(offset));
  return months;
}

/** The span a concrete series covers — the ends of the bars actually drawn. */
export function histogramSpan(buckets: MonthlyHistogram): HistogramSpan {
  return { first: buckets[0].month, last: buckets[buckets.length - 1]!.month };
}

/**
 * The span a charted window covers, with no place involved.
 *
 * For a caller that names one span over a whole list: the months depend on the anchor and the
 * month count alone, so the span is a fact about the window rather than about whichever place
 * happens to sit in the first row.
 */
export function histogramSpanFor(
  anchor: string,
  monthCount: number = HISTOGRAM_MONTHS,
): HistogramSpan {
  const months = chartedMonths(anchor, monthCount);
  return { first: months[0], last: months[months.length - 1]! };
}

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
): MonthlyHistogram {
  const months = chartedMonths(anchor, monthCount);
  const end = parseIsoDate(anchor);

  const byMonth = new Map<string, HistogramBucket>();
  const oldest: HistogramBucket = { month: months[0], visitCount: 0 };
  byMonth.set(oldest.month, oldest);

  const buckets: [HistogramBucket, ...HistogramBucket[]] = [oldest];
  for (const month of months.slice(1)) {
    const bucket: HistogramBucket = { month, visitCount: 0 };
    buckets.push(bucket);
    byMonth.set(month, bucket);
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
