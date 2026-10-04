import { loadPlacesDataset } from '../data/load';
import type { Period, PlaceRecord, PlacesDataset } from '../data/types';
import { computeMonthlyHistogram } from '../stats/histogram';
import { filterByKind } from '../stats/search';
import { computeKindPlaceCounts, computeWindowSummary } from '../stats/window-summary';
import { computePlaceStats } from '../stats/place-stats';
import { CAMPUS_ORIGIN } from '../stats/distance';
import { resolvePeriodWindow } from '../stats/period';
import { renderPageMap, type PageMapHandle, type PageMapPlace } from '../map/place-map';
import type { PlaceDetail } from './place-detail';
import { renderLoadFailure, renderLoading } from './data-state';
import { createDetailPanel, type DetailPanelHandle } from './detail-panel';
import {
  renderKindFilter,
  markActiveKind,
  setKindCounts,
  type KindSelection,
} from './kind-filter';
import { DEFAULT_PERIOD, renderPlaceList } from './place-list';
import { renderPlaceSearch } from './search';
import { SHEET_SNAP_EVENT } from './bottom-sheet';
import {
  mapCoveredInsets,
  renderShell,
  setShellMapUnavailable,
  setShellUpdatedAt,
} from './shell';
import { renderSummaryLine, summaryLabel } from './summary-line';
import { setTopPlaceHighlight, type VisibleRankedPlace } from './top-places';

/**
 * Wires the page frame to the dataset: shell first, then the load, then whichever state the load
 * ended in. A successful load renders search, the ranked list with its period selector and the
 * responsive detail view into `#content`, and the page map behind the desktop panel or mobile sheet.
 *
 * `load` and `renderMap` are injectable because jsdom cannot fetch the dataset or run the Naver
 * script. Layout changes belong to CSS; the map and selection persist across them.
 */
export interface BootstrapOptions {
  load?: () => Promise<PlacesDataset>;
  /** Mounts the page map. Injectable for the same reason the map API is. */
  renderMap?: typeof renderPageMap;
}

/**
 * The places the page map draws: those with at least one in-window visit under the current filters.
 *
 * The predicate is the one `computeWindowSummary` counts and `rankWindow` filters on
 * (`src/stats/top-places.ts`), so the dots, the summary's N곳 and the list's rows cannot come to
 * name three different sets. It is recomputed here rather than taken from the ranked list because
 * the list ranks itself inside `place-list.ts`, which this module does not own.
 */
