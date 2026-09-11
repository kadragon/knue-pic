import type { PlaceRecord } from '../data/types';
import { loadNaverMaps } from './loader';
import type { HtmlIcon, NaverMap, NaverMapsApi } from './naver-api';

/**
 * The location map for one selected place: a single marker on that place's coordinates, mounted
 * inside the detail dialog.
 *
 * It used to be a page-level section plotting every located place with rank badges. That map
 * answered "what is around?" from a slot three screens away from the moment the reader actually
 * asks "where is *this* one?" — so the map moved into the dialog and lost everything that was
 * about ranking: no badges, no `TopPlacesResult`, no second ordering of anything.
 *
 * This module still derives no statistic of its own (`docs/architecture.md` → Layers), and every
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
 * `undefined` deletes the property rather than storing a no-op: the API reads this global to decide
 * whether anyone is listening, so an installed do-nothing function is not the same as no handler.
 */
function setAuthFailureHandler(handler: (() => void) | undefined): void {
  if (handler === undefined) {
    delete (globalThis as AuthFailureGlobal).navermap_authFailure;
    return;
  }
  (globalThis as AuthFailureGlobal).navermap_authFailure = handler;
}

/** Only ours, never a handler some later render installed over it. */
function clearAuthFailureHandler(handler: () => void): void {
  if ((globalThis as AuthFailureGlobal).navermap_authFailure === handler) {
    setAuthFailureHandler(undefined);
  }
}

/**
 * Drops a mounted map, if the object it returned knows how.
 *
 * Feature-detected rather than assumed: `docs/architecture.md` treats the map script as the app's
 * only third-party runtime input, and this repo has verified nothing about `destroy` against the
 * live v3 bundle. Calling it when it is there is what keeps a dialog opened thirty times from
 * holding thirty live maps; calling it blindly would be a claim about an API nobody here has read.
 */
function releaseMap(map: NaverMap): void {
  map.destroy?.();
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

  // Registered *before* the script is awaited, and kept until release, so the hook is caught
  // whichever side of the mount the API calls it on. Which side that is has not been observed:
  // `backlog.md` carries the real-browser check against a rejected origin, and nothing here depends
  // on its answer. Installing ours also replaces any handler a previous render left behind — one
  // closing over a section this call just replaced.
  setAuthFailureHandler(fail);

  try {
    const api = await loadApi();
    // The key was rejected while the script was still arriving: the fallback is up, so mount
    // nothing behind it.
    if (!live) {
      clearAuthFailureHandler(fail);
      return () => {};
    }
    // Mounting is inside the try as well: a script that loaded can still throw from a constructor
    // (a rejected key, an API version that moved). Leaving that outside would reject the promise
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
      clearAuthFailureHandler(fail);
      releaseMap(map);
    };
  } catch {
    // The reason is dropped on purpose — see MAP_ERROR_MESSAGE.
    fail();
    clearAuthFailureHandler(fail);
    // Nothing mounted, so there is nothing to release — but the caller still gets a function, so it
    // never has to branch on whether the map came up.
    return () => {};
  }
}
