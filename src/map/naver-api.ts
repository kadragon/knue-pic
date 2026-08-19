/**
 * The slice of the Naver Maps JavaScript API v3 this app actually calls.
 *
 * There is no `@types/navermaps` dependency, and adding one would put a runtime-shaped package in a
 * project whose only runtime inputs are `places.json` and the map script itself
 * (`docs/eval-criteria.md` → Static-First Integrity). Hand-writing the surface keeps the contract
 * visible and keeps `no-explicit-any` satisfied.
 *
 * Shapes follow the official reference: `new naver.maps.Map(el, options)`,
 * `new naver.maps.Marker(options)`, `marker.setIcon(icon)`, `map.fitBounds(bounds)`, and
 * `naver.maps.Event.addListener(target, eventName, listener)`.
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

export interface LatLngBounds {
  extend(latlng: LatLng): void;
}

export interface MarkerOptions {
  position: LatLng;
  map: NaverMap;
  title?: string;
  icon?: HtmlIcon;
  zIndex?: number;
}

export interface NaverMarker {
  setIcon(icon: HtmlIcon): void;
  setTitle(title: string): void;
  setZIndex(zIndex: number): void;
}

export interface MapOptions {
  center: LatLng;
  zoom: number;
}

export interface NaverMap {
  fitBounds(bounds: LatLngBounds): void;
}

export interface MapEventListener {
  // Opaque: the app registers listeners for the lifetime of the page and never removes one.
  readonly eventName?: string;
}

/**
 * Constructors are exposed as values so a fake can supply plain functions. `Event.addListener` is
 * the only static the app touches.
 */
export interface NaverMapsApi {
  LatLng: new (lat: number, lng: number) => LatLng;
  Point: new (x: number, y: number) => Point;
  Size: new (width: number, height: number) => Size;
  LatLngBounds: new (sw: LatLng, ne: LatLng) => LatLngBounds;
  Map: new (element: HTMLElement, options: MapOptions) => NaverMap;
  Marker: new (options: MarkerOptions) => NaverMarker;
  Event: {
    addListener(target: object, eventName: string, listener: () => void): MapEventListener;
  };
}
