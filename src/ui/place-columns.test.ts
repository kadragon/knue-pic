import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import { filterByKind } from '../stats/search';
import { COLUMN_PAGE_SIZE, EMPTY_MESSAGE } from './top-places';
import { PERIOD_ORDER } from './period-labels';
import {
  COLUMN_ORDER,
  TAB_GROUP_LABEL,
  columnLabel,
  markActiveColumn,
  renderPlaceColumns,
} from './place-columns';

function render(onSelect = vi.fn()): { root: HTMLElement; onSelect: typeof onSelect } {
  const root = document.createElement('div');
  renderPlaceColumns(root, SAMPLE_DATASET, onSelect);
  return { root, onSelect };
}

describe('columnLabel', () => {
  it('names the window the column reads', () => {
    expect(columnLabel('1m')).toBe('최근 1개월');
    expect(columnLabel('1y')).toBe('최근 1년');
  });
});

describe('renderPlaceColumns', () => {
  it('renders the four windows in order, each headed by the window it reads', () => {
    const { root } = render();

    const columns = [...root.querySelectorAll<HTMLElement>('.place-column')];
    expect(columns.map((column) => column.dataset['column'])).toEqual(COLUMN_ORDER);
    // The literal order, not just the membership: every other assertion here is derived from
    // `COLUMN_ORDER` itself, so reordering it would keep them all green while moving the column a
    // phone visitor lands on.
    expect(COLUMN_ORDER).toEqual(PERIOD_ORDER);
    expect(COLUMN_ORDER).toEqual(['1m', '3m', '6m', '1y']);
    expect(columns).toHaveLength(4);
    expect(columns.map((column) => column.querySelector('h2')?.textContent)).toEqual(
      COLUMN_ORDER.map(columnLabel),
    );
  });

  it('ranks each column over its own window, not one shared list', () => {
    const { root } = render();

    // 황새울분식's visits are all older than the 1m window but inside the 1y one, so a column
    // reading the wrong window would list a different set entirely.
    const monthly = root.querySelector('.place-column[data-column="1m"]');
    const yearly = root.querySelector('.place-column[data-column="1y"]');

    expect(monthly?.textContent).not.toContain('황새울분식');
    expect(yearly?.textContent).toContain('황새울분식');
  });

  it('says so plainly when a window holds no visit', () => {
    const root = document.createElement('div');

    // An anchor far past every transaction: the column is honest rather than absent.
    renderPlaceColumns(root, { ...SAMPLE_DATASET, updatedAt: '2028-08-01' }, vi.fn());

    expect(root.querySelector('.place-column[data-column="1m"]')?.textContent).toContain(
      EMPTY_MESSAGE,
    );
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
    expect(root.querySelector<HTMLElement>('.place-columns-grid')?.dataset['active']).toBe('1y');
  });

  it('opens every column on one page, with the rest a scroll away rather than cut off', () => {
    const { root } = render();

    for (const column of root.querySelectorAll('.place-column')) {
      expect(column.querySelectorAll('.top-place').length).toBeLessThanOrEqual(COLUMN_PAGE_SIZE);
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
