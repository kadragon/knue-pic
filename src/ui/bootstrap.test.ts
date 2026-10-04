import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import type { Period } from '../data/types';
import type { FakeMarker, FakeNaverApi } from '../map/fake-naver-api';
import { createFakeNaverApi } from '../map/fake-naver-api';
import {
  MAP_ERROR_MESSAGE,
  renderPageMap,
  resetAuthFailureState,
} from '../map/place-map';
import { CAMPUS_ORIGIN } from '../stats/distance';
import { bootstrap, type BootstrapOptions, type MatchMedia } from './bootstrap';
import { LOADING_MESSAGE, LOAD_ERROR_MESSAGE, RETRY_LABEL } from './data-state';
import { PERIOD_LABELS } from './period-labels';
import { DEFAULT_PERIOD, PERIOD_TABS, listHeading, periodLabel } from './place-list';
import { periodStatsHeading } from './place-detail';
import { displayDate } from './place-labels';
import { KIND_LABELS, ALL_KINDS_LABEL } from './kind-filter';
import { NO_RESULTS_MESSAGE, resultCountLabel } from './search';
import { DISCLAIMER, SOURCE_LINE } from './shell';
import { summaryLabel } from './summary-line';

function retryButton(root: HTMLElement): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>('.data-state-retry');
}

function periodTab(root: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>('.period-tab')].find(
    (button) => button.textContent === label,
  );
}

function pressedTab(root: HTMLElement): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>('.period-tab')].find(
    (button) => button.getAttribute('aria-pressed') === 'true',
  );
}

/**
 * Selects a window and returns the first row of the list it produced, which is how every selection
 * case opens the detail. Only one list is on screen at a time, so the period has to be chosen
 * before the row exists.
 */
function firstRow(root: HTMLElement, period: Period): HTMLButtonElement | null {
  periodTab(root, periodLabel(period))?.click();
  return root.querySelector<HTMLButtonElement>('.place-list-body .top-place-body');
}

function kindOption(root: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>('.kind-filter-option')].find(
    (button) => button.querySelector('.kind-filter-name')?.textContent === label,
  );
}

function searchField(root: HTMLElement): HTMLInputElement {
  const input = root.querySelector<HTMLInputElement>('.place-search-input');
  if (!input) throw new Error('search input is missing');
  return input;
}

function typeQuery(root: HTMLElement, text: string): void {
  const input = searchField(root);
  input.value = text;
  input.dispatchEvent(new Event('input'));
}

/** Lets the detail's fire-and-forget map render settle before the assertions run. */
const flush = (): Promise<void> => Promise.resolve().then(() => {});

/**
 * A rejected key is remembered for the life of a real page, which is right in the browser and wrong
 * between cases: the case that fires the auth-failure hook would otherwise send every later one
 * straight to the fallback.
 */
afterEach(() => {
  resetAuthFailureState();
  history.replaceState(null, '', location.pathname + location.search);
});

describe('bootstrap', () => {
  it('shows the loading message while the dataset is in flight', async () => {
    const root = document.createElement('div');
    let resolve!: (dataset: typeof SAMPLE_DATASET) => void;
    const load = vi.fn(() => new Promise<typeof SAMPLE_DATASET>((r) => (resolve = r)));

    const pending = bootstrap(root, { load });
    expect(root.textContent).toContain(LOADING_MESSAGE);

    resolve(SAMPLE_DATASET);
    await pending;
  });

  it('shows the dataset update date and the ranked list once loaded', async () => {
    const root = document.createElement('div');

    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });

    expect(root.textContent).toContain(`데이터 기준일: ${displayDate(SAMPLE_DATASET.updatedAt)}`);
    expect(root.textContent).not.toContain(LOADING_MESSAGE);
    expect(root.querySelectorAll('.period-tab')).toHaveLength(PERIOD_TABS.length);
    expect(root.querySelectorAll('.place-list-body .top-places')).toHaveLength(1);
  });

  it('puts the ranked list before the search in source order', async () => {
    const root = document.createElement('div');

    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });

    // The list is the answer the page exists for; search is the lookup for a reader who already
    // has a name (`docs/conventions.md` → Accessibility & Responsive). Asserted on the order, not
    // on presence: both slots exist either way.
    const order = [...(root.querySelector('#content')?.children ?? [])].map((el) => el.className);
    expect(order.indexOf('place-list-slot')).toBeLessThan(order.indexOf('search-slot'));
  });

  it('shows a plain Korean failure state, not a raw error, when the dataset is missing', async () => {
    const root = document.createElement('div');

    await bootstrap(root, { load: () => Promise.reject(new Error('404 Not Found')) });

    expect(root.textContent).toContain(LOAD_ERROR_MESSAGE);
    expect(root.textContent).not.toContain('404');
    expect(retryButton(root)?.textContent).toBe(RETRY_LABEL);
  });

  it('keeps the source line and disclaimer visible in the failure state', async () => {
    const root = document.createElement('div');

    await bootstrap(root, { load: () => Promise.reject(new Error('offline')) });

    expect(root.textContent).toContain(SOURCE_LINE);
    expect(root.textContent).toContain(DISCLAIMER);
  });

  it('recovers when the retry control succeeds on a later attempt', async () => {
    const root = document.createElement('div');
    const load = vi
      .fn<() => Promise<typeof SAMPLE_DATASET>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(SAMPLE_DATASET);

    await bootstrap(root, { load });

    const retry = retryButton(root);
    expect(retry).not.toBeNull();
    retry?.click();
    // The click starts a fresh attempt; flush the microtask queue it awaits on.
    await vi.waitFor(() => expect(root.textContent).not.toContain(LOAD_ERROR_MESSAGE));

    expect(load).toHaveBeenCalledTimes(2);
    expect(root.textContent).toContain(`데이터 기준일: ${displayDate(SAMPLE_DATASET.updatedAt)}`);
  });
});

