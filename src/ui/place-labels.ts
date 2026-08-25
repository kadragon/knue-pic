/** Small display transforms shared by every place list and the detail dialog. */

/**
 * Naver categories use commas; the UI uses the same middle dot as its other metadata.
 * `src/stats/search.ts` folds both spellings to one form, so a reader can type what they see.
 */
export function displayCategory(category: string): string {
  return category.replace(/,\s*/g, '·');
}

/**
 * Converts an ISO date into the same Korean date form the period headings use
 * (`period-labels.ts` → `lastYearMonthLabel`, `place-detail.ts` → `monthLabel`), so one dialog
 * never carries two date formats. The shape guard is on the whole string, not on the field count:
 * `2026-07-08T00:00:00` splits into three truthy parts and would otherwise render a `NaN` day.
 */
export function displayDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const [year, month, day] = date.split('-') as [string, string, string];
  return `${year}년 ${Number(month)}월 ${Number(day)}일`;
}
