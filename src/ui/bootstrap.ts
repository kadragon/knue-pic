import { loadPlacesDataset } from '../data/load';
import type { PlacesDataset } from '../data/types';
import { renderLoadFailure, renderLoading } from './data-state';
import { renderShell } from './shell';

/**
 * Wires the page frame to the dataset: shell first, then the load, then whichever state the load
 * ended in. Feature views (TOP 10, map, detail) fill `#content` in later work; until then a
 * successful load leaves the slot empty and only the footer's update date changes.
 *
 * `load` is injectable so this is testable without stubbing global `fetch`.
 */
export interface BootstrapOptions {
  load?: () => Promise<PlacesDataset>;
}

export async function bootstrap(root: HTMLElement, options: BootstrapOptions = {}): Promise<void> {
  const { load = () => loadPlacesDataset() } = options;

  // Rendered once. A retry re-renders `#content` alone: re-rendering the shell would destroy the
  // button the user just pressed and drop keyboard focus to the top of the document.
  const content = renderFrame();
  let retriedByUser = false;

  function onRetry(): void {
    retriedByUser = true;
    void attempt();
  }

  async function attempt(): Promise<void> {
    renderLoading(content);

    try {
      const dataset = await load();
      renderFrame(dataset.updatedAt);
    } catch {
      // The reason is deliberately dropped: every failure reads the same to the user, and
      // `data-state.ts` owns the wording. Retry re-runs the whole attempt, so a transient
      // network failure is recoverable without a reload.
      const retry = renderLoadFailure(content, onRetry);
      if (retriedByUser) retry.focus();
    }
  }

  function renderFrame(updatedAt?: string): HTMLElement {
    renderShell(root, updatedAt === undefined ? {} : { updatedAt });

    const slot = root.querySelector<HTMLElement>('#content');
    if (!slot) {
      throw new Error('renderShell did not produce a #content slot');
    }
    return slot;
  }

  await attempt();
}
