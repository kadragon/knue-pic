import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import { filterByKind } from '../stats/search';
import { EMPTY_MESSAGE, LIST_PAGE_SIZE } from './top-places';
import { PERIOD_ORDER } from './period-labels';
import {
  DEFAULT_PERIOD,
  PERIOD_TABS,
  TAB_GROUP_LABEL,
  listHeading,
  markActivePeriod,
  periodLabel,
  renderPlaceList,
} from './place-list';

function render(onSelect = vi.fn()): { root: HTMLElement; onSelect: typeof onSelect } {
  const root = document.createElement('div');
  renderPlaceList(root, SAMPLE_DATASET, onSelect);
  return { root, onSelect };
}

function pressed(root: HTMLElement): string | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>('.period-tab')].find(
    (button) => button.getAttribute('aria-pressed') === 'true',
  )?.dataset['period'];
}

describe('periodLabel', () => {
  it('names the window the list reads', () => {
    expect(periodLabel('1m')).toBe('최근 1개월');
    expect(periodLabel('1y')).toBe('최근 1년');
  });
});

describe('renderPlaceList', () => {
  it('offers one tab per window, in the widening order the page states', () => {
    const { root } = render();

    const tabs = [...root.querySelectorAll<HTMLButtonElement>('.period-tab')];
    expect(root.querySelector('.period-tabs')?.getAttribute('aria-label')).toBe(TAB_GROUP_LABEL);
    expect(tabs.map((tab) => tab.dataset['period'])).toEqual(PERIOD_TABS);
    // The literal order, not just the membership: every other assertion here is derived from
    // `PERIOD_TABS` itself, so reordering it would keep them all green while moving the selector.
    expect(PERIOD_TABS).toEqual(PERIOD_ORDER);
    expect(PERIOD_TABS).toEqual(['1m', '3m', '6m', '1y']);
  });

  it('opens on 최근 3개월, with exactly one list on screen', () => {
    const { root } = render();

    expect(DEFAULT_PERIOD).toBe('3m');
    expect(pressed(root)).toBe('3m');
    expect(root.querySelectorAll('.top-places')).toHaveLength(1);
    expect(root.querySelector('.place-list-body h2')?.textContent).toBe(listHeading('3m'));
  });

  it('ranks the selected window, not one shared list', () => {
    const { root } = render();

    // 황새울분식's visits are all older than the 1m window but inside the 1y one, so a list
    // reading the wrong window would show a different set entirely.
    root.querySelector<HTMLButtonElement>('.period-tab[data-period="1m"]')?.click();
    expect(root.textContent).not.toContain('황새울분식');

    root.querySelector<HTMLButtonElement>('.period-tab[data-period="1y"]')?.click();
    expect(root.textContent).toContain('황새울분식');
  });

  it('switches the window without rebuilding the selector', () => {
    const { root } = render();
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('.period-tab')];

    tabs[3]?.click();

    // Same nodes, new state: a rebuilt group would drop the focus the reader was holding on the
    // button they just pressed. `toBe` per element, not `toEqual` on the arrays — structural
    // equality is satisfied by freshly-built buttons carrying identical attributes, which is
    // exactly the failure this is here to catch.
    const after = [...root.querySelectorAll('.period-tab')];
    expect(after).toHaveLength(tabs.length);
    after.forEach((node, index) => {
      expect(node).toBe(tabs[index]);
    });
    expect(tabs[3]?.getAttribute('aria-pressed')).toBe('true');
    expect(tabs[1]?.getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector('.place-list-body h2')?.textContent).toBe(listHeading('1y'));
  });

  it('leaves focus on the pressed button when the list is rebuilt', () => {
    const root = document.createElement('div');
    document.body.append(root);
    renderPlaceList(root, SAMPLE_DATASET, vi.fn());

    const tab = root.querySelector<HTMLButtonElement>('.period-tab[data-period="1y"]');
    tab?.focus();
    tab?.click();

    expect(document.activeElement).toBe(tab);
    root.remove();
  });

  it('says so plainly when a window holds no visit', () => {
    const root = document.createElement('div');

    // An anchor far past every transaction: the list is honest rather than absent.
    renderPlaceList(root, { ...SAMPLE_DATASET, updatedAt: '2028-08-01' }, vi.fn());

    expect(root.textContent).toContain(EMPTY_MESSAGE);
  });

  it('reports the window a selection was made in alongside the place', () => {
    const { root, onSelect } = render();

    root.querySelector<HTMLButtonElement>('.period-tab[data-period="6m"]')?.click();
    root.querySelector<HTMLButtonElement>('.top-place-body')?.click();

    expect(onSelect).toHaveBeenCalledWith(expect.stringMatching(/^restaurant_/), '6m');
  });

  it('opens on one page, with the rest a scroll away rather than cut off', () => {
    const { root } = render();

    expect(root.querySelectorAll('.top-place').length).toBeLessThanOrEqual(LIST_PAGE_SIZE);
  });

  it('opens on the window the caller names, not always the default', () => {
    const root = document.createElement('div');

    renderPlaceList(root, SAMPLE_DATASET, vi.fn(), { active: '1y' });

    expect(pressed(root)).toBe('1y');
    expect(root.querySelector('.place-list-body h2')?.textContent).toBe(listHeading('1y'));
  });

  it('reports a switch, so a re-render can reopen where the reader was', () => {
    const root = document.createElement('div');
    const onActiveChange = vi.fn();

    renderPlaceList(root, SAMPLE_DATASET, vi.fn(), { onActiveChange });
    root.querySelector<HTMLButtonElement>('.period-tab[data-period="6m"]')?.click();

    expect(onActiveChange).toHaveBeenCalledWith('6m');
  });

  it('keeps the reader on their window when the dataset narrows under them', () => {
    const root = document.createElement('div');
    let active = DEFAULT_PERIOD;
    const options = {
      get active() {
        return active;
      },
      onActiveChange: (period: typeof active) => {
        active = period;
      },
    };

    renderPlaceList(root, SAMPLE_DATASET, vi.fn(), options);
    root.querySelector<HTMLButtonElement>('.period-tab[data-period="1y"]')?.click();
    // What the global 업종 filter does: same container, fewer places.
    renderPlaceList(root, filterByKind(SAMPLE_DATASET, 'cafe'), vi.fn(), options);

    // Resetting to the default here would move the reader to a window they never asked for.
    expect(pressed(root)).toBe('1y');
    expect(root.querySelector('.place-list-body h2')?.textContent).toBe(listHeading('1y'));
  });

  it('ranks only the places the narrowed dataset contains', () => {
    const root = document.createElement('div');

    renderPlaceList(root, filterByKind(SAMPLE_DATASET, 'cafe'), vi.fn());

    expect(root.textContent).toContain('청람카페');
    expect(root.textContent).not.toContain('한밭식당');
  });

  it('marks a window active on a container that has a selector', () => {
    const { root } = render();

    markActivePeriod(root, '1y');

    expect(pressed(root)).toBe('1y');
  });
});
