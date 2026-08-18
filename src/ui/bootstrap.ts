import { loadPlacesDataset } from '../data/load';
import type { Period, PlacesDataset } from '../data/types';
import { computeNewlySeenPlaces, computeTrendingPlaces } from '../stats/discovery';
import { computeMonthlyHistogram } from '../stats/histogram';
import { computePlaceStats } from '../stats/place-stats';
import { resolvePeriodWindow } from '../stats/period';
import { computeTopPlaces } from '../stats/top-places';
import { renderLoadFailure, renderLoading } from './data-state';
import { renderNewlySeenPlaces, renderTrendingPlaces } from './discovery';
import { markSelectedPeriod, renderPeriodSelector } from './period-selector';
import { renderPlaceDetail } from './place-detail';
import { renderPlaceSearch } from './search';
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
   *
   * Each view owns its own container, and only the containers whose contents actually changed are
   * replaced. That is what keeps focus where the user left it: selecting a place rebuilds the
   * detail card alone, and the trending / newly-seen sections — whose windows are fixed by
   * `docs/conventions.md` → Statistics Rules and do not follow the selector — are rendered once.
   *
   * Order follows `docs/conventions.md` → Accessibility & Responsive verbatim: TOP 10, then search,
   * then the detail card. The two discovery sections take the gap the map will occupy — the four
   * documented sections keep their relative order either way, and putting discovery ahead of search
   * would break the one ordering the doc actually states.
   */
  function renderDataset(dataset: PlacesDataset): void {
    const slot = renderFrame(dataset.updatedAt);

    const controls = document.createElement('div');
    controls.className = 'period-controls';
    const list = document.createElement('div');
    list.className = 'top-places-slot';
    const trending = document.createElement('div');
    trending.className = 'trending-slot';
    const newlySeen = document.createElement('div');
    newlySeen.className = 'newly-seen-slot';
    const search = document.createElement('div');
    search.className = 'search-slot';
    const detail = document.createElement('div');
    detail.className = 'detail-slot';
    slot.replaceChildren(controls, list, search, trending, newlySeen, detail);

    let selectedPlaceId: string | null = null;
    let currentPeriod: Period = DEFAULT_PERIOD;

    function showDetail(): void {
      const place = dataset.places.find((candidate) => candidate.id === selectedPlaceId);
      if (!place) {
        renderPlaceDetail(detail, null);
        return;
      }

      renderPlaceDetail(detail, {
        place,
        period: currentPeriod,
        stats: computePlaceStats(place, resolvePeriodWindow(currentPeriod, dataset.updatedAt)),
        histogram: computeMonthlyHistogram(place, dataset.updatedAt),
      });
    }

    /**
     * Moves focus into the card after rendering it.
     *
     * The card is the last section on the page, so on a 360px screen a selection made from a list
     * above it changes nothing the user can see. Focusing it scrolls it into view and announces it,
     * which is the difference between a working control and one that reads as a no-op. Focus moves
     * only here — `show()` must leave it on the period button the user just pressed.
     */
    function selectPlace(placeId: string): void {
      selectedPlaceId = placeId;
      showDetail();
      detail.querySelector<HTMLElement>('.place-detail')?.focus();
    }

    function show(period: Period): void {
      currentPeriod = period;
      markSelectedPeriod(controls, period);
      renderTopPlaces(list, computeTopPlaces(dataset, period), selectPlace);
      showDetail();
    }

    renderPeriodSelector(controls, DEFAULT_PERIOD, show);
    renderTrendingPlaces(trending, computeTrendingPlaces(dataset), selectPlace);
    renderNewlySeenPlaces(newlySeen, computeNewlySeenPlaces(dataset), selectPlace);
    renderPlaceSearch(search, dataset, selectPlace);
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
