import type { PlacesDataset } from '../data/types';
import { computeTrendingPlaces } from '../stats/discovery';
import { LAST_YEAR_MONTH, type StatBasis } from '../stats/period';
import { TOP_PLACES_LIMIT, computeTopPlaces } from '../stats/top-places';
import { TRENDING_HEADING, renderTrendingPlaces } from './discovery';
import { PERIOD_ORDER, basisLabel } from './period-labels';
import { renderTopPlaces } from './top-places';

/**
 * The five discovery columns, side by side: 작년 같은 달, 최근 이용 변화, then the three ranked
 * windows widening from three months to a year.
 *
 * This replaced a single ranked list behind a 1m/6m/1y switch. Under the switch, comparing the
 * windows meant pressing a button and holding the previous list in memory; the comparison is the
 * question the page exists to answer, so the lists are now on screen at once and the reader's
 * eye does the comparing.
 *
 * 작년 같은 달 leads because it is the only column that is not about the recent past — it answers
 * "what were people using a year ago?", which is the question the widening windows beside it
 * cannot. It is a fixed calendar month, so its heading names the month rather than a span.
 *
 * No statistic is computed here. `computeTrendingPlaces` and `computeTopPlaces` own the numbers,
 * and `renderTrendingPlaces` / `renderTopPlaces` own the rows — this module owns the grid, the
 * headings, the row cap and the mobile tab switch, and nothing else.
 */

/** The key of the one column ordered by movement rather than by usage. */
export const TRENDING_COLUMN = 'trending';

export type ColumnKey = typeof TRENDING_COLUMN | StatBasis;

/**
 * How many rows each column shows.
 *
 * Uniform across the five on purpose: columns of different lengths read as a statement about the
 * columns ("there is more here") when they are only a statement about the cap. Anything held back
 * is counted on screen — the ranked columns name the rendered count in their heading, the trending
 * column prints `remainderLabel`.
 *
 * Aliased to the ranking module's own default rather than restated as `10`: two constants holding
 * one documented cap is one edit away from two different caps.
 */
export const COLUMN_LIMIT = TOP_PLACES_LIMIT;

/** Oldest window first, then movement, then the ranked windows widening from 3개월. */
export const COLUMN_ORDER: ColumnKey[] = [LAST_YEAR_MONTH, TRENDING_COLUMN, ...PERIOD_ORDER];

/**
 * A function rather than a record, because one of the labels is a date: the 작년 같은 달 column
 * names the month it covers, which only the dataset's anchor knows.
 */
export function columnLabel(column: ColumnKey, anchor: string): string {
  return column === TRENDING_COLUMN ? TRENDING_HEADING : basisLabel(column, anchor);
}

/**
 * The window a selection made from a given column was measured over, which is what the detail
 * dialog then states as its "…기준" line. Trending is measured over the recent month
 * (`docs/conventions.md` → Statistics Rules), so a place picked from it is shown 최근 1개월 figures
 * rather than a period the reader never chose.
 */
export function columnBasis(column: ColumnKey): StatBasis {
  return column === TRENDING_COLUMN ? '1m' : column;
}

/**
 * Only shown on narrow screens, where the five columns collapse to one; the group is `display:none`
 * from the tablet breakpoint up, at which point every column is on screen and there is nothing to
 * switch between.
 */
export const TAB_GROUP_LABEL = '목록 선택';

/**
 * States the rendered count in the heading, so a capped column never reads as the whole set. Same
 * shape as `topPlacesHeading`, which this replaces on the three ranked columns — there the subject
 * ("많이 이용한 곳") is what the heading names, here it is the window.
 *
 * Ranked columns only. The trending column is ordered by movement rather than by usage, so "TOP N"
 * would name a ranking it does not express — and it already states its cap the other way, through
 * `remainderLabel`.
 */
export function columnHeading(label: string, renderedCount: number): string {
  return renderedCount === 0 ? label : `${label} 상위 ${renderedCount}곳`;
}

