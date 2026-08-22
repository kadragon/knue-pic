/**
 * The slice of the Naver Maps JavaScript API v3 this app actually calls.
 *
 * There is no `@types/navermaps` dependency, and adding one would put a runtime-shaped package in a
 * project whose only runtime inputs are `places.json` and the map script itself
 * (`docs/eval-criteria.md` → Static-First Integrity). Hand-writing the surface keeps the contract
 * visible and keeps `no-explicit-any` satisfied.
 *
 * Shapes follow the official reference: `new naver.maps.Map(el, options)` and
 * `new naver.maps.Marker(options)`. The marker-mutation, bounds and event surface went with the
 * page-level map — a hand-written vendor type with no caller drifts from the real API unnoticed,
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

/** Constructed and left alone: one marker per map, never re-badged. */
export type NaverMarker = object;

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
}

/** Constructors are exposed as values so a fake can supply plain functions. */
export interface NaverMapsApi {
  LatLng: new (lat: number, lng: number) => LatLng;
  Point: new (x: number, y: number) => Point;
  Size: new (width: number, height: number) => Size;
  Map: new (element: HTMLElement, options: MapOptions) => NaverMap;
  Marker: new (options: MarkerOptions) => NaverMarker;
}
