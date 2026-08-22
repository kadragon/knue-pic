import type { Period } from '../data/types';

/**
 * The names of the three ranked windows, in one place.
 *
 * They were the property of the 1m/6m/1y selector until the page stopped switching between the
 * windows and started showing them side by side (`src/ui/place-columns.ts`). Two views now speak
 * the same names — a column heading and the detail dialog's "…기준" line — so the strings live in a
 * module of their own rather than in either of them, and the banned-phrase test still has a single
 * place to assert over.
 */

export const PERIOD_LABELS: Record<Period, string> = {
  '1m': '최근 1개월',
  '6m': '최근 6개월',
  '1y': '최근 1년',
};

/** Ranked columns are rendered in this order: shortest window first, so the reader scans widening. */
export const PERIOD_ORDER: Period[] = ['1m', '6m', '1y'];
