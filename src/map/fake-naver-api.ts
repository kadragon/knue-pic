import type {
  HtmlIcon,
  LatLng,
  LatLngBounds,
  MapOptions,
  MarkerOptions,
  NaverMap,
  NaverMapsApi,
  NaverMarker,
} from './naver-api';

/**
 * A stand-in for `naver.maps` that records what the map module asked for.
 *
 * jsdom cannot load the real script — it is a hosted bundle that draws to a canvas — so the only
 * way to assert that the right markers carry the right badges is to inject a fake that satisfies
 * `NaverMapsApi` structurally. Nothing here draws; it just remembers.
 */

export interface FakeMarker extends NaverMarker {
  readonly options: MarkerOptions;
  icon: HtmlIcon | undefined;
  title: string | undefined;
  zIndex: number | undefined;
  /** How often `setIcon` ran: the real API rebuilds the overlay DOM on each call, so the count is
   * the cost the map module is supposed to keep proportional to what actually changed. */
  setIconCalls: number;
  click(): void;
}

export interface FakeMap extends NaverMap {
  readonly element: HTMLElement;
  readonly options: MapOptions;
  fitBoundsCalls: number;
}

export interface FakeNaverApi extends NaverMapsApi {
  readonly maps: FakeMap[];
  readonly markers: FakeMarker[];
}

export function createFakeNaverApi(): FakeNaverApi {
  const maps: FakeMap[] = [];
  const markers: FakeMarker[] = [];
  const clickListeners = new Map<object, Array<() => void>>();

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

  class FakeBounds implements LatLngBounds {
    readonly extended: LatLng[] = [];
    constructor(sw: LatLng, ne: LatLng) {
      this.extended.push(sw, ne);
    }
    extend(latlng: LatLng): void {
      this.extended.push(latlng);
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
    LatLngBounds: FakeBounds,
    Map: class implements FakeMap {
      fitBoundsCalls = 0;
      constructor(
        readonly element: HTMLElement,
        readonly options: MapOptions,
      ) {
        maps.push(this);
      }
      fitBounds(): void {
        this.fitBoundsCalls += 1;
      }
    },
    Marker: class implements FakeMarker {
      icon: HtmlIcon | undefined;
      title: string | undefined;
      zIndex: number | undefined;
      setIconCalls = 0;
      constructor(readonly options: MarkerOptions) {
        this.icon = options.icon;
        this.title = options.title;
        this.zIndex = options.zIndex;
        markers.push(this);
      }
      setIcon(icon: HtmlIcon): void {
        this.icon = icon;
        this.setIconCalls += 1;
      }
      setTitle(title: string): void {
        this.title = title;
      }
      setZIndex(zIndex: number): void {
        this.zIndex = zIndex;
      }
      click(): void {
        for (const listener of clickListeners.get(this) ?? []) listener();
      }
    },
    Event: {
      addListener(target: object, eventName: string, listener: () => void) {
        if (eventName === 'click') {
          const existing = clickListeners.get(target) ?? [];
          existing.push(listener);
          clickListeners.set(target, existing);
        }
        return { eventName };
      },
    },
  };

  return api;
}
