import type { PlaceRecord } from '../data/types';
import { isWithinWindow, type PeriodWindow } from './period';

/**
 * Per-place figures for one period window. Pure: places in, numbers out — no DOM, no fetch,
 * no map. Amount is aggregated for display only; ranking is by visit count alone
 * (`docs/conventions.md` → Statistics Rules) and no ordering happens here.
 *
 * A malformed transaction date is a hard failure, not a skipped row: `isWithinWindow` throws and
 * this function does not catch, because silently dropping a visit would understate a place's
 * count with nothing on screen to say so. Whatever loads `places.json` must validate every date
 * before calling in, so the throw can never reach the render path.
 */
export interface PlaceStats {
  /** One transaction is one visit; payments in a single sitting are not merged. */
  visitCount: number;
  totalAmount: number;
  /**
   * `totalAmount / visitCount` rounded to whole won; `0` when there were no visits.
   * Nothing renders it since the detail dialog dropped its amount figures — it is kept, with its
   * rounding rule in `docs/conventions.md`, so the stat is defined once if a view asks for it.
   */
  averageAmount: number;
  /** Latest in-window visit date, or `null` when the place has no visits in the window. */
  mostRecentVisit: string | null;
}

export function computePlaceStats(place: PlaceRecord, periodWindow: PeriodWindow): PlaceStats {
  let visitCount = 0;
  let totalAmount = 0;
  let mostRecentVisit: string | null = null;

  for (const transaction of place.transactions) {
    if (!isWithinWindow(transaction.date, periodWindow)) continue;

    visitCount += 1;
    totalAmount += transaction.amount;
    if (mostRecentVisit === null || transaction.date > mostRecentVisit) {
      mostRecentVisit = transaction.date;
    }
  }

  // Guarding the empty window here is what keeps an average from surfacing as NaN in the UI.
  const averageAmount = visitCount === 0 ? 0 : Math.round(totalAmount / visitCount);

  return { visitCount, totalAmount, averageAmount, mostRecentVisit };
}
