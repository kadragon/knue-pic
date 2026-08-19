import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import { createFakeNaverApi } from '../map/fake-naver-api';
import { MAP_ERROR_MESSAGE } from '../map/place-map';
import { bootstrap } from './bootstrap';
import { LOADING_MESSAGE, LOAD_ERROR_MESSAGE, RETRY_LABEL } from './data-state';
import { PERIOD_LABELS } from './period-selector';
import { DETAIL_EMPTY_MESSAGE, periodStatsHeading } from './place-detail';
import { DISCLAIMER, SOURCE_LINE } from './shell';
import { topPlacesHeading } from './top-places';

function retryButton(root: HTMLElement): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>('.data-state-retry');
}

function periodButton(root: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>('.period-option')].find(
    (button) => button.textContent === label,
  );
}

function pressedPeriod(root: HTMLElement): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>('.period-option')].find(
    (button) => button.getAttribute('aria-pressed') === 'true',
  );
}

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

    expect(root.textContent).toContain(`최근 데이터 업데이트: ${SAMPLE_DATASET.updatedAt}`);
    expect(root.textContent).not.toContain(LOADING_MESSAGE);
    expect(root.querySelector('#content')?.textContent).toContain(topPlacesHeading(6));
  });

  it('opens on the 1y period', async () => {
    const root = document.createElement('div');

    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });

    expect(pressedPeriod(root)?.textContent).toBe(PERIOD_LABELS['1y']);
    // 1y ranks all six fixture places; a shorter window would rank fewer.
    expect(root.querySelectorAll('.top-place')).toHaveLength(6);
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
    expect(root.textContent).toContain(`최근 데이터 업데이트: ${SAMPLE_DATASET.updatedAt}`);
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
    // The provenance line is written into the existing footer exactly once.
    expect(root.querySelectorAll('.shell-updated')).toHaveLength(1);
    expect(root.textContent).toContain(`최근 데이터 업데이트: ${SAMPLE_DATASET.updatedAt}`);
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

describe('bootstrap period switching', () => {
  it('re-derives the list from the newly selected period', async () => {
    const root = document.createElement('div');

    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });
    periodButton(root, PERIOD_LABELS['1m'])?.click();

    expect(pressedPeriod(root)?.textContent).toBe(PERIOD_LABELS['1m']);
    // 1m ranks five of the six fixture places — 000003 has no visit in that window.
    expect(root.querySelectorAll('.top-place')).toHaveLength(5);
    // Scoped to the ranked list: the search results below it list every place regardless of period.
    expect(root.querySelector('.top-places-slot')?.textContent).not.toContain('황새울분식');
  });

  it('keeps focus on the period button that was pressed', async () => {
    const root = document.createElement('div');
    document.body.append(root);

    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });
    const button = periodButton(root, PERIOD_LABELS['6m']);
    button?.focus();
    button?.click();

    // Rebuilding the selector on every change would drop focus to the document body.
    expect(document.activeElement).toBe(button);
    root.remove();
  });
});

