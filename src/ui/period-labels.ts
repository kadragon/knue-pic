import type { Period } from '../data/types';
import { LAST_YEAR_MONTH, lastYearMonthOf, type StatBasis } from '../stats/period';

/**
 * The names of the windows a list or the detail dialog can be measured over, in one place.
 *
 * They were the property of the 1m/6m/1y selector until the page stopped switching between the
 * windows and started showing them side by side (`src/ui/place-columns.ts`). Two views now speak
 * the same names — a column heading and the detail dialog's "…기준" line — so the strings live in a
 * module of their own rather than in either of them, and the banned-phrase test still has a single
 * place to assert over.
 */

export const PERIOD_LABELS: Record<Period, string> = {
  '1m': '최근 1개월',
  '3m': '최근 3개월',
  '6m': '최근 6개월',
  '1y': '최근 1년',
};

/**
 * Ranked columns are rendered in this order: shortest window first, so the reader scans widening.
 *
 * `1m` is absent on purpose. The 최근 뜨는 곳 column already reads that month, so a ranked list
 * beside it stated the same window twice; `1m` survives in `PERIOD_LABELS` because a place picked
 * from the trending column is still shown 최근 1개월 figures.
 */
export const PERIOD_ORDER: Period[] = ['3m', '6m', '1y'];

/**
 * The 작년 같은 달 window, named by the month it actually is.
 *
 * Every label beside it says "최근 N개월", so a reader has no way to tell that this one is a fixed
 * calendar month unless the label spells the month out — "작년 같은 달" alone would leave which
 * month unstated on a page whose whole claim is that its figures can be checked by hand.
 */
export function lastYearMonthLabel(anchor: string): string {
  const { year, month } = lastYearMonthOf(anchor);
  return `${year}년 ${month}월`;
}

export function basisLabel(basis: StatBasis, anchor: string): string {
  return basis === LAST_YEAR_MONTH ? lastYearMonthLabel(anchor) : PERIOD_LABELS[basis];
}
