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

export const TOP_PLACES_HEADING = '많이 이용한 곳 TOP 10';

export const EMPTY_MESSAGE = '이 기간에는 이용 기록이 없습니다.';

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
function renderEntry(entry: RankedPlace): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'top-place';

  const badge = document.createElement('span');
  badge.className = 'top-place-rank';
  badge.textContent = String(entry.rank);

  const body = document.createElement('div');
  body.className = 'top-place-body';

  const name = document.createElement('p');
  name.className = 'top-place-name';
  name.textContent = entry.place.name;

  const meta = document.createElement('p');
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
    delta.setAttribute('aria-label', rankDeltaLabel(entry.rankDelta));
    item.append(delta);
  }

  return item;
}

export function renderTopPlaces(container: HTMLElement, result: TopPlacesResult): void {
  const section = document.createElement('section');
  section.className = 'top-places';

  const heading = document.createElement('h2');
  heading.textContent = TOP_PLACES_HEADING;
  section.append(heading);

  if (result.entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'top-places-empty';
    empty.textContent = EMPTY_MESSAGE;
    section.append(empty);
  } else {
    const list = document.createElement('ol');
    list.className = 'top-places-list';
    list.append(...result.entries.map(renderEntry));
    section.append(list);
  }

  container.replaceChildren(section);
}
