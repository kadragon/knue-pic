import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import { computeTopPlaces } from '../stats/top-places';
import {
  COLUMN_LABELS,
  COLUMN_LIMIT,
  COLUMN_ORDER,
  TAB_GROUP_LABEL,
  columnHeading,
  columnPeriod,
  markActiveColumn,
  renderPlaceColumns,
} from './place-columns';

function render(onSelect = vi.fn()): { root: HTMLElement; onSelect: typeof onSelect } {
  const root = document.createElement('div');
  renderPlaceColumns(root, SAMPLE_DATASET, onSelect);
  return { root, onSelect };
}

describe('columnPeriod', () => {
  it('reads the trending column over the month it is measured on', () => {
    // `docs/conventions.md` → Statistics Rules fixes trending to the recent month, so a place
    // picked from it must not be shown figures for a window the reader never chose.
    expect(columnPeriod('trending')).toBe('1m');
  });

  it('reads a ranked column over its own window', () => {
    expect(columnPeriod('6m')).toBe('6m');
  });
});

describe('columnHeading', () => {
  it('states the rendered count so a capped column never reads as the whole set', () => {
    expect(columnHeading('최근 1년', 10)).toBe('최근 1년 TOP 10');
  });

  it('names no number when there is nothing to number', () => {
    expect(columnHeading('최근 1년', 0)).toBe('최근 1년');
  });
});

describe('renderPlaceColumns', () => {
  it('renders the four windows in order, each headed by the window it reads', () => {
    const { root } = render();

    const columns = [...root.querySelectorAll<HTMLElement>('.place-column')];
    expect(columns.map((column) => column.dataset['column'])).toEqual(COLUMN_ORDER);
    // The trending column is ordered by movement, so it carries the bare label: no "TOP N", and
    // `remainderLabel` is its single statement of the cap.
    expect(columns[0]?.querySelector('h2')?.textContent).toBe(COLUMN_LABELS['trending']);
    expect(columns[3]?.querySelector('h2')?.textContent).toBe(
      columnHeading(COLUMN_LABELS['1y'], computeTopPlaces(SAMPLE_DATASET, '1y', COLUMN_LIMIT).entries.length),
    );
  });

  it('reports the window a selection was made in alongside the place', () => {
    const { root, onSelect } = render();

    root
      .querySelector<HTMLButtonElement>('.place-column[data-column="6m"] .top-place-body')
      ?.click();

    expect(onSelect).toHaveBeenCalledWith(expect.stringMatching(/^restaurant_/), '6m');
  });

  it('offers a labelled tab per column, starting on the first', () => {
    const { root } = render();

    const tabs = [...root.querySelectorAll<HTMLButtonElement>('.place-column-tab')];
    expect(root.querySelector('.place-column-tabs')?.getAttribute('aria-label')).toBe(
      TAB_GROUP_LABEL,
    );
    expect(tabs.map((tab) => tab.dataset['column'])).toEqual(COLUMN_ORDER);
    expect(tabs[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector<HTMLElement>('.place-columns-grid')?.dataset['active']).toBe(
      COLUMN_ORDER[0],
    );
  });

  it('switches the active column without rebuilding the tabs', () => {
    const { root } = render();
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('.place-column-tab')];

    tabs[2]?.click();

    // Same nodes, new state: a rebuilt group would drop the focus the reader was holding.
    expect([...root.querySelectorAll('.place-column-tab')]).toEqual(tabs);
    expect(tabs[2]?.getAttribute('aria-pressed')).toBe('true');
    expect(tabs[0]?.getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector<HTMLElement>('.place-columns-grid')?.dataset['active']).toBe('6m');
  });

  it('caps every column at the same number of rows', () => {
    const { root } = render();

    for (const column of root.querySelectorAll('.place-column')) {
      expect(column.querySelectorAll('.top-place, .discovery-place').length).toBeLessThanOrEqual(
        COLUMN_LIMIT,
      );
    }
  });

  it('marks a column active on a container that has one', () => {
    const { root } = render();

    markActiveColumn(root, '1y');

    expect(root.querySelector<HTMLElement>('.place-columns-grid')?.dataset['active']).toBe('1y');
  });
});
