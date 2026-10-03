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
import type { DetailDialogOptions } from './detail-dialog';
import { createDetailPanel, type DetailPanelHandle } from './detail-panel';
import {
  renderKindFilter,
  markActiveKind,
  setKindCounts,
  type KindSelection,
} from './kind-filter';
import { DEFAULT_PERIOD, renderPlaceList } from './place-list';
import { renderPlaceSearch } from './search';
import {
  renderShell,
  setShellMapFirst,
  setShellMapUnavailable,
  setShellUpdatedAt,
} from './shell';
import { renderSummaryLine, summaryLabel } from './summary-line';
import { setTopPlaceHighlight, type VisibleRankedPlace } from './top-places';

/**
 * Wires the page frame to the dataset: shell first, then the load, then whichever state the load
 * ended in. A successful load renders search, the ranked list with its period selector and the
 * responsive detail view into `#content`, and — on a wide viewport — the page map beside them.
 *
 * `load` is injectable so this is testable without stubbing global `fetch`, and `dialog`,
 * `renderMap` and `matchMedia` carry the same reach further down: jsdom cannot run the Naver
 * script and has no `matchMedia` at all, so both the map and the viewport that decides whether to
 * ask for it are handed in.
 */
export interface BootstrapOptions {
  load?: () => Promise<PlacesDataset>;
  dialog?: DetailDialogOptions;
  /** Mounts the page map. Injectable for the same reason `dialog.renderMap` is. */
  renderMap?: typeof renderPageMap;
  /** `window.matchMedia` by default; injectable so a test can decide the viewport. */
  matchMedia?: MatchMedia;
}

/** The viewport query the map-first layout turns on. `src/styles.css` holds the same breakpoint. */
const MAP_FIRST_QUERY = '(min-width: 768px)';

export type MatchMedia = (query: string) => MediaQueryList;

/** The one question the layout asks of the window, and the answer changing. */
interface Viewport {
  wide(): boolean;
  onChange(onChange: (wide: boolean) => void): void;
}

/**
 * The window's answer, or `null` when there is no media query to ask.
 *
 * Feature-detected rather than assumed: jsdom implements no `matchMedia`, so an un-injected case
 * gets today's full-width layout and no map — which is what a narrow phone gets anyway, rather than
 * a crash on the page's first render.
 */
function resolveViewport(matchMedia: MatchMedia | undefined): Viewport | null {
  const ask =
    matchMedia ??
    (typeof window.matchMedia === 'function' ? window.matchMedia.bind(window) : undefined);
  if (ask === undefined) return null;

  const list = ask(MAP_FIRST_QUERY);
  return {
    wide: () => list.matches,
    onChange: (onChange) => {
      // Read from the list rather than the event: a `change` event carries no value of its own, and
      // every consumer here asks the same one question.
      list.addEventListener('change', () => {
        onChange(list.matches);
      });
    },
  };
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
    dialog: dialogOptions = {},
    renderMap = renderPageMap,
    matchMedia,
  } = options;

  const viewport = resolveViewport(matchMedia);

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

  viewport?.onChange((wide) => {
    // A narrowing hides the region rather than releasing the map, so widening the window again
    // finds the same dots — and a resize is never reported as a failure. The exception is a map
    // that is already gone: nothing will be mounted beside the panel, so the full-width fallback
    // has to survive the resize too.
    setShellMapFirst(root, wide && !mapUnavailable);
    detailView?.syncLayout();
    if (wide) mountPageMap();
  });

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
    if (pageMap || mounting || mapUnavailable || (viewport?.wide() ?? false) === false) return;
    const region = root.querySelector<HTMLElement>('.map-shell-map');
    if (!region) return;
    mounting = true;

    void renderMap(region, pageMapPlaces(), {
      origin: CAMPUS_ORIGIN,
      onSelect: (placeId) => { selectFromMap(placeId); },
      onUnavailable: () => {
        mapUnavailable = true;
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
        if (selectedDetail) handle.focusPlace(selectedDetail.place);
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
   * Each view owns its own container. Selecting a place rebuilds the dialog alone, which is what
   * keeps the row the reader pressed alive to hand focus back to on close; selecting a period
   * rebuilds the list alone, inside `place-list.ts`, leaving the pressed button holding focus.
   *
   * Source order — the list, then search — follows `docs/conventions.md` → Accessibility &
   * Responsive. `.detail-slot` replaces the list on desktop and holds a modal on mobile.
   */
  function renderDataset(dataset: PlacesDataset): void {
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
      wide: () => viewport?.wide() ?? false,
      resolve: (placeId) => currentDetail(placeId, activePeriod),
      dialog: dialogOptions,
      onSelection: (selection) => {
        selectedDetail = selection;
        if (selection) pageMap?.focusPlace(selection.place);
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
      });
      refreshCounts();
    }
  }

  function renderFrame(): HTMLElement {
    renderShell(root, {
      mapFirst: viewport?.wide() ?? false,
      // The shell holds no map, so the press travels: before the script has loaded there is nothing
      // to move, and the button is off screen at every width where the map is not mounted.
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
