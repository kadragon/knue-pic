import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import { bootstrap } from './bootstrap';
import { LOADING_MESSAGE, LOAD_ERROR_MESSAGE, RETRY_LABEL } from './data-state';
import { DISCLAIMER, SOURCE_LINE } from './shell';

function retryButton(root: HTMLElement): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>('.data-state-retry');
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

  it('shows the dataset update date and an empty content slot once loaded', async () => {
    const root = document.createElement('div');

    await bootstrap(root, { load: () => Promise.resolve(SAMPLE_DATASET) });

    expect(root.textContent).toContain(`최근 데이터 업데이트: ${SAMPLE_DATASET.updatedAt}`);
    expect(root.textContent).not.toContain(LOADING_MESSAGE);
    expect(root.querySelector('#content')?.childElementCount).toBe(0);
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
