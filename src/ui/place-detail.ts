import type { Period, PlaceRecord } from '../data/types';
import { histogramSpan, type MonthlyHistogram } from '../stats/histogram';
import { distanceBand, distanceFromCampusKm } from '../stats/distance';
import type { PlaceStats } from '../stats/place-stats';
import { addressRegion } from '../stats/short-address';
import { PERIOD_LABELS } from './period-labels';
import {
  campusDistanceLabel,
  displayShortDate,
  histogramSpanLabel,
  monthLabel,
  renderKindBadge,
  visitCountLabel,
} from './place-labels';

/**
 * The detail card for one selected place: a slot for the location map, the figures for the period
 * the place was picked from, a monthly visit histogram, and the links out to Naver Maps and
 * Kakao Map.
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

/**
 * The second map service, worded the same way as the first. Both labels name where the link goes
 * and nothing else: picking a different verb for one of them would read as a preference between
 * two services this dataset says nothing about (`docs/conventions.md` → Framing Vocabulary).
 */
export const KAKAO_LINK_LABEL = '카카오지도에서 보기';

/**
 * The distance badge, alongside the address rather than replacing it.
 *
 * The dialog is where a reader goes for the exact location, so the full address stays whole here
 * and the shortened form the list row carries (`src/ui/top-places.ts`) has no place on this screen.
 * The distance is the one thing the address does not tell them, so it is added rather than traded.
 */
export function distanceLabel(place: PlaceRecord): string {
  return campusDistanceLabel(distanceFromCampusKm(place));
}

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

export { visitCountLabel };

/** `new URL` throws on anything it cannot parse, which is itself a rejection. */
function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * The prefix the collector also uses (`collector/build_places.py` → `NAVER_SEARCH_PREFIX`). A
 * search link, not a place ID: neither side ever learns Naver's internal ID, so composing one
 * would be a fabrication.
 */
const NAVER_SEARCH_PREFIX = 'https://map.naver.com/p/search/';

/**
 * Kakao Map's own search URL. `https://map.kakao.com/link/search/<query>` answers 302 with exactly
 * this form, so the redirect target is what is written here rather than the hop to it.
 *
 * There is no `kakaoUrl` in the dataset and none is being added: the query below is composed from
 * `name` and `address`, which every published row already carries.
 */
const KAKAO_SEARCH_PREFIX = 'https://map.kakao.com/?q=';

/**
 * Where the Naver Maps link points, or `null` when no link should be rendered at all.
 *
 * The dataset's `naverUrl` searches the trade name alone, which finds the wrong branch whenever the
 * name is not unique nationwide — `신토불이` is the reported case. Prefixing where the place is,
 * from the address the dataset already carries, is a claim the data supports: `addressRegion` names
 * the shape (city, then narrowest unit), so the query reads `청주 강내면 신토불이`. It is composed
 * here rather than in the collector so all 504 rows get it without regenerating `data/places.json`.
 *
 * The composed URL is safe by construction — the prefix is a constant and the query is
 * percent-encoded — so `isHttpsUrl` guards the fallback alone, which is the one branch where a
 * dataset string reaches an executable position. On that branch a `naverUrl` that is not `https:`
 * renders no link rather than an inert-looking one; on the composed branch the field is not read at
 * all, so its scheme decides nothing.
 *
 * Every one of the 504 rows published today names an administrative unit, so the fallback is a
 * path the current dataset does not take. It is kept as the honest answer to an address shaped
 * unlike any of them — the same refusal `shortAddress` makes — not as dead code, and the guard
 * stays with it because that is the branch a dataset string would arrive on.
 */
function naverLinkHref(place: PlaceRecord): string | null {
  const region = addressRegion(place.address);
  if (region !== null) {
    return NAVER_SEARCH_PREFIX + encodeURIComponent(mapSearchQuery(region, place));
  }
  return isHttpsUrl(place.naverUrl) ? place.naverUrl : null;
}

