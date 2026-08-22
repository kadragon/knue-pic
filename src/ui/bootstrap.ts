import { loadPlacesDataset } from '../data/load';
import type { Period, PlacesDataset } from '../data/types';
import { computeMonthlyHistogram } from '../stats/histogram';
import { computePlaceStats } from '../stats/place-stats';
import { resolvePeriodWindow } from '../stats/period';
import type { PlaceDetail } from './place-detail';
import { renderLoadFailure, renderLoading } from './data-state';
import { createDetailDialog, type DetailDialogOptions } from './detail-dialog';
import { renderPlaceColumns } from './place-columns';
import { renderPlaceSearch } from './search';
import { renderShell, setShellUpdatedAt } from './shell';

/**
 * Wires the page frame to the dataset: shell first, then the load, then whichever state the load
 * ended in. A successful load renders search, the four discovery columns and the detail dialog into
 * `#content`.
 *
 * `load` is injectable so this is testable without stubbing global `fetch`, and `dialog` carries
 * the same injection down to the map — jsdom cannot run the Naver script, so the fake API goes in
 * the same way.
 */
export interface BootstrapOptions {
  load?: () => Promise<PlacesDataset>;
  dialog?: DetailDialogOptions;
}

/**
 * The window a place selected from search is shown under.
 *
 * Search spans the whole dataset rather than a column, so there is no window it was picked from;
 * `1y` is the only one that covers everything the file retains, which makes it the honest default
 * for a place the reader found by name.
 */
const SEARCH_PERIOD: Period = '1y';

export async function bootstrap(root: HTMLElement, options: BootstrapOptions = {}): Promise<void> {
  const { load = () => loadPlacesDataset(), dialog: dialogOptions = {} } = options;

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
   * Each view owns its own container and is rendered exactly once: the four columns show four fixed
   * windows, so nothing on the page swaps a list any more. Selecting a place rebuilds the dialog
   * alone, which is what keeps the row the reader pressed alive to hand focus back to on close.
   *
   * Source order — search, then the columns — follows `docs/conventions.md` → Accessibility &
   * Responsive. The dialog is not part of that flow: `.detail-slot` holds a modal, so selecting a
   * place opens over the column the reader was in rather than moving them somewhere else.
   */
  function renderDataset(dataset: PlacesDataset): void {
    // The frame is never rebuilt here: `renderShell` would replace `root` and detach the `content`
    // node captured above, taking whatever held focus with it. Only the provenance date changes,
    // and `setShellUpdatedAt` writes it in place.
    setShellUpdatedAt(root, dataset.updatedAt);

    const search = document.createElement('div');
    search.className = 'search-slot';
    const columns = document.createElement('div');
    columns.className = 'place-columns-slot';
    const detail = document.createElement('div');
    detail.className = 'detail-slot';
    content.replaceChildren(search, columns, detail);

    const dialog = createDetailDialog(detail, dialogOptions);

    /** `null` when the selection is not in the dataset. */
    function currentDetail(placeId: string, period: Period): PlaceDetail | null {
      const place = dataset.places.find((candidate) => candidate.id === placeId);
      if (!place) return null;

      return {
        place,
        period,
        stats: computePlaceStats(place, resolvePeriodWindow(period, dataset.updatedAt)),
        histogram: computeMonthlyHistogram(place, dataset.updatedAt),
      };
    }

    /**
     * Opens the detail dialog over whatever the reader was looking at.
     *
     * `period` is the window the place was picked from — the column's own — so the figures answer
     * the list the reader was reading rather than a period they never chose. The dialog moves focus
     * into itself and hands it back to this control on close.
     */
    function selectPlace(placeId: string, period: Period): void {
      const next = currentDetail(placeId, period);
      if (!next) return;
      dialog.open(next);
    }

    renderPlaceSearch(search, dataset, (placeId) => {
      selectPlace(placeId, SEARCH_PERIOD);
    });
    renderPlaceColumns(columns, dataset, selectPlace);
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
