import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import { createFakeNaverApi } from '../map/fake-naver-api';
import { MAP_ERROR_MESSAGE, renderPlaceLocationMap } from '../map/place-map';
import { bootstrap } from './bootstrap';
import { LOADING_MESSAGE, LOAD_ERROR_MESSAGE, RETRY_LABEL } from './data-state';
import { PERIOD_LABELS } from './period-labels';
import { COLUMN_LABELS, COLUMN_ORDER, columnHeading } from './place-columns';
import { periodStatsHeading } from './place-detail';
import { DISCLAIMER, SOURCE_LINE } from './shell';

function retryButton(root: HTMLElement): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>('.data-state-retry');
}

function columnTab(root: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>('.place-column-tab')].find(
    (button) => button.textContent === label,
  );
}

function pressedTab(root: HTMLElement): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>('.place-column-tab')].find(
    (button) => button.getAttribute('aria-pressed') === 'true',
  );
}

/** The first row of one column, which is how every selection case opens the dialog. */
function firstRow(root: HTMLElement, column: string): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>(
    `.place-column[data-column="${column}"] .top-place-body, ` +
      `.place-column[data-column="${column}"] .place-select`,
  );
}

/** Lets the dialog's fire-and-forget map render settle before the assertions run. */
const flush = (): Promise<void> => Promise.resolve().then(() => {});

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

  it('shows the dataset update date and the four columns once loaded', async () => {
    const root = document.createElement('div');

    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });

    expect(root.textContent).toContain(`최근 데이터 업데이트: ${SAMPLE_DATASET.updatedAt}`);
    expect(root.textContent).not.toContain(LOADING_MESSAGE);
    expect(root.querySelector('#content')?.textContent).toContain(
      columnHeading(PERIOD_LABELS['1y'], 6),
    );
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

describe('bootstrap columns', () => {
  it('renders the four windows side by side, in order', async () => {
    const root = document.createElement('div');

    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });

    const columns = [...root.querySelectorAll<HTMLElement>('.place-column')];
    expect(columns.map((column) => column.dataset['column'])).toEqual(COLUMN_ORDER);
    for (const column of columns) {
      expect(column.querySelector('h2')?.textContent).toContain(
        COLUMN_LABELS[column.dataset['column'] as keyof typeof COLUMN_LABELS],
      );
    }
  });

  it('ranks each column over its own window', async () => {
    const root = document.createElement('div');

    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });

    // 1y ranks all six fixture places; 1m ranks five — 000003 has no visit in that window.
    expect(root.querySelectorAll('.place-column[data-column="1y"] .top-place')).toHaveLength(6);
    expect(root.querySelectorAll('.place-column[data-column="1m"] .top-place')).toHaveLength(5);
    expect(root.querySelector('.place-column[data-column="1m"]')?.textContent).not.toContain(
      '황새울분식',
    );
  });

  it('shows the picked column\'s window in the dialog', async () => {
    const root = document.createElement('div');

    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });
    firstRow(root, '6m')?.click();

    expect(root.querySelector('.detail-slot')?.textContent).toContain(periodStatsHeading('6m'));
  });

  it('shows a place picked from the trending column over the month it trended in', async () => {
    const root = document.createElement('div');

    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });
    firstRow(root, 'trending')?.click();

    // Trending is measured over the recent month, so those are the figures the dialog states.
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
    expect(root.querySelector('.detail-slot')?.textContent).toContain(periodStatsHeading('1y'));
  });

  it('opens the tab switch on the trending column and flips it in place', async () => {
    const root = document.createElement('div');
    document.body.append(root);

    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });
    expect(pressedTab(root)?.textContent).toBe(COLUMN_LABELS['trending']);

    const button = columnTab(root, PERIOD_LABELS['6m']);
    button?.focus();
    button?.click();

    expect(pressedTab(root)).toBe(button);
    expect(root.querySelector<HTMLElement>('.place-columns-grid')?.dataset['active']).toBe('6m');
    // Rebuilding the tabs on every change would drop focus to the document body.
    expect(document.activeElement).toBe(button);
    root.remove();
  });
});

