import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import { LAST_YEAR_MONTH } from '../stats/period';
import { filterByKind } from '../stats/search';
import { computeTopPlaces } from '../stats/top-places';
import { EMPTY_MESSAGE } from './top-places';
import {
  COLUMN_LIMIT,
  COLUMN_ORDER,
  TAB_GROUP_LABEL,
  columnBasis,
  columnHeading,
  columnLabel,
  markActiveColumn,
  renderPlaceColumns,
} from './place-columns';

function render(onSelect = vi.fn()): { root: HTMLElement; onSelect: typeof onSelect } {
  const root = document.createElement('div');
  renderPlaceColumns(root, SAMPLE_DATASET, onSelect);
  return { root, onSelect };
}

describe('columnBasis', () => {
  it('reads the trending column over the month it is measured on', () => {
    // `docs/conventions.md` → Statistics Rules fixes trending to the recent month, so a place
    // picked from it must not be shown figures for a window the reader never chose.
    expect(columnBasis('trending')).toBe('1m');
  });

  it('reads a ranked column over its own window', () => {
    expect(columnBasis('6m')).toBe('6m');
  });

  it('reads the 작년 같은 달 column over that month', () => {
    expect(columnBasis(LAST_YEAR_MONTH)).toBe(LAST_YEAR_MONTH);
  });
});

describe('columnLabel', () => {
  it('names the month the 작년 같은 달 column covers, not the relation', () => {
    // Every label beside it reads 최근 N개월; an unnamed month leaves the reader with no way to
    // check the figures against the disclosure they came from.
    expect(columnLabel(LAST_YEAR_MONTH, '2026-08-01')).toBe('2025년 8월');
    expect(columnLabel(LAST_YEAR_MONTH, '2026-01-15')).toBe('2025년 1월');
  });
});

describe('columnHeading', () => {
  it('states the rendered count so a capped column never reads as the whole set', () => {
    expect(columnHeading('최근 1년', 10)).toBe('최근 1년 상위 10곳');
  });

  it('names no number when there is nothing to number', () => {
    expect(columnHeading('최근 1년', 0)).toBe('최근 1년');
  });
});

