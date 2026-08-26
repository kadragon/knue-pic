import type { Period, PlaceRecord } from '../data/types';
import { histogramSpan, type MonthlyHistogram } from '../stats/histogram';
import type { PlaceStats } from '../stats/place-stats';
import { PERIOD_LABELS } from './period-labels';
import { displayShortDate, histogramSpanLabel, monthLabel, renderKindBadge } from './place-labels';

/**
 * The detail card for one selected place: a slot for the location map, the figures for the period
 * the place was picked from, a monthly visit histogram, and a link out to Naver Maps.
 *
 * Every number arrives already computed — `src/stats/place-stats.ts` and `src/stats/histogram.ts`
 * own them — so there is no second definition of a visit count on this screen. Strings are
 * exported for the banned-phrase test, and none of them frames the figures as a rating or as
 * spending oversight (`docs/conventions.md` → Framing Vocabulary).
 */

export const DETAIL_HEADING = '선택한 곳';

export const DETAIL_EMPTY_MESSAGE = '목록에서 장소를 선택하면 이용 횟수를 확인할 수 있습니다.';

/**
 * Names the span the bars actually cover. Derived from the buckets rather than fixed so the
 * heading can never state a span the chart does not draw.
 *
 * The months are spelled out instead of counted: `최근 12개월` reads as the 최근 1년 period button,
 * and the figures above this chart are counted over that window, which starts mid-month and so
 * covers a different span than the whole calendar months charted here (`histogramSpanLabel`).
 */
export function histogramHeading(buckets: MonthlyHistogram): string {
  return `${histogramSpanLabel(histogramSpan(buckets))} 이용 횟수`;
}

export const NAVER_LINK_LABEL = '네이버지도에서 보기';

export const NO_VISIT_IN_PERIOD_MESSAGE = '선택한 기간의 이용 기록이 없습니다.';

/**
 * The figure labels, exported like every other string in this module.
 *
 * They are exported so the UI tests can assert over every visible figure label.
 */
export const FIGURE_LABELS = {
  visitCount: '이용 횟수',
  mostRecentVisit: '최근 이용일',
} as const;

/** Names the window the figures below it were counted over — the one the place was picked from. */
export function periodStatsHeading(basis: Period): string {
  return `${PERIOD_LABELS[basis]} 기준`;
}

export function visitCountLabel(visitCount: number): string {
  return `${visitCount}회`;
}

/** `new URL` throws on anything it cannot parse, which is itself a rejection. */
function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
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
function renderHistogram(buckets: MonthlyHistogram): HTMLElement {
  const section = document.createElement('section');
  section.className = 'place-histogram';

  const heading = document.createElement('h4');
  // Read off the buckets rather than off the basis: the heading then cannot disagree with the bars
  // it sits above, whatever decided how many there are.
  heading.textContent = histogramHeading(buckets);

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
  /** Computed over `basis`'s window. */
  stats: PlaceStats;
  /** The window the place was picked from — whichever the selector had active, or the search's own. */
  basis: Period;
  histogram: MonthlyHistogram;
}

/** `null` renders the placeholder — the card is always on the page, empty until a place is picked. */
export function renderPlaceDetail(container: HTMLElement, detail: PlaceDetail | null): void {
  const section = document.createElement('section');
  section.className = 'place-detail';
  // Not in the tab order, but focusable programmatically: `bootstrap.ts` moves focus here after a
  // list selection so the change is announced and scrolled to instead of happening off-screen.
  section.tabIndex = -1;

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

  const { place, stats, basis, histogram } = detail;

  const name = document.createElement('h3');
  name.className = 'place-detail-name';
  name.textContent = place.name;

  const meta = document.createElement('p');
  meta.className = 'place-detail-meta';
  meta.append(renderKindBadge(place));
  const address = document.createElement('span');
  address.className = 'place-detail-address';
  address.textContent = place.address;
  meta.append(address);

  const periodNote = document.createElement('p');
  periodNote.className = 'place-detail-period';
  periodNote.textContent = periodStatsHeading(basis);

  // Left empty here on purpose: the card stays pure DOM over already-computed numbers, and the map
  // is the one view that needs a third-party script. `src/ui/detail-dialog.ts` fills this slot, so
  // a caller that has no map — or a test — renders the whole card without one.
  const mapSlot = document.createElement('div');
  mapSlot.className = 'place-detail-map';

  section.append(name, meta, mapSlot, periodNote);

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
    );
    // Non-null whenever there was a visit; the guard keeps the type honest without inventing a date.
    if (stats.mostRecentVisit !== null) {
      figures.append(renderFigure(FIGURE_LABELS.mostRecentVisit, displayShortDate(stats.mostRecentVisit)));
    }
    section.append(figures);
  }

  section.append(renderHistogram(histogram));

  // The only place a dataset string reaches an executable position in this app. `src/data/load.ts`
  // now rejects the whole file unless `naverUrl` is an https URL on a Naver host, so a
  // `javascript:` value never reaches this line — but the check stays, because the cost of being
  // wrong here is that value running in the page origin on click. A URL that is not `https:`
  // renders no link at all rather than an inert-looking one.
  if (isHttpsUrl(place.naverUrl)) {
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
  }

  container.replaceChildren(section);
}
