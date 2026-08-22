import { afterEach, describe, expect, it } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import type { PlaceRecord } from '../data/types';
import type { FakeNaverApi } from './fake-naver-api';
import { createFakeNaverApi } from './fake-naver-api';
import { MAP_ERROR_MESSAGE, MAP_HEADING, markerLabel, renderPlaceLocationMap } from './place-map';

const PLACE: PlaceRecord = SAMPLE_DATASET.places[0]!;

function container(): HTMLElement {
  return document.createElement('div');
}

/**
 * `renderPlaceLocationMap` installs its auth-failure hook on the real global, so a rendered case
 * would otherwise leave a live closure over a detached DOM for every case that follows.
 */
afterEach(() => {
  delete (globalThis as { navermap_authFailure?: () => void }).navermap_authFailure;
});

/** The property, not a call — the re-render case asserts it is absent rather than a no-op. */
function authFailureHook(): (() => void) | undefined {
  return (globalThis as { navermap_authFailure?: () => void }).navermap_authFailure;
}

async function render(api: FakeNaverApi, place: PlaceRecord = PLACE): Promise<HTMLElement> {
  const root = container();
  await renderPlaceLocationMap(root, place, { loadApi: () => Promise.resolve(api) });
  return root;
}

describe('renderPlaceLocationMap', () => {
  it('renders the heading and a canvas for the map to draw into', async () => {
    const root = await render(createFakeNaverApi());

    expect(root.querySelector('h4')?.textContent).toBe(MAP_HEADING);
    expect(root.querySelector('.place-map-canvas')).toBeInstanceOf(HTMLElement);
    expect(root.querySelector('.place-map-fallback')).toBeNull();
  });

  it('centres one marker on the selected place and never fits bounds', async () => {
    const api = createFakeNaverApi();
    await render(api);

    expect(api.markers).toHaveLength(1);
    expect(api.markers[0]?.options.position.lat()).toBe(PLACE.lat);
    expect(api.markers[0]?.options.position.lng()).toBe(PLACE.lng);
    expect(api.maps).toHaveLength(1);
    expect(api.maps[0]?.options.center.lat()).toBe(PLACE.lat);
    // A single marker has no extent to fit to; the fixed zoom is the whole framing decision.
    expect(api.maps[0]?.fitBoundsCalls).toBe(0);
  });

  it('names the place in the marker title, so the pin is not its only carrier', async () => {
    const api = createFakeNaverApi();
    await render(api);

    expect(api.markers[0]?.options.title).toBe(markerLabel(PLACE));
    expect(markerLabel(PLACE)).toContain(PLACE.name);
  });

  it('shows the documented fallback when the map script never arrives', async () => {
    const root = container();
    await renderPlaceLocationMap(root, PLACE, {
      loadApi: () => Promise.reject(new Error('script blocked')),
    });

    expect(root.querySelector('.place-map-fallback')?.textContent).toBe(MAP_ERROR_MESSAGE);
    expect(root.querySelector('.place-map-canvas')).toBeNull();
    // The failure lands after the dialog has settled, so it has to announce itself.
    expect(root.querySelector('.place-map-fallback')?.getAttribute('role')).toBe('status');
  });

  it('shows the same fallback when the key rejects the origin after the map mounts', async () => {
    const root = await render(createFakeNaverApi());

    authFailureHook()?.();

    expect(root.querySelector('.place-map-fallback')?.textContent).toBe(MAP_ERROR_MESSAGE);
    expect(root.querySelector('.place-map-canvas')).toBeNull();
  });

  it('appends only one fallback however often the API calls the hook', async () => {
    const root = await render(createFakeNaverApi());

    authFailureHook()?.();
    authFailureHook()?.();

    expect(root.querySelectorAll('.place-map-fallback')).toHaveLength(1);
  });

  it('drops the previous handler when a second place is rendered', async () => {
    const first = await render(createFakeNaverApi());
    const second = await render(createFakeNaverApi(), SAMPLE_DATASET.places[1]!);

    authFailureHook()?.();

    // The stale closure would otherwise blank the first dialog's canvas, which is already detached.
    expect(first.querySelector('.place-map-fallback')).toBeNull();
    expect(second.querySelector('.place-map-fallback')?.textContent).toBe(MAP_ERROR_MESSAGE);
  });

  it('leaves no handler installed when the script failed to load', async () => {
    await renderPlaceLocationMap(container(), PLACE, {
      loadApi: () => Promise.reject(new Error('script blocked')),
    });

    expect(authFailureHook()).toBeUndefined();
  });
});
