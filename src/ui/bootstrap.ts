import { loadPlacesDataset } from '../data/load';
import type { Period, PlacesDataset } from '../data/types';
import { computeMonthlyHistogram } from '../stats/histogram';
import { filterByKind } from '../stats/search';
import { computePlaceStats } from '../stats/place-stats';
import { resolvePeriodWindow } from '../stats/period';
import type { PlaceDetail } from './place-detail';
import { renderLoadFailure, renderLoading } from './data-state';
import { createDetailDialog, type DetailDialogOptions } from './detail-dialog';
import { renderKindFilter, markActiveKind, type KindSelection } from './kind-filter';
import { COLUMN_ORDER, renderPlaceColumns, type ColumnKey } from './place-columns';
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

  /**
   * Held here rather than in the views because both of them are rebuilt from it: the kind decides
   * what the columns and the search are computed over, and the column decides which of the four is
   * on screen once a narrow viewport has collapsed them to one. A view that owned either would lose
   * it on the next re-render.
   */
  let activeKind: KindSelection = null;
  let activeColumn: ColumnKey = COLUMN_ORDER[0]!;

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

    const kinds = document.createElement('div');
    kinds.className = 'kind-filter-slot';
    const search = document.createElement('div');
    search.className = 'search-slot';
    const columns = document.createElement('div');
    columns.className = 'place-columns-slot';
    const detail = document.createElement('div');
    detail.className = 'detail-slot';
    content.replaceChildren(kinds, search, columns, detail);

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

    // Narrowed even on the first render: `renderDataset` runs again after a failed load's retry,
    // and a selection made before that would otherwise come back silently cleared on the lists
    // while the control still showed it as pressed.
    const initial = filterByKind(dataset, activeKind);

    const searchView = renderPlaceSearch(search, initial, (placeId) => {
      selectPlace(placeId, SEARCH_PERIOD);
    });
    renderPlaceColumns(columns, initial, selectPlace, {
      active: activeColumn,
      onActiveChange: (column) => {
        activeColumn = column;
      },
    });
    renderKindFilter(kinds, activeKind, selectKind);

    /**
     * One narrowed dataset feeds both views, so the columns and the search can never disagree about
     * what is being shown. The search is updated through its handle rather than re-rendered — a
     * rebuild would discard whatever the reader had typed — while the columns are recomputed, since
     * their rankings are derived from the set that just changed.
     *
     * `selectPlace` deliberately keeps reading the *unfiltered* dataset: the dialog is opened from a
     * row that was on screen, and looking the place up in the narrowed set would make a selection
     * fail silently the moment the two got out of step.
     */
    function selectKind(kind: KindSelection): void {
      activeKind = kind;
      markActiveKind(kinds, kind);

      const narrowed = filterByKind(dataset, kind);
      searchView.setDataset(narrowed);
      renderPlaceColumns(columns, narrowed, selectPlace, {
        active: activeColumn,
        onActiveChange: (column) => {
          activeColumn = column;
        },
      });
    }
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
