/**
 * The slice of the Naver Maps JavaScript API v3 this app actually calls.
 *
 * There is no `@types/navermaps` dependency, and adding one would put a runtime-shaped package in a
 * project whose only runtime inputs are `places.json` and the map script itself
 * (`docs/eval-criteria.md` → Static-First Integrity). Hand-writing the surface keeps the contract
 * visible and keeps `no-explicit-any` satisfied.
 *
 * Shapes follow the official reference: `new naver.maps.Map(el, options)` and
 * `new naver.maps.Marker(options)`, plus the two mutation calls the page map makes —
 * `map.setCenter` and `marker.setMap(null)`, both read off that reference on 2026-10-03 rather
 * than inferred. The bounds and event surface still went with the page-level map in PR #17 and
 * has not come back: a hand-written vendor type with no caller drifts from the real API unnoticed,
 * so what is unused is deleted rather than kept "in case".
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
}
