import type { PlaceRecord } from '../data/types';
import { loadNaverMaps } from './loader';
import type { HtmlIcon, NaverMap, NaverMarker, NaverMapsApi } from './naver-api';

/**
 * Two maps, one module: the page map the site opens on, and the single-marker map the detail dialog
 * carries.
 *
 * PR #17 removed the page-level map — every located place plotted at once with rank badges — because
 * it sat three screens below the ranked list, away from the moment the reader asks "where is *this*
 * one?", and the dialog's one marker answered that question where the question is asked. What it
 * could not answer was "what is around here?", which is the question the first screen now asks: the
 * map-first layout (`docs/design/map-first-layout.md`) is the map, the page, with the content in a
 * panel beside it, so the distance between a name and a location is gone instead of the map.
 *
 * What came back is deliberately quieter than what went: a neutral dot per filtered place, no rank
 * badge, no size, shade or hue from the visit count (Implementation Decision 1). The numbered pins
 * synced with the list are their own ticket, and the marker set is id-keyed so that ticket adds
 * labels to the dots rather than re-deriving the map.
 *
 * This module still derives no statistic of its own (`docs/architecture.md` → Layers): the campus
 * origin and the filtered set arrive as arguments, and nothing here imports `src/stats/`. Every
 * user-facing string is exported so the banned-phrase test can assert over it.
 */

export const MAP_HEADING = '위치';

/**
 * Verbatim from `docs/runbook.md` → Failure modes, which names this exact sentence as the intended
 * degraded state (PRD §38). The cause is deliberately unsaid: a missing client ID and an origin
 * outside the key's allowed-URL list read identically to the user, and neither is actionable from
 * the page. No retry control either — unlike the data load, nothing about this failure changes on a
 * second attempt.
 */
export const MAP_ERROR_MESSAGE = '지도를 불러오지 못했습니다.';

/** Spoken form of the single marker: the place it stands on, and nothing about rank. */
export function markerLabel(place: PlaceRecord): string {
  return `${place.name} 위치`;
}

/** Close enough to read the surrounding block; a single marker has no extent to fit to. */
const PLACE_ZOOM = 16;

const MARKER_SIZE = 28;

export interface RenderPlaceLocationMapOptions {
  /** Injectable so tests can supply a fake API; production loads the real script. */
  loadApi?: () => Promise<NaverMapsApi>;
}

/**
 * Releases the map and the auth-failure hook this render installed.
 *
 * Idempotent, and safe on every path — a render that never mounted anything returns one that does
 * nothing. The caller owns a map for exactly as long as the dialog showing it is open; the previous
 * design owned one map for the life of the page and had nothing to release.
 */
export type ReleasePlaceLocationMap = () => void;

function markerIcon(api: NaverMapsApi): HtmlIcon {
  return {
    content: '<span class="place-map-marker"></span>',
    size: new api.Size(MARKER_SIZE, MARKER_SIZE),
    anchor: new api.Point(MARKER_SIZE / 2, MARKER_SIZE / 2),
  };
}

function heading(): HTMLHeadingElement {
  // `h4`, matching the histogram heading inside the same card: the card's own name is the `h3`.
  const element = document.createElement('h4');
  element.textContent = MAP_HEADING;
  return element;
}

/**
 * A `role="status"` paragraph rather than a bare one: the map arrives asynchronously, so its
 * failure lands after the dialog has settled and would otherwise pass silently for a screen-reader
 * user.
 */
