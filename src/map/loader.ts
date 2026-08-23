import type { NaverMapsApi } from './naver-api';

/**
 * Injects the Naver Maps script tag and resolves once `naver.maps` is usable.
 *
 * The app has no npm dependency for the map — the API ships only as a hosted script, so loading it
 * is a DOM operation, not an import. The failure modes this module owns — no client ID configured,
 * the script blocked or offline — are *rejected promises*, never throws: `docs/runbook.md` → the map
 * failing while the list still renders is intended behaviour, and a synchronous throw here would
 * take the whole page with it.
 *
 * One failure mode is deliberately NOT covered here: an origin missing from the key's allowed-URL
 * list. The v3 script serves the full API bundle whatever the key says, so it loads, `naver.maps`
 * exists, and this promise resolves; the API only nulls the global and calls a
 * `window.navermap_authFailure` hook about a second later, after a map has already been
 * constructed. Catching that means reacting *after* the map mounted, which is a different mechanism
 * from this loader — `renderPlaceLocationMap` in `./place-map.ts` owns it.
 */

/** `docs/conventions.md` → Naming. Vite inlines it; it is a browser key, public by design. */
const CLIENT_ID = import.meta.env.VITE_NAVER_MAP_CLIENT_ID as string | undefined;

/** Verbatim from the v3 reference; `ncpKeyId` is the current key parameter. */
const SCRIPT_ORIGIN = 'https://oapi.map.naver.com/openapi/v3/maps.js';

/**
 * A blocked script can hang instead of firing `error` — an ad blocker that black-holes the request
 * leaves the promise pending forever, and with it the map slot stuck on nothing. The timeout turns
 * that into the same fallback every other failure takes.
 */
const LOAD_TIMEOUT_MS = 10_000;

export interface LoadNaverMapsOptions {
  /**
   * Omit to read the build-time key. Passing it explicitly — `undefined` included — overrides that,
   * so a caller (the tests, above all) can say "not configured" on a machine that *is* configured.
   * A `clientId = CLIENT_ID` default parameter cannot express that: it fires on `undefined` too.
   */
  clientId?: string | undefined;
  timeoutMs?: number;
  /** Injected by the tests; production reads the real global. */
  readApi?: () => NaverMapsApi | undefined;
}

interface NaverGlobal {
  naver?: { maps?: NaverMapsApi };
}

function readGlobalApi(): NaverMapsApi | undefined {
  return (globalThis as NaverGlobal).naver?.maps;
}

export function naverMapsScriptUrl(clientId: string): string {
  return `${SCRIPT_ORIGIN}?ncpKeyId=${encodeURIComponent(clientId)}`;
}

/**
 * Resolves with the API, or rejects. Concurrent callers share one script tag and one promise: the
 * map is rendered once per page today, but a second injection would silently redefine the global.
 */
let pending: Promise<NaverMapsApi> | null = null;

export function loadNaverMaps(options: LoadNaverMapsOptions = {}): Promise<NaverMapsApi> {
  const { timeoutMs = LOAD_TIMEOUT_MS, readApi = readGlobalApi } = options;
  const clientId = 'clientId' in options ? options.clientId : CLIENT_ID;

  const already = readApi();
  if (already) return Promise.resolve(already);

  if (pending) return pending;

  if (!clientId) {
    // Not an exceptional state: a contributor with no `.env.local` gets the documented fallback,
    // which is exactly what a blocked script would produce.
    return Promise.reject(new Error('VITE_NAVER_MAP_CLIENT_ID is not configured'));
  }

  pending = new Promise<NaverMapsApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = naverMapsScriptUrl(clientId);
    script.async = true;

    const timer = setTimeout(() => {
      settle(() => reject(new Error('Naver Maps script timed out')));
    }, timeoutMs);

    function settle(finish: () => void): void {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      // Removing the tag matters on the failure paths: a later call injects a fresh one, and two
      // tags with the same src would each define the global. On the timeout path it also drops a
      // request that is still in flight rather than letting it land after the promise rejected.
      script.remove();
      pending = null;
      finish();
    }

    script.onload = (): void => {
      const api = readApi();
      // The event says the response arrived, not that it was usable — a proxy or an error page can
      // fire `load` with nothing defined. The global is what decides success. (Note this does not
      // catch a rejected origin: that response *is* the real bundle. See the module comment.)
      settle(() => (api ? resolve(api) : reject(new Error('Naver Maps script loaded without an API'))));
    };

    script.onerror = (): void => {
      settle(() => reject(new Error('Naver Maps script failed to load')));
    };

    document.head.append(script);
  });

  return pending;
}

/** Test-only: drops the shared promise so each case starts from a clean slate. */
export function resetNaverMapsLoader(): void {
  pending = null;
}
