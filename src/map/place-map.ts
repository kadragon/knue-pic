import type { PlaceRecord } from '../data/types';
import { clusterPoints } from './cluster';
import { loadNaverMaps } from './loader';
import type { FitBoundsOptions, HtmlIcon, NaverMap, NaverMarker, NaverMapsApi } from './naver-api';

/**
 * The page map fills the viewport behind a desktop panel or mobile sheet.
 *
 * What came back, and what it carries: a numbered pin for every row the list currently shows, and a
 * neutral dot for every other place that passes the period and 업종 filters. No size, shade or hue
 * from the visit count (Implementation Decision 1) — the only thing that varies between one pin and
 * another is the rank string the row already printed, and the UI hands it in rather than this module
 * ranking anything. The marker set is id-keyed, so a row appearing, re-ranking or leaving costs a
 * `setIcon` rather than a second marker. Dots that would stack at the current zoom stand down behind
 * one `N곳` marker (`./cluster.ts`); pins never do — a rank is never hidden behind a count.
 *
 * This module still derives no statistic of its own (`docs/architecture.md` → Layers): the campus
 * origin, the filtered set and the labels all arrive as arguments, and nothing here imports
 * `src/stats/`. Every user-facing string is exported so the banned-phrase test can assert over it.
 */

/**
 * Verbatim from `docs/runbook.md` → Failure modes, which names this exact sentence as the intended
 * degraded state (PRD §38). The cause is deliberately unsaid: a missing client ID and an origin
 * outside the key's allowed-URL list read identically to the user, and neither is actionable from
 * the page. No retry control either — unlike the data load, nothing about this failure changes on a
 * second attempt.
 */
export const MAP_ERROR_MESSAGE = '지도를 불러오지 못했습니다.';

/**
 * The one failure the loader cannot see. An origin outside the key's allowed-URL list still gets the
 * full v3 bundle, so the script loads, `naver.maps` is there and a map mounts; the API nulls the
 * global and calls this hook. Reacting to it belongs to the render that owns the map, not to
 * `src/map/loader.ts` — see its module comment — and the render listens for its whole life, so it
 * does not depend on when the hook fires relative to the mount.
 */
interface AuthFailureGlobal {
  navermap_authFailure?: () => void;
}

/**
 * Every render that is listening, not one.
 *
 * Each mounted page map owns a listener and removes it when released. The dispatcher fans one
 * auth rejection out to every live subscriber.
 *
 * A copy is taken before iterating: a listener that releases the page (which is what the page's own
 * fallback does) mutates the set underneath the loop.
 */
const authFailureListeners = new Set<() => void>();

function dispatchAuthFailure(): void {
  for (const listener of [...authFailureListeners]) listener();
}

/**
 * Registers `listener` and returns the call that takes it back off.
 *
 * The global is installed only while something is listening and deleted when the last render lets
 * go: the API reads the property to decide whether anyone is there, so an installed do-nothing
 * function is not the same as no handler, and a page that had released everything must not look
 * like it is still waiting on the key.
 */
function listenForAuthFailure(listener: () => void): () => void {
  authFailureListeners.add(listener);
  // Assigned on every registration rather than only on the first: the set is the record of who is
  // listening, and anything that deletes the global behind this module's back — a test cleaning up
  // after itself, a third party — would otherwise leave the next render listening on nothing.
  (globalThis as AuthFailureGlobal).navermap_authFailure = dispatchAuthFailure;
  return () => {
    authFailureListeners.delete(listener);
    if (authFailureListeners.size === 0) {
      delete (globalThis as AuthFailureGlobal).navermap_authFailure;
    }
  };
}

/**
 * Set once the API has called the auth-failure hook, and never cleared by the page.
 *
 * The one cause this repo has observed for the hook is a rejected origin (2026-10-03,
 * `localhost:5179`, Chromium — `./loader.ts` module comment), which is a property of the page, not
 * of one render: every later render would ask `/v3/auth` again, mount a map and lose it ~1.1 s
 * later. Remembering it sends those renders straight to the fallback. Whether the API also calls
 * the hook on a transient `/v3/auth` failure (network, 5xx) is unverified; if it does, the map
 * stays off until the page is reloaded. A *load* failure is deliberately not remembered: a blocked
 * or timed-out script can come back, and the loader already drops its tag so a later call can
 * retry.
 */
