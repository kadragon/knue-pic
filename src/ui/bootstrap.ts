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

  async function attempt(): Promise<void> {
    const content = renderFrame();
    renderLoading(content);

    try {
      const dataset = await load();
      renderFrame(dataset.updatedAt);
    } catch {
      // The reason is deliberately dropped: every failure reads the same to the user, and
      // `data-state.ts` owns the wording. Retry re-runs the whole attempt, so a transient
      // network failure is recoverable without a reload.
      renderLoadFailure(content, () => void attempt());
    }
  }

  function renderFrame(updatedAt?: string): HTMLElement {
    renderShell(root, updatedAt === undefined ? {} : { updatedAt });

    const content = root.querySelector<HTMLElement>('#content');
    if (!content) {
      throw new Error('renderShell did not produce a #content slot');
    }
    return content;
  }

  await attempt();
}