describe('bootstrap accessibility', () => {
  it('keeps one live region across states so the failure is announced', async () => {
    const root = document.createElement('div');
    let reject!: (reason: Error) => void;
    const load = vi.fn(
      () => new Promise<typeof SAMPLE_DATASET>((_resolve, r) => (reject = r)),
    );

    const pending = bootstrap(root, { load });
    const region = root.querySelector('.data-state');
    expect(region?.getAttribute('role')).toBe('status');

    reject(new Error('offline'));
    await pending;

    // Same node, new text — a replaced region would never announce to a screen reader.
    expect(root.querySelector('.data-state')).toBe(region);
    expect(region?.textContent).toBe(LOAD_ERROR_MESSAGE);
  });

  it('moves focus into the content region when a retry finally succeeds', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const load = vi
      .fn<() => Promise<typeof SAMPLE_DATASET>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(SAMPLE_DATASET);

    await bootstrap(root, { load });
    retryButton(root)?.focus();
    retryButton(root)?.click();
    await vi.waitFor(() => expect(root.textContent).not.toContain(LOAD_ERROR_MESSAGE));

    // The retry button is gone with the failure state; focus must land on the loaded content, not
    // fall back to the document body.
    expect(document.activeElement).toBe(root.querySelector('#content'));
    root.remove();
  });

  it('keeps the shell and the content node identical across a retry', async () => {
    const root = document.createElement('div');
    const load = vi
      .fn<() => Promise<typeof SAMPLE_DATASET>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(SAMPLE_DATASET);

    await bootstrap(root, { load });
    const content = root.querySelector('#content');
    const header = root.querySelector('.shell-header');

    retryButton(root)?.click();
    await vi.waitFor(() => expect(root.textContent).not.toContain(LOAD_ERROR_MESSAGE));

    expect(root.querySelector('#content')).toBe(content);
    expect(root.querySelector('.shell-header')).toBe(header);
    // The provenance line is written into the existing band exactly once.
    expect(root.querySelectorAll('.shell-updated')).toHaveLength(1);
    expect(root.textContent).toContain(`데이터 기준일: ${displayDate(SAMPLE_DATASET.updatedAt)}`);
  });

  it('returns focus to the retry control when a retry fails again', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const load = vi
      .fn<() => Promise<typeof SAMPLE_DATASET>>()
      .mockRejectedValue(new Error('offline'));

    await bootstrap(root, { load });
    retryButton(root)?.focus();
    retryButton(root)?.click();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));

    expect(document.activeElement).toBe(retryButton(root));
    root.remove();
  });
});

