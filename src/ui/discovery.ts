import type { NewlySeenPlace, TrendingPlace } from '../stats/discovery';

/**
 * The 요즘 많이 가는 곳 and 새로 발견된 곳 sections. Takes what `src/stats/discovery.ts` already
 * computed and turns it into DOM — no counting happens here.
 *
 * Every user-facing string is exported so the banned-phrase test can import them
 * (`docs/conventions.md` → Framing Vocabulary). Both sections describe *usage*, never a
 * recommendation and never the spending the usage was derived from.
 */

/**
 * How many rows either discovery section shows.
 *
 * `computeTrendingPlaces` and `computeNewlySeenPlaces` return everything that qualifies — 12 and 29
 * rows against the published file at the time of writing — and two uncapped lists were most of the
 * page's height, stacked below every section that actually answers a question. The ranked list has
 * always capped itself at `TOP_PLACES_LIMIT`; these are secondary to it, so they cap harder.
 *
 * The cap is a display decision, not a statistical one: the stats modules still compute the full
 * set, and `remainderLabel` says on screen how much is not shown.
 */
export const DISCOVERY_LIMIT = 6;

export const TRENDING_HEADING = '요즘 많이 가는 곳';

/**
 * Both sections read fixed windows, so they do not move when the 1m/6m/1y selector changes. Saying
 * so on screen is what keeps a viewer who just switched to 최근 1년 from reading these lists as
 * year figures that failed to update.
 */
export const TRENDING_NOTE = '최근 1개월 이용 기준이며, 위의 기간 선택과 무관합니다.';

export const TRENDING_EMPTY_MESSAGE = '최근 1개월에 두 번 이상 이용한 곳이 없습니다.';

export const NEW_BADGE_TEXT = 'NEW';

/** The badge is two latin letters, so the fact it carries is spelled out for a screen reader. */
export const NEW_BADGE_LABEL = '이전 1개월에는 이용 기록이 없던 곳';

export const NEWLY_SEEN_HEADING = '새로 발견된 곳';

export const NEWLY_SEEN_NOTE = '최근 2개월 안에 첫 이용 기록이 생긴 곳이며, 기간 선택과 무관합니다.';

export const NEWLY_SEEN_EMPTY_MESSAGE = '최근 2개월에 새로 발견된 곳이 없습니다.';

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
 */
export function visitDeltaLabel(visitDelta: number): string {
  if (visitDelta === 0) return '이전 1개월과 같습니다';
  return visitDelta > 0
    ? `이전 1개월보다 ${visitDelta}회 늘었습니다`
    : `이전 1개월보다 ${-visitDelta}회 줄었습니다`;
}

export function firstVisitLabel(firstVisit: string): string {
  return `첫 이용 ${firstVisit}`;
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

/** Appends the remainder line when the section rendered fewer rows than it was given. */
function renderRemainder(section: HTMLElement, total: number): void {
  if (total <= DISCOVERY_LIMIT) return;

  const remainder = document.createElement('p');
  remainder.className = 'discovery-remainder';
  remainder.textContent = remainderLabel(total - DISCOVERY_LIMIT);
  section.append(remainder);
}

export function renderTrendingPlaces(
  container: HTMLElement,
  trending: TrendingPlace[],
  onSelect: (placeId: string) => void,
): void {
  const section = renderSection(TRENDING_HEADING, TRENDING_NOTE);

  if (trending.length === 0) {
    renderEmpty(section, TRENDING_EMPTY_MESSAGE);
    container.replaceChildren(section);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'discovery-list';

  for (const entry of trending.slice(0, DISCOVERY_LIMIT)) {
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
      movement.textContent = visitDeltaLabel(entry.visitDelta);
    }
    item.append(movement);
    list.append(item);
  }

  section.append(list);
  renderRemainder(section, trending.length);
  container.replaceChildren(section);
}

export function renderNewlySeenPlaces(
  container: HTMLElement,
  newlySeen: NewlySeenPlace[],
  onSelect: (placeId: string) => void,
): void {
  const section = renderSection(NEWLY_SEEN_HEADING, NEWLY_SEEN_NOTE);

  if (newlySeen.length === 0) {
    renderEmpty(section, NEWLY_SEEN_EMPTY_MESSAGE);
    container.replaceChildren(section);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'discovery-list';
  list.append(
    ...newlySeen.slice(0, DISCOVERY_LIMIT).map((entry) =>
      renderSelectableEntry(
        entry.place.name,
        [entry.place.category, firstVisitLabel(entry.firstVisit)].join(' · '),
        onSelect,
        entry.place.id,
      ),
    ),
  );

  section.append(list);
  renderRemainder(section, newlySeen.length);
  container.replaceChildren(section);
}
