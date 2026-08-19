import type { RankedPlace, TopPlacesResult } from '../stats/top-places';

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
 * The heading counts what the list actually renders. `computeTopPlaces` takes a `limit`, and a
 * short window routinely ranks fewer places than that limit, so a fixed "TOP 10" would name a
 * number the page does not show. With nothing ranked there is no number to name and the empty
 * message carries the explanation.
 */
export function topPlacesHeading(renderedCount: number): string {
  return renderedCount === 0 ? '많이 이용한 곳' : `많이 이용한 곳 TOP ${renderedCount}`;
}

export const EMPTY_MESSAGE = '이 기간에는 이용 기록이 없습니다.';

/**
 * Shown when `priorWindowComplete` is false. Without it the default 1y view — the one window whose
 * prior period is never retained — would show no movement indicators at all, and the absence would
 * read as "nothing moved" rather than "there is nothing to compare against".
 */
export const NO_COMPARISON_MESSAGE = '이전 기간 자료가 없어 변동은 표시하지 않습니다.';

export function visitCountLabel(visitCount: number): string {
  return `이용횟수 ${visitCount}회`;
}

export function mostRecentLabel(date: string): string {
  return `최근 이용 ${date}`;
}

/**
 * Spoken form of the rank movement.
 *
 * Says "계단 위/아래" rather than naming a rating or a ranking quality — `순위가 높은 좋은 집` is
 * banned framing, and the movement itself is a plain fact about the list.
 */
export function rankDeltaLabel(rankDelta: number): string {
  if (rankDelta === 0) return '이전 기간과 같은 자리';
  return rankDelta > 0 ? `이전 기간보다 ${rankDelta}계단 위` : `이전 기간보다 ${-rankDelta}계단 아래`;
}

function rankDeltaText(rankDelta: number): string {
  if (rankDelta === 0) return '–';
  return rankDelta > 0 ? `▲${rankDelta}` : `▼${-rankDelta}`;
}

/**
 * The rank badge carries the number as text, not as a colour or a size — marker and list importance
 * must never be conveyed by colour alone (`docs/conventions.md` → Accessibility).
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
  // identical either way — the same shape `.place-select` uses in `discovery.ts` and `search.ts`.
  const name = document.createElement('span');
  name.className = 'top-place-name';
  name.textContent = entry.place.name;

  const meta = document.createElement('span');
  meta.className = 'top-place-meta';
  // `mostRecentVisit` is non-null for every ranked place: a place with no in-window visit is not
  // ranked at all. The fallback keeps the type honest without inventing a date.
  const parts = [entry.place.category, visitCountLabel(entry.stats.visitCount)];
  if (entry.stats.mostRecentVisit !== null) {
    parts.push(mostRecentLabel(entry.stats.mostRecentVisit));
  }
  meta.textContent = parts.join(' · ');

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

/** `onSelect` is optional: without it the list renders exactly as before, with no controls. */
export function renderTopPlaces(
  container: HTMLElement,
  result: TopPlacesResult,
  onSelect?: (placeId: string) => void,
): void {
  const section = document.createElement('section');
  section.className = 'top-places';

  const heading = document.createElement('h2');
  heading.textContent = topPlacesHeading(result.entries.length);
  section.append(heading);

  if (result.entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'top-places-empty';
    empty.textContent = EMPTY_MESSAGE;
    section.append(empty);
  } else {
    if (!result.priorWindowComplete) {
      const note = document.createElement('p');
      note.className = 'top-places-note';
      note.textContent = NO_COMPARISON_MESSAGE;
      section.append(note);
    }

    const list = document.createElement('ol');
    list.className = 'top-places-list';
    list.append(...result.entries.map((entry) => renderEntry(entry, onSelect)));
    section.append(list);
  }

  container.replaceChildren(section);
}
