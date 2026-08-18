import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import { bootstrap } from './bootstrap';
import { LOADING_MESSAGE, LOAD_ERROR_MESSAGE, RETRY_LABEL } from './data-state';
import { PERIOD_LABELS } from './period-selector';
import { DISCLAIMER, SOURCE_LINE } from './shell';
import { TOP_PLACES_HEADING } from './top-places';

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
    expect(root.querySelector('#content')?.textContent).toContain(TOP_PLACES_HEADING);
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
    expect(root.textContent).not.toContain('황새울분식');
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
