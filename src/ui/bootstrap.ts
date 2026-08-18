import { loadPlacesDataset } from '../data/load';
import type { Period, PlacesDataset } from '../data/types';
import { computeTopPlaces } from '../stats/top-places';
import { renderLoadFailure, renderLoading } from './data-state';
import { markSelectedPeriod, renderPeriodSelector } from './period-selector';
import { renderShell } from './shell';
import { renderTopPlaces } from './top-places';

/**
 * Wires the page frame to the dataset: shell first, then the load, then whichever state the load
 * ended in. A successful load renders the period selector and the ranked list into `#content`; the
 * map and the detail card fill in later work.
 *
 * `load` is injectable so this is testable without stubbing global `fetch`.
 */
export interface BootstrapOptions {
  load?: () => Promise<PlacesDataset>;
}

/**
 * `1y` is the only window whose prior period lies outside the retained range, so it shows no rank
 * deltas — but it is also the window that shows every place the file knows about, which is the
 * right first impression for a discovery tool.
 */
const DEFAULT_PERIOD: Period = '1y';

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
      renderDataset(dataset);
    } catch {
      // The reason is deliberately dropped: every failure reads the same to the user, and
      // `data-state.ts` owns the wording. Retry re-runs the whole attempt, so a transient
      // network failure is recoverable without a reload.
      const retry = renderLoadFailure(content, onRetry);
      if (retriedByUser) retry.focus();
    }
  }

  /**
   * Changing the period swaps the list container's contents and flips `aria-pressed` in place. The
   * selector element itself is never rebuilt, so the button the user just pressed keeps focus.
   */
  function renderDataset(dataset: PlacesDataset): void {
    const slot = renderFrame(dataset.updatedAt);

    const controls = document.createElement('div');
    controls.className = 'period-controls';
    const list = document.createElement('div');
    list.className = 'top-places-slot';
    slot.replaceChildren(controls, list);

    function show(period: Period): void {
      markSelectedPeriod(controls, period);
      renderTopPlaces(list, computeTopPlaces(dataset, period));
    }

    renderPeriodSelector(controls, DEFAULT_PERIOD, show);
    show(DEFAULT_PERIOD);
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