describe('bootstrap ranked list', () => {
  it('offers every window as a tab and opens on the default one', async () => {
    const root = document.createElement('div');

    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });

    const tabs = [...root.querySelectorAll<HTMLButtonElement>('.period-tab')];
    expect(tabs.map((tab) => tab.dataset['period'])).toEqual(PERIOD_TABS);
    expect(pressedTab(root)?.dataset['period']).toBe(DEFAULT_PERIOD);
    expect(root.querySelector('.place-list-body h2')?.textContent).toBe(listHeading(DEFAULT_PERIOD));
  });

  it('ranks the selected window alone', async () => {
    const root = document.createElement('div');

    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });

    // 1y ranks all six fixture places; 3m ranks five — 황새울분식 has nothing recent at all, so a
    // list reading one shared window would show it under both.
    periodTab(root, periodLabel('1y'))?.click();
    expect(root.querySelectorAll('.place-list-body .top-place')).toHaveLength(6);

    periodTab(root, periodLabel('3m'))?.click();
    expect(root.querySelector('.place-list-body')?.textContent).not.toContain('황새울분식');
  });

  it('shows the picked window in the detail', async () => {
    const root = document.createElement('div');

    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });
    firstRow(root, '6m')?.click();

    expect(root.querySelector('.detail-slot')?.textContent).toContain(
      periodStatsHeading('6m'),
    );
  });

  it('shows a place picked under 최근 1개월 over that month', async () => {
    const root = document.createElement('div');

    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });
    firstRow(root, '1m')?.click();

    expect(root.querySelector('.detail-slot')?.textContent).toContain(periodStatsHeading('1m'));
  });

  it('shows a place found by search over the full retained window', async () => {
    const root = document.createElement('div');

    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });
    const input = root.querySelector<HTMLInputElement>('.place-search-input');
    input!.value = '황새울';
    input!.dispatchEvent(new Event('input'));
    root
      .querySelector<HTMLButtonElement>(
        '.place-search-list .place-select[data-place-id="restaurant_000003"]',
      )
      ?.click();

    expect(root.querySelector('.detail-slot')?.textContent).toContain('황새울분식');
    expect(root.querySelector('.detail-slot')?.textContent).toContain(
      periodStatsHeading('1y'),
    );
  });

  it('opens on the default window and flips the selector in place', async () => {
    const root = document.createElement('div');
    document.body.append(root);

    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });
    // One list is on screen at a time, so the window the page opens on is the only ranking a
    // visitor sees before touching anything.
    expect(pressedTab(root)?.textContent).toBe(periodLabel(DEFAULT_PERIOD));

    const button = periodTab(root, PERIOD_LABELS['6m']);
    button?.focus();
    button?.click();

    expect(pressedTab(root)).toBe(button);
    expect(root.querySelector('.place-list-body h2')?.textContent).toBe(listHeading('6m'));
    // Rebuilding the selector on every change would drop focus to the document body.
    expect(document.activeElement).toBe(button);
    root.remove();
  });
});

/*
 * Hand-counted from the fixture (`updatedAt` 2026-08-01). 3m, the default: 000001 3 visits, 000002
 * 1, 000004 2, 000005 2, 000006 3 → 5곳 11회; restaurant 4, cafe 1, lunchbox 0, other 0. 1y adds
 * 000001's 2025-11-03 and 000003's two visits → 6곳 14회, and other 1.
 */
describe('bootstrap summary line and 업종 counts', () => {
  function summaryText(root: HTMLElement): string | null | undefined {
    return root.querySelector('.summary-line')?.textContent;
  }

  function chipCounts(root: HTMLElement): (string | null | undefined)[] {
    return [...root.querySelectorAll('.kind-filter-option')].map(
      (button) => button.querySelector('.kind-filter-count')?.textContent,
    );
  }

  it('sits above the filters and counts the default window', async () => {
    const root = document.createElement('div');
    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });

    const line = root.querySelector('.summary-line');
    expect(line?.textContent).toBe('2026년 7월 31일 기준 · 5곳 · 11회');
    expect(line?.textContent).toBe(
      summaryLabel(SAMPLE_DATASET.updatedAt, { placeCount: 5, visitCount: 11 }),
    );
    const filters = root.querySelector('.kind-filter');
    expect(
      line && filters && line.compareDocumentPosition(filters) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // 전체, then the dataset's kind order: restaurant, cafe, lunchbox, other.
    expect(chipCounts(root)).toEqual(['5곳', '4곳', '1곳', '0곳', '0곳']);
  });

  it('recounts both when the period changes, without rebuilding the chips', async () => {
    const root = document.createElement('div');
    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });
    const chip = kindOption(root, KIND_LABELS.restaurant);

    periodTab(root, periodLabel('1y'))?.click();

    expect(summaryText(root)).toBe('2026년 7월 31일 기준 · 6곳 · 14회');
    expect(chipCounts(root)).toEqual(['6곳', '4곳', '1곳', '0곳', '1곳']);
    expect(kindOption(root, KIND_LABELS.restaurant)).toBe(chip);
  });

  it('narrows the summary to the picked 업종 but keeps every chip counting its own kind', async () => {
    const root = document.createElement('div');
    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });

    kindOption(root, KIND_LABELS.cafe)?.click();
    expect(summaryText(root)).toBe('2026년 7월 31일 기준 · 1곳 · 1회');
    expect(chipCounts(root)).toEqual(['5곳', '4곳', '1곳', '0곳', '0곳']);

    periodTab(root, periodLabel('1m'))?.click();
    expect(summaryText(root)).toBe('2026년 7월 31일 기준 · 1곳 · 1회');

    kindOption(root, ALL_KINDS_LABEL)?.click();
    expect(summaryText(root)).toBe('2026년 7월 31일 기준 · 5곳 · 9회');
  });
});

