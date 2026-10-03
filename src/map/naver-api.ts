/**
 * The slice of the Naver Maps JavaScript API v3 this app actually calls.
 *
 * There is no `@types/navermaps` dependency, and adding one would put a runtime-shaped package in a
 * project whose only runtime inputs are `places.json` and the map script itself
 * (`docs/eval-criteria.md` → Static-First Integrity). Hand-writing the surface keeps the contract
 * visible and keeps `no-explicit-any` satisfied.
 *
 * Shapes follow the official reference: `new naver.maps.Map(el, options)` and
 * `new naver.maps.Marker(options)`, plus the mutation calls the page map makes —
 * `map.setCenter`, `marker.setMap(null)` and `marker.setIcon(icon)` — and `naver.maps.Event.addListener`,
 * all read off that reference on 2026-10-03 rather than inferred
 * (`https://navermaps.github.io/maps.js.en/docs/naver.maps.Marker.html` for `setIcon`,
 * `https://navermaps.github.io/maps.js.en/docs/naver.maps.Event.html` for `addListener`;
 * `naver.maps.Event.addListener(map, 'click', …)` appears in the Markers tutorial itself).
 *
 * The bounds surface still went with the page-level map in PR #17 and has not come back: a
 * hand-written vendor type with no caller drifts from the real API unnoticed, so what is unused is
 * deleted rather than kept "in case". `setIcon` and `Event` came back with the numbered pins — the
 * first two are what makes a pin's own highlight possible, `Event` the only way the map learns a
 * reader touched one.
 *
 * Structural interfaces, not classes: the tests inject a fake that satisfies this shape, which is
 * the only way a jsdom test can exercise marker rendering at all.
 */

export interface LatLng {
  lat(): number;
  lng(): number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** `content` may be markup or an element; the app always passes markup. */
export interface HtmlIcon {
  content: string;
  size?: Size;
  anchor?: Point;
}

/**
 * The marker events the page map listens for.
 *
 * A closed union rather than `string`, and the two names are the whole of what the page map asks
 * for: a pin that highlights its row needs to say "a reader arrived" and "a reader left", and every
 * other event name in the API's list would be a claim this repo has not read.
 */
export type MarkerEventName = 'mouseover' | 'mouseout';

export interface MarkerOptions {
  position: LatLng;
  map: NaverMap;
  title?: string;
  icon?: HtmlIcon;
}

export interface NaverMarker {
  /**
   * Takes the marker off whatever map it is on when handed `null` — the documented removal, and
   * the only way the page map drops the dots a filter change excluded (official reference,
   * https://navermaps.github.io/maps.js.en/docs/tutorial-2-Marker.html, read 2026-10-03:
   * `hideMarker` calls `marker.setMap(null)`).
   *
   * The same call with no argument returns the current map. Nothing here reads it back, so the
   * type is the narrower one the app uses rather than the whole vendor surface.
   */
  setMap(map: NaverMap | null): void;

  /**
   * Swaps the marker's icon in place.
   *
   * How a pin is highlighted: the numbered pin and its active variant are two `HtmlIcon`s, and
   * redrawing the marker would drop it off the map and back on again. Read off the official
   * reference's overlapping-markers example (`markers[i].setIcon(icon)`,
   * https://navermaps.github.io/maps.js.en/docs/tutorial-2-Marker.html, read 2026-10-03).
   */
  setIcon(icon: HtmlIcon): void;
}

/**
 * `naver.maps.Event` — the only statics this app calls.
 *
 * Named after the vendor's own static object rather than as a bare function, so the call site reads
 * as the reference does: `api.Event.addListener(marker, 'mouseover', …)`. The reference types
 * `target` as a bare `object`; it is narrowed to `NaverMarker` because the only target the page map
 * ever hands it is a marker, and a wider type here would be a claim about callers that do not exist.
 */
export interface NaverEventApi {
  /** Returns a `MapEventListener` the app does not hold — it releases nothing on its own. */
  addListener(target: NaverMarker, eventName: MarkerEventName, listener: () => void): unknown;
}

export interface MapOptions {
  center: LatLng;
  zoom: number;
}

export interface NaverMap {
  /**
   * Optional because this file only promises what the app has seen the API do, and nothing in this
   * repo has verified `destroy` against the live v3 bundle. A map that is dropped without one still
   * has to be dropped — see `releaseMap` in `./place-map.ts`, which calls it only when the mounted
   * object actually carries it.
   */
  destroy?(): void;

  /**
   * Moves the map's centre. Required rather than optional because it is not an inference: the
   * official reference shows `map.setCenter(jeju)` as the way to move a map
   * (https://navermaps.github.io/maps.js.en/docs/tutorial-Map.html, read 2026-10-03), and it is
   * what `학교로` presses. `destroy` above is optional for the opposite reason — nothing here has
   * watched the live bundle throw or return one.
   */
  setCenter(position: LatLng): void;
}

/** Constructors are exposed as values so a fake can supply plain functions. */
export interface NaverMapsApi {
  LatLng: new (lat: number, lng: number) => LatLng;
  Point: new (x: number, y: number) => Point;
  Size: new (width: number, height: number) => Size;
  Map: new (element: HTMLElement, options: MapOptions) => NaverMap;
  Marker: new (options: MarkerOptions) => NaverMarker;
  Event: NaverEventApi;
}
