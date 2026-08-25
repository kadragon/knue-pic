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
import { DEFAULT_PERIOD, renderPlaceList } from './place-list';
import { renderPlaceSearch } from './search';
import { renderShell, setShellUpdatedAt } from './shell';

/**
 * Wires the page frame to the dataset: shell first, then the load, then whichever state the load
 * ended in. A successful load renders search, the ranked list with its period selector and the
 * detail dialog into `#content`.
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
 * Search spans the whole dataset rather than the selected window, so there is no period it was
 * picked from;
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
   * Held here rather than in the views because both are rebuilt from it: the kind decides what the
   * list and the search are computed over, and the period decides which window the list ranks. A
   * view that owned either would lose it on the next re-render — changing 업종 would silently throw
   * the reader back to the default window.
   */
  let activeKind: KindSelection = null;
  /** The window the page opens on; `place-list.ts` states why it is 최근 3개월 and not another. */
  let activePeriod: Period = DEFAULT_PERIOD;

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
   * Each view owns its own container. Selecting a place rebuilds the dialog alone, which is what
   * keeps the row the reader pressed alive to hand focus back to on close; selecting a period
   * rebuilds the list alone, inside `place-list.ts`, leaving the pressed button holding focus.
   *
   * Source order — search, then the list — follows `docs/conventions.md` → Accessibility &
   * Responsive. The dialog is not part of that flow: `.detail-slot` holds a modal, so selecting a
   * place opens over the list the reader was in rather than moving them somewhere else.
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
    const list = document.createElement('div');
    list.className = 'place-list-slot';
    const detail = document.createElement('div');
    detail.className = 'detail-slot';
    content.replaceChildren(kinds, search, list, detail);

    const dialog = createDetailDialog(detail, dialogOptions);

    /** `null` when the selection is not in the dataset. */
    function currentDetail(placeId: string, basis: Period): PlaceDetail | null {
      const place = dataset.places.find((candidate) => candidate.id === placeId);
      if (!place) return null;

      return {
        place,
        basis,
        stats: computePlaceStats(place, resolvePeriodWindow(basis, dataset.updatedAt)),
        histogram: computeMonthlyHistogram(place, dataset.updatedAt),
      };
    }

    /**
     * Opens the detail dialog over whatever the reader was looking at.
     *
     * `basis` is the window the place was picked from — the selected period, or `SEARCH_PERIOD` for
     * a search hit — so the figures answer the list the reader was reading rather than a window they
     * never chose. The dialog moves focus
     * into itself and hands it back to this control on close.
     */
    function selectPlace(placeId: string, basis: Period): void {
      const next = currentDetail(placeId, basis);
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
    renderPlaceList(list, initial, selectPlace, {
      active: activePeriod,
      onActiveChange: (period) => {
        activePeriod = period;
      },
    });
    renderKindFilter(kinds, activeKind, selectKind);

    /**
     * One narrowed dataset feeds both views, so the list and the search can never disagree about
     * what is being shown. The search is updated through its handle rather than re-rendered — a
     * rebuild would discard whatever the reader had typed — while the list is recomputed, since its
     * ranking is derived from the set that just changed.
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
      renderPlaceList(list, narrowed, selectPlace, {
        active: activePeriod,
        onActiveChange: (period) => {
          activePeriod = period;
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
