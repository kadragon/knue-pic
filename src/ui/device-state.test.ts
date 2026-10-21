import { describe, expect, it } from 'vitest';

/**
 * Device access is limited to the reviewed favourites store, holding canonical IDs only.
 * Position, cookies, other storage APIs and service workers remain outside the approved scope.
 * See docs/design/deferred-scope.md for the conditions on future device features.
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

/** `path → APIs it may use`. Only the favourites store may persist canonical IDs. */
const ALLOWED: Record<string, string[]> = {
  '/src/ui/favourites-store.ts': ['localStorage'],
};

describe('device state', () => {
  it('limits favourites storage access to its reviewed module', () => {
    expect(SOURCES['/src/ui/favourites-store.ts']).toContain('localStorage');
    expect(ALLOWED).toEqual({ '/src/ui/favourites-store.ts': ['localStorage'] });
  });
  it('scans the shipped sources, so an empty glob cannot pass', () => {
    expect(Object.keys(SOURCES)).toContain('/src/main.ts');
    expect(Object.keys(SOURCES).length).toBeGreaterThan(10);
  });

  it('allows no device-state access outside the reviewed API allowlist', () => {
    const found = Object.entries(SOURCES).flatMap(([path, text]) =>
      DEVICE_STATE_APIS.filter((api) => text.includes(api) && !(ALLOWED[path] ?? []).includes(api)).map(
        (api) => `${path}: ${api}`,
      ),
    );

    expect(found, 'see docs/design/deferred-scope.md before allowing one').toEqual([]);
  });
});
