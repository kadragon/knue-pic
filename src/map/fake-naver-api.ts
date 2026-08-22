import type {
  HtmlIcon,
  LatLng,
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
 * way to assert that the right marker landed on the right coordinates is to inject a fake that
 * satisfies `NaverMapsApi` structurally. Nothing here draws; it just remembers.
 */

export interface FakeMarker extends NaverMarker {
  readonly options: MarkerOptions;
  icon: HtmlIcon | undefined;
  title: string | undefined;
}

export interface FakeMap extends NaverMap {
  readonly element: HTMLElement;
  readonly options: MapOptions;
  /** How often the map module released this instance; the real API leaks one otherwise. */
  destroyCalls: number;
}

export interface FakeNaverApi extends NaverMapsApi {
  readonly maps: FakeMap[];
  readonly markers: FakeMarker[];
}

export function createFakeNaverApi(): FakeNaverApi {
  const maps: FakeMap[] = [];
  const markers: FakeMarker[] = [];

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
      constructor(
        readonly element: HTMLElement,
        readonly options: MapOptions,
      ) {
        maps.push(this);
      }
      destroy(): void {
        this.destroyCalls += 1;
      }
    },
    Marker: class implements FakeMarker {
      icon: HtmlIcon | undefined;
      title: string | undefined;
      constructor(readonly options: MarkerOptions) {
        this.icon = options.icon;
        this.title = options.title;
        markers.push(this);
      }
    },
  };

  return api;
}