describe('bootstrap place selection', () => {
  it('opens the detail only once a place is picked', async () => {
    const root = document.createElement('div');

    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });
    // Nothing selected yet: no detail card, so the page does not end in an
    // empty card explaining a feature the visitor has not used.
    expect(root.querySelector('.detail-panel')).toBeNull();

    firstRow(root, '1y')?.click();

    expect(root.querySelector('.detail-panel')).not.toBeNull();
    expect(root.querySelector<HTMLAnchorElement>('.place-detail-link')?.rel).toBe(
      'noopener noreferrer',
    );
  });

  it('leaves the ranked list and the search query untouched when a place is selected', async () => {
    const root = document.createElement('div');
    document.body.append(root);

    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });
    const searchInput = root.querySelector<HTMLInputElement>('.place-search-input');
    // Captured *after* `firstRow`, which selects a window and so legitimately rebuilds the list:
    // a node captured before that click is detached by construction and the identity assertion
    // below would compare two nulls and pass having tested nothing.
    const button = firstRow(root, '1y');
    const rankedList = root.querySelector('.place-list-body .top-places-list');
    expect(rankedList).not.toBeNull();
    button?.focus();
    button?.click();

    // Only the detail body is repainted — an in-progress search query and the ranked list survive
    // the selection, asserted by node identity rather than by where focus ended up.
    expect(root.querySelector('.place-search-input')).toBe(searchInput);
    expect(root.querySelector('.place-list-body .top-places-list')).toBe(rankedList);
    // Focus moves into the detail so the selection is announced rather than happening off-screen.
    expect(document.activeElement).toBe(root.querySelector('.detail-panel .place-detail'));
    root.remove();
  });

  it('returns focus to the row that opened the detail when it is closed', async () => {
    const root = document.createElement('div');
    document.body.append(root);

    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });
    const button = firstRow(root, '1y');
    button?.focus();
    button?.click();
    const returned = new Promise<void>((resolve) => window.addEventListener('hashchange', () => resolve(), { once: true }));
    root.querySelector<HTMLButtonElement>('.detail-panel-back')?.click();
    await returned;

    // The whole point of the detail over the old bottom-of-page card: the reader keeps their place
    // in the list they were reading.
    expect(root.querySelector('.detail-panel')).toBeNull();
    expect(document.activeElement).toBe(button);
    root.remove();
  });
});

