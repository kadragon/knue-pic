import type { PlaceRecord, PlacesDataset } from '../data/types';
import type { TopPlacesResult } from '../stats/top-places';
import { loadNaverMaps } from './loader';
import type { HtmlIcon, NaverMap, NaverMapsApi, NaverMarker } from './naver-api';

/**
 * The map view: one marker per located place, a rank number on the ones currently in the TOP 10,
 * and the documented fallback when the map script never arrives.
 *
 * This module reads what `src/stats/` already computed and never derives a statistic of its own —
 * the rank on a badge is `entry.rank` from `computeTopPlaces`, not a second ordering.
 * `docs/architecture.md` → Layers: `src/map/` may read `src/stats/` output; the reverse never holds.
 *
 * Every user-facing string is exported so the banned-phrase test can assert over it, matching the
 * idiom in `src/ui/*.ts`.
 */

export const MAP_HEADING = '지도에서 보기';

/**
 * Verbatim from `docs/runbook.md` → Failure modes, which names this exact sentence as the intended
 * degraded state (PRD §38). The cause is deliberately unsaid: a missing client ID and an origin
 * outside the key's allowed-URL list read identically to the user, and neither is actionable from
 * the page. No retry control either — unlike the data load, nothing about this failure changes on a
 * second attempt.
 */
export const MAP_ERROR_MESSAGE = '지도를 불러오지 못했습니다.';

export const MAP_EMPTY_MESSAGE = '표시할 장소가 없습니다.';

/**
 * Spoken form of a marker. The badge shows a bare numeral, which says nothing on its own — the
 * title is where the number is named as a position in the ranked list.
 */
export function markerLabel(place: PlaceRecord, rank: number | null): string {
  return rank === null ? place.name : `${place.name} · 많이 이용한 곳 ${rank}위`;
}

/** Only the initial value: `fitBounds` immediately replaces it with the extent of every marker. */
const INITIAL_ZOOM = 13;

const MARKER_SIZE = 28;

interface MarkerEntry {
  place: PlaceRecord;
  marker: NaverMarker;
  /** The rank the marker is currently painted with; `null` when it carries a plain dot. */
  rank: number | null;
}

export interface PlaceMapHandle {
  /** Re-badges the existing markers for a new period. The map instance is never rebuilt. */
  update(result: TopPlacesResult): void;
  /** Highlights the marker for a place selected elsewhere on the page. */
  select(placeId: string | null): void;
}

export interface RenderPlaceMapOptions {
  /** Injectable so tests can supply a fake API; production loads the real script. */
  loadApi?: () => Promise<NaverMapsApi>;
}

/**
 * The badge carries the rank as text inside the marker, never as colour or size alone
 * (`docs/conventions.md` → Accessibility). An unranked place gets a plain dot: the absence of a
 * number is the distinction, so the two read apart in greyscale.
 */
function markerContent(rank: number | null, selected: boolean): string {
  const classes = ['place-map-marker'];
  if (rank !== null) classes.push('place-map-marker-ranked');
  const selectedAttribute = selected ? ' data-selected="true"' : '';
  return `<span class="${classes.join(' ')}"${selectedAttribute}>${rank === null ? '' : rank}</span>`;
}

function markerIcon(api: NaverMapsApi, rank: number | null, selected: boolean): HtmlIcon {
  return {
    content: markerContent(rank, selected),
    size: new api.Size(MARKER_SIZE, MARKER_SIZE),
    anchor: new api.Point(MARKER_SIZE / 2, MARKER_SIZE / 2),
  };
}

function rankByPlaceId(result: TopPlacesResult): Map<string, number> {
  return new Map(result.entries.map((entry) => [entry.place.id, entry.rank]));
}

function heading(): HTMLHeadingElement {
  const element = document.createElement('h2');
  element.textContent = MAP_HEADING;
  return element;
}

/**
 * A `role="status"` paragraph rather than a bare one: the map arrives asynchronously, so its
 * failure lands after the page has settled and would otherwise pass silently for a screen-reader
 * user.
 */
function message(text: string, className: string): HTMLParagraphElement {
  const element = document.createElement('p');
  element.className = className;
  element.setAttribute('role', 'status');
  element.textContent = text;
  return element;
}

/** A handle that answers every call with nothing — used on the empty and failed paths. */
const INERT_HANDLE: PlaceMapHandle = {
  update: () => {},
  select: () => {},
};

/**
 * The one failure the loader cannot see. An origin outside the key's allowed-URL list still gets the
 * full v3 bundle, so the script loads, `naver.maps` is there and a map mounts; the API only nulls
 * the global and calls this hook about a second later. Reacting to it therefore belongs here, after
 * the mount, not in `src/map/loader.ts` — see its module comment.
 */
interface AuthFailureGlobal {
  navermap_authFailure?: () => void;
}

function setAuthFailureHandler(handler: () => void): void {
  (globalThis as AuthFailureGlobal).navermap_authFailure = handler;
}

/**
 * Renders synchronously into `container`, then fills the canvas once the script resolves.
 *
 * Always resolves — a rejected loader becomes the fallback message, not a rejection. The caller is
 * `bootstrap`, where an unhandled rejection would surface as the *data* load failing, which is a
 * different and much louder screen than the one this failure is supposed to produce.
 */
