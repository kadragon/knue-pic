import { histogramSpan, type HistogramSpan, type MonthlyHistogram } from '../stats/histogram';
import { DISTANCE_BANDS, distanceBand, distanceFromCampusKm } from '../stats/distance';
import type { RankedPlace, TopPlacesResult } from '../stats/top-places';
import {
  campusDistanceLabel,
  distanceBandLabel,
  histogramSpanLabel,
  monthLabel,
  renderKindBadge,
  shortAddress,
} from './place-labels';

/**
 * The ranked list view. Takes the numbers `src/stats/top-places.ts` already computed and turns them
 * into DOM — no statistic is derived here, so there is no second, subtly different definition of a
 * visit count anywhere in the app.
 *
 * Every user-facing string in this module is exported. `docs/conventions.md` → Framing Vocabulary
 * bans recommendation and surveillance wording, and a banned-phrase test can only assert over
 * strings it can import.
 */

/**
 * The heading no longer counts anything: the list grows as the reader scrolls, so a number in the
 * heading would be stale the moment it did. What is on screen and what is held back are stated
 * together, once, by the counter under the list.
 */
export function topPlacesHeading(): string {
  return '많이 이용한 곳';
}

export const EMPTY_MESSAGE = '이 기간에는 이용 기록이 없습니다.';

/**
 * How many rows the list shows before the reader asks for more, and how many each further page
 * adds.
 *
 * Ten is a screenful on a phone. The rest are not withheld — they are one scroll away — so this is
 * a pacing decision rather than the cap it replaced, and nothing about the data is claimed by it.
 */
export const LIST_PAGE_SIZE = 10;

/** States both halves — what is rendered and what the window actually ranked. */
export function renderedCountLabel(rendered: number, total: number): string {
  return `${total}곳 중 ${rendered}곳 표시`;
}

export function allRenderedLabel(total: number): string {
  return `${total}곳 모두 표시`;
}

export function moreLabel(remaining: number): string {
  return `${remaining}곳 더 보기`;
}

/**
 * Spoken form of the rank movement.
 *
 * Says "계단 위/아래" rather than naming a rating or a ranking quality — `순위가 높은 좋은 집` is
 * banned framing, and the movement itself is a plain fact about the list.
 */
export function rankDeltaLabel(rankDelta: number): string {
  if (rankDelta === 0) return '직전 기간과 같은 자리';
  return rankDelta > 0 ? `직전 기간보다 ${rankDelta}계단 상승` : `직전 기간보다 ${-rankDelta}계단 하락`;
}

function rankDeltaText(rankDelta: number): string {
  if (rankDelta === 0) return '–';
  return rankDelta > 0 ? `▲${rankDelta}` : `▼${-rankDelta}`;
}

/**
 * Spoken form of the whole trend, month by month.
 *
 * Every bucket is named — including the empty ones. The bars themselves are the only other carrier
 * of this series and they convey it by height alone, which `docs/conventions.md` → Accessibility
 * bans as a sole channel; dropping the quiet months from the label would also turn an interrupted
 * run into a steady one, the same distortion `computeMonthlyHistogram` keeps zero buckets to avoid.
 */
export function sparklineLabel(buckets: MonthlyHistogram): string {
  const months = buckets
    .map((bucket) => `${monthLabel(bucket.month)} ${bucket.visitCount}회`)
    .join(', ');
  return `${histogramSpanLabel(histogramSpan(buckets))} 월별 이용: ${months}`;
}

/**
 * The sighted reader's counterpart to `sparklineLabel`'s span — stated once for the list.
 *
 * The bars carry no period claim of their own, so the only thing naming their span is their
 * adjacency to the `N회 이용` figure, which is counted over the *selected* window. Those two spans
 * are not the same (`histogramSpanLabel`), so the row would otherwise invite a reader to sum the
 * bars and find less than the figure beside them. Per list rather than per row: every entry's
 * buckets come from the same anchor and month count, so a copy on each row would repeat one fact
 * as many times as there are places.
 *
 * Takes the span itself, not a row's buckets: it is the *list's* claim, and deriving it from one
 * row would label every row's bars with that row's span the moment a caller assembled a result
 * whose entries were not all charted together.
 */
export function trendSpanNote(span: HistogramSpan): string {
  return `월별 막대는 ${histogramSpanLabel(span)} 기준`;
}

/**
 * Names the colours the distance badges are drawn in.
 *
 * `색` rather than a verb: the caption states what the swatches are, and the swatch beside each
 * range is the only thing that has to be read as a colour.
 */