let authRejected = false;

/**
 * Test-only: forgets a rejected key *and* drops the listeners earlier cases left behind.
 *
 * Two pieces of state, because "the hook is installed" was one thing and now is two: the rejected
 * memo, and the set of renders currently listening. A case that mounts without releasing would
 * otherwise leave a live entry, and the next case's assertion that nothing is installed would be
 * reading that entry rather than its own render.
 */
export function resetAuthFailureState(): void {
  authRejected = false;
  authFailureListeners.clear();
  delete (globalThis as AuthFailureGlobal).navermap_authFailure;
}

/**
 * Drops a mounted map, if the object it returned knows how.
 *
 * Feature-detected rather than assumed: `docs/architecture.md` treats the map script as the app's
 * only third-party runtime input, and this repo has verified nothing about `destroy` against the
 * live v3 bundle. Calling it when available releases the mounted map; calling it blindly would
 * be a claim about an API nobody here has read.
 *
 * A throw is swallowed. On a rejected origin, once the auth-failure hook has fired, the real
 * `destroy` throws `TypeError: Cannot read properties of null (reading 'isArray')` (observed
 * 2026-10-03, `localhost:5179`, Chromium). Whether that map's resources were freed is unverified;
 * the map is unusable either way. Letting the throw escape would break the caller's release and every
 * later paint.
 */
function releaseMap(map: NaverMap): void {
  try {
    map.destroy?.();
  } catch {
    // Nothing to recover, and release must not throw.
  }
}

/* ── The page map ───────────────────────────────────────────────────────────────────────────── */

/**
 * What the marker says, and all it says: the place's own name.
 *
 * The page map is the one place on the page where colour is not allowed to carry a claim
 * (`docs/design/map-first-layout.md` → Implementation Decision 1), so nothing but the name goes into
 * a marker's title. On a pin the number is printed in the icon body rather than in the title: Naver
 * shows a `title` as a tooltip, and a tooltip that said `7` would be the rank with the place's name
 * gone.
 */
export function dotLabel(place: PlaceRecord): string {
  return place.name;
}

/**
 * Small enough to read as a dot rather than a pin, which is the point: a place with no row on screen
 * has no rank to print, so the marker that stands in for it must say nothing at all.
 */
const DOT_SIZE = 12;

/** A shade wider than the dot, because a pin carries a number and the number needs room. */
const PIN_SIZE = 26;

/**
 * Stacking order among the page markers: a dot under every cluster, a cluster under every pin — a
 * rank is never buried under a count — and the lit pin over the rest. At the
 * vendor's one default level a dense cluster draws in creation order, and dots built after a pin
 * covered its number (observed at 1440px around 오송, 2026-10-03). Only the order is a decision;
 * the values are arbitrary steps.
 */
const DOT_Z_INDEX = 1;
const CLUSTER_Z_INDEX = 2;
const PIN_Z_INDEX = 3;
const ACTIVE_PIN_Z_INDEX = 4;

/**
 * A cluster's whole text: how many places it stands for. `곳`, not a bare number, because a pin
 * prints a bare number and that number is a rank — a cluster reading `7` would read as seventh.
 */
export function clusterLabel(count: number): string {
  return `${count}곳`;
}

/** The cluster's body. Exported for the same reason as `pinLabelMarkup`. */
export function clusterMarkup(count: number): string {
  return `<span class="page-map-cluster">${clusterLabel(count)}</span>`;
}

/**
 * One box for every cluster, wide enough for `525곳`. A cluster that grew with its count would be the
 * density scale Implementation Decision 1 rules out.
 *
 * The box is also what `clusterPoints` groups by, so two clusters cannot stand on each other's
 * label: a 24px radius let `11곳` cover `25곳` on the real map, and a 40px radius around a mean
 * still overlapped four pairs (2026-10-05).
 */
const CLUSTER_WIDTH = 40;
const CLUSTER_HEIGHT = 24;

/**
 * The pin's body: the rank string the row printed, and nothing else.
 *
 * `active` is a class rather than a different icon so the two shapes stay one rule in the
 * stylesheet — the same discipline the 거리 밴드 palette is held to (`docs/conventions.md` →
 * Accessibility): this module decides *which* pin is lit, the stylesheet decides what lit looks like.
 *
 * Exported so a test can assert the pin's markup without restating it, which is what keeps a test
 * from passing on a pin that prints a plausible wrong number.
 */
