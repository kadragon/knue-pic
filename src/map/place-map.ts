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
 * full v3 bundle, so the script loads, `naver.maps` is there and a map mounts; the API only nulls
 * the global and calls this hook about a second later. Reacting to it therefore belongs here, after
 * the mount, not in `src/map/loader.ts` — see its module comment.
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

/**
 * Renders the heading and an empty canvas synchronously, then mounts the map once the script
 * resolves.
 *
 * Always resolves — a rejected loader becomes the fallback message, not a rejection. The caller is
 * the detail dialog, which must open with the figures either way: the map is the one view on the
 * page that depends on a third-party script, and its failure may never take the statistics with it
 * (`docs/eval-criteria.md` → Graceful Degradation).
 */
export async function renderPlaceLocationMap(
  container: HTMLElement,
  place: PlaceRecord,
  options: RenderPlaceLocationMapOptions = {},
): Promise<void> {
  const { loadApi = () => loadNaverMaps() } = options;

  // A previous render's handler closes over a section this call is about to replace: left
  // installed, it would remove an already-detached canvas and append the fallback where nobody can
  // see it, while the live map stays up. Selecting a second place re-enters here, so the clear is
  // what keeps the previous dialog's handler from outliving its map.
  setAuthFailureHandler(undefined);

  const section = document.createElement('section');
  section.className = 'place-map';
  section.append(heading());

  const canvas = document.createElement('div');
  canvas.className = 'place-map-canvas';
  section.append(canvas);
  container.replaceChildren(section);

  try {
    const api = await loadApi();
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

    // The mounted map is swapped for the same fallback the loader failures produce, so the two
    // degraded states are indistinguishable to the user and to the tests.
    //
    // Registered *after* the mount, which assumes the API calls this hook after constructing a map
    // rather than during script init. That ordering is the repo's own assertion, not a sourced
    // vendor guarantee — `backlog.md` carries the real-browser check that would settle it. Moving
    // the registration earlier is not the cheap fix it looks like: the `catch` below has already
    // appended the fallback, so a pre-installed handler would append a second one.
    let live = true;
    setAuthFailureHandler(() => {
      // Idempotent: nothing documents how many times the API calls this, and a second call would
      // otherwise append a second message under the heading.
      if (!live) return;
      live = false;
      canvas.remove();
      section.append(message(MAP_ERROR_MESSAGE, 'place-map-fallback'));
    });
  } catch {
    // The reason is dropped on purpose — see MAP_ERROR_MESSAGE.
    canvas.remove();
    section.append(message(MAP_ERROR_MESSAGE, 'place-map-fallback'));
  }
}