function message(text: string, className: string): HTMLParagraphElement {
  const element = document.createElement('p');
  element.className = className;
  element.setAttribute('role', 'status');
  element.textContent = text;
  return element;
}

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
 * The page map holds the hook for as long as the page lives and the dialog's for as long as the card
 * is open, so "the newest render owns the global" — which is all this had to be while a single
 * dialog map was the only thing that ever listened — would let a dialog opened over a live page map
 * mute the first screen: the key would be rejected, only the dialog would hear it, and the page would
 * keep showing a map the API had already taken away. The dispatcher below fans one call out to
 * everyone, and each render takes its own listener back down when it is released.
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
 * live v3 bundle. Calling it when it is there is what keeps a dialog opened thirty times from
 * holding thirty live maps; calling it blindly would be a claim about an API nobody here has read.
 *
 * A throw is swallowed. On a rejected origin, once the auth-failure hook has fired, the real
 * `destroy` throws `TypeError: Cannot read properties of null (reading 'isArray')` (observed
 * 2026-10-03, `localhost:5179`, Chromium). Whether that map's resources were freed is unverified;
 * the map is unusable either way. Letting the throw escape would break the caller's close and every
 * later paint.
 */
function releaseMap(map: NaverMap): void {
  try {
    map.destroy?.();
  } catch {
    // Nothing to recover, and release must not throw.
  }
}

/**
 * Renders the heading and an empty canvas synchronously, then mounts the map once the script
 * resolves.
 *
 * Always resolves — a rejected loader becomes the fallback message, not a rejection. The caller is
 * the detail dialog, which must open with the figures either way: the map is the one view on the
 * page that depends on a third-party script, and its failure may never take the statistics with it
 * (`docs/eval-criteria.md` → Graceful Degradation).
 *
 * Resolves with the release function for whatever it mounted; the caller must call it when the
 * dialog closes or moves to another place.
 */
export async function renderPlaceLocationMap(
  container: HTMLElement,
  place: PlaceRecord,
  options: RenderPlaceLocationMapOptions = {},
): Promise<ReleasePlaceLocationMap> {
  const { loadApi = () => loadNaverMaps() } = options;

  const section = document.createElement('section');
  section.className = 'place-map';
  section.append(heading());

  const canvas = document.createElement('div');
  canvas.className = 'place-map-canvas';
  section.append(canvas);
  container.replaceChildren(section);

  // One failure path for every way the map can fail — the script never usable, a constructor
  // throwing, the key rejecting the origin — so however they interleave, exactly one fallback
  // appears, and never after the caller released this render. The fallback is the same message the
  // loader failures produce, so the degraded states are indistinguishable to the user and to the
  // tests.
  let live = true;
  const fail = (): void => {
    if (!live) return;
    live = false;
    canvas.remove();
    section.append(message(MAP_ERROR_MESSAGE, 'place-map-fallback'));
  };

  if (authRejected) {
    fail();
    return () => {};
  }

  const onAuthFailure = (): void => {
    authRejected = true;
    fail();
  };

  // Registered *before* the script is awaited, and kept until release, so the hook is caught
  // whichever side of the mount the API calls it on. The real API was observed calling it after
  // the mount (`./loader.ts` module comment); the earlier side is held anyway, because nothing
  // pins that ordering.
  const stopListening = listenForAuthFailure(onAuthFailure);

  try {
    const api = await loadApi();
    // The key was rejected while the script was still arriving: the fallback is up, so mount
    // nothing behind it.
    if (!live) {
      stopListening();
      return () => {};
    }
    // Mounting is inside the try as well: a script that loaded can still throw from a constructor
    // (an API version that moved). A rejected key does not throw here — it mounts, then fails
    // through the auth-failure hook (`./loader.ts` module comment). Leaving that outside would reject the promise
    // and leave an empty canvas where the fallback message belongs.
    const position = new api.LatLng(place.lat, place.lng);
    const map: NaverMap = new api.Map(canvas, { center: position, zoom: PLACE_ZOOM });
    new api.Marker({
      position,
      map,
      title: markerLabel(place),
      icon: markerIcon(api),
    });

    return () => {
      // `live` also gates the hook, so a rejection arriving after the dialog closed cannot append
      // a fallback into a section that is no longer on screen.
      live = false;
      stopListening();
      releaseMap(map);
    };
  } catch {
    // The reason is dropped on purpose — see MAP_ERROR_MESSAGE.
    fail();
    stopListening();
    // Nothing mounted, so there is nothing to release — but the caller still gets a function, so it
    // never has to branch on whether the map came up.
    return () => {};
  }
}

