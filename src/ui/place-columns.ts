import type { Period, PlacesDataset } from '../data/types';
import { computeTrendingPlaces } from '../stats/discovery';
import { TOP_PLACES_LIMIT, computeTopPlaces } from '../stats/top-places';
import { TRENDING_HEADING, renderTrendingPlaces } from './discovery';
import { PERIOD_LABELS, PERIOD_ORDER } from './period-labels';
import { renderTopPlaces } from './top-places';

/**
 * The four discovery columns, side by side: 최근 뜨는 곳, then the three ranked windows.
 *
 * This replaced a single ranked list behind a 1m/6m/1y switch. Under the switch, comparing the
 * windows meant pressing a button and holding the previous list in memory; the comparison is the
 * question the page exists to answer, so the four lists are now on screen at once and the reader's
 * eye does the comparing.
 *
 * No statistic is computed here. `computeTrendingPlaces` and `computeTopPlaces` own the numbers,
 * and `renderTrendingPlaces` / `renderTopPlaces` own the rows — this module owns the grid, the
 * headings, the row cap and the mobile tab switch, and nothing else.
 */

/** The key of the one column whose window is fixed rather than ranked. */
export const TRENDING_COLUMN = 'trending';

export type ColumnKey = typeof TRENDING_COLUMN | Period;

/**
 * How many rows each column shows.
 *
 * Uniform across the four on purpose: columns of different lengths read as a statement about the
 * columns ("there is more here") when they are only a statement about the cap. Anything held back
 * is counted on screen — the ranked columns name the rendered count in their heading, the trending
 * column prints `remainderLabel`.
 *
 * Aliased to the ranking module's own default rather than restated as `10`: two constants holding
 * one documented cap is one edit away from two different caps.
 */
export const COLUMN_LIMIT = TOP_PLACES_LIMIT;

/** Trending first: it is the only column about movement, and the three beside it widen from 1개월. */
export const COLUMN_ORDER: ColumnKey[] = [TRENDING_COLUMN, ...PERIOD_ORDER];

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  [TRENDING_COLUMN]: TRENDING_HEADING,
  ...PERIOD_LABELS,
};

/**
 * The window a selection made from a given column was measured over, which is what the detail
 * dialog then states as its "…기준" line. Trending is measured over the recent month
 * (`docs/conventions.md` → Statistics Rules), so a place picked from it is shown 최근 1개월 figures
 * rather than a period the reader never chose.
 */
export function columnPeriod(column: ColumnKey): Period {
  return column === TRENDING_COLUMN ? '1m' : column;
}

/**
 * Only shown on narrow screens, where the four columns collapse to one; the group is `display:none`
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
  return renderedCount === 0 ? label : `${label} TOP ${renderedCount}`;
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

  for (const button of container.querySelectorAll<HTMLButtonElement>('.place-column-tab')) {
    button.setAttribute('aria-pressed', String(button.dataset['column'] === active));
  }
}

function renderTabs(active: ColumnKey, onSelect: (column: ColumnKey) => void): HTMLElement {
  const group = document.createElement('div');
  group.className = 'place-column-tabs';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', TAB_GROUP_LABEL);

  for (const column of COLUMN_ORDER) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'place-column-tab';
    button.dataset['column'] = column;
    button.textContent = COLUMN_LABELS[column];
    button.setAttribute('aria-pressed', String(column === active));
    button.addEventListener('click', () => {
      onSelect(column);
    });
    group.append(button);
  }

  return group;
}

/**
 * Renders every column once. The four lists never change after this — nothing on the page selects a
 * period any more — so a selection or a tab switch touches no list, and the row the reader pressed
 * keeps focus while the detail dialog opens over it.
 */
export function renderPlaceColumns(
  container: HTMLElement,
  dataset: PlacesDataset,
  onSelect: (placeId: string, period: Period) => void,
): void {
  const section = document.createElement('section');
  section.className = 'place-columns';

  const grid = document.createElement('div');
  grid.className = 'place-columns-grid';

  for (const column of COLUMN_ORDER) {
    const cell = document.createElement('div');
    cell.className = 'place-column';
    cell.dataset['column'] = column;

    const period = columnPeriod(column);
    const select = (placeId: string): void => {
      onSelect(placeId, period);
    };

    if (column === TRENDING_COLUMN) {
      const trending = computeTrendingPlaces(dataset);
      renderTrendingPlaces(cell, trending, select, {
        heading: COLUMN_LABELS[column],
        limit: COLUMN_LIMIT,
      });
    } else {
      const top = computeTopPlaces(dataset, column, COLUMN_LIMIT);
      renderTopPlaces(cell, top, select, columnHeading(COLUMN_LABELS[column], top.entries.length));
    }

    grid.append(cell);
  }

  const tabs = renderTabs(COLUMN_ORDER[0]!, (column) => {
    markActiveColumn(section, column);
  });

  section.append(tabs, grid);
  container.replaceChildren(section);
  markActiveColumn(section, COLUMN_ORDER[0]!);
}