describe('renderPlaceColumns', () => {
  it('renders the five windows in order, each headed by the window it reads', () => {
    const { root } = render();

    const columns = [...root.querySelectorAll<HTMLElement>('.place-column')];
    expect(columns.map((column) => column.dataset['column'])).toEqual(COLUMN_ORDER);
    expect(columns).toHaveLength(5);
    expect(columns[0]?.querySelector('h2')?.textContent).toBe(
      columnHeading(
        columnLabel(LAST_YEAR_MONTH, SAMPLE_DATASET.updatedAt),
        computeTopPlaces(SAMPLE_DATASET, LAST_YEAR_MONTH, COLUMN_LIMIT).entries.length,
      ),
    );
    // The trending column is ordered by movement, so it carries the bare label: no "TOP N", and
    // `remainderLabel` is its single statement of the cap.
    expect(columns[1]?.querySelector('h2')?.textContent).toBe(
      columnLabel('trending', SAMPLE_DATASET.updatedAt),
    );
    expect(columns[4]?.querySelector('h2')?.textContent).toBe(
      columnHeading(
        columnLabel('1y', SAMPLE_DATASET.updatedAt),
        computeTopPlaces(SAMPLE_DATASET, '1y', COLUMN_LIMIT).entries.length,
      ),
    );
  });

  it('ranks the 작년 같은 달 column over that calendar month alone', () => {
    const { root } = render();

    // 000006's 2025-08-01 payment is the fixture's only visit in 2025-08, and it sits *outside*
    // the 1y window — so a column reading the wrong window would list a different set entirely.
    const column = root.querySelector(`.place-column[data-column="${LAST_YEAR_MONTH}"]`);
    expect(column?.querySelectorAll('.top-place')).toHaveLength(1);
    expect(column?.textContent).toContain('새터말칼국수');
  });

  it('shows no rank movement in the 작년 같은 달 column', () => {
    const { root } = render();

    // The month before it is two years from the anchor — outside any retained file — so every
    // delta is omitted rather than computed against months nobody collected.
    const column = root.querySelector(`.place-column[data-column="${LAST_YEAR_MONTH}"]`);
    expect(column?.querySelectorAll('.top-place-delta')).toHaveLength(0);
  });

  it('says so plainly when the 작년 같은 달 month holds no visit', () => {
    const root = document.createElement('div');

    // What ships until the older months are collected: the column is honest rather than absent.
    renderPlaceColumns(root, { ...SAMPLE_DATASET, updatedAt: '2028-08-01' }, vi.fn());

    expect(
      root.querySelector(`.place-column[data-column="${LAST_YEAR_MONTH}"]`)?.textContent,
    ).toContain(EMPTY_MESSAGE);
  });

  it('marks every column active or not, so the phone layout needs no per-key rule', () => {
    const { root } = render();

    markActiveColumn(root, '1y');

    const states = [...root.querySelectorAll<HTMLElement>('.place-column')].map((cell) => [
      cell.dataset['column'],
      cell.dataset['active'],
    ]);
    expect(states).toEqual(COLUMN_ORDER.map((column) => [column, String(column === '1y')]));
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

    tabs[3]?.click();

    // Same nodes, new state: a rebuilt group would drop the focus the reader was holding.
    expect([...root.querySelectorAll('.place-column-tab')]).toEqual(tabs);
    expect(tabs[3]?.getAttribute('aria-pressed')).toBe('true');
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

  it('opens on the column the caller names, not always the first', () => {
    const root = document.createElement('div');

    renderPlaceColumns(root, SAMPLE_DATASET, vi.fn(), { active: '1y' });

    expect(root.querySelector<HTMLElement>('.place-columns-grid')?.dataset['active']).toBe('1y');
    expect(
      [...root.querySelectorAll<HTMLButtonElement>('.place-column-tab')].find(
        (button) => button.getAttribute('aria-pressed') === 'true',
      )?.dataset['column'],
    ).toBe('1y');
  });

  it('reports a tab switch, so a re-render can reopen where the reader was', () => {
    const root = document.createElement('div');
    const onActiveChange = vi.fn();

    renderPlaceColumns(root, SAMPLE_DATASET, vi.fn(), { onActiveChange });
    root.querySelector<HTMLButtonElement>('.place-column-tab[data-column="6m"]')?.click();

    expect(onActiveChange).toHaveBeenCalledWith('6m');
  });

  it('keeps the reader on their column when the dataset narrows under them', () => {
    const root = document.createElement('div');
    let active = COLUMN_ORDER[0]!;
    const options = {
      get active() {
        return active;
      },
      onActiveChange: (column: typeof active) => {
        active = column;
      },
    };

    renderPlaceColumns(root, SAMPLE_DATASET, vi.fn(), options);
    root.querySelector<HTMLButtonElement>('.place-column-tab[data-column="1y"]')?.click();
    // What the global 업종 filter does: same container, fewer places.
    renderPlaceColumns(root, filterByKind(SAMPLE_DATASET, 'cafe'), vi.fn(), options);

    // On a narrow screen the active column is the only one on screen, so resetting it here would
    // move the reader to a list they never asked for.
    expect(root.querySelector<HTMLElement>('.place-columns-grid')?.dataset['active']).toBe('1y');
  });

  it('ranks only the places the narrowed dataset contains', () => {
    const root = document.createElement('div');

    renderPlaceColumns(root, filterByKind(SAMPLE_DATASET, 'cafe'), vi.fn());

    expect(root.textContent).toContain('청람카페');
    expect(root.textContent).not.toContain('한밭식당');
  });

  it('marks a column active on a container that has one', () => {
    const { root } = render();

    markActiveColumn(root, '1y');

    expect(root.querySelector<HTMLElement>('.place-columns-grid')?.dataset['active']).toBe('1y');
  });
});