describe('bootstrap place selection', () => {
  it('opens the dialog only once a place is picked', async () => {
    const root = document.createElement('div');

    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });
    // Nothing selected yet: the dialog exists but is not shown, so the page does not end in an
    // empty card explaining a feature the visitor has not used.
    expect(root.querySelector<HTMLElement>('.detail-dialog')?.hidden).toBe(true);

    firstRow(root, '1y')?.click();

    expect(root.querySelector<HTMLElement>('.detail-dialog')?.hidden).toBe(false);
    expect(root.querySelector<HTMLAnchorElement>('.place-detail-link')?.rel).toBe(
      'noopener noreferrer',
    );
  });

  it('leaves the columns and the search query untouched when a place is selected', async () => {
    const root = document.createElement('div');
    document.body.append(root);

    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });
    const searchInput = root.querySelector<HTMLInputElement>('.place-search-input');
    const trendingList = root.querySelector('.place-column[data-column="trending"] .discovery-list');
    const button = firstRow(root, '1y');
    button?.focus();
    button?.click();

    // Only the dialog body is repainted — an in-progress search query and the columns survive the
    // selection, asserted by node identity rather than by where focus ended up.
    expect(root.querySelector('.place-search-input')).toBe(searchInput);
    expect(root.querySelector('.place-column[data-column="trending"] .discovery-list')).toBe(
      trendingList,
    );
    // Focus moves into the dialog so the selection is announced rather than happening off-screen.
    expect(document.activeElement).toBe(root.querySelector('.detail-dialog-panel'));
    root.remove();
  });

  it('returns focus to the row that opened the dialog when it is closed', async () => {
    const root = document.createElement('div');
    document.body.append(root);

    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });
    const button = firstRow(root, '1y');
    button?.focus();
    button?.click();
    root.querySelector<HTMLButtonElement>('.detail-dialog-close')?.click();

    // The whole point of the dialog over the old bottom-of-page card: the reader keeps their place
    // in the list they were reading.
    expect(root.querySelector<HTMLElement>('.detail-dialog')?.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
    root.remove();
  });
});

describe('bootstrap map wiring', () => {
  it('mounts the selected place on the map inside the dialog', async () => {
    const root = document.createElement('div');
    const api = createFakeNaverApi();

    await bootstrap(root, {
      load: () => Promise.resolve(SAMPLE_DATASET),
      dialog: {
        renderMap: (container, place) =>
          renderPlaceLocationMap(container, place, { loadApi: () => Promise.resolve(api) }),
      },
    });
    // The map is mounted on selection, not on load: nothing is picked yet.
    expect(api.markers).toHaveLength(0);

    firstRow(root, '1y')?.click();
    await flush();

    expect(api.markers).toHaveLength(1);
    const selected = SAMPLE_DATASET.places.find((place) =>
      api.markers[0]?.options.title?.startsWith(place.name),
    );
    expect(api.markers[0]?.options.position.lat()).toBe(selected?.lat);
    expect(root.querySelector('.detail-slot .place-map-canvas')).toBeInstanceOf(HTMLElement);
  });

  it('keeps the figures and the rest of the page when the map script never loads', async () => {
    const root = document.createElement('div');

    await bootstrap(root, {
      load: () => Promise.resolve(SAMPLE_DATASET),
      dialog: {
        renderMap: (container, place) =>
          renderPlaceLocationMap(container, place, {
            loadApi: () => Promise.reject(new Error('blocked')),
          }),
      },
    });
    firstRow(root, '1y')?.click();
    await flush();

    expect(root.querySelector('.detail-slot')?.textContent).toContain(MAP_ERROR_MESSAGE);
    // The statistics are what the dialog is for; the map failing may never take them with it.
    expect(root.querySelector('.place-detail-figures')).not.toBeNull();
    expect(root.textContent).toContain(columnHeading(PERIOD_LABELS['1y'], 6));
    expect(root.textContent).not.toContain(LOAD_ERROR_MESSAGE);
    expect(root.querySelector('.search-slot')).not.toBeNull();
  });
});
