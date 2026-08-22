import type { TrendingPlace } from '../stats/discovery';

/**
 * The 최근 뜨는 곳 list. Takes what `src/stats/discovery.ts` already computed and turns it into
 * DOM — no counting happens here.
 *
 * It is one of the four columns in `src/ui/place-columns.ts`, and the only one whose window is
 * fixed rather than chosen: the other three are ranked periods. The column owns the heading and the
 * row cap, because those are decisions about the grid, not about trending.
 *
 * Every user-facing string is exported so the banned-phrase test can import them
 * (`docs/conventions.md` → Framing Vocabulary). The list describes *usage*, never a recommendation
 * and never the spending the usage was derived from.
 */

export const TRENDING_HEADING = '최근 뜨는 곳';

/**
 * The column reads a fixed window while the three beside it read 1개월 / 6개월 / 1년, so the note
 * says which window this one is. Without it, a reader comparing the columns has no way to tell
 * what "뜨는" is measured over, and the list would read as an opinion rather than as a count.
 *
 * It states the sort, not a filter: `computeTrendingPlaces` admits every place with ≥2 visits in
 * the recent month and orders them by the *signed* change, so a place that fell is in the list too
 * — at the bottom, carrying a ▼. Two wordings were wrong before this one: "늘어난 곳" promised a
 * riser filter the stats module does not apply, and "변동이 큰 순" claimed ordering by magnitude,
 * which puts a 0 above a −1 and is falsifiable on the rendered page.
 */
export const TRENDING_NOTE = '최근 1개월에 두 번 이상 이용한 곳을, 이전 1개월 대비 많이 늘어난 순으로 보여줍니다.';

export const TRENDING_EMPTY_MESSAGE = '최근 1개월에 두 번 이상 이용한 곳이 없습니다.';

export const NEW_BADGE_TEXT = 'NEW';

/** The badge is two latin letters, so the fact it carries is spelled out for a screen reader. */
export const NEW_BADGE_LABEL = '이전 1개월에는 이용 기록이 없던 곳';

/** Shown only when the section is holding rows back, so the list never reads as the whole set. */
export function remainderLabel(hiddenCount: number): string {
  return `이 밖에 ${hiddenCount}곳이 더 있습니다.`;
}

export function recentVisitsLabel(recentVisits: number): string {
  return `최근 1개월 ${recentVisits}회`;
}

/**
 * Movement in visits, never a ratio: `src/stats/discovery.ts` omits the delta entirely for a place
 * with no prior-month visit, and this function is never called for one.
 *
 * This is the spoken form. In a column the width of a quarter screen the sentence wrapped to three
 * lines and pushed the next row off the fold, so the row renders `visitDeltaText` and carries this
 * as its label — the same split `rankDeltaLabel` / `rankDeltaText` makes in `top-places.ts`.
 */
export function visitDeltaLabel(visitDelta: number): string {
  if (visitDelta === 0) return '이전 1개월과 같습니다';
  return visitDelta > 0
    ? `이전 1개월보다 ${visitDelta}회 늘었습니다`
    : `이전 1개월보다 ${-visitDelta}회 줄었습니다`;
}

/** The glyph form. It says nothing on its own, which is why `visitDeltaLabel` always accompanies it. */
export function visitDeltaText(visitDelta: number): string {
  if (visitDelta === 0) return '–';
  return visitDelta > 0 ? `▲${visitDelta}` : `▼${-visitDelta}`;
}

/**
 * A native `<button>` per entry, so every list on the page opens the detail card the same way and
 * is reachable by keyboard with no ARIA (`docs/conventions.md` → Accessibility).
 */
function renderSelectableEntry(
  name: string,
  meta: string,
  onSelect: (placeId: string) => void,
  placeId: string,
): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'discovery-place';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'place-select';
  button.dataset['placeId'] = placeId;
  button.addEventListener('click', () => {
    onSelect(placeId);
  });

  const nameLine = document.createElement('span');
  nameLine.className = 'place-select-name';
  nameLine.textContent = name;

  const metaLine = document.createElement('span');
  metaLine.className = 'place-select-meta';
  metaLine.textContent = meta;

  button.append(nameLine, metaLine);
  item.append(button);
  return item;
}

function renderSection(heading: string, note: string): HTMLElement {
  const section = document.createElement('section');
  section.className = 'discovery';

  const title = document.createElement('h2');
  title.textContent = heading;

  const subtitle = document.createElement('p');
  subtitle.className = 'discovery-note';
  subtitle.textContent = note;

  section.append(title, subtitle);
  return section;
}

function renderEmpty(section: HTMLElement, message: string): void {
  const empty = document.createElement('p');
  empty.className = 'discovery-empty';
  empty.textContent = message;
  section.append(empty);
}

/** Appends the remainder line when the list rendered fewer rows than it was given. */
function renderRemainder(section: HTMLElement, total: number, limit: number): void {
  if (total <= limit) return;

  const remainder = document.createElement('p');
  remainder.className = 'discovery-remainder';
  remainder.textContent = remainderLabel(total - limit);
  section.append(remainder);
}

export interface TrendingListOptions {
  /** The column's own heading, which states the row cap — see `src/ui/place-columns.ts`. */
  heading: string;
  /** How many rows to render; the rest are counted in the remainder line, never dropped silently. */
  limit: number;
}

export function renderTrendingPlaces(
  container: HTMLElement,
  trending: TrendingPlace[],
  onSelect: (placeId: string) => void,
  options: TrendingListOptions,
): void {
  const { heading, limit } = options;
  const section = renderSection(heading, TRENDING_NOTE);

  if (trending.length === 0) {
    renderEmpty(section, TRENDING_EMPTY_MESSAGE);
    container.replaceChildren(section);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'discovery-list';

  for (const entry of trending.slice(0, limit)) {
    const item = renderSelectableEntry(
      entry.place.name,
      [entry.place.category, recentVisitsLabel(entry.recentVisits)].join(' · '),
      onSelect,
      entry.place.id,
    );

    // `visitDelta` is null exactly when the place is new to the recent month. Rendering the badge
    // instead of a number is the whole point of that omission — see `TrendingPlace.visitDelta`.
    const movement = document.createElement('span');
    if (entry.visitDelta === null) {
      movement.className = 'discovery-new';
      movement.textContent = NEW_BADGE_TEXT;
      movement.setAttribute('role', 'img');
      movement.setAttribute('aria-label', NEW_BADGE_LABEL);
    } else {
      movement.className = 'discovery-delta';
      movement.dataset['direction'] =
        entry.visitDelta > 0 ? 'up' : entry.visitDelta < 0 ? 'down' : 'same';
      movement.textContent = visitDeltaText(entry.visitDelta);
      // `role="img"` is what lets a bare `<span>` be named: WAI-ARIA 1.2 prohibits naming an
      // element with the implicit `generic` role, so `aria-label` alone would leave a screen reader
      // announcing the glyph — the same reasoning as `.top-place-delta`.
      movement.setAttribute('role', 'img');
      movement.setAttribute('aria-label', visitDeltaLabel(entry.visitDelta));
    }
    item.append(movement);
    list.append(item);
  }

  section.append(list);
  renderRemainder(section, trending.length, limit);
  container.replaceChildren(section);
}
