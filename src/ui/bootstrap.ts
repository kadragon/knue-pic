import { loadPlacesDataset } from '../data/load';
import type { Period, PlacesDataset } from '../data/types';
import type { PlaceMapHandle, RenderPlaceMapOptions } from '../map/place-map';
import { renderPlaceMap } from '../map/place-map';
import { computeNewlySeenPlaces, computeTrendingPlaces } from '../stats/discovery';
import { computeMonthlyHistogram } from '../stats/histogram';
import { computePlaceStats } from '../stats/place-stats';
import { resolvePeriodWindow } from '../stats/period';
import { computeTopPlaces } from '../stats/top-places';
import type { PlaceDetail } from './place-detail';
import { renderLoadFailure, renderLoading } from './data-state';
import { createDetailDialog } from './detail-dialog';
import { renderNewlySeenPlaces, renderTrendingPlaces } from './discovery';
import { markSelectedPeriod, renderPeriodSelector } from './period-selector';
import { renderPlaceSearch } from './search';
import { renderShell, setShellUpdatedAt } from './shell';
import { renderTopPlaces } from './top-places';

/**
 * Wires the page frame to the dataset: shell first, then the load, then whichever state the load
 * ended in. A successful load renders the period selector, the ranked list, search, the map and the
 * detail card into `#content`.
 *
 * `load` is injectable so this is testable without stubbing global `fetch`, and `map` carries the
 * same injection down to the map module — jsdom cannot run the Naver script, so the fake API goes
 * in the same way.
 */
export interface BootstrapOptions {
  load?: () => Promise<PlacesDataset>;
  map?: RenderPlaceMapOptions;
}

/**
 * `1y` is the only window whose prior period lies outside the retained range, so it shows no rank
 * deltas — but it is also the window that shows every place the file knows about, which is the
 * right first impression for a discovery tool.
 */
const DEFAULT_PERIOD: Period = '1y';

export async function bootstrap(root: HTMLElement, options: BootstrapOptions = {}): Promise<void> {
  const { load = () => loadPlacesDataset(), map: mapOptions = {} } = options;

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
      // The retry button lived in `#content` and the successful render replaced it, so the focus
      // the user was holding has nowhere to return to. Moving it to the content region — the
      // failure branch's `retry.focus()` in the other direction — announces the loaded page
      // instead of silently dropping the caret to the top of the document.
      if (retriedByUser) content.focus();
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
   * Source order follows the reflow order in `docs/conventions.md` → Accessibility & Responsive:
   * TOP 10, then search, then the map, with the two discovery sections after it. The detail card is
   * no longer part of that flow — `.detail-slot` holds a dialog, so selecting a place opens over
   * the list the user was reading instead of throwing them to the bottom of the page.
   */
  function renderDataset(dataset: PlacesDataset): void {
    // The frame is never rebuilt here: `renderShell` would replace `root` and detach the `content`
    // node captured above, taking whatever held focus with it. Only the provenance date changes,
    // and `setShellUpdatedAt` writes it in place.
    setShellUpdatedAt(root, dataset.updatedAt);

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
    const map = document.createElement('div');
    map.className = 'map-slot';
    const detail = document.createElement('div');
    detail.className = 'detail-slot';
    content.replaceChildren(controls, list, search, map, trending, newlySeen, detail);

    let selectedPlaceId: string | null = null;
    let currentPeriod: Period = DEFAULT_PERIOD;
    // Resolved once the map script settles. Until then — and forever, if it never loads — every
    // call against it is a no-op, so nothing else on the page waits on the map.
    let mapHandle: PlaceMapHandle | null = null;

    const dialog = createDetailDialog(detail);

    /** `null` when nothing is selected, or when the selection is not in the dataset. */
    function currentDetail(): PlaceDetail | null {
      const place = dataset.places.find((candidate) => candidate.id === selectedPlaceId);
      if (!place) return null;

      return {
        place,
        period: currentPeriod,
        stats: computePlaceStats(place, resolvePeriodWindow(currentPeriod, dataset.updatedAt)),
        histogram: computeMonthlyHistogram(place, dataset.updatedAt),
      };
    }

    /** Repaints an open dialog after the period changes; a no-op when nothing is open. */
    function refreshDetail(): void {
      const next = currentDetail();
      if (next) dialog.update(next);
    }

    /**
     * Opens the detail dialog over whatever the user was reading.
     *
     * The dialog moves focus into itself and hands it back to this control on close, so the
     * selection is announced and reversible without the user losing their place in the list —
     * which is what the card being the page's last section used to cost them.
     */
    function selectPlace(placeId: string): void {
      selectedPlaceId = placeId;
      const next = currentDetail();
      if (!next) return;
      mapHandle?.select(placeId);
      dialog.open(next);
    }

    // Ranking the default period is the most expensive thing the initial render does; the map, the
    // list and the detail card all want the same result, so it is computed once and passed around.
    const initialTop = computeTopPlaces(dataset, DEFAULT_PERIOD);

    function show(period: Period): void {
      currentPeriod = period;
      markSelectedPeriod(controls, period);
      const top = period === DEFAULT_PERIOD ? initialTop : computeTopPlaces(dataset, period);
      renderTopPlaces(list, top, selectPlace);
      // Re-badges the existing markers; the map instance and the user's viewport survive.
      mapHandle?.update(top);
      refreshDetail();
    }

    /**
     * Fire-and-forget: the map is the one view that depends on a third-party script, and
     * `renderPlaceMap` resolves even when that script never arrives (it renders the documented
     * fallback instead). Awaiting it here would hold the rest of the page behind a network round
     * trip for no gain.
     */
    void renderPlaceMap(map, dataset, initialTop, selectPlace, mapOptions)
      .then((handle) => {
        mapHandle = handle;
        // The period or the selection may have moved while the script was in flight; only then is
        // a second aggregation worth paying for.
        if (currentPeriod !== DEFAULT_PERIOD) handle.update(computeTopPlaces(dataset, currentPeriod));
        handle.select(selectedPlaceId);
      })
      // `renderPlaceMap` resolves on every failure it knows about; this catches the ones it does
      // not — a real map object throwing from a handle call — so the map can never surface as an
      // unhandled rejection on a page that is otherwise fine.
      .catch(() => {});

    renderPeriodSelector(controls, DEFAULT_PERIOD, show);
    renderTrendingPlaces(trending, computeTrendingPlaces(dataset), selectPlace);
    renderNewlySeenPlaces(newlySeen, computeNewlySeenPlaces(dataset), selectPlace);
    renderPlaceSearch(search, dataset, selectPlace);
    show(DEFAULT_PERIOD);
  }

  function renderFrame(): HTMLElement {
    renderShell(root);

    const slot = root.querySelector<HTMLElement>('#content');
    if (!slot) {
      throw new Error('renderShell did not produce a #content slot');
    }
    // `-1` so only script can move focus here: the region is a landing spot after a retry, never
    // an extra tab stop on the way through the page.
    slot.tabIndex = -1;
    return slot;
  }

  await attempt();
}