describe('bootstrap map wiring', () => {
  it('mounts one page map on mobile and centres it on the selected place', async () => {
    const root = document.createElement('div');
    const api = createFakeNaverApi();
    await bootstrap(root, {
      load: () => Promise.resolve(SAMPLE_DATASET),
      renderMap: (container, places, options) => renderPageMap(container, places, {
        ...options, loadApi: () => Promise.resolve(api),
      }),
    });
    await flush();
    expect(api.maps).toHaveLength(1);
    firstRow(root, '1y')?.click();
    expect(root.querySelector('.detail-panel .place-detail-figures')).not.toBeNull();
    expect(root.querySelector('.detail-dialog')).toBeNull();
    expect(root.querySelector('.place-detail-map')).toBeNull();
    expect(api.maps).toHaveLength(1);
  });

  it('keeps mobile search and detail usable when the page map script is blocked', async () => {
    const root = document.createElement('div');
    await bootstrap(root, {
      load: () => Promise.resolve(SAMPLE_DATASET),
      renderMap: (container, places, options) => renderPageMap(container, places, {
        ...options, loadApi: () => Promise.reject(new Error('blocked')),
      }),
    });
    await flush();
    expect(root.querySelectorAll('.shell-map-note')).toHaveLength(1);
    firstRow(root, '1y')?.click();
    expect(root.querySelector('.shell-map-note')?.textContent).toBe(MAP_ERROR_MESSAGE);
    expect(root.querySelector('.place-detail-figures')).not.toBeNull();
    expect(root.classList.contains('is-map-first')).toBe(false);
    expect(root.textContent).not.toContain(LOAD_ERROR_MESSAGE);
    expect(root.querySelector('.search-slot')).not.toBeNull();
  });
  it('narrows the ranked list and the search with one 업종 selection', async () => {
    const root = document.createElement('div');
    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });
    typeQuery(root, '식당');
    expect(root.querySelector('.search-slot')?.textContent).toContain(resultCountLabel(1));

    kindOption(root, KIND_LABELS.cafe)?.click();

    // Both views answer the same question afterwards; a control that moved one and not the other
    // would read as a bug in whichever list kept showing everything.
    const list = root.querySelector('.place-list-slot');
    expect(list?.textContent).toContain('청람카페');
    expect(list?.textContent).not.toContain('한밭식당');
    expect(root.querySelector('.search-slot')?.textContent).toContain(NO_RESULTS_MESSAGE);
  });

  it('restores every place when 전체 is picked again', async () => {
    const root = document.createElement('div');
    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });

    kindOption(root, KIND_LABELS.cafe)?.click();
    kindOption(root, ALL_KINDS_LABEL)?.click();

    expect(root.querySelector('.place-list-slot')?.textContent).toContain('한밭식당');
  });

  it('keeps the typed query and the selected window across a 업종 change', async () => {
    const root = document.createElement('div');
    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });
    typeQuery(root, '카페');
    periodTab(root, periodLabel('1y'))?.click();
    const input = searchField(root);

    kindOption(root, KIND_LABELS.cafe)?.click();

    // The same input node: a rebuild would throw away what the reader typed and move the caret.
    expect(searchField(root)).toBe(input);
    expect(searchField(root).value).toBe('카페');
    expect(pressedTab(root)?.dataset['period']).toBe('1y');
  });

  it('still opens the panel detail for a place listed under a narrowed 업종', async () => {
    const root = document.createElement('div');
    await bootstrap(root, {
      load: () => Promise.resolve(SAMPLE_DATASET),

    });

    kindOption(root, KIND_LABELS.cafe)?.click();
    firstRow(root, '1y')?.click();
    await flush();

    expect(root.querySelector('.detail-slot')?.textContent).toContain('청람카페');
  });
});

/**
 * The page map: the first screen, and the layout it came with
 * (`docs/design/map-first-layout.md`). jsdom has no `matchMedia`, so every case here states the
 * viewport it wants rather than relying on a layout engine that does not exist.
 */
