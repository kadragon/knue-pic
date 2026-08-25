/** Small display transforms shared by every place list and the detail dialog. */

/** Naver categories use commas; the UI uses the same middle dot as its other metadata. */
export function displayCategory(category: string): string {
  return category.replace(/,\s*/g, '·');
}

/** Converts an ISO date into a compact Korean date form without exposing machine punctuation. */
export function displayDate(date: string): string {
  const [year, month, day] = date.split('-');
  if (!year || !month || !day) return date;
  return `${year}. ${Number(month)}. ${Number(day)}.`;
}