export function pinLabelMarkup(label: string, active: boolean): string {
  return `<span class="page-map-pin${active ? ' is-active' : ''}">${escapeHtml(label)}</span>`;
}

/**
 * The label is the UI's value, and the pin body is injected as HTML into the map's own overlay
 * layer. Today the label is a rank — `String(entry.rank)` — and the reader cannot type it, but the
 * escaping is here so that changing where the label comes from cannot turn into an injection.
 */
function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}

/**
 * The zoom the map is built at, before the first fit replaces it — and the one it keeps when the
 * filtered set is empty and there is nothing to fit to.
 */
const PAGE_ZOOM = 13;

/**
 * The frame stops zooming in here. A display choice, not a data claim: two places on one block
 * would otherwise fit to street level, and the reader loses where the block is.
 */
const FIT_MAX_ZOOM = 16;

/** Clear space between the outermost dot and whatever covers the map's edge, in CSS pixels. */
const FRAME_GAP = 16;

/**
 * How much of the map, per edge, the page has drawn over — in CSS pixels.
 *
 * The map fills the viewport behind the desktop column and masthead, and behind the mobile sheet;
 * the page measures them (`src/ui/shell.ts` → `mapCoveredInsets`) and this module frames inside
 * what is left. The page answers `null` instead when too little map shows to frame into — the sheet
 * fully open — and the frame waits for `coverChanged`.
 */
export interface PageMapInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: PageMapInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Which sides other than the top a cover takes from the map — the shape of the layout, not its size.
 *
 * The top is left out because both layouts may cover it (the masthead beside the column, the card a
 * peeking sheet floats), and scrolling the masthead away changes it inside one layout. What tells
 * the desktop column from the mobile sheet is the left edge against the bottom one.
 */
function coveredSides(insets: PageMapInsets): string {
  return [insets.right > 0 ? 'r' : '', insets.bottom > 0 ? 'b' : '', insets.left > 0 ? 'l' : ''].join('');
}

/**
 * What the UI hands the map for one place: the record, and the rank string its row printed.
 *
 * A separate `label` rather than a `PlaceRecord` with a rank on it, because the rank is not the
 * place's: it is the place's position in *one window under one filter*, computed by
 * `src/stats/top-places.ts` and owned by the list. This module never ranks anything — Decision 2 —
 * so a place with no row on screen arrives with no label and is drawn as the dot it has always been.
 */
export interface PageMapPlace {
  place: PlaceRecord;
  /** The rank string the row printed, verbatim. Absent for a place the list is not showing. */
  label?: string;
}

/**
 * One drawn marker, and the two things about it that change while it stands.
 *
 * `label` is `null` rather than `''` so "no row on screen" and "a row that printed nothing" cannot be
 * confused; a rank is never the empty string, and an empty pin would be a pin asserting nothing.
 */
interface PlacedMarker {
  marker: NaverMarker;
  place: PlaceRecord;
  label: string | null;
  active: boolean;
  /** `false` while a cluster stands in for this dot. */
  shown: boolean;
}

export interface PageMapHandle {
  /**
   * Replaces the marker set with the places that pass the current filters, labelled where the list
   * is showing the place.
   *
   * Keyed by place id: a filter change adds and removes, it never redraws what survived, so
   * widening a filter or reordering it costs no marker and no flicker. A place that survives with a
   * *different* label — the reader switched window and its rank moved — keeps its marker and takes
   * the new number, which is why the label lives beside the marker rather than in the key.
   */
  setPlaces(places: PageMapPlace[]): void;
  /**
   * Lights the pin for `placeId`, or every pin off when handed `null`.
   *
   * Driven by the list: the row a reader is hovering or has focused is the one whose pin should
   * stand out. `null` is a real state rather than "no argument" because leaving a row is an event
   * the list reports like any other, and a pin left lit would claim a row the reader has left.
   */
  highlight(placeId: string | null): void;
  /**
   * Returns the map to the campus origin, centred in the part of the map the page leaves visible.
   *
   * Stops following a focused place and drops any frame it held: the reader asked for the campus,
   * and a later snap or resize must not pull the map back to the place they left. The place itself
   * still holds the frame while the detail shows it, so a filter change after the press stays owed
   * until it closes.
   * With no room to measure, the campus is re-centred at the next `coverChanged` that has some.
   */
  recenter(): void;
  /**
   * Centres the page map on a selected place, including one outside the filtered marker set, and
   * holds it there: while a place is focused a filter change does not re-frame the map. `null` lets
   * go — the detail closed — and does not re-centre; it only makes the frame a held change owed.
   */
  focusPlace(place: PlaceRecord | null): void;
  /**
   * What covers the map changed — the sheet snapped, the window resized. Re-centres the focused
   * place against the new cover, or makes the frame that was waiting for room — or the one a
   * layout switch owes, since a fit made beside the desktop column can leave dots under the mobile
   * sheet. Otherwise nothing moves: the reader may have panned the map themselves.
   */
  coverChanged(): void;
  /** Releases the map and this render's auth-failure listener. Everything after it is inert. */
  release(): void;
}