/* ── The page map ───────────────────────────────────────────────────────────────────────────── */

/**
 * What the dot says, and all it says: the place's own name.
 *
 * The page map's dots are the one place on the page where colour is not allowed to carry a claim
 * (`docs/design/map-first-layout.md` → Implementation Decision 1), so nothing but the name may go
 * into the marker. `markerLabel` above adds 위치 because that marker stands alone in a card whose
 * heading already says which place is being discussed.
 */
export function dotLabel(place: PlaceRecord): string {
  return place.name;
}

/**
 * Small enough to read as a dot rather than a pin, which is the point: a badge or a bigger marker
 * per place would put the ranking back on the map before the numbered-pins ticket decides how.
 */
const DOT_SIZE = 12;

/**
 * The frame the map opens on: the campus and roughly the width of 청주 around it.
 *
 * A fixed zoom rather than a fit to the dots, for one reason — `fitBounds` would drag `LatLngBounds`
 * and `getBounds` into the hand-written vendor surface, and nothing here has watched the live bundle
 * return either. `src/stats/distance.ts` cuts its bands at 2/5/15km and notes that most of the
 * dataset falls between 1 and 10km, so a campus-centred frame shows the cluster a reader came for
 * and `학교로` is there for the rest.
 */
const PAGE_ZOOM = 13;

export interface PageMapHandle {
  /**
   * Replaces the dot set with the places that pass the current filters.
   *
   * Keyed by place id: a filter change adds and removes, it never redraws what survived, so
   * widening a filter or reordering it costs no marker and no flicker.
   */
  setPlaces(places: PlaceRecord[]): void;
  /** Returns the map to the origin it opened on. */
  recenter(): void;
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
}

function dotIcon(api: NaverMapsApi): HtmlIcon {
  return {
    content: '<span class="page-map-dot"></span>',
    size: new api.Size(DOT_SIZE, DOT_SIZE),
    anchor: new api.Point(DOT_SIZE / 2, DOT_SIZE / 2),
  };
}

/**
 * A handle whose every method does nothing.
 *
 * Handed back when nothing mounted, so the caller never has to branch on whether the map came up —
 * the same promise `renderPlaceLocationMap` makes.
 */
const INERT_PAGE_MAP: PageMapHandle = {
  setPlaces: () => {},
  recenter: () => {},
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
  places: PlaceRecord[],
  options: RenderPageMapOptions,
): Promise<PageMapHandle> {
  const { loadApi = () => loadNaverMaps(), origin, onUnavailable } = options;

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
    const markers = new Map<string, NaverMarker>();

    const draw = (next: PlaceRecord[]): void => {
      if (!live) return;
      const wanted = new Set(next.map((place) => place.id));
      for (const [id, marker] of markers) {
        if (wanted.has(id)) continue;
        // `marker.setMap(null)` is the documented removal, and it is the only half of the vendor
        // surface the page map needed besides `setCenter` (see `./naver-api.ts`).
        marker.setMap(null);
        markers.delete(id);
      }
      for (const place of next) {
        if (markers.has(place.id)) continue;
        markers.set(
          place.id,
          new api.Marker({
            position: new api.LatLng(place.lat, place.lng),
            map,
            title: dotLabel(place),
            icon: dotIcon(api),
          }),
        );
      }
    };

    draw(places);

    mounted = () => {
      stopListening();
      for (const marker of markers.values()) marker.setMap(null);
      markers.clear();
      releaseMap(map);
    };

    return {
      setPlaces: draw,
      recenter: () => {
        if (!live) return;
        map.setCenter(new api.LatLng(origin.lat, origin.lng));
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
