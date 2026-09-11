import { describe, expect, it } from 'vitest';

/**
 * The shipped app reads no device position and keeps nothing on the device — no storage, no
 * cookie, no service worker. That is true today by absence; this makes it a decision.
 *
 * Two of the PRD §44 V2 candidates would change it — distance-from-me needs the Geolocation API and
 * favourites need storage — and `docs/design/deferred-scope.md` records the conditions each must
 * meet (position never leaves the tab or outlives it; storage holds place ids and nothing else). A
 * change that lands one edits `ALLOWED` below, which is where that review is forced to happen.
 */
const SOURCES: Record<string, string> = import.meta.glob(['/src/**/*.ts', '!/src/**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

const DEVICE_STATE_APIS = [
  'geolocation',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'document.cookie',
  'serviceWorker',
  'caches.open',
];

/** `path → APIs it may use`. Empty until a V2 candidate lands under its design conditions. */
const ALLOWED: Record<string, string[]> = {};

describe('device state', () => {
  it('scans the shipped sources, so an empty glob cannot pass', () => {
    expect(Object.keys(SOURCES)).toContain('/src/main.ts');
    expect(Object.keys(SOURCES).length).toBeGreaterThan(10);
  });

  it('reads no device position and stores nothing on the device outside ALLOWED', () => {
    const found = Object.entries(SOURCES).flatMap(([path, text]) =>
      DEVICE_STATE_APIS.filter((api) => text.includes(api) && !(ALLOWED[path] ?? []).includes(api)).map(
        (api) => `${path}: ${api}`,
      ),
    );

    expect(found, 'see docs/design/deferred-scope.md before allowing one').toEqual([]);
  });
});