export interface RenderPageMapOptions {
  /** Injectable so tests can supply a fake API; production loads the real script. */
  loadApi?: () => Promise<NaverMapsApi>;
  /**
   * Where the map opens, and what `학교로` returns to — `CAMPUS_ORIGIN`, handed in by the caller.
   *
   * A parameter rather than an import: `src/map/` computes no statistic and reads nothing from
   * `src/stats/` (`docs/architecture.md` → Layer Rules), so the coordinate crosses as data.
   */
  origin: { lat: number; lng: number };
  /**
   * Called once, on either failure route, so the page can give the panel the whole width back.
   *
   * The page map paints no fallback message of its own: what a reader sees when the map is gone is a
   * layout, and the layout is the shell's (`src/ui/shell.ts` → `setShellMapUnavailable`).
   */
  onUnavailable?: () => void;
  /**
   * Which pin a reader touched, and `null` when they left it — so the panel can highlight that row.
   *
   * The other half of the sync: a row handing its place to `highlight` answers "where is this row?",
   * and this answers "which row is this pin?" — a question a reader who has touched the map and has
   * no row in hand can only ask in this direction. Pins only; a dot has no row to light, and
   * reporting one would clear the row the reader was actually on.
   */
  onPinHover?: (placeId: string | null) => void;
  /** A click on either a numbered pin or a neutral dot selects its canonical place id. */
  onSelect?: (placeId: string) => void;
  /**
   * What the page has drawn over the map, read at the moment of each fit or centring rather than
   * once: the sheet snaps and the window resizes while the map stands. Absent → nothing covers it;
   * `null` → too little map shows to frame into, so the frame waits for `coverChanged`.
   */
  coveredInsets?: () => PageMapInsets | null;
}

function dotIcon(api: NaverMapsApi): HtmlIcon {
  return {
    content: '<span class="page-map-dot"></span>',
    size: new api.Size(DOT_SIZE, DOT_SIZE),
    anchor: new api.Point(DOT_SIZE / 2, DOT_SIZE / 2),
  };
}

function clusterIcon(api: NaverMapsApi, count: number): HtmlIcon {
  return {
    content: clusterMarkup(count),
    size: new api.Size(CLUSTER_WIDTH, CLUSTER_HEIGHT),
    anchor: new api.Point(CLUSTER_WIDTH / 2, CLUSTER_HEIGHT / 2),
  };
}

function pinIcon(api: NaverMapsApi, label: string, active: boolean): HtmlIcon {
  return {
    content: pinLabelMarkup(label, active),
    size: new api.Size(PIN_SIZE, PIN_SIZE),
    anchor: new api.Point(PIN_SIZE / 2, PIN_SIZE / 2),
  };
}

/**
 * A handle whose every method does nothing.
 *
 * Handed back when nothing mounted, so the caller never has to branch on whether the map came up —
 * the caller can use the same handle whether or not a map mounted.
 */
const INERT_PAGE_MAP: PageMapHandle = {
  setPlaces: () => {},
  highlight: () => {},
  recenter: () => {},
  focusPlace: () => {},
  coverChanged: () => {},
  release: () => {},
};