/** The one query both services search, so the two links can never point at different places. */
function mapSearchQuery(region: string, place: PlaceRecord): string {
  return `${region} ${place.name}`;
}

/**
 * Where the Kakao Map link points, or `null` when no link should be rendered.
 *
 * Only the composed branch exists here. Naver's fallback reads `naverUrl` out of the dataset;
 * Kakao has no such field, and the one query that could stand in for it — the trade name alone —
 * is the nationwide-collision search that composing a region-prefixed query exists to avoid. An
 * address `addressRegion` refuses therefore yields no Kakao link rather than a link to the wrong
 * branch, which is the same refusal `shortAddress` makes.
 *
 * Safe by construction like the composed Naver href: a constant https prefix over a
 * percent-encoded query, with no dataset string reaching an executable position.
 */
function kakaoLinkHref(place: PlaceRecord): string | null {
  const region = addressRegion(place.address);
  if (region === null) {
    return null;
  }
  return KAKAO_SEARCH_PREFIX + encodeURIComponent(mapSearchQuery(region, place));
}

/**
 * One map link. Both services get the same class, and the service name rides a `data-` attribute
 * that exists for the tests to aim at rather than for the stylesheet to style by — the two are the
 * same control pointing at different places, and a card that drew one heavier than the other would
 * state a preference the usage data does not support. The attribute is targetable like any other,
 * so the equal weight is held by a rule in `src/ui/stylesheet-claims.test.ts` rather than by this
 * sentence: no rule in `src/styles.css` may select `[data-service]`.
 */
