import type { PlaceRecord, Period } from '../data/types';
import type { HistogramBucket } from '../stats/histogram';
import type { PlaceStats } from '../stats/place-stats';
import { PERIOD_LABELS } from './period-selector';

/**
 * The detail card for one selected place: the figures for the currently selected period, a
 * 12-month visit histogram, and a link out to Naver Maps.
 *
 * Every number arrives already computed — `src/stats/place-stats.ts` and `src/stats/histogram.ts`
 * own them — so there is no second definition of a visit count on this screen. Strings are
 * exported for the banned-phrase test, and none of them frames the figures as a rating or as
 * spending oversight (`docs/conventions.md` → Framing Vocabulary).
 */

export const DETAIL_HEADING = '선택한 곳';

export const DETAIL_EMPTY_MESSAGE = '목록에서 장소를 선택하면 이용 기록을 볼 수 있습니다.';

export const HISTOGRAM_HEADING = '월별 이용 기록 (최근 12개월)';

export const NAVER_LINK_LABEL = '네이버지도에서 보기';

export const NO_VISIT_IN_PERIOD_MESSAGE = '선택한 기간에는 이용 기록이 없습니다.';

/**
 * The figure labels, exported like every other string in this module.
 *
 * They are the ones most likely to drift into banned framing — 합계 is one edit away from
 * 지출 합계, which frames the data as expense tracking (`docs/conventions.md` → Framing
 * Vocabulary) — and a banned-phrase test can only assert over strings it can import.
 */
export const FIGURE_LABELS = {
  visitCount: '이용횟수',
  totalAmount: '합계',
  averageAmount: '평균',
  mostRecentVisit: '최근 이용',
} as const;

export function periodStatsHeading(period: Period): string {
  return `${PERIOD_LABELS[period]} 기준`;
}

/** Won, with thousands separators. Amount is shown for context only; it never affects ranking. */
export function amountLabel(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`;
}

export function visitCountLabel(visitCount: number): string {
  return `${visitCount}회`;
}

/** `2026-07` → `2026년 7월`, so the axis reads as months rather than as a code. */
export function monthLabel(month: string): string {
  const [year, index] = month.split('-');
  return `${year}년 ${Number(index)}월`;
}

function renderFigure(term: string, value: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'place-detail-figure';

  const label = document.createElement('dt');
  label.textContent = term;
  const figure = document.createElement('dd');
  figure.textContent = value;

  row.append(label, figure);
  return row;
}

/**
 * Each bar carries its month and its count as text. A bar length alone would put the whole chart
 * behind sighted, precise-width perception — `docs/conventions.md` → Accessibility bans conveying
 * importance by visual channel alone, and the same reasoning covers a chart.
 */
function renderHistogram(buckets: HistogramBucket[]): HTMLElement {
  const section = document.createElement('section');
  section.className = 'place-histogram';

  const heading = document.createElement('h4');
  heading.textContent = HISTOGRAM_HEADING;

  const list = document.createElement('ol');
  list.className = 'place-histogram-list';

  // Scaled against the busiest month so a quiet place still shows relative shape. Guarded because
  // a place with no charted visit would otherwise divide by zero and produce `NaN%` widths.
  const busiest = buckets.reduce((max, bucket) => Math.max(max, bucket.visitCount), 0);

  for (const bucket of buckets) {
    const item = document.createElement('li');
    item.className = 'place-histogram-entry';

    const label = document.createElement('span');
    label.className = 'place-histogram-month';
    label.textContent = monthLabel(bucket.month);

    const track = document.createElement('span');
    track.className = 'place-histogram-track';
    const bar = document.createElement('span');
    bar.className = 'place-histogram-bar';
    bar.style.width = busiest === 0 ? '0%' : `${(bucket.visitCount / busiest) * 100}%`;
    track.append(bar);

    const count = document.createElement('span');
    count.className = 'place-histogram-count';
    count.textContent = visitCountLabel(bucket.visitCount);

    item.append(label, track, count);
    list.append(item);
  }

  section.append(heading, list);
  return section;
}

export interface PlaceDetail {
  place: PlaceRecord;
  /** Computed for the currently selected period. */
  stats: PlaceStats;
  period: Period;
  histogram: HistogramBucket[];
}

/** `null` renders the placeholder — the card is always on the page, empty until a place is picked. */
export function renderPlaceDetail(container: HTMLElement, detail: PlaceDetail | null): void {
  const section = document.createElement('section');
  section.className = 'place-detail';

  const heading = document.createElement('h2');
  heading.textContent = DETAIL_HEADING;
  section.append(heading);

  if (detail === null) {
    const empty = document.createElement('p');
    empty.className = 'place-detail-empty';
    empty.textContent = DETAIL_EMPTY_MESSAGE;
    section.append(empty);
    container.replaceChildren(section);
    return;
  }

  const { place, stats, period, histogram } = detail;

  const name = document.createElement('h3');
  name.className = 'place-detail-name';
  name.textContent = place.name;

  const meta = document.createElement('p');
  meta.className = 'place-detail-meta';
  meta.textContent = [place.category, place.address].join(' · ');

  const periodNote = document.createElement('p');
  periodNote.className = 'place-detail-period';
  periodNote.textContent = periodStatsHeading(period);

  section.append(name, meta, periodNote);

  if (stats.visitCount === 0) {
    const empty = document.createElement('p');
    empty.className = 'place-detail-empty-period';
    empty.textContent = NO_VISIT_IN_PERIOD_MESSAGE;
    section.append(empty);
  } else {
    const figures = document.createElement('dl');
    figures.className = 'place-detail-figures';
    figures.append(
      renderFigure(FIGURE_LABELS.visitCount, visitCountLabel(stats.visitCount)),
      renderFigure(FIGURE_LABELS.totalAmount, amountLabel(stats.totalAmount)),
      renderFigure(FIGURE_LABELS.averageAmount, amountLabel(stats.averageAmount)),
    );
    // Non-null whenever there was a visit; the guard keeps the type honest without inventing a date.
    if (stats.mostRecentVisit !== null) {
      figures.append(renderFigure(FIGURE_LABELS.mostRecentVisit, stats.mostRecentVisit));
    }
    section.append(figures);
  }

  section.append(renderHistogram(histogram));

  const link = document.createElement('a');
  link.className = 'place-detail-link';
  link.href = place.naverUrl;
  link.target = '_blank';
  // `noopener` denies the opened tab a handle back to this window; `noreferrer` keeps the
  // referrer off the outbound request. Neither costs anything here and both are the default
  // expectation for a `target="_blank"` link.
  link.rel = 'noopener noreferrer';
  link.textContent = NAVER_LINK_LABEL;
  section.append(link);

  container.replaceChildren(section);
}