describe('bootstrap page map', () => {
  /**
   * A `matchMedia` whose answer can be changed mid-test, which is the only way to reach the resize
   * path — a window is not something jsdom can do to itself.
   */
  function viewport(initial: boolean): { matchMedia: MatchMedia; set: (wide: boolean) => void } {
    let wide = initial;
    const listeners = new Set<() => void>();
    const list = {
      get matches() {
        return wide;
      },
      addEventListener: (_type: string, listener: () => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        listeners.delete(listener);
      },
    } as unknown as MediaQueryList;

    return {
      matchMedia: () => list,
      set: (next: boolean) => {
        wide = next;
        for (const listener of [...listeners]) listener();
      },
    };
  }

  /** The dots still standing on the map — the fake records every marker ever made. */
  function liveDots(api: FakeNaverApi): FakeMarker[] {
    return api.markers.filter((marker) => marker.attached.at(-1) !== null);
  }

  function mapOptions(api: FakeNaverApi): Partial<BootstrapOptions> {
    return { renderMap: (container, places, options) => renderPageMap(container, places, {
      ...options,
      loadApi: () => Promise.resolve(api),
    }) };
  }

  it('paints the list before it mounts the map', async () => {
    const root = document.createElement('div');
    const api = createFakeNaverApi();
    let rowsWhenAsked = 0;
    let settle!: (api: FakeNaverApi) => void;
    const pending = new Promise<FakeNaverApi>((resolve) => {
      settle = resolve;
    });

    const loading = bootstrap(root, {
      load: () => Promise.resolve(SAMPLE_DATASET),
      matchMedia: viewport(true).matchMedia,
      renderMap: (container, places, options) => {
        rowsWhenAsked = root.querySelectorAll('.top-place').length;
        return renderPageMap(container, places, {
          ...options,
          loadApi: () => pending,
        });
      },
    });
    await loading;

    // The panel does not wait on a third-party script: the reader has the ranked list before the
    // map has even asked for its bundle, and nothing is drawn until it answers.
    expect(rowsWhenAsked).toBeGreaterThan(0);
    expect(api.maps).toHaveLength(0);
    expect(root.querySelector('.page-map-canvas')).not.toBeNull();

    settle(api);
    await flush();

    expect(liveDots(api).length).toBeGreaterThan(0);
  });

  it('draws one dot per place that passes both filters, and takes the rest away', async () => {
    const root = document.createElement('div');
    const api = createFakeNaverApi();
    await bootstrap(root, {
      load: () => Promise.resolve(SAMPLE_DATASET),
      matchMedia: viewport(true).matchMedia,
      ...mapOptions(api),
    });
    await flush();

    // 3m is the default window: 황새울분식 has nothing in it, so it is a dot-less place rather than
    // a place ranked last.
    const summary = root.querySelector('.summary-line')?.textContent ?? '';
    expect(liveDots(api)).toHaveLength(5);
    expect(summary).toContain('5곳');
    expect(liveDots(api).map((dot) => dot.title)).not.toContain('황새울분식');

    periodTab(root, periodLabel('1y'))?.click();
    expect(liveDots(api)).toHaveLength(6);
    expect(root.querySelector('.summary-line')?.textContent ?? '').toContain('6곳');

    kindOption(root, KIND_LABELS.cafe)?.click();
    expect(liveDots(api)).toHaveLength(1);
    expect(liveDots(api)[0]?.title).toBe('청람카페');
    expect(root.querySelector('.summary-line')?.textContent ?? '').toContain('1곳');
  });

  describe('numbered pins', () => {
    /** The marker standing for a place, by the name it goes by in the list. */
    function markerFor(api: FakeNaverApi, placeName: string): FakeMarker | undefined {
      return api.markers.find((marker) => marker.title === placeName);
    }

    function firstRow(root: HTMLElement): HTMLLIElement {
      return root.querySelector<HTMLLIElement>('li.top-place')!;
    }

    it('prints each visible row\'s own rank on its pin, and leaves the rest as dots', async () => {
      const root = document.createElement('div');
      const api = createFakeNaverApi();
      await bootstrap(root, {
        load: () => Promise.resolve(SAMPLE_DATASET),
        matchMedia: viewport(true).matchMedia,
        ...mapOptions(api),
      });
      await flush();

      const rank = firstRow(root).querySelector('.top-place-rank')?.textContent;
      const name = firstRow(root).querySelector('.top-place-name')?.textContent ?? '';

      // The number is the row's own badge text — the map draws what the reader is reading, and this
      // module ranks nothing itself.
      expect(rank).toBe('1');
      expect(markerFor(api, name)?.icon?.content).toContain('page-map-pin');
      expect(markerFor(api, name)?.icon?.content).toContain('>1<');

      // Every row on screen is a pin, and no marker is left saying a number no row prints: with this
      // fixture all five in-window places fit on one page, so the "place with no row stays a dot"
      // half has nothing to show here — `src/map/place-map.test.ts` drives it with an unlabelled
      // entry directly.
      const rows = [...root.querySelectorAll('li.top-place')];
      expect(rows.length).toBeGreaterThan(1);
      expect(liveDots(api)).toHaveLength(rows.length);
    });

    it('lights the pin for the row the reader hovered, and takes it off again', async () => {
      const root = document.createElement('div');
      const api = createFakeNaverApi();
      await bootstrap(root, {
        load: () => Promise.resolve(SAMPLE_DATASET),
        matchMedia: viewport(true).matchMedia,
        ...mapOptions(api),
      });
      await flush();
      const name = firstRow(root).querySelector('.top-place-name')?.textContent ?? '';

      firstRow(root).dispatchEvent(new MouseEvent('mouseenter'));
      expect(markerFor(api, name)?.icon?.content).toContain('is-active');

      firstRow(root).dispatchEvent(new MouseEvent('mouseleave'));
      expect(markerFor(api, name)?.icon?.content).not.toContain('is-active');
    });

    it('lights the row for the pin the reader touched, and clears it when they leave', async () => {
      const root = document.createElement('div');
      const api = createFakeNaverApi();
      await bootstrap(root, {
        load: () => Promise.resolve(SAMPLE_DATASET),
        matchMedia: viewport(true).matchMedia,
        ...mapOptions(api),
      });
      await flush();
      const placeId = firstRow(root).getAttribute('data-place-id');

      markerFor(api, firstRow(root).querySelector('.top-place-name')?.textContent ?? '')?.emit(
        'mouseover',
      );
      expect(root.querySelectorAll('li.top-place[data-active]')).toHaveLength(1);
      expect(firstRow(root).getAttribute('data-active')).toBe('true');

      markerFor(api, firstRow(root).querySelector('.top-place-name')?.textContent ?? '')?.emit('mouseout');
      expect(root.querySelectorAll('li.top-place[data-active]')).toHaveLength(0);
      expect(placeId).toBeTruthy();
    });

    it('highlights the mobile page map from the row', async () => {
      const root = document.createElement('div');
      const api = createFakeNaverApi();
      await bootstrap(root, {
        load: () => Promise.resolve(SAMPLE_DATASET),
        matchMedia: viewport(false).matchMedia,
        ...mapOptions(api),
      });
      await flush();

      // Mobile rows highlight the same page map as desktop rows.
      expect(() => firstRow(root).dispatchEvent(new MouseEvent('mouseenter'))).not.toThrow();
      expect(api.maps).toHaveLength(1);
    });
  });

  it('keeps the map on the campus origin and returns there on demand', async () => {
    const root = document.createElement('div');
    const api = createFakeNaverApi();
    await bootstrap(root, {
      load: () => Promise.resolve(SAMPLE_DATASET),
      matchMedia: viewport(true).matchMedia,
      ...mapOptions(api),
    });
    await flush();

    expect(api.maps[0]?.options.center.lat()).toBe(CAMPUS_ORIGIN.lat);

    root.querySelector<HTMLButtonElement>('.map-recentre')?.click();

    expect(api.maps[0]?.centers.at(-1)?.lat()).toBe(CAMPUS_ORIGIN.lat);
    expect(api.maps[0]?.centers.at(-1)?.lng()).toBe(CAMPUS_ORIGIN.lng);
  });

  it('gives the page back its full width when the map script never arrives', async () => {
    const root = document.createElement('div');
    await bootstrap(root, {
      load: () => Promise.resolve(SAMPLE_DATASET),
      matchMedia: viewport(true).matchMedia,
      renderMap: (container, places, options) =>
        renderPageMap(container, places, { ...options, loadApi: () => Promise.reject(new Error()) }),
    });
    await flush();

    expect(root.querySelector('.shell-map-note')?.textContent).toBe(MAP_ERROR_MESSAGE);
    expect(root.querySelectorAll('.shell-map-note')).toHaveLength(1);
    expect(root.querySelector('.map-shell-map')).toBeNull();
    expect(root.classList.contains('is-map-first')).toBe(false);
    // Everything the panel does still works — this is the one third-party input on the page.
    expect(root.querySelectorAll('.place-list-body .top-place').length).toBeGreaterThan(0);
    expect(root.querySelector('.search-slot')).not.toBeNull();
    expect(root.querySelector('.detail-slot')).not.toBeNull();
  });

  it('mounts one map however often the filters change while the script is still loading', async () => {
    const root = document.createElement('div');
    const api = createFakeNaverApi();
    let settle!: (api: FakeNaverApi) => void;
    const pending = new Promise<FakeNaverApi>((resolve) => {
      settle = resolve;
    });

    await bootstrap(root, {
      load: () => Promise.resolve(SAMPLE_DATASET),
      matchMedia: viewport(true).matchMedia,
      renderMap: (container, places, options) =>
        renderPageMap(container, places, { ...options, loadApi: () => pending }),
    });

    // The script is a third-party download and the reader is not waiting for it: a 기간 or 업종 press
    // in that window must not start a second mount, or the first map instance is orphaned on a
    // detached canvas with nobody left holding its release.
    periodTab(root, periodLabel('1y'))?.click();
    kindOption(root, KIND_LABELS.cafe)?.click();

    settle(api);
    await flush();

    expect(api.maps).toHaveLength(1);
    expect(root.querySelectorAll('.page-map-canvas')).toHaveLength(1);
    expect(liveDots(api)).toHaveLength(1);
    expect(liveDots(api)[0]?.title).toBe('청람카페');
  });

  it('falls back the same way when the key rejects the origin after the map mounted', async () => {
    const root = document.createElement('div');
    const api = createFakeNaverApi();
    await bootstrap(root, {
      load: () => Promise.resolve(SAMPLE_DATASET),
      matchMedia: viewport(true).matchMedia,
      ...mapOptions(api),
    });
    await flush();

    (globalThis as { navermap_authFailure?: () => void }).navermap_authFailure?.();

    expect(root.querySelectorAll('.shell-map-note')).toHaveLength(1);
    expect(root.querySelector('.map-shell-map')).toBeNull();
    expect(root.querySelectorAll('.place-list-body .top-place').length).toBeGreaterThan(0);
  });

  it('loads the page map behind the half-open sheet on a narrow viewport', async () => {
    const root = document.createElement('div');
    const api = createFakeNaverApi();
    await bootstrap(root, {
      load: () => Promise.resolve(SAMPLE_DATASET),
      matchMedia: viewport(false).matchMedia,
      ...mapOptions(api),
    });
    await flush();

    // The sheet opens halfway with a live page map behind it.
    expect(api.maps).toHaveLength(1);
    expect(root.querySelector('.page-map-canvas')).not.toBeNull();
    expect(root.classList.contains('is-map-first')).toBe(true);
    expect(root.querySelector<HTMLElement>('.sheet-panel')?.dataset['snap']).toBe('half');
    expect(root.querySelectorAll('.place-list-body .top-place').length).toBeGreaterThan(0);
  });

  it('mounts the map when a narrow window is widened, drawing the filters as they stand', async () => {
    const root = document.createElement('div');
    const api = createFakeNaverApi();
    const view = viewport(false);
    await bootstrap(root, {
      load: () => Promise.resolve(SAMPLE_DATASET),
      matchMedia: view.matchMedia,
      ...mapOptions(api),
    });
    kindOption(root, KIND_LABELS.cafe)?.click();

    view.set(true);
    await flush();

    // A phone turned sideways is a desktop-width layout, and the map that goes with it has to show
    // the window and kind the reader is already looking at.
    expect(root.classList.contains('is-map-first')).toBe(true);
    expect(liveDots(api)).toHaveLength(1);
    expect(liveDots(api)[0]?.title).toBe('청람카페');
  });

  it('keeps the full-width fallback when a map that failed is followed by a resize', async () => {
    const root = document.createElement('div');
    const view = viewport(true);
    await bootstrap(root, {
      load: () => Promise.resolve(SAMPLE_DATASET),
      matchMedia: view.matchMedia,
      renderMap: (container, places, options) =>
        renderPageMap(container, places, { ...options, loadApi: () => Promise.reject(new Error()) }),
    });
    await flush();
    expect(root.querySelectorAll('.shell-map-note')).toHaveLength(1);

    view.set(false);
    view.set(true);
    await flush();

    // A failed map is gone for the life of the page — the auth-failure memo sends a later mount
    // straight back to the fallback, so there is nothing to make room for. Widening must not restore
    // the panel width beside an absent map.
    expect(root.classList.contains('is-map-first')).toBe(false);
    expect(root.querySelector('.map-shell-map')).toBeNull();
    expect(root.querySelectorAll('.shell-map-note')).toHaveLength(1);
    expect(root.querySelectorAll('.place-list-body .top-place').length).toBeGreaterThan(0);
  });

  it('falls back even when the window was narrowed before the failure arrived', async () => {
    const root = document.createElement('div');
    const view = viewport(true);
    let reject!: (reason: Error) => void;
    await bootstrap(root, {
      load: () => Promise.resolve(SAMPLE_DATASET),
      matchMedia: view.matchMedia,
      renderMap: (container, places, options) =>
        renderPageMap(container, places, {
          ...options,
          loadApi: () => new Promise<FakeNaverApi>((_resolve, r) => (reject = r)),
        }),
    });

    // The map was asked for, so a failure is a failure at whatever width the reader has since moved
    // to — dropping it would leave a narrow reader who widens the window with neither a map nor the
    // line that says why.
    view.set(false);
    reject(new Error('blocked'));
    await flush();

    expect(root.querySelectorAll('.shell-map-note')).toHaveLength(1);

    view.set(true);
    expect(root.querySelectorAll('.shell-map-note')).toHaveLength(1);
    expect(root.classList.contains('is-map-first')).toBe(false);
  });

  it('leaves a mounted map alone when a wide window narrows, rather than calling it a failure', async () => {
    const root = document.createElement('div');
    const api = createFakeNaverApi();
    const view = viewport(true);
    await bootstrap(root, {
      load: () => Promise.resolve(SAMPLE_DATASET),
      matchMedia: view.matchMedia,
      ...mapOptions(api),
    });
    await flush();

    view.set(false);

    // The layout becomes a sheet and the map stays mounted behind it, so widening the
    // window again finds the same map and the same dots. A resize is not a map failure.
    expect(root.classList.contains('is-map-first')).toBe(true);
    expect(root.querySelector('.shell-map-note')).toBeNull();
    expect(root.querySelector('.map-shell-map')).not.toBeNull();
    expect(liveDots(api)).toHaveLength(5);

    view.set(true);
    await flush();
    expect(liveDots(api)).toHaveLength(5);
    expect(api.maps).toHaveLength(1);
  });
});