function renderMapLink(service: 'naver' | 'kakao', href: string, label: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'place-detail-link';
  link.dataset['service'] = service;
  link.href = href;
  link.target = '_blank';
  // `noopener` denies the opened tab a handle back to this window; `noreferrer` keeps the
  // referrer off the outbound request. Neither costs anything here and both are the default
  // expectation for a `target="_blank"` link.
  link.rel = 'noopener noreferrer';
  link.textContent = label;
  return link;
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

/** Text a screen reader reads but the column does not draw — the column is too narrow for it. */
function hiddenText(text: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'visually-hidden';
  span.textContent = text;
  return span;
}

/**
 * Each column carries its month and its count as text. A bar height alone would put the whole
 * chart behind sighted, precise-height perception — `docs/conventions.md` → Accessibility bans
 * conveying importance by visual channel alone, and the same reasoning covers a chart.
 *
 * Twelve columns share 328px at 360px width, so each draws only the month number and the count;
 * the year and the `월`/`회` units are still in the text, so every entry reads in full as
 * `2025년 10월 9회`. The year is drawn once where it starts — the first column and each January —
 * instead of on all twelve.
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

  buckets.forEach((bucket, index) => {
    const item = document.createElement('li');
    item.className = 'place-histogram-entry';
    // Same two-channel rule as the row sparkline: an empty month differs from a quiet one in
    // height as well as tone, so the stylesheet gives it a baseline rather than a floor.
    item.dataset['empty'] = String(bucket.visitCount === 0);

    // Split out of `monthLabel` rather than re-derived from the key, so the entry reads as the
    // label every other surface prints.
    const [yearPart = '', monthPart = ''] = monthLabel(bucket.month).split(' ');
    const label = document.createElement('span');
    label.className = 'place-histogram-month';
    const year = document.createElement('span');
    year.className = 'place-histogram-year';
    // A January next to the first column labels the new year itself; labelling both would draw
    // two years over each other, since each spills past its narrow column.
    const opensSpan = index === 0 && !buckets[1]?.month.endsWith('-01');
    year.dataset['start'] = String(opensSpan || monthPart === '1월');
    year.textContent = `${yearPart} `;
    label.append(year, monthPart.replace('월', ''), hiddenText('월'));

    const track = document.createElement('span');
    track.className = 'place-histogram-track';
    const bar = document.createElement('span');
    bar.className = 'place-histogram-bar';
    bar.style.height = busiest === 0 ? '0%' : `${(bucket.visitCount / busiest) * 100}%`;
    track.append(bar);

    const count = document.createElement('span');
    count.className = 'place-histogram-count';
    // The units are written here rather than sliced off the labels; the test pins both entries'
    // text to `monthLabel` and `visitCountLabel`, so a reworded label fails there, not silently.
    count.append(String(bucket.visitCount), hiddenText('회'));

    // One accessible phrase per entry. The drawn parts are split across flex items and
    // absolutely positioned units, which a screen reader may read as `10`, `월`, `9`, `회`; they are
    // hidden from it, and the stylesheet draws the count on top and the month under the axis.
    for (const drawn of [label, track, count]) {
      drawn.setAttribute('aria-hidden', 'true');
    }
    item.append(
      hiddenText(`${monthLabel(bucket.month)} ${visitCountLabel(bucket.visitCount)}`),
      label,
      track,
      count,
    );
    list.append(item);
  });

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

  // Two badges on one row, the address alone on the next. On one shared line the full address
  // wrapped at 360px and stranded its separator at the end of a line with the distance badge
  // dropped below it; with the badges together the address wraps on its own and needs no separator.
  const meta = document.createElement('p');
  meta.className = 'place-detail-meta';
  meta.append(renderKindBadge(place));

  const address = document.createElement('p');
  address.className = 'place-detail-address';
  address.textContent = place.address;

  const distance = document.createElement('span');
  distance.className = 'place-detail-distance';
  // The same band the ranked row carries, so a place is the same colour in the list the reader
  // came from and in the card they opened. The badge still spells the figure out; the band only
  // ever reaches the stylesheet.
  distance.dataset['band'] = distanceBand(distanceFromCampusKm(place));
  distance.textContent = distanceLabel(place);
  // No separating text node here: `.place-detail-meta` is a flex container, where a whitespace-only
  // run between items is not rendered at all — the gap comes from the container's own `gap`.
  meta.append(distance);

  const periodNote = document.createElement('p');
  periodNote.className = 'place-detail-period';
  periodNote.textContent = periodStatsHeading(basis);

  // Left empty here on purpose: the card stays pure DOM over already-computed numbers, and the map
  // is the one view that needs a third-party script. `src/ui/detail-dialog.ts` fills this slot, so
  // a caller that has no map — or a test — renders the whole card without one. Appended below the
  // histogram, next to the link out.
  const mapSlot = document.createElement('div');
  mapSlot.className = 'place-detail-map';

  // The figures come before the map: the number is what the reader opened the row for, and the
  // map — which may never arrive — answers the follow-up question, so it sits above the link out.
  section.append(name, meta, address, periodNote);

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

  section.append(renderHistogram(histogram), mapSlot);

  // The only place a dataset string reaches an executable position in this app — see
  // `naverLinkHref`, which owns the scheme check; `kakaoLinkHref` composes its href and reads no
  // dataset URL at all. `src/data/load.ts` now rejects the whole file
  // unless `naverUrl` is an https URL on a Naver host, so a `javascript:` value never reaches that
  // check — but it stays, because the cost of being wrong is that value running in the page origin
  // on click.
  const links: HTMLAnchorElement[] = [];
  const naverHref = naverLinkHref(place);
  if (naverHref !== null) {
    links.push(renderMapLink('naver', naverHref, NAVER_LINK_LABEL));
  }
  const kakaoHref = kakaoLinkHref(place);
  if (kakaoHref !== null) {
    links.push(renderMapLink('kakao', kakaoHref, KAKAO_LINK_LABEL));
  }
  if (links.length > 0) {
    // A wrapper rather than two siblings on the card: the pair shares one margin above it and one
    // gap between, so neither link owns the spacing of the other. It is omitted entirely when
    // there is no link, so an empty row never takes the margin.
    const linkRow = document.createElement('div');
    linkRow.className = 'place-detail-links';
    linkRow.append(...links);
    section.append(linkRow);
  }

  container.replaceChildren(section);
}