export const DISTANCE_LEGEND_CAPTION = '거리 색';

/**
 * The legend for the distance badges — one swatch per band, each labelled with its own range.
 *
 * Rendered once above the list rather than repeated on a row, for the same reason `trendSpanNote`
 * is: it is a fact about the list's encoding, not about any place. The ranges come from
 * `distanceBandLabel`, which derives them from `DISTANCE_BANDS`, so the legend cannot drift from
 * the classifier that colours the rows.
 *
 * Every swatch carries its range as text. The colour is the scanning aid and the words are the
 * meaning — `docs/conventions.md` → Accessibility, the same rule the 업종 badge follows.
 */
export function renderDistanceLegend(): HTMLElement {
  const legend = document.createElement('p');
  legend.className = 'top-places-distance-legend';

  const caption = document.createElement('span');
  caption.className = 'top-places-distance-legend-caption';
  caption.textContent = DISTANCE_LEGEND_CAPTION;
  legend.append(caption);

  for (const { band } of DISTANCE_BANDS) {
    const item = document.createElement('span');
    item.className = 'top-places-distance-legend-item';
    item.dataset['band'] = band;
    item.textContent = distanceBandLabel(band);
    legend.append(item);
  }

  return legend;
}

/**
 * The row's trend bars: one bar per calendar month, oldest at the left.
 *
 * Heights are scaled against the busiest month of *this place* rather than of the list, so a quiet
 * place still shows its own shape — the same choice the detail card's chart makes. The comparison
 * the bars invite is therefore within a row, never across rows, and no number is claimed by them:
 * the figures line beside them states the counts the ranking actually used.
 *
 * `role="img"` is what lets the label reach a screen reader. A bare `<span>` has the implicit role
 * `generic`, which WAI-ARIA 1.2 prohibits naming, so `aria-label` alone would be dropped and the
 * series would exist for sighted readers only.
 */
export function renderSparkline(buckets: MonthlyHistogram): HTMLElement {
  const chart = document.createElement('span');
  chart.className = 'top-place-trend';
  chart.setAttribute('role', 'img');
  chart.setAttribute('aria-label', sparklineLabel(buckets));

  // Guarded: a place whose charted months are all empty would otherwise divide by zero and write
  // `NaN%` heights. It can happen: ranking requires an in-window visit, but the 1년 window opens
  // mid-month — `(anchor − 12 months, anchor]` — while the first bar is a whole calendar month
  // later, so a place ranked solely on a visit in that sliver charts twelve zeros. The note above
  // the list is what keeps that from reading as a contradiction of the figure beside it.
  const busiest = buckets.reduce((max, bucket) => Math.max(max, bucket.visitCount), 0);

  for (const bucket of buckets) {
    const bar = document.createElement('span');
    bar.className = 'top-place-trend-bar';
    // A month with no visit keeps its slot and renders as the track alone, so the gap is visible
    // as a gap rather than as a missing bar the eye closes up.
    bar.dataset['empty'] = String(bucket.visitCount === 0);
    bar.style.height = busiest === 0 ? '0%' : `${(bucket.visitCount / busiest) * 100}%`;
    chart.append(bar);
  }

  return chart;
}

/**
 * The rank badge carries the number as text, not as a colour or a size — marker and list importance
 * must never be conveyed by colour alone (`docs/conventions.md` → Accessibility). The 업종 badge
 * beside the metadata follows the same rule: it spells its category out.
 */
