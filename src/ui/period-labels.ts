import type { Period } from '../data/types';

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
 * The order the columns are rendered in: shortest window first, so the reader scans widening.
 *
 * Every `Period` appears exactly once — the columns *are* the set of windows the page measures, so
 * a period missing here is a window the reader has no way to see.
 */
export const PERIOD_ORDER: Period[] = ['1m', '3m', '6m', '1y'];