function placesInWindow(dataset: PlacesDataset, period: Period): PlaceRecord[] {
  const window = resolvePeriodWindow(period, dataset.updatedAt);
  return dataset.places.filter((place) => computePlaceStats(place, window).visitCount > 0);
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
  const {
    load = () => loadPlacesDataset(),
    renderMap = renderPageMap,
  } = options;

  /**
   * Holds the cover listeners — the root's sheet snap and the window's resize — so they go when the
   * map does: past a failure there is nothing left for them to tell. Declared before `renderFrame`,
   * which registers them.
   */
  const coverListeners = new AbortController();

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

  /**
   * The page map, once mounted. Held here rather than in the shell because the set it draws belongs
   * to the filters below, and a resize that mounts it long after the last render needs those
   * filters as they stand.
   */
  let pageMap: PageMapHandle | null = null;
  /** The set the map draws, kept current between mounts. Empty until a dataset has rendered. */
  let dotPlaces: PlaceRecord[] = [];
  /**
   * The rank label each visible row printed, by place id.
   *
   * Held beside `dotPlaces` rather than folded into it, because the two answer different questions:
   * the dots are every place that passes the filters, and a label is a claim about one *row*, which
   * a window switch, an 업종 press and a `더 보기` each rewrite. Replaced whole on every report —
   * a merge would leave a place pinned at a rank no row prints any more.
   */
  let pinLabels = new Map<string, string>();
  /** Set once the map has failed, so a later widening does not ask for it again. */
  let mapUnavailable = false;
  /**
   * A mount is in flight.
   *
   * `pageMap` only holds a handle once the script has resolved, and the script is a third-party
   * download the reader does not wait for — so a 기간 or 업종 press in that window would start a
   * second mount. The first map instance would be orphaned on a detached canvas with its listener
   * still registered and nobody left holding its release.
   */
  let mounting = false;
  let detailView: DetailPanelHandle | null = null;
  let selectedDetail: PlaceDetail | null = null;
  let selectFromMap: (placeId: string) => void = () => {};


  /**
   * The markers the map should be standing on right now: every filtered place, labelled where a row
   * is showing it.
   *
   * Read through a function rather than kept as a second array, so the mount and every later update
   * cannot disagree about what the map is answering. A label for a place `dotPlaces` no longer holds
   * is dropped here rather than passed on — the map would ignore it, and passing it would make the
   * set look wider than the dots the summary's `N곳` counts.
   */
  function pageMapPlaces(): PageMapPlace[] {
    return dotPlaces.map((place) => ({
      place,
      ...(pinLabels.has(place.id) ? { label: pinLabels.get(place.id) } : {}),
    }));
  }

  /**
   * Mounts the page map, at most once per page.
   *
   * Fire-and-forget, and called only after the panel is painted: the map is the page's one
   * third-party input and must never hold up the figures (`docs/design/map-first-layout.md` →
   * Implementation Decision 5). The dots handed over afterwards are the *current* ones, so a filter
   * change that lands while the script is still downloading cannot leave the map answering a
   * window the list has left.
   */
  function mountPageMap(): void {
    if (pageMap || mounting || mapUnavailable) return;
    const region = root.querySelector<HTMLElement>('.map-shell-map');
    if (!region) return;
    mounting = true;

    void renderMap(region, pageMapPlaces(), {
      origin: CAMPUS_ORIGIN,
      // Read at each fit, not once: the sheet snaps and the page scrolls while the map stands.
      coveredInsets: () => mapCoveredInsets(root),
      onSelect: (placeId) => { selectFromMap(placeId); },
      onUnavailable: () => {
        mapUnavailable = true;
        coverListeners.abort();
        setShellMapUnavailable(root);
      },
      // The other direction of the sync: a reader who touched a pin has no row in hand, so the map
      // reports the place and the panel lights the row behind it. The slot is looked up here rather
      // than captured, for the same reason the map region is: a hover can land at any point in the
      // page's life, and the only thing a reader must never see is a stale row still lit.
      onPinHover: (placeId) => {
        const rows = root.querySelector<HTMLElement>('.place-list-slot');
        if (rows) setTopPlaceHighlight(rows, placeId);
      },
    })
      .then((handle) => {
        pageMap = handle;
        // The filters may have moved while the script was still downloading — the markers are read
        // again here rather than captured, so the map cannot answer a window the list has left.
        handle.setPlaces(pageMapPlaces());
        if (selectedDetail) {
          handle.focusPlace(selectedDetail.place);
          handle.highlight(selectedDetail.place.id);
        }
      })
      .finally(() => {
        mounting = false;
      });
  }

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
   * Each view owns its own container. Selecting a place rebuilds the detail alone, which is what
   * keeps the row the reader pressed alive to hand focus back to on close; selecting a period
   * rebuilds the list alone, inside `place-list.ts`, leaving the pressed button holding focus.
   *
   * Source order — the list, then search — follows `docs/conventions.md` → Accessibility &
   * Responsive. `.detail-slot` replaces the list inside the panel at every width.
   */
  function renderDataset(dataset: PlacesDataset): void {
    detailView?.release();
    // The frame is never rebuilt here: `renderShell` would replace `root` and detach the `content`
    // node captured above, taking whatever held focus with it. Only the provenance date changes,
    // and `setShellUpdatedAt` writes it in place.
    setShellUpdatedAt(root, dataset.updatedAt);

    const summary = document.createElement('div');
    summary.className = 'summary-slot';
    const kinds = document.createElement('div');
    kinds.className = 'kind-filter-slot';
    const search = document.createElement('div');
    search.className = 'search-slot';
    const list = document.createElement('div');
    list.className = 'place-list-slot';
    const detail = document.createElement('div');
    detail.className = 'detail-slot';
    // The list before the search: the ranked list is the answer the page exists for, and search is
    // the lookup for a reader who already has a name — `docs/conventions.md` → Accessibility &
    // Responsive.
    // The summary above the filters, grouped with them: it states what they currently select, so
    // it reads as their caption rather than as a section of its own.
    const filters = document.createElement('div');
    filters.className = 'filter-head';
    filters.append(summary, kinds);
    content.replaceChildren(filters, list, search, detail);

    detailView = createDetailPanel(detail, [filters, list, search], {
      resolve: (placeId, basis) => currentDetail(placeId, basis ?? activePeriod),
      onSelection: (selection) => {
        selectedDetail = selection;
        // `null` too: a closed detail lets the next filter change re-frame the map.
        pageMap?.focusPlace(selection?.place ?? null);
        pageMap?.highlight(selection?.place.id ?? null);
      },
    });
    selectFromMap = (placeId) => { selectPlace(placeId, activePeriod); };

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
     * Opens the responsive detail view for the place the reader selected.
     *
     * `basis` is the window the place was picked from — the selected period, or `SEARCH_PERIOD` for
     * a search hit — so the figures answer the list the reader was reading rather than a window they
     * never chose. The detail view moves focus to the card and restores it on return.
     */
    function selectPlace(placeId: string, basis: Period): void {
      const next = currentDetail(placeId, basis);
      if (!next) return;
      detailView?.open(next);
    }

    // Narrowed even on the first render: `renderDataset` runs again after a failed load's retry,
    // and a selection made before that would otherwise come back silently cleared on the lists
    // while the control still showed it as pressed.
    const initial = filterByKind(dataset, activeKind);

    /**
     * The summary counts under both filters; the chips count under the period alone, since each
     * chip states what pressing it would show. Both are rewritten in place, never rebuilt.
     */
    function refreshCounts(): void {
      const narrowed = filterByKind(dataset, activeKind);
      renderSummaryLine(
        summary,
        summaryLabel(dataset.updatedAt, computeWindowSummary(narrowed, activePeriod)),
      );
      // 전체 is the sum of the kinds: every place carries exactly one kind.
      const byKind = computeKindPlaceCounts(dataset, activePeriod);
      const all = Object.values(byKind).reduce((sum, count) => sum + count, 0);
      setKindCounts(kinds, { all, byKind });
      refreshDots(narrowed);
    }

    /**
     * The map's marker set, from the same narrowed dataset the summary just counted.
     *
     * Called on every filter change and on the first paint, which is also where the map is first
     * mounted: `mountPageMap` mounts at most once, so on every later call this is only the update.
     */
    function refreshDots(narrowed: PlacesDataset): void {
      dotPlaces = placesInWindow(narrowed, activePeriod);
      pageMap?.setPlaces(pageMapPlaces());
      mountPageMap();
    }

    /**
     * The rows on screen, as the map's pins.
     *
     * A replacement, never a merge: the list reports the whole visible set every time it pages in or
     * the window changes, and a number left over from a window the reader has left would be a pin
     * asserting a rank no row prints. `refreshDots` follows, so the labels are on the map by the
     * time the reader sees the list — the map is fire-and-forget, and this is not.
     */
    function onVisibleChange(visible: VisibleRankedPlace[]): void {
      pinLabels = new Map(visible.map(({ place, label }) => [place.id, label]));
      pageMap?.setPlaces(pageMapPlaces());
    }

    /** The row the reader arrived at — or left, as `null`. The map decides what lit looks like. */
    function onHighlight(placeId: string | null): void {
      pageMap?.highlight(selectedDetail?.place.id ?? placeId);
    }

    function onActiveChange(period: Period): void {
      activePeriod = period;
      refreshCounts();
    }

    const searchView = renderPlaceSearch(search, initial, (placeId) => {
      selectPlace(placeId, SEARCH_PERIOD);
    });
    renderPlaceList(list, initial, selectPlace, {
      active: activePeriod,
      onActiveChange,
      onVisibleChange,
      onHighlight,
      selection: () => selectedDetail?.place.id ?? null,
    });
    renderKindFilter(kinds, activeKind, selectKind);
    refreshCounts();
    detailView.syncHash();

    /**
     * One narrowed dataset feeds both views, so the list and the search can never disagree about
     * what is being shown. The search is updated through its handle rather than re-rendered — a
     * rebuild would discard whatever the reader had typed — while the list is recomputed, since its
     * ranking is derived from the set that just changed.
     *
     * `selectPlace` deliberately keeps reading the *unfiltered* dataset: the detail is opened from a
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
        onActiveChange,
        onVisibleChange,
        onHighlight,
        selection: () => selectedDetail?.place.id ?? null,
      });
      refreshCounts();
    }
  }

  function renderFrame(): HTMLElement {
    // On `root`, which outlives every shell render; the sheet inside it is replaced with the frame.
    // A resize too: crossing the breakpoint swaps the desktop column for the sheet without a snap.
    const { signal } = coverListeners;
    root.addEventListener(SHEET_SNAP_EVENT, () => {
      pageMap?.coverChanged();
    }, { signal });
    // A drag-resize fires many times a frame, and each `coverChanged` measures the layout: one per
    // frame is all the map can show.
    let resizeFrame: number | null = null;
    window.addEventListener('resize', () => {
      if (resizeFrame !== null) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        if (!signal.aborted) pageMap?.coverChanged();
      });
    }, { signal });
    renderShell(root, {
      mapFirst: true,
      // The shell holds no map, so the press travels: before the script has loaded there is nothing
      // to move; a failed map removes the control with its region.
      onRecentre: () => {
        pageMap?.recenter();
      },
    });

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