describe('bootstrap place selection', () => {
  function selectFirstTopPlace(root: HTMLElement): void {
    root.querySelector<HTMLButtonElement>('.top-places-slot .top-place-body')?.click();
  }

  it('fills the detail card from whichever list the place was picked in', async () => {
    const root = document.createElement('div');

    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });
    expect(root.querySelector('.detail-slot')?.textContent).toContain(DETAIL_EMPTY_MESSAGE);

    root
      .querySelector<HTMLButtonElement>('.place-search-list .place-select[data-place-id="restaurant_000003"]')
      ?.click();

    expect(root.querySelector('.detail-slot')?.textContent).toContain('황새울분식');
    expect(root.querySelector<HTMLAnchorElement>('.place-detail-link')?.rel).toBe(
      'noopener noreferrer',
    );
  });

  it('re-derives the selected place\'s figures when the period changes', async () => {
    const root = document.createElement('div');

    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });
    selectFirstTopPlace(root);
    const detail = () => root.querySelector('.detail-slot')?.textContent ?? '';

    // 한밭식당 tops the default 1y window with 4 visits; the 1m window holds 2 of them.
    expect(detail()).toContain(periodStatsHeading('1y'));
    expect(detail()).toContain('4회');

    periodButton(root, PERIOD_LABELS['1m'])?.click();

    expect(detail()).toContain(periodStatsHeading('1m'));
    expect(detail()).toContain('2회');
  });

  it('leaves the lists untouched when a place is selected', async () => {
    const root = document.createElement('div');
    document.body.append(root);

    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });
    const searchInput = root.querySelector<HTMLInputElement>('.place-search-input');
    const trendingList = root.querySelector('.trending-slot .discovery-list');
    const button = root.querySelector<HTMLButtonElement>('.top-places-slot .top-place-body');
    button?.focus();
    button?.click();

    // Only the detail container is replaced — an in-progress search query and the discovery list
    // survive the selection, asserted by node identity rather than by where focus ended up.
    expect(root.querySelector('.place-search-input')).toBe(searchInput);
    expect(root.querySelector('.trending-slot .discovery-list')).toBe(trendingList);
    // Focus moves into the card on purpose: it is the last section on the page, so a selection
    // that left focus on the button would be invisible at 360px.
    expect(document.activeElement).toBe(root.querySelector('.place-detail'));
    expect(button).not.toBe(null);
    root.remove();
  });
});

describe('bootstrap map wiring', () => {
  /** Lets the fire-and-forget map render settle before the assertions run. */
  const flush = (): Promise<void> => Promise.resolve().then(() => {});

  it('places the map between search and the discovery sections', async () => {
    const root = document.createElement('div');
    const api = createFakeNaverApi();

    await bootstrap(root, {
      load: () => Promise.resolve(SAMPLE_DATASET),
      map: { loadApi: () => Promise.resolve(api) },
    });
    await flush();

    const slots = [...(root.querySelector('#content')?.children ?? [])].map(
      (child) => child.className,
    );
    expect(slots.indexOf('map-slot')).toBeGreaterThan(slots.indexOf('search-slot'));
    expect(slots.indexOf('map-slot')).toBeLessThan(slots.indexOf('trending-slot'));
    expect(api.markers).toHaveLength(SAMPLE_DATASET.places.length);
  });

  it('re-badges the markers when the period changes', async () => {
    const root = document.createElement('div');
    const api = createFakeNaverApi();

    await bootstrap(root, {
      load: () => Promise.resolve(SAMPLE_DATASET),
      map: { loadApi: () => Promise.resolve(api) },
    });
    await flush();

    const before = api.markers.map((marker) => marker.icon?.content);
    periodButton(root, PERIOD_LABELS['1m'])?.click();

    expect(api.markers.map((marker) => marker.icon?.content)).not.toEqual(before);
    // The map instance survives a period change; only the icons are swapped.
    expect(api.maps).toHaveLength(1);
  });

  it('marks the map selection when a place is picked from the list', async () => {
    const root = document.createElement('div');
    const api = createFakeNaverApi();

    await bootstrap(root, {
      load: () => Promise.resolve(SAMPLE_DATASET),
      map: { loadApi: () => Promise.resolve(api) },
    });
    await flush();

    root.querySelector<HTMLButtonElement>('.top-places-slot .top-place-body')?.click();

    const selected = api.markers.filter((marker) =>
      marker.icon?.content.includes('data-selected="true"'),
    );
    expect(selected).toHaveLength(1);
  });

  it('keeps the rest of the page working when the map script never loads', async () => {
    const root = document.createElement('div');

    await bootstrap(root, {
      load: () => Promise.resolve(SAMPLE_DATASET),
      map: { loadApi: () => Promise.reject(new Error('blocked')) },
    });
    await flush();

    expect(root.querySelector('.map-slot')?.textContent).toContain(MAP_ERROR_MESSAGE);
    expect(root.textContent).toContain(topPlacesHeading(6));
    expect(root.textContent).not.toContain(LOAD_ERROR_MESSAGE);
    expect(root.querySelector('.search-slot')).not.toBeNull();
    // A period change must still work with no map behind it.
    expect(() => periodButton(root, PERIOD_LABELS['1m'])?.click()).not.toThrow();
  });
});
