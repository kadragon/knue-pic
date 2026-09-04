import type { Period, PlacesDataset } from '../data/types';
import { computeTopPlaces } from '../stats/top-places';
import { PERIOD_LABELS, PERIOD_ORDER } from './period-labels';
import { renderTopPlaces } from './top-places';

/**
 * One ranked list, and the period selector that decides which window it measures.
 *
 * This replaced a four-column grid that showed 최근 1개월 / 3개월 / 6개월 / 1년 side by side. Four
 * full rankings at once left every column too narrow to read and asked the reader to hold four
 * orderings in their head to get anything out of the comparison. The selector puts one list on
 * screen at full width, and the comparison the grid was reaching for now lives inside each row:
 * a monthly trend chart (`renderSparkline`) and the rank movement badge beside it.
 *
 * No statistic is computed here. `computeTopPlaces` owns the numbers and `renderTopPlaces` owns
 * the rows — this module owns the selector, the heading and nothing else.
 */

/** The order the selector lists its windows in: shortest first, so the reader scans widening. */
export const PERIOD_TABS: Period[] = PERIOD_ORDER;

/**
 * The window the page opens on.
 *
 * 최근 1개월 ranks off too few visits for the order to mean much, and 최근 1년 buries whatever
 * changed recently under a year of history. 최근 3개월 is the one that is both current and
 * populated, which is what a reader landing on the page is trying to see.
 */
export const DEFAULT_PERIOD: Period = '3m';

export function periodLabel(period: Period): string {
  return PERIOD_LABELS[period];
}

export const TAB_GROUP_LABEL = '기간 선택';

/**
 * The list's heading: the window, then what the list is. The pressed tab above it already reads
 * `최근 3개월`, so a heading of the bare window name repeated it; this one names the list.
 * `자주 찾은 곳` is the sanctioned discovery phrasing (`docs/conventions.md` → Framing Vocabulary).
 */
export function listHeading(period: Period): string {
  return `${periodLabel(period)} 동안 자주 찾은 곳`;
}

/**
 * Flips `aria-pressed` in place rather than re-rendering the selector.
 *
 * Re-rendering would replace the button the reader just activated and drop keyboard focus to the
 * top of the document — the failure every module in `src/ui/` is written to avoid. Only the list
 * beneath it is rebuilt, and it never holds focus at the moment of a switch.
 */
export function markActivePeriod(container: HTMLElement, active: Period): void {
  for (const button of container.querySelectorAll<HTMLButtonElement>('.period-tab')) {
    button.setAttribute('aria-pressed', String(button.dataset['period'] === active));
  }
}

function renderTabs(active: Period, onSelect: (period: Period) => void): HTMLElement {
  const group = document.createElement('div');
  group.className = 'period-tabs';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', TAB_GROUP_LABEL);

  for (const period of PERIOD_TABS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'period-tab';
    button.dataset['period'] = period;
    button.textContent = periodLabel(period);
    button.setAttribute('aria-pressed', String(period === active));
    button.addEventListener('click', () => {
      onSelect(period);
    });
    group.append(button);
  }

  return group;
}

/**
 * How a re-render keeps the reader where they were.
 *
 * The page-wide 업종 filter narrows the dataset the list is computed from, so a kind change rebuilds
 * it. Rebuilding with the default period would silently move the reader from the window they chose
 * back to 최근 3개월. `active` carries their selection across the rebuild; `onActiveChange` is how
 * the caller learns of a switch it did not make.
 */
export interface PlaceListOptions {
  active?: Period;
  onActiveChange?: (period: Period) => void;
}

/**
 * Renders the selector once and the list once per selected period.
 *
 * The list is computed over the *whole* ranking rather than a visible cap — `computeTopPlaces` is
 * called with no `limit`: `renderTopPlaces` pages through it as the reader scrolls, so a cap
 * applied here would be a ceiling the reader could never scroll past.
 */
export function renderPlaceList(
  container: HTMLElement,
  dataset: PlacesDataset,
  onSelect: (placeId: string, basis: Period) => void,
  options: PlaceListOptions = {},
): void {
  const { active = DEFAULT_PERIOD, onActiveChange } = options;
  const section = document.createElement('section');
  section.className = 'place-list';

  const cell = document.createElement('div');
  cell.className = 'place-list-body';

  function fill(period: Period): void {
    renderTopPlaces(
      cell,
      computeTopPlaces(dataset, period),
      (placeId) => {
        onSelect(placeId, period);
      },
      listHeading(period),
    );
  }

  const tabs = renderTabs(active, (period) => {
    markActivePeriod(section, period);
    fill(period);
    onActiveChange?.(period);
  });

  section.append(tabs, cell);
  container.replaceChildren(section);
  fill(active);
}
