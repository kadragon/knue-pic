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
 * `naver.maps.Event.addListener(map, 'click', …)` appears in the Markers tutorial itself). `getZoom`
 * and the map's `zoom_changed` came with dot clustering, each observed on the live bundle.
 *
 * The bounds surface went with the page-level map in PR #17; framing came back as `fitBounds` over
 * a plain coordinate array, so `LatLngBounds` itself still has no caller and no type here. A
 * hand-written vendor type with no caller drifts from the real API unnoticed, so what is unused is
 * deleted rather than kept "in case". `setIcon` and `Event` came back with the numbered pins — the
 * first two are what makes a pin's own highlight possible, `Event` the only way the map learns a
 * reader touched one. `zIndex` and `setZIndex` followed, so a pin stands above the dots around it.
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
 * A closed union rather than `string`: hover connects a pin to its row, and click selects either
 * a pin or a dot. Each event is part of the documented Marker surface.
 */
// Marker click is documented at https://navermaps.github.io/maps.js.en/docs/naver.maps.Marker.html#event:click.
export type MarkerEventName = 'mouseover' | 'mouseout' | 'click';

/**
 * The one map event the page map listens for: a zoom change regroups the dots (`./cluster.ts`).
 * Observed on the live v3 bundle at `localhost:5173`, 2026-10-05: `setZoom(15)` on a zoom-13 map
 * fired `zoom_changed` with `15`, then `idle`. The listener reads `getZoom()` rather than the
 * argument, so the payload is not part of the type.
 */
export type MapEventName = 'zoom_changed';

export interface MarkerOptions {
  position: LatLng;
  map: NaverMap;
  title?: string;
  icon?: HtmlIcon;
  /**
   * The marker's stacking order among the other markers. Every marker defaults to the same level,
   * so a dense cluster draws in creation order and a dot can bury a numbered pin. Read off the live
   * v3 bundle at `localhost:5173`, 2026-10-03: `new naver.maps.Marker({ zIndex: 200 }).getZIndex()`
   * returned `200`, and the default returned `null`.
   */
  zIndex?: number;
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

  /**
   * Restacks the marker in place — what a dot promoted to a pin, and a pin lit or unlit, needs
   * alongside its new icon. Present on `naver.maps.Marker.prototype` in the live v3 bundle
   * (observed 2026-10-03, with the `zIndex` option above).
   */
  setZIndex(zIndex: number): void;
}

/**
 * `naver.maps.Event` — the only statics this app calls.
 *
 * Named after the vendor's own static object rather than as a bare function, so the call site reads
 * as the reference does: `api.Event.addListener(marker, 'mouseover', …)`. The reference types
 * `target` as a bare `object`; it is narrowed to `NaverMarker` because the only target the page map
 * hands it is a marker, or the map for its zoom; a wider type would claim callers that do not exist.
 */
export interface NaverEventApi {
  /** Returns a `MapEventListener` the app does not hold — it releases nothing on its own. */
  addListener(target: NaverMarker, eventName: MarkerEventName, listener: () => void): unknown;
  addListener(target: NaverMap, eventName: MapEventName, listener: () => void): unknown;
}

/**
 * The second argument of `map.fitBounds`: pixel margins per side, plus an optional zoom ceiling.
 *
 * Read off the official reference (https://navermaps.github.io/maps.js.en/docs/naver.maps.Map.html,
 * read 2026-10-04): "left 값이 10이면 왼쪽 여백이 5px 증가합니다" — each side widens the frame by
 * *half* the value given. Measured on the live v3 bundle at `localhost:5173` the same day, on a
 * 400×400 map: `{ bottom: 200 }` centred the fitted pair 50px above the map's centre and `{ left:
 * 200 }` 50px right of it, i.e. 100px reserved for 200 passed. A caller reserving N pixels passes 2N.
 */
export interface FitBoundsOptions {
  top: number;
  right: number;
  bottom: number;
  left: number;
  maxZoom?: number;
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

  /**
   * Moves the map so every coordinate in `coords` is inside the frame, less the margins.
   *
   * The reference types `bounds` as `Bounds | ArrayOfCoords` among others; only the array is
   * declared, because the page map frames a set of places and never holds a bounds object. Measured
   * 2026-10-04 on the live bundle: handed a *single* coordinate it did not move the map at all, so
   * the page map centres a lone place with `setCenter` instead.
   */
  fitBounds(coords: LatLng[], options?: FitBoundsOptions): void;

  /**
   * Shifts the map by a pixel offset. The reference says only "지정한 픽셀 좌표만큼 지도를
   * 이동합니다"; the direction is measured, not read: on the live v3 bundle (`localhost:5173`,
   * 2026-10-04) `panBy(new Point(0, 100))` left the previous centre coordinate 100px *above* the
   * map's middle — the view moves by the offset, so the content moves against it.
   */
  panBy(offset: Point): void;

  /**
   * Sets the zoom level. In the reference's method list (`setZoom(zoom, effect)`); the optional
   * `effect` is left out because nothing here animates. Called on the live v3 bundle 2026-10-04:
   * `setZoom(15)` then `getZoom()` returned `15`.
   */
  setZoom(zoom: number): void;

  /**
   * The current zoom level. Called on the live v3 bundle 2026-10-05: a map built at `zoom: 13`
   * returned `13`, and `15` after `setZoom(15)`. What `./cluster.ts` groups the dots at.
   */
  getZoom(): number;
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