/**
 * Flips `aria-pressed` and the grid's active column in place rather than re-rendering the tabs.
 *
 * Re-rendering would replace the button the user just activated and drop keyboard focus to the top
 * of the document — the failure every module in `src/ui/` is written to avoid.
 */
export function markActiveColumn(container: HTMLElement, active: ColumnKey): void {
  const grid = container.querySelector<HTMLElement>('.place-columns-grid');
  if (grid) grid.dataset['active'] = active;

  // Each column carries its own answer rather than the stylesheet comparing the grid's key against
  // the column's — CSS cannot do that, so the alternative is one selector pair per key, and the key
  // someone forgets to add is a column that never appears on a phone.
  for (const cell of container.querySelectorAll<HTMLElement>('.place-column')) {
    cell.dataset['active'] = String(cell.dataset['column'] === active);
  }

  for (const button of container.querySelectorAll<HTMLButtonElement>('.place-column-tab')) {
    button.setAttribute('aria-pressed', String(button.dataset['column'] === active));
  }
}

function renderTabs(
  active: ColumnKey,
  anchor: string,
  onSelect: (column: ColumnKey) => void,
): HTMLElement {
  const group = document.createElement('div');
  group.className = 'place-column-tabs';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', TAB_GROUP_LABEL);

  for (const column of COLUMN_ORDER) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'place-column-tab';
    button.dataset['column'] = column;
    button.textContent = columnLabel(column, anchor);
    button.setAttribute('aria-pressed', String(column === active));
    button.addEventListener('click', () => {
      onSelect(column);
    });
    group.append(button);
  }

  return group;
}

/**
 * How a re-render keeps the reader where they were.
 *
 * The lists are static once rendered — nothing on the page selects a period — but the global 업종
 * filter narrows the dataset they are computed from, so a kind change does rebuild all five. On
 * narrow screens only one column is on screen at a time, and rebuilding with the default active
 * column would silently move the reader from 1년 back to the first column. `active` carries their
 * tab across the rebuild; `onActiveChange` is how the caller learns of a switch it did not make.
 */
export interface PlaceColumnsOptions {
  active?: ColumnKey;
  onActiveChange?: (column: ColumnKey) => void;
}

/**
 * Renders every column once. Within one dataset the five lists never change — nothing on the page
 * selects a period any more — so a selection or a tab switch touches no list, and the row the
 * reader pressed keeps focus while the detail dialog opens over it.
 */
export function renderPlaceColumns(
  container: HTMLElement,
  dataset: PlacesDataset,
  onSelect: (placeId: string, basis: StatBasis) => void,
  options: PlaceColumnsOptions = {},
): void {
  const { active = COLUMN_ORDER[0]!, onActiveChange } = options;
  const section = document.createElement('section');
  section.className = 'place-columns';

  const grid = document.createElement('div');
  grid.className = 'place-columns-grid';

  for (const column of COLUMN_ORDER) {
    const cell = document.createElement('div');
    cell.className = 'place-column';
    cell.dataset['column'] = column;

    const basis = columnBasis(column);
    const label = columnLabel(column, dataset.updatedAt);
    const select = (placeId: string): void => {
      onSelect(placeId, basis);
    };

    if (column === TRENDING_COLUMN) {
      const trending = computeTrendingPlaces(dataset);
      renderTrendingPlaces(cell, trending, select, { heading: label, limit: COLUMN_LIMIT });
    } else {
      const top = computeTopPlaces(dataset, basis, COLUMN_LIMIT);
      renderTopPlaces(cell, top, select, columnHeading(label, top.entries.length));
    }

    grid.append(cell);
  }

  const tabs = renderTabs(active, dataset.updatedAt, (column) => {
    markActiveColumn(section, column);
    onActiveChange?.(column);
  });

  section.append(tabs, grid);
  container.replaceChildren(section);
  markActiveColumn(section, active);
}
