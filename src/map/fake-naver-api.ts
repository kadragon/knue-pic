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
}

export interface FakeMap extends NaverMap {
  readonly element: HTMLElement;
  readonly options: MapOptions;
  /** How often the map module released this instance; the real API leaks one otherwise. */
  destroyCalls: number;
  /** Every centre this map was moved to, oldest first — the construction centre included. */
  readonly centers: LatLng[];
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
      readonly centers: LatLng[] = [];
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
      destroy(): void {
        this.destroyCalls += 1;
      }
    },
    Marker: class implements FakeMarker {
      icon: HtmlIcon | undefined;
      title: string | undefined;
      readonly attached: (NaverMap | null)[];
      constructor(readonly options: MarkerOptions) {
        this.icon = options.icon;
        this.title = options.title;
        this.attached = [options.map];
        markers.push(this);
      }
      setMap(map: NaverMap | null): void {
        this.attached.push(map);
      }
    },
  };

  return api;
}
