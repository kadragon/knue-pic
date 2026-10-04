import type {
  FitBoundsOptions,
  HtmlIcon,
  LatLng,
  MapOptions,
  MarkerEventName,
  MarkerOptions,
  NaverMap,
  NaverMapsApi,
  NaverMarker,
  Point,
} from './naver-api';

/**
 * A stand-in for `naver.maps` that records what the map module asked for.
 *
 * jsdom cannot load the real script — it is a hosted bundle that draws to a canvas — so the only
 * way to assert that the right marker landed on the right coordinates is to inject a fake that
 * satisfies `NaverMapsApi` structurally. Nothing here draws; it just remembers.
 */

export interface FakeMarker extends NaverMarker {
  readonly options: MarkerOptions;
  /**
   * Every map this marker was attached to, `null` for each removal.
   *
   * A removal the fake cannot record is a removal nothing can test: `marker.setMap(null)` is how
   * the page map drops a dot a filter change excluded, so the *record* of the call is the only
   * evidence that a narrowed filter did not leave the excluded place on the map.
   */
  readonly attached: (NaverMap | null)[];
  icon: HtmlIcon | undefined;
  title: string | undefined;
  /** The marker's current stacking order — from the option, then from every `setZIndex`. */
  zIndex: number | undefined;
  /**
   * Fires an event the way the API would.
   *
   * `emit('mouseover')` on a marker nothing listened to is a no-op, so a case cannot pass by
   * reaching a listener that was never registered. The payload is absent because the app's two
   * listeners take none — narrowing the fake to what the vendor types actually carry is what keeps
   * the surface honest.
   */
  emit(eventName: MarkerEventName): void;
}

export interface FakeMap extends NaverMap {
  readonly element: HTMLElement;
  readonly options: MapOptions;
  /** How often the map module released this instance; the real API leaks one otherwise. */
  destroyCalls: number;
  /** Every centre this map was moved to, oldest first — the construction centre included. */
  readonly centers: LatLng[];
  /** Every `fitBounds`, oldest first: the coordinates framed and the margins asked for. */
  readonly fits: { coords: LatLng[]; options: FitBoundsOptions | undefined }[];
  /** Every `panBy` offset, oldest first. Nothing here models the projection, so no centre moves. */
  readonly pans: Point[];
  /** Every `setZoom`, oldest first. */
  readonly zooms: number[];
}

export interface FakeNaverApi extends NaverMapsApi {
  readonly maps: FakeMap[];
  readonly markers: FakeMarker[];
}

export function createFakeNaverApi(): FakeNaverApi {
  const maps: FakeMap[] = [];
  const markers: FakeMarker[] = [];
  /** The listeners `Event.addListener` registered, oldest first — one bucket per target. */
  const listeners = new Map<NaverMarker, Map<MarkerEventName, (() => void)[]>>();

  const Event = {
    addListener(target: NaverMarker, eventName: MarkerEventName, listener: () => void): unknown {
      const forTarget = listeners.get(target) ?? new Map<MarkerEventName, (() => void)[]>();
      listeners.set(target, forTarget);
      const forEvent = forTarget.get(eventName) ?? [];
      forTarget.set(eventName, forEvent);
      forEvent.push(listener);
      // The real API hands back a `MapEventListener` with its own `disconnect`; nothing here holds
      // it — the page map releases its markers instead — so a token is all the shape promises.
      return {};
    },
  };

  class FakeLatLng implements LatLng {
    constructor(
      private readonly latitude: number,
      private readonly longitude: number,
    ) {}
    lat(): number {
      return this.latitude;
    }
    lng(): number {
      return this.longitude;
    }
  }

  const api: FakeNaverApi = {
    maps,
    markers,
    LatLng: FakeLatLng,
    Point: class {
      constructor(
        public x: number,
        public y: number,
      ) {}
    },
    Size: class {
      constructor(
        public width: number,
        public height: number,
      ) {}
    },
    Map: class implements FakeMap {
      destroyCalls = 0;
      readonly centers: LatLng[] = [];
      readonly fits: { coords: LatLng[]; options: FitBoundsOptions | undefined }[] = [];
      readonly pans: Point[] = [];
      readonly zooms: number[] = [];
      constructor(
        readonly element: HTMLElement,
        readonly options: MapOptions,
      ) {
        // The centre the map was built at is a move too, so `학교로` after a pan and `학교로` on a
        // map that has not moved cannot be told apart by reading `centers[0]` alone.
        this.centers.push(options.center);
        maps.push(this);
      }
      setCenter(position: LatLng): void {
        this.centers.push(position);
      }
      fitBounds(coords: LatLng[], options?: FitBoundsOptions): void {
        this.fits.push({ coords: [...coords], options });
      }
      panBy(offset: Point): void {
        this.pans.push(offset);
      }
      setZoom(zoom: number): void {
        this.zooms.push(zoom);
      }
      destroy(): void {
        this.destroyCalls += 1;
      }
    },
    Marker: class implements FakeMarker {
      icon: HtmlIcon | undefined;
      title: string | undefined;
      zIndex: number | undefined;
      readonly attached: (NaverMap | null)[];
      constructor(readonly options: MarkerOptions) {
        this.icon = options.icon;
        this.zIndex = options.zIndex;
        this.title = options.title;
        this.attached = [options.map];
        markers.push(this);
      }
      setMap(map: NaverMap | null): void {
        this.attached.push(map);
      }
      setIcon(icon: HtmlIcon): void {
        // Recorded rather than ignored: a highlight that never reached the marker's icon is a pin
        // that does not look like the row the reader is on, and nothing else in the fake would see it.
        this.icon = icon;
      }
      setZIndex(zIndex: number): void {
        this.zIndex = zIndex;
      }
      emit(eventName: MarkerEventName): void {
        for (const listener of listeners.get(this)?.get(eventName) ?? []) listener();
      }
    },
    Event,
  };

  return api;
}