export async function renderPlaceMap(
  container: HTMLElement,
  dataset: PlacesDataset,
  result: TopPlacesResult,
  onSelect: (placeId: string) => void,
  options: RenderPlaceMapOptions = {},
): Promise<PlaceMapHandle> {
  const { loadApi = () => loadNaverMaps() } = options;

  const section = document.createElement('section');
  section.className = 'place-map';
  section.append(heading());

  const canvas = document.createElement('div');
  canvas.className = 'place-map-canvas';
  section.append(canvas);
  container.replaceChildren(section);

  if (dataset.places.length === 0) {
    canvas.remove();
    section.append(message(MAP_EMPTY_MESSAGE, 'place-map-empty'));
    return INERT_HANDLE;
  }

  try {
    const api = await loadApi();
    // Mounting is inside the try as well: a script that loaded can still throw from a constructor
    // (a rejected key, an API version that moved). Leaving that outside would reject the promise
    // and leave an empty canvas where the fallback message belongs.
    const handle = mountMarkers(api, canvas, dataset.places, result, onSelect);

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

    // Gated rather than replaced: the caller holds this handle for the life of the page and keeps
    // calling it on every period change and selection, long after the map is gone.
    return {
      update: (next: TopPlacesResult): void => {
        if (live) handle.update(next);
      },
      select: (placeId: string | null): void => {
        if (live) handle.select(placeId);
      },
    };
  } catch {
    // The reason is dropped on purpose — see MAP_ERROR_MESSAGE.
    canvas.remove();
    section.append(message(MAP_ERROR_MESSAGE, 'place-map-fallback'));
    return INERT_HANDLE;
  }
}

/** Called only with a non-empty `places` — `renderPlaceMap` returns early otherwise. */
function mountMarkers(
  api: NaverMapsApi,
  canvas: HTMLElement,
  places: readonly PlaceRecord[],
  result: TopPlacesResult,
  onSelect: (placeId: string) => void,
): PlaceMapHandle {
  const center = new api.LatLng(places[0]!.lat, places[0]!.lng);
  const map: NaverMap = new api.Map(canvas, { center, zoom: INITIAL_ZOOM });

  let ranks = rankByPlaceId(result);
  let selectedPlaceId: string | null = null;

  // `rank` is the rank currently *painted* on the marker, not the live one — the two diverge
  // between a period change and the repaint that follows, which is exactly what tells `update`
  // which markers actually need touching.
  const markers = new Map<string, MarkerEntry>();
  const bounds = new api.LatLngBounds(center, center);

  for (const place of places) {
    const position = new api.LatLng(place.lat, place.lng);
    const rank = ranks.get(place.id) ?? null;
    const marker: NaverMarker = new api.Marker({
      position,
      map,
      title: markerLabel(place, rank),
      icon: markerIcon(api, rank, false),
      // Ranked markers sit above the rest so a badge is never hidden under a plain dot.
      zIndex: rank === null ? 1 : 100,
    });

    api.Event.addListener(marker, 'click', () => onSelect(place.id));
    markers.set(place.id, { place, marker, rank });
    bounds.extend(position);
  }

  // Fits every place on screen once. Later updates deliberately leave the viewport alone: the user
  // may have panned or zoomed, and a period change must not yank the map back.
  map.fitBounds(bounds);

  /**
   * Stacking order: the selection on top, then the ranked badges, then everything else. Only 10
   * places are ever ranked, so a selection made from search or the detail card is usually an
   * unranked marker — leaving it at the bottom would draw its ring underneath a neighbouring
   * badge and make the selection look like a no-op.
   */
  function zIndexFor(placeId: string, rank: number | null): number {
    if (placeId === selectedPlaceId) return 200;
    return rank === null ? 1 : 100;
  }

  /**
   * Repaints one marker. Deliberately never called in a loop over every marker: with the real API
   * `setIcon` tears down and rebuilds the overlay DOM, so repainting a marker nothing changed on is
   * not a wasted assignment but a wasted DOM rebuild.
   */
  function paintMarker(placeId: string, entry: MarkerEntry): void {
    const rank = ranks.get(placeId) ?? null;
    entry.rank = rank;
    entry.marker.setIcon(markerIcon(api, rank, placeId === selectedPlaceId));
    entry.marker.setTitle(markerLabel(entry.place, rank));
    entry.marker.setZIndex(zIndexFor(placeId, rank));
  }

  function repaint(placeId: string | null): void {
    if (placeId === null) return;
    // Every place in the dataset gets a marker, so a miss means the caller passed an id from
    // somewhere else; skipping is the same no-op the old whole-map loop performed.
    const entry = markers.get(placeId);
    if (entry) paintMarker(placeId, entry);
  }

  return {
    update(next: TopPlacesResult): void {
      ranks = rankByPlaceId(next);
      // A period change moves only a handful of places in and out of the ranked list; the rest
      // carry the same badge, title and z-index they already have.
      for (const [placeId, entry] of markers) {
        if ((ranks.get(placeId) ?? null) !== entry.rank) paintMarker(placeId, entry);
      }
    },
    select(placeId: string | null): void {
      const previous = selectedPlaceId;
      if (previous === placeId) return;
      selectedPlaceId = placeId;
      // Exactly the two markers whose selected state changed.
      repaint(previous);
      repaint(placeId);
    },
  };
}
