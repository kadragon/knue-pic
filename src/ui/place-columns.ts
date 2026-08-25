import type { Period, PlacesDataset } from '../data/types';
import { computeTopPlaces } from '../stats/top-places';
import { PERIOD_LABELS, PERIOD_ORDER } from './period-labels';
import { renderTopPlaces } from './top-places';

/**
 * The four discovery columns, side by side: the ranked windows widening from one month to a year.
 *
 * This replaced a single ranked list behind a 1m/6m/1y switch. Under the switch, comparing the
 * windows meant pressing a button and holding the previous list in memory; the comparison is the
 * question the page exists to answer, so the lists are now on screen at once and the reader's
 * eye does the comparing.
 *
 * No statistic is computed here. `computeTopPlaces` owns the numbers and `renderTopPlaces` owns
 * the rows — this module owns the grid, the headings and the mobile tab switch, and nothing else.
 */

export type ColumnKey = Period;

/** Shortest window first, so the reader scans widening. */
export const COLUMN_ORDER: ColumnKey[] = PERIOD_ORDER;

export function columnLabel(column: ColumnKey): string {
  return PERIOD_LABELS[column];
}

/**
 * Only shown on narrow screens, where the four columns collapse to one; the group is `display:none`
 * from the tablet breakpoint up, at which point every column is on screen and there is nothing to
 * switch between.
 */
export const TAB_GROUP_LABEL = '목록 선택';

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
    button.textContent = columnLabel(column);
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
 * filter narrows the dataset they are computed from, so a kind change does rebuild all four. On
 * narrow screens only one column is on screen at a time, and rebuilding with the default active
 * column would silently move the reader from 1년 back to the first column. `active` carries their
 * tab across the rebuild; `onActiveChange` is how the caller learns of a switch it did not make.
 */
export interface PlaceColumnsOptions {
  active?: ColumnKey;
  onActiveChange?: (column: ColumnKey) => void;
}

/**
 * Renders every column once. Within one dataset the four lists never change — nothing on the page
 * selects a period any more — so a selection or a tab switch touches no list, and the row the
 * reader pressed keeps focus while the detail dialog opens over it.
 *
 * Each column is computed over the *whole* ranking rather than a visible cap: `renderTopPlaces`
 * pages through it as the reader scrolls, so a cap applied here would be a ceiling the reader
 * could never scroll past.
 */
export function renderPlaceColumns(
  container: HTMLElement,
  dataset: PlacesDataset,
  onSelect: (placeId: string, basis: Period) => void,
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

    const top = computeTopPlaces(dataset, column, dataset.places.length);
    renderTopPlaces(
      cell,
      top,
      (placeId) => {
        onSelect(placeId, column);
      },
      columnLabel(column),
    );

    grid.append(cell);
  }

  const tabs = renderTabs(active, (column) => {
    markActiveColumn(section, column);
    onActiveChange?.(column);
  });

  section.append(tabs, grid);
  container.replaceChildren(section);
  markActiveColumn(section, active);
}