function renderEntry(entry: RankedPlace, onSelect?: (placeId: string) => void): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'top-place';

  const badge = document.createElement('span');
  badge.className = 'top-place-rank';
  badge.textContent = String(entry.rank);

  // A native `<button>` when the list is wired to the detail card, a plain `<div>` when it is not:
  // a control that does nothing is worse than no control, and it would still take a tab stop.
  const body = document.createElement(onSelect ? 'button' : 'div');
  body.className = 'top-place-body';
  if (body instanceof HTMLButtonElement && onSelect) {
    body.type = 'button';
    body.dataset['placeId'] = entry.place.id;
    body.addEventListener('click', () => {
      onSelect(entry.place.id);
    });
  }

  // `<span>`, not `<p>`: when `onSelect` is supplied the body is a `<button>`, whose content model
  // admits phrasing content only. `styles.css` gives both spans `display: block` so the row looks
  // identical either way — the same shape `.place-select` uses in `search.ts`.
  const name = document.createElement('span');
  name.className = 'top-place-name';
  name.textContent = entry.place.name;

  const meta = document.createElement('span');
  meta.className = 'top-place-meta';
  meta.append(renderKindBadge(entry.place));

  const location = document.createElement('span');
  location.className = 'top-place-location';
  // Two elements and a space between them. The line has to be able to wrap between the district
  // and the distance at 360px, and the distance must never break inside itself — `거리` above its
  // own `1.2km` reads as a stray word. The separating space is a text node of the *parent*, not
  // the head of the distance: `white-space: nowrap` suppresses break opportunities inside the
  // element it is on, including a leading space, so a space carried there would leave the whole
  // line unbreakable. The district keeps ordinary wrapping — an address is prose and may break.
  const district = document.createElement('span');
  district.className = 'top-place-district';
  // The dot trails the token it follows rather than leading the next one: a separator at the head
  // of a wrapped line reads as a bullet, and the eye looks for a list that is not there. The space
  // before it is non-breaking, or the line breaks between them and the dot leads the next line
  // after all.
  district.textContent = `${shortAddress(entry.place.address)}\u00A0·`;
  const distance = document.createElement('span');
  distance.className = 'top-place-distance';
  const km = distanceFromCampusKm(entry.place);
  // The band is a `data-` attribute, never the text: the stylesheet reads it for the badge colour
  // while the figure below stays the only thing that states how far the place actually is.
  distance.dataset['band'] = distanceBand(km);
  distance.textContent = campusDistanceLabel(km);
  location.append(district, ' ', distance);
  meta.append(location);

  body.append(name, meta);
  item.append(badge, body);
  // A sibling of the button, never a child. The accessible name of a `<button>` is computed from
  // its contents, so nesting the chart here would append twelve months of label text to the name
  // of every row — the same reason the rank-delta badge below sits outside it.
  item.append(renderSparkline(entry.histogram));

  // Omitted, not zero: `rankDelta` is null when the prior window is outside the retained range or
  // the place was not in it. Rendering nothing is the whole point of that distinction.
  if (entry.rankDelta !== null) {
    const delta = document.createElement('span');
    delta.className = 'top-place-delta';
    delta.dataset['direction'] = entry.rankDelta > 0 ? 'up' : entry.rankDelta < 0 ? 'down' : 'same';
    delta.textContent = rankDeltaText(entry.rankDelta);
    // `role="img"` is what makes the label reach a screen reader: WAI-ARIA 1.2 prohibits naming a
    // bare `<span>` (implicit role `generic`), so `aria-label` alone is nonconforming and browse
    // mode may announce only the glyph — `▲3`, or a bare `–` that says nothing. `img` permits
    // name-from-author and replaces the glyph in the accessibility tree. The movement is carried
    // nowhere else, so losing the label loses the fact.
    delta.setAttribute('role', 'img');
    delta.setAttribute('aria-label', rankDeltaLabel(entry.rankDelta));
    item.append(delta);
  }

  return item;
}

export interface TopPlacesOptions {
  /** Rows in the first page, and in every page after it. */
  pageSize?: number;
}

/**
 * The observer currently watching each container's sentinel.
 *
 * A container is re-rendered whenever the page-wide 업종 filter narrows the dataset or the reader
 * selects another period, and an `IntersectionObserver` holds its target alive: without this,
 * every one of those changes left an observer watching a detached button that retained the whole
 * previous list. Keyed on the container rather than returned as a disposer because the caller
 * replaces the container's children and has no teardown hook to call one from.
 */
const sentinelObservers = new WeakMap<HTMLElement, IntersectionObserver>();

/**
 * `onSelect` is optional: without it the list renders exactly as before, with no controls.
 *
 * `heading` is overridden by `src/ui/place-list.ts`, which names the window the reader selected —
 * 최근 1개월 / 3개월 / 6개월 / 1년 — so the heading always agrees with the pressed period button.
 *
 * The list is paged rather than capped: `pageSize` rows are rendered, and the reader gets the rest
 * by scrolling the button into view or by pressing it. Both paths call the same `appendPage`, so
 * a reader who cannot generate a scroll — a keyboard or screen-reader user, or a browser without
 * `IntersectionObserver` — is never stranded on the first page.
 */
