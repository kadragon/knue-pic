import type { RankedPlace, TopPlacesResult } from '../stats/top-places';
import { displayShortDate, renderKindBadge } from './place-labels';

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
 * How many rows a column shows before the reader asks for more, and how many each further page
 * adds.
 *
 * Ten is a screenful on a phone. The rest are not withheld — they are one scroll away — so this is
 * a pacing decision rather than the cap it replaced, and nothing about the data is claimed by it.
 */
export const COLUMN_PAGE_SIZE = 10;

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

export function visitCountLabel(visitCount: number): string {
  return `${visitCount}회 이용`;
}

export function mostRecentLabel(date: string): string {
  return `최근 이용 ${displayShortDate(date)}`;
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

  const figures = document.createElement('span');
  figures.className = 'top-place-figures';
  // `mostRecentVisit` is non-null for every ranked place: a place with no in-window visit is not
  // ranked at all. The fallback keeps the type honest without inventing a date.
  const parts = [visitCountLabel(entry.stats.visitCount)];
  if (entry.stats.mostRecentVisit !== null) {
    parts.push(mostRecentLabel(entry.stats.mostRecentVisit));
  }
  figures.textContent = parts.join(' · ');
  meta.append(figures);

  body.append(name, meta);
  item.append(badge, body);

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
 * `onSelect` is optional: without it the list renders exactly as before, with no controls.
 *
 * `heading` is overridden by `src/ui/place-columns.ts`, where four of these lists sit side by side
 * and the window each one reads — 최근 1개월 / 3개월 / 6개월 / 1년 — is the thing that tells them
 * apart.
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
  const { pageSize = COLUMN_PAGE_SIZE } = options;
  const section = document.createElement('section');
  section.className = 'top-places';

  const title = document.createElement('h2');
  title.textContent = heading;
  section.append(title);

  if (result.entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'top-places-empty';
    empty.textContent = EMPTY_MESSAGE;
    section.append(empty);
    container.replaceChildren(section);
    return;
  }

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

  function appendPage(): void {
    const next = result.entries.slice(rendered, rendered + pageSize);
    list.append(...next.map((entry) => renderEntry(entry, onSelect)));
    rendered += next.length;

    if (rendered >= total) {
      counter.textContent = allRenderedLabel(total);
      observer?.disconnect();
      observer = null;
      more.remove();
      return;
    }

    counter.textContent = renderedCountLabel(rendered, total);
    more.textContent = moreLabel(total - rendered);
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
  // The condition is "there are pages left", NOT "the button is in the document": every caller
  // renders into a detached subtree and attaches it afterwards (`place-columns.ts` builds all four
  // cells before appending the grid), so an `isConnected` check here is false for every column on
  // the page and the observer is never created. Observing a detached element is fine — it reports
  // nothing until the node is attached, then behaves normally.
  if (rendered < total && typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) appendPage();
    });
    observer.observe(more);
  }
}
