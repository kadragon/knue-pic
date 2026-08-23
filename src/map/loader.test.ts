import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeNaverApi } from './fake-naver-api';
import { loadNaverMaps, naverMapsScriptUrl, resetNaverMapsLoader } from './loader';

/**
 * jsdom never executes an injected `<script>`, which is exactly what makes these cases testable:
 * the tag lands in the document inert, and the test fires the event the browser would have.
 */
function injectedScript(): HTMLScriptElement | null {
  return document.head.querySelector<HTMLScriptElement>('script[src*="maps.js"]');
}

afterEach(() => {
  resetNaverMapsLoader();
  injectedScript()?.remove();
});

describe('naverMapsScriptUrl', () => {
  it('passes the key as the ncpKeyId parameter the v3 API expects', () => {
    expect(naverMapsScriptUrl('abc123')).toBe(
      'https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=abc123',
    );
  });

  it('escapes the key rather than splicing it in raw', () => {
    expect(naverMapsScriptUrl('a b&c')).toContain('ncpKeyId=a%20b%26c');
  });
});

describe('loadNaverMaps', () => {
  it('rejects without injecting anything when no client ID is configured', async () => {
    await expect(loadNaverMaps({ clientId: undefined, readApi: () => undefined })).rejects.toThrow();
    expect(injectedScript()).toBeNull();
  });

  it('lets an explicit undefined mean "not configured" even when the build has a key', async () => {
    // The case above passes for the wrong reason wherever `.env` is absent — CI, a fresh clone.
    // Loading the module against a stubbed env is what makes it a guard everywhere: a
    // `clientId = CLIENT_ID` default would swallow the `undefined` and inject a real script tag.
    vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', 'configured-key');
    vi.resetModules();
    const configured = await import('./loader');
    try {
      await expect(
        configured.loadNaverMaps({ clientId: undefined, timeoutMs: 1, readApi: () => undefined }),
      ).rejects.toThrow(/not configured/);
      expect(injectedScript()).toBeNull();
    } finally {
      configured.resetNaverMapsLoader();
      vi.unstubAllEnvs();
    }
  });

  it('rejects when the script fails to load', async () => {
    const pending = loadNaverMaps({ clientId: 'key', readApi: () => undefined });
    const script = injectedScript();
    expect(script).not.toBeNull();

    script?.dispatchEvent(new Event('error'));

    await expect(pending).rejects.toThrow(/failed to load/);
  });

  it('rejects when the script loads but leaves no API behind', async () => {
    // What a rejected key actually does: a 200 response that never defines `naver.maps`.
    const pending = loadNaverMaps({ clientId: 'key', readApi: () => undefined });
    injectedScript()?.dispatchEvent(new Event('load'));

    await expect(pending).rejects.toThrow(/without an API/);
  });

  it('resolves with the global the script defined', async () => {
    const api = createFakeNaverApi();
    let ready = false;

    const pending = loadNaverMaps({ clientId: 'key', readApi: () => (ready ? api : undefined) });
    ready = true;
    injectedScript()?.dispatchEvent(new Event('load'));

    await expect(pending).resolves.toBe(api);
  });

  it('reuses an API that is already on the page instead of injecting a second tag', async () => {
    const api = createFakeNaverApi();

    await expect(loadNaverMaps({ clientId: 'key', readApi: () => api })).resolves.toBe(api);
    expect(injectedScript()).toBeNull();
  });

  it('rejects once the timeout elapses on a request that never settles', async () => {
    const pending = loadNaverMaps({ clientId: 'key', timeoutMs: 1, readApi: () => undefined });

    await expect(pending).rejects.toThrow(/timed out/);
  });
});
