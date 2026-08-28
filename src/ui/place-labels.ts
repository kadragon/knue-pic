import type { PlaceRecord } from '../data/types';
import type { MonthKey } from '../data/iso-date';
import type { HistogramSpan } from '../stats/histogram';

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
 * (`monthLabel`, below), so one dialog never carries two date formats. The shape
 * guard is on the whole string, not on the field count: `2026-07-08T00:00:00` splits into three
 * truthy parts and would otherwise render a `NaN` day.
 *
 * Used for the footer's provenance line alone. A place's own dates go through
 * `displayShortDate` — see there for why the two forms are not one.
 */
export function displayDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const [year, month, day] = date.split('-') as [string, string, string];
  return `${year}년 ${Number(month)}월 ${Number(day)}일`;
}

/**
 * `2026-07-08` → `07-08`, for a place's most recent visit.
 *
 * The year is dropped because these dates are read as recency, not as calendar positions: the
 * question a row answers is "how recently was this used", and against a window the heading already
 * names, the year repeated on every row crowded the metadata line without settling that question.
 *
 * It is a real trade, not a free one. 최근 1년 spans two calendar years, and the dialog opened from
 * search is measured over that same window, so `09-14` there could be either year and the row does
 * not say which. That ambiguity is accepted for the list; the footer's provenance date keeps its
 * year, because that one is the reader's only statement of *which* published file they are looking
 * at and a bare `07-08` would not say it.
 */
export function displayShortDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const [, month, day] = date.split('-') as [string, string, string];
  return `${month}-${day}`;
}

/**
 * The 업종 badge carried by every place row and by the detail dialog.
 *
 * The text is Naver's own category (`한식`, `카페·디저트`, `중식`…), which is finer than the four
 * kinds the 업종 filter offers; the colour comes from the kind, so the badge lines up with the
 * filter chip that would select it. The kind reaches the stylesheet as `data-kind` and never as a
 * colour chosen here — this module knows no colour values, and the palette stays in one file.
 *
 * The category is always spelled out. Colour alone may not carry the fact
 * (`docs/conventions.md` → Accessibility), so a reader who cannot tell the four hues apart still
 * reads the classification.
 */
export function renderKindBadge(place: PlaceRecord): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = 'place-kind-badge';
  badge.dataset['kind'] = place.kind;
  badge.textContent = displayCategory(place.category);
  return badge;
}

/**
 * `2026-07` → `2026년 7월`, so a month axis reads as months rather than as a code.
 *
 * Lives here rather than in either view: the detail card's chart labels every bar with it and the
 * ranked row's trend bars name their months with it, and a second copy is how the two charts end
 * up spelling the same month differently.
 *
 * Takes a `MonthKey`, not a `string`: an `''` reaching here rendered `년 NaN월`, and
 * `src/data/iso-date.ts` is where a month is shaped before one exists. The destructuring stays
 * unguarded because `.split()` on a branded string tells TypeScript nothing about the halves —
 * the guarantee is at the boundary, not here.
 *
 * `MonthKey` is a nominal brand minted by `monthKey` and `isMonthKey`, both of which enforce a
 * four-digit year, so the `'-1-08'` and `'1e3-08'` that used to render `년 1월` and `1e3년 8월` can
 * no longer be handed to this function by writing the literal. Forging one is still syntactically
 * possible, which is why `eslint.config.js` confines the routes that spell the name — cast,
 * angle-bracket assertion, alias, ambient declaration — to `src/data/iso-date.ts`: the guarantee
 * is "no accidental month, and one checked mint point", the second of them held by a lint rule
 * whose limits that file documents.
 */
export function monthLabel(month: MonthKey): string {
  const [year, index] = month.split('-');
  return `${year}년 ${Number(index)}월`;
}

/**
 * The concrete span a chart covers — `2025년 9월~2026년 8월`.
 *
 * Named from the span's own ends rather than from a month count, because a count reads as the
 * selected period and is not one. `resolvePeriodWindow('1y', anchor)` is half-open by *day* —
 * with `updatedAt: 2026-08-25` it opens 2025-08-25 — while `computeMonthlyHistogram` charts whole
 * calendar months, so its first bar is 2025-09. Both would print `최근 12개월`, and a visit in the
 * uncovered sliver counts toward the figure beside the chart while landing in no bar. Naming the
 * months makes the two spans legibly different instead of apparently identical.
 *
 * Takes a `HistogramSpan` rather than a bucket array so there is no empty case to answer: a span
 * has two ends by its type, and `src/stats/histogram.ts` is where a series is proven non-empty
 * (`MonthlyHistogram`) before one is derived from it. An empty array used to return `''` here,
 * which would have rendered `" 이용 횟수"` and `"월별 막대는  기준"` — a blank where a period
 * belongs.
 */
export function histogramSpanLabel(span: HistogramSpan): string {
  if (span.first === span.last) return monthLabel(span.first);
  return `${monthLabel(span.first)}~${monthLabel(span.last)}`;
}