/**
 * Mounts the page map: an empty canvas immediately, the API's map and one dot per place once the
 * script resolves.
 *
 * Always resolves, and never rejects. Both ways this can fail — the script never usable, and the
 * key rejecting the origin — end in `onUnavailable` exactly once, whichever side of the mount they
 * land on, because the page has one fallback state and one sentence for it. The list in the panel
 * has already painted by the time this runs: the panel never waits on a third-party script, which
 * is the whole reason the map is fire-and-forget from the UI.
 */
export async function renderPageMap(
  container: HTMLElement,
  places: PageMapPlace[],
  options: RenderPageMapOptions,
): Promise<PageMapHandle> {
  const {
    loadApi = () => loadNaverMaps(),
    origin,
    onUnavailable,
    onPinHover,
    onSelect,
    coveredInsets = () => NO_INSETS,
  } = options;

  const canvas = document.createElement('div');
  canvas.className = 'page-map-canvas';
  // Appended, never a wholesale replacement: the region is the shell's, and it already holds the
  // `학교로` control — `replaceChildren` here would take the reader's way back to the campus away
  // in the same paint that gives them the map.
  container.querySelector('.page-map-canvas')?.remove();
  container.append(canvas);

  // `live` is the single gate both the failure path and the release share, which is what makes
  // "exactly once" true without counting calls: a second failure, or a call that arrives after the
  // page released the map, finds it false and does nothing.
  let live = true;
  // What the mounted map needs released — set once it exists, and callable from either the failure
  // path or the caller's release. A rejection arriving after the mount still leaves a live map
  // instance, its markers and its auth-failure listener behind, and this page map is the one that
  // would stay mounted for the life of the page.
  let mounted: (() => void) | null = null;
  const fail = (): void => {
    if (!live) return;
    live = false;
    canvas.remove();
    mounted?.();
    mounted = null;
    onUnavailable?.();
  };

  if (authRejected) {
    fail();
    return INERT_PAGE_MAP;
  }

  const onAuthFailure = (): void => {
    authRejected = true;
    fail();
  };
  const stopListening = listenForAuthFailure(onAuthFailure);

  try {
    const api = await loadApi();
    // The key was rejected while the script was still arriving: the page has already fallen back,
    // so mount nothing behind it.
    if (!live) {
      stopListening();
      return INERT_PAGE_MAP;
    }

    const map: NaverMap = new api.Map(canvas, {
      center: new api.LatLng(origin.lat, origin.lng),
      zoom: PAGE_ZOOM,
    });
    const markers = new Map<string, PlacedMarker>();
    /** Cluster markers standing now, keyed by their member ids — an unchanged group keeps its marker. */
    const clusterMarkers = new Map<string, NaverMarker>();
    /** The place the detail is showing; it holds the frame until the detail closes. */
    let focused: PlaceRecord | null = null;
    /**
     * Whether the view follows `focused` through cover changes. `학교로` turns it off without letting
     * go of the place — the detail still shows it — and focusing a place turns it back on.
     */
    let following = false;
    /** The set last drawn. */
    let current: PageMapPlace[] = places;
    /** Whether the set's frame is still owed — held by a focus, or by no room to frame into. */
    let frameOwed = false;
    /**
     * Whether `학교로` is still owed a centring in the uncovered part: pressed with no room to measure.
     * Separate from `frameOwed` because the two fall due at different moments — the campus at the
     * next measured cover, a held frame when the detail closes.
     */
    let campusOwed = false;
    /**
     * The `coveredSides` the view was last laid out inside — by a frame, or by `학교로`. `null` while
     * unknown (no frame yet, or `학교로` with no room to measure); the next measured cover adopts it.
     */
    let framedSides: string | null = null;
    /**
     * The page now covers a different side than the view was laid out for: the layout switched.
     * Read against the cover as it stands, so switching back before the detail closes owes nothing.
     */
    const layoutSwitched = (insets: PageMapInsets | null): boolean =>
      insets !== null && framedSides !== null && coveredSides(insets) !== framedSides;

    /**
     * Puts `lat`/`lng` in the middle of the uncovered part of the map rather than the middle of the
     * map. `panBy` moves the view by its offset (measured — `./naver-api.ts`), so the offset is the
     * uncovered centre's distance *from* the map centre, negated: half of what each opposite pair of
     * edges leaves unbalanced.
     */
    const centreInView = (lat: number, lng: number, insets: PageMapInsets): void => {
      map.setCenter(new api.LatLng(lat, lng));
      map.panBy(new api.Point((insets.right - insets.left) / 2, (insets.bottom - insets.top) / 2));
    };

    /**
     * Fits `places` inside what `insets` leaves uncovered — the set's frame and a cluster click alike.
     * Distinct coordinates, not places: two places in one building give bounds with no area, and
     * `fitBounds` over those left the live map where it was, as it did for one place.
     */
    const fitInto = (places: PlaceRecord[], insets: PageMapInsets): void => {
      if (new Set(places.map((place) => `${place.lat},${place.lng}`)).size === 1) {
        // A lone place at the zoom a fit stops at, not at whatever region-wide zoom the last fit left.
        const [place] = places as [PlaceRecord];
        map.setZoom(FIT_MAX_ZOOM);
        centreInView(place.lat, place.lng, insets);
        return;
      }
      // Doubled: the bundle widens the frame by half the margin it is handed (`./naver-api.ts`).
      const margin: FitBoundsOptions = {
        top: 2 * (insets.top + FRAME_GAP),
        right: 2 * (insets.right + FRAME_GAP),
        bottom: 2 * (insets.bottom + FRAME_GAP),
        left: 2 * (insets.left + FRAME_GAP),
        maxZoom: FIT_MAX_ZOOM,
      };
      map.fitBounds(
        places.map((place) => new api.LatLng(place.lat, place.lng)),
        margin,
      );
    };

    /**
     * Frames the filtered set inside the uncovered part of the map. Every dot, the far ones
     * included: the summary's `N곳` counts all of them, and a frame that left some off-screen would
     * show fewer places than the line above it says.
     */
    const frame = (next: PageMapPlace[]): void => {
      const insets = coveredInsets();
      frameOwed = insets === null;
      // The set is newer than any `학교로` still waiting for room.
      campusOwed = false;
      if (insets === null || next.length === 0) return;
      framedSides = coveredSides(insets);
      fitInto(
        next.map(({ place }) => place),
        insets,
      );
    };

    /**
     * Regroups the dots for the current zoom: hides each dot a cluster now stands in for, brings back
     * each one it no longer does, and keeps a cluster whose members did not change as the marker it
     * was. Pins and the focused place are left out — a rank is never hidden behind a count, and the
     * place the detail shows must stay where the reader can see it.
     */
    const recluster = (): void => {
      const dots = [...markers]
        .filter(([id, entry]) => entry.label === null && id !== focused?.id)
        .map(([id, { place }]) => ({ id, lat: place.lat, lng: place.lng }));
      const { clusters } = clusterPoints(dots, map.getZoom(), {
        width: CLUSTER_WIDTH,
        height: CLUSTER_HEIGHT,
        stopZoom: FIT_MAX_ZOOM,
      });
      const hidden = new Set(clusters.flatMap(({ ids }) => ids));
      for (const [id, entry] of markers) {
        const shown = !hidden.has(id);
        if (entry.shown === shown) continue;
        entry.shown = shown;
        entry.marker.setMap(shown ? map : null);
      }
      const standing = new Set<string>();
      for (const cluster of clusters) {
        const key = cluster.ids.join('\n');
        standing.add(key);
        if (clusterMarkers.has(key)) continue;
        const marker = new api.Marker({
          position: new api.LatLng(cluster.lat, cluster.lng),
          map,
          title: clusterLabel(cluster.ids.length),
          icon: clusterIcon(api, cluster.ids.length),
          zIndex: CLUSTER_Z_INDEX,
        });
        clusterMarkers.set(key, marker);
        // Opens the cluster up: fitting its members lands at most at `FIT_MAX_ZOOM`, where nothing
        // clusters, so a click always leaves fewer dots behind one marker than before.
        api.Event.addListener(marker, 'click', () => {
          if (!live || clusterMarkers.get(key) !== marker) return;
          const members = cluster.ids.flatMap((id) => {
            const entry = markers.get(id);
            return entry ? [entry.place] : [];
          });
          if (members.length === 0) return;
          // The reader moved the view, as with `학교로`: nothing owed from before may pull it back,
          // and a held focus stops being followed. The place itself still holds the frame.
          following = false;
          frameOwed = false;
          campusOwed = false;
          const insets = coveredInsets();
          framedSides = insets === null ? null : coveredSides(insets);
          fitInto(members, insets ?? NO_INSETS);
        });
      }
      for (const [key, marker] of clusterMarkers) {
        if (standing.has(key)) continue;
        marker.setMap(null);
        clusterMarkers.delete(key);
      }
    };
    api.Event.addListener(map, 'zoom_changed', () => {
      if (live) recluster();
    });

    /**
     * The icon a placed marker wears right now.
     *
     * Only the label and the lit state can vary: both come from the list, and neither is derived
     * here, so two places with different visit counts cannot end up with different icons beyond the
     * number each one prints.
     */
    const iconFor = (entry: PlacedMarker): HtmlIcon =>
      entry.label === null ? dotIcon(api) : pinIcon(api, entry.label, entry.active);

    /**
     * Follows the icon: every path that swaps one swaps the other through `restyle`. The focused
     * place's dot stands with the pins, over the clusters: it is left out of every cluster, but a
     * cluster of its neighbours can still stand on its coordinate.
     */
    const zIndexFor = (entry: PlacedMarker): number =>
      entry.label !== null
        ? entry.active
          ? ACTIVE_PIN_Z_INDEX
          : PIN_Z_INDEX
        : entry.place.id === focused?.id
          ? PIN_Z_INDEX
          : DOT_Z_INDEX;

    const restyle = (entry: PlacedMarker): void => {
      entry.marker.setIcon(iconFor(entry));
      entry.marker.setZIndex(zIndexFor(entry));
    };

    /**
     * The listeners every page marker gets, attached once at creation and guarded on the
     * marker's *current* state rather than removed later.
     *
     * Two things make the guard load-bearing, and the first is why the registration is unconditional.
     * A marker is built the moment its place passes the filters and may sit there as a dot for many
     * pages before a `더 보기` brings in its row, so attaching only to new pins left every paged-in
     * pin mute. And a pin demoted back to a dot by a window change keeps its listeners — a stale
     * `mouseout` firing `onPinHover(null)` would clear the highlight of whichever row the reader had
     * actually moved onto. The vendor surface has no per-marker listener removal this module needs
     * (`naver.maps.Event.clearInstanceListeners` exists and is deliberately not in `./naver-api.ts`:
     * a marker carries only this view's listeners, and the guard reaches the same behaviour without a new
     * claim about the API).
     */
    const listenToMarker = (entry: PlacedMarker, placeId: string): void => {
      api.Event.addListener(entry.marker, 'click', () => {
        if (live && markers.get(placeId) === entry) onSelect?.(placeId);
      });
      api.Event.addListener(entry.marker, 'mouseover', () => {
        if (live && entry.label !== null) onPinHover?.(placeId);
      });
      api.Event.addListener(entry.marker, 'mouseout', () => {
        if (live && entry.label !== null) onPinHover?.(null);
      });
    };

    const draw = (next: PageMapPlace[]): void => {
      if (!live) return;
      const wanted = new Set(next.map(({ place }) => place.id));
      // A relabel — `더 보기`, a row hovered — keeps the set; only a filter or window change moves
      // the frame, so paging through the list never yanks the map out from under the reader.
      const reframe = wanted.size !== markers.size || [...wanted].some((id) => !markers.has(id));
      for (const [id, entry] of markers) {
        if (wanted.has(id)) continue;
        // `marker.setMap(null)` is the documented removal (see `./naver-api.ts`).
        entry.marker.setMap(null);
        markers.delete(id);
      }
      for (const { place, label } of next) {
        // `null`, not `''`: "no row on screen" and "a row that printed nothing" are different
        // states, and an empty pin would be a pin asserting nothing.
        const nextLabel = label ?? null;
        const existing = markers.get(place.id);
        if (existing) {
          // The same place under a new label — the reader switched window and its rank moved, or a
          // `더 보기` brought its row in. The marker is kept, so the pin the reader was reading does
          // not blink out and back.
          if (nextLabel === existing.label) continue;
          existing.label = nextLabel;
          // Demotion clears the light. `highlight` skips unlabelled markers, so a marker demoted
          // while lit would keep the flag for good and `더 보기` would bring its row back as a pin
          // lit for a row the reader is not on.
          if (nextLabel === null) existing.active = false;
          restyle(existing);
          continue;
        }

        const marker = new api.Marker({
          position: new api.LatLng(place.lat, place.lng),
          map,
          title: dotLabel(place),
          icon: nextLabel === null ? dotIcon(api) : pinIcon(api, nextLabel, false),
          zIndex: nextLabel === null ? DOT_Z_INDEX : PIN_Z_INDEX,
        });
        const placed: PlacedMarker = { marker, place, label: nextLabel, active: false, shown: true };
        markers.set(place.id, placed);
        listenToMarker(placed, place.id);
      }
      current = next;
      recluster();
      // A focused place holds the frame; the change is owed, and paid when the detail closes.
      if (reframe) {
        if (focused === null) frame(next);
        else frameOwed = true;
      }
    };

    /** Centres the focused place, if the page leaves room to; otherwise `coverChanged` will. */
    const showFocused = (): void => {
      const insets = coveredInsets();
      if (focused && insets) centreInView(focused.lat, focused.lng, insets);
    };

    /** Centres the campus in what the page leaves visible, and lays the view out for that cover. */
    const showCampus = (insets: PageMapInsets): void => {
      campusOwed = false;
      framedSides = coveredSides(insets);
      centreInView(origin.lat, origin.lng, insets);
    };

    const highlight = (placeId: string | null): void => {
      if (!live) return;
      for (const [id, entry] of markers) {
        // A dot has nothing to light: the highlight answers "the row you are on", and a place with
        // no row is not on one.
        if (entry.label === null) continue;
        const shouldBeActive = id === placeId;
        if (entry.active === shouldBeActive) continue;
        entry.active = shouldBeActive;
        restyle(entry);
      }
    };

    draw(places);

    mounted = () => {
      stopListening();
      for (const entry of markers.values()) entry.marker.setMap(null);
      markers.clear();
      for (const marker of clusterMarkers.values()) marker.setMap(null);
      clusterMarkers.clear();
      releaseMap(map);
    };

    return {
      setPlaces: draw,
      highlight,
      recenter: () => {
        if (!live) return;
        // `focused` stays: the detail still shows the place, so it still holds the frame. Only the
        // view lets go, and a later snap must not pull it back to the place the reader left.
        following = false;
        // A frame owed so far is dropped — the reader asked for the campus. A filter change after the
        // press is a newer request, and is owed again until the detail closes.
        frameOwed = false;
        const insets = coveredInsets();
        // The campus is now what the view is laid out for: a layout switch made while a place was
        // focused must not read, at the next snap, as one still owed.
        if (insets) {
          showCampus(insets);
          return;
        }
        // No room to measure: centre on the whole map now, and again above the sheet when it
        // comes down.
        campusOwed = true;
        framedSides = null;
        centreInView(origin.lat, origin.lng, NO_INSETS);
      },
      focusPlace: (place) => {
        if (!live) return;
        const previous = focused;
        focused = place;
        following = place !== null;
        // Restacked before regrouping, both ways: the dot that loses focus drops back under clusters.
        for (const id of new Set([previous?.id, place?.id])) {
          const entry = id === undefined ? undefined : markers.get(id);
          if (entry) restyle(entry);
        }
        recluster();
        if (place) {
          campusOwed = false;
          showFocused();
        } else if (frameOwed || (!campusOwed && layoutSwitched(coveredInsets()))) {
          frame(current);
        }
      },
      coverChanged: () => {
        if (!live) return;
        const insets = coveredInsets();
        if (insets && framedSides === null) framedSides = coveredSides(insets);
        if (focused && following) showFocused();
        // After `학교로` the campus is the view, open detail or not: an owed press or a layout switch
        // re-centres it for the new cover. A held frame waits for the detail to close.
        else if (campusOwed || (focused && layoutSwitched(insets))) {
          if (insets) showCampus(insets);
        } else if (!focused && (frameOwed || layoutSwitched(insets))) {
          frame(current);
        }
      },
      release: () => {
        // `live` gates this as well as `fail`, so a release that arrives after the failure path
        // already released the map does not destroy the same instance a second time.
        if (!live) return;
        live = false;
        mounted?.();
        mounted = null;
      },
    };
  } catch {
    // The reason is dropped on purpose — see MAP_ERROR_MESSAGE.
    fail();
    stopListening();
    return INERT_PAGE_MAP;
  }
}