export function renderTopPlaces(
  container: HTMLElement,
  result: TopPlacesResult,
  onSelect?: (placeId: string) => void,
  heading: string = topPlacesHeading(),
  options: TopPlacesOptions = {},
): void {
  const { pageSize = LIST_PAGE_SIZE } = options;
  const section = document.createElement('section');
  section.className = 'top-places';

  const title = document.createElement('h2');
  title.textContent = heading;
  section.append(title);

  // Before either branch replaces the container's children, not just before the paged one. The
  // same container is re-rendered whenever the reader selects another window, so a switch from a
  // paged window to an empty one used to return below with the previous observer still registered,
  // watching a `더 보기` button that had just been detached and retaining the whole previous list.
  sentinelObservers.get(container)?.disconnect();
  sentinelObservers.delete(container);

  if (result.entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'top-places-empty';
    empty.textContent = EMPTY_MESSAGE;
    section.append(empty);
    container.replaceChildren(section);
    return;
  }

  // After the empty-state return, so a list with no rows states no span: there are no bars to
  // name. Read from the result's own `chartedSpan` rather than off the first row, so the caption
  // states the window the result was charted over instead of whatever the top row happens to cover.
  const note = document.createElement('p');
  note.className = 'top-places-trend-note';
  note.textContent = trendSpanNote(result.chartedSpan);
  section.append(note);

  // After the same return, and for the same reason: an empty list has no badge to explain.
  section.append(renderDistanceLegend());

  const total = result.entries.length;
  const list = document.createElement('ol');
  list.className = 'top-places-list';

  const footer = document.createElement('div');
  footer.className = 'top-places-more';

  // Created once and only its text rewritten: a live region replaced on every page announces
  // nothing, so a screen-reader user would never hear that more rows arrived.
  const counter = document.createElement('p');
  counter.className = 'top-places-count';
  counter.setAttribute('aria-live', 'polite');
  counter.setAttribute('aria-atomic', 'true');

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'top-places-more-button';

  let rendered = 0;
  let observer: IntersectionObserver | null = null;

  /**
   * Moves focus off the button before it is removed.
   *
   * Activating 더 보기 on the last page destroys the element that has focus, and a detached
   * `activeElement` drops the caret to the top of the document — the reader is thrown to the page
   * header having just asked for the rest of the list. Focus lands on the first row this page
   * added, which is where they were reading; with no `onSelect` there is no button in the list to
   * take it, so the counter does, and it says what just happened.
   */
  function keepFocusInList(firstIndexOfPage: number): void {
    if (document.activeElement !== more) return;

    const row = list.children[firstIndexOfPage];
    const target = row?.querySelector<HTMLElement>('button.top-place-body');
    if (target) {
      target.focus();
      return;
    }
    counter.tabIndex = -1;
    counter.focus();
  }

  function appendPage(): void {
    const firstIndexOfPage = rendered;
    const next = result.entries.slice(rendered, rendered + pageSize);
    list.append(...next.map((entry) => renderEntry(entry, onSelect)));
    rendered += next.length;

    if (rendered >= total) {
      counter.textContent = allRenderedLabel(total);
      keepFocusInList(firstIndexOfPage);
      observer?.disconnect();
      observer = null;
      sentinelObservers.delete(container);
      more.remove();
      return;
    }

    counter.textContent = renderedCountLabel(rendered, total);
    more.textContent = moreLabel(total - rendered);

    // Re-arm: `IntersectionObserver` reports a *transition*, so a sentinel that stays on screen
    // after a page is appended — a tall viewport, or ten new rows that do not fill it —
    // emits no second entry and auto-paging stalls with the button still in view. Unobserving and
    // observing again forces a fresh initial report against the new layout.
    if (observer) {
      observer.unobserve(more);
      observer.observe(more);
    }
  }

  more.addEventListener('click', appendPage);

  footer.append(counter, more);
  section.append(list, footer);
  container.replaceChildren(section);

  appendPage();

  // The button is the sentinel: it sits exactly where the next page belongs, and it is removed the
  // moment there is nothing left to load, so there is no stray node to observe. Guarded because
  // jsdom — and any browser without the API — has no `IntersectionObserver`; there the button is
  // the only way through, which is why it is a real control rather than an empty marker div.
  //
  // The condition is "there are pages left", NOT "the button is in the document". Observing a
  // detached element is harmless — the observer reports nothing until the node is attached, then
  // behaves normally — while an `isConnected` gate is false for any caller that builds its subtree
  // before attaching it, and silently leaves that list with no auto-paging at all. The invariant is
  // what the guard rests on; do not re-derive it from whichever caller happens to exist today.
  if (rendered < total && typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) appendPage();
    });
    observer.observe(more);
    sentinelObservers.set(container, observer);
  }
}
