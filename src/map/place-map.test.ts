import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import type { PlacesDataset } from '../data/types';
import { computeTopPlaces } from '../stats/top-places';
import type { FakeNaverApi } from './fake-naver-api';
import { createFakeNaverApi } from './fake-naver-api';
import {
  MAP_EMPTY_MESSAGE,
  MAP_ERROR_MESSAGE,
  MAP_HEADING,
  markerLabel,
  renderPlaceMap,
} from './place-map';

/** The fixture holds six places, so a limit below six leaves some of them unranked. */
const RANKED_LIMIT = 3;

function container(): HTMLElement {
  return document.createElement('div');
}

/**
 * `renderPlaceMap` installs its auth-failure hook on the real global, so a rendered case would
 * otherwise leave a live closure over a detached DOM for every case that follows.
 */
afterEach(() => {
  delete (globalThis as { navermap_authFailure?: () => void }).navermap_authFailure;
});

/** The property, not a call — the re-render cases assert it is absent rather than a no-op. */
function authFailureHook(): (() => void) | undefined {
  return (globalThis as { navermap_authFailure?: () => void }).navermap_authFailure;
}

async function render(
  api: FakeNaverApi,
  onSelect: (placeId: string) => void = () => {},
  dataset: PlacesDataset = SAMPLE_DATASET,
  limit = RANKED_LIMIT,
): Promise<{ root: HTMLElement; handle: Awaited<ReturnType<typeof renderPlaceMap>> }> {
  const root = container();
  const handle = await renderPlaceMap(
    root,
    dataset,
    computeTopPlaces(dataset, '1y', limit),
    onSelect,
    { loadApi: () => Promise.resolve(api) },
  );
  return { root, handle };
}

/** Reads the numeral a marker's badge markup carries; `null` when the badge holds no number. */
function badgeText(content: string | undefined): string | null {
  const match = content?.match(/>(\d*)<\/span>/);
  const text = match?.[1] ?? '';
  return text === '' ? null : text;
}

describe('renderPlaceMap', () => {
  it('renders the heading and a canvas for the map to draw into', async () => {
    const { root } = await render(createFakeNaverApi());

    expect(root.querySelector('h2')?.textContent).toBe(MAP_HEADING);
    expect(root.querySelector('.place-map-canvas')).toBeInstanceOf(HTMLElement);
    expect(root.querySelector('.place-map-fallback')).toBeNull();
  });

  it('creates one marker per place and fits them all into view once', async () => {
    const api = createFakeNaverApi();
    await render(api);

    expect(api.markers).toHaveLength(SAMPLE_DATASET.places.length);
    expect(api.maps).toHaveLength(1);
    expect(api.maps[0]?.fitBoundsCalls).toBe(1);
  });

  it('numbers only the places currently in the ranked list', async () => {
    const api = createFakeNaverApi();
    await render(api);

    const ranked = computeTopPlaces(SAMPLE_DATASET, '1y', RANKED_LIMIT);
    const expected = new Map(ranked.entries.map((entry) => [entry.place.id, String(entry.rank)]));

    for (const [index, place] of SAMPLE_DATASET.places.entries()) {
      const marker = api.markers[index];
      expect(marker?.options.title).toContain(place.name);
      expect(badgeText(marker?.icon?.content)).toBe(expected.get(place.id) ?? null);
    }

    // Sanity: the fixture must actually contain both kinds for the assertion above to mean anything.
    expect(expected.size).toBe(RANKED_LIMIT);
    expect(SAMPLE_DATASET.places.length).toBeGreaterThan(RANKED_LIMIT);
  });

  it('names the rank in the marker title, so the numeral is not its only carrier', async () => {
    const api = createFakeNaverApi();
    await render(api);

    const top = computeTopPlaces(SAMPLE_DATASET, '1y', RANKED_LIMIT).entries[0];
    const marker = api.markers.find((candidate) => candidate.title?.startsWith(top!.place.name));

    expect(marker?.title).toBe(markerLabel(top!.place, top!.rank));
  });

  it('reports the clicked place to the caller', async () => {
    const api = createFakeNaverApi();
    const onSelect = vi.fn();
    await render(api, onSelect);

    api.markers[2]?.click();

    expect(onSelect).toHaveBeenCalledWith(SAMPLE_DATASET.places[2]?.id);
  });

  it('re-badges the existing markers on a period change without rebuilding the map', async () => {
    const api = createFakeNaverApi();
    const { handle } = await render(api);

    const before = api.markers.map((marker) => badgeText(marker.icon?.content));
    handle.update(computeTopPlaces(SAMPLE_DATASET, '1m', RANKED_LIMIT));
    const after = api.markers.map((marker) => badgeText(marker.icon?.content));

    expect(after).not.toEqual(before);
    expect(api.markers).toHaveLength(SAMPLE_DATASET.places.length);
    expect(api.maps).toHaveLength(1);
    expect(api.maps[0]?.fitBoundsCalls).toBe(1);
  });

  it('marks the selected place and clears the previous one', async () => {
    const api = createFakeNaverApi();
    const { handle } = await render(api);
    const [first, second] = SAMPLE_DATASET.places;

    handle.select(first!.id);
    expect(api.markers[0]?.icon?.content).toContain('data-selected="true"');

    handle.select(second!.id);
    expect(api.markers[0]?.icon?.content).not.toContain('data-selected="true"');
    expect(api.markers[1]?.icon?.content).toContain('data-selected="true"');
  });

  it('lifts the selected marker above the ranked ones so its ring is never covered', async () => {
    const api = createFakeNaverApi();
    const { handle } = await render(api);

    // An unranked place: only the top three are badged at this limit, and search or the detail card
    // routinely selects one outside them.
    const unranked = SAMPLE_DATASET.places.find(
      (place) =>
        !computeTopPlaces(SAMPLE_DATASET, '1y', RANKED_LIMIT).entries.some(
          (entry) => entry.place.id === place.id,
        ),
    );
    const marker = api.markers.find((candidate) => candidate.options.title?.includes(unranked!.name));
    expect(marker?.zIndex).toBe(1);

    handle.select(unranked!.id);

    const ranked = api.markers.filter((candidate) => candidate !== marker).map((c) => c.zIndex ?? 0);
    expect(marker?.zIndex).toBeGreaterThan(Math.max(...ranked));
  });
});

/**
 * `setIcon` is not a cheap assignment on the real API — it tears down and rebuilds the overlay DOM.
 * These cases pin the *cost* of an interaction, not its result: the assertions above already cover
 * what the markers end up looking like.
 */
describe('renderPlaceMap repaint cost', () => {
  it('touches only the deselected and the newly selected marker on a selection change', async () => {
    const api = createFakeNaverApi();
    const { handle } = await render(api);
    const [first, second] = SAMPLE_DATASET.places;

    // The fixture holds more markers than a selection can change, so "at most two" is a real bound.
    expect(api.markers.length).toBeGreaterThan(2);

    const before = api.markers.map((marker) => marker.setIconCalls);
    handle.select(first!.id);
    handle.select(second!.id);
    const deltas = api.markers.map((marker, index) => marker.setIconCalls - before[index]!);

    // The first marker is painted twice — selected, then deselected — the second once, and the
    // rest not at all. Three repaints for two selections, however many places the map holds.
    expect(deltas[0]).toBe(2);
    expect(deltas[1]).toBe(1);
    expect(deltas.slice(2)).toEqual(Array(deltas.length - 2).fill(0));
  });

  it('repaints nothing when the same place is selected twice', async () => {
    const api = createFakeNaverApi();
    const { handle } = await render(api);

    handle.select(SAMPLE_DATASET.places[0]!.id);
    const before = api.markers.map((marker) => marker.setIconCalls);
    handle.select(SAMPLE_DATASET.places[0]!.id);

    expect(api.markers.map((marker) => marker.setIconCalls)).toEqual(before);
  });

  it('repaints only the markers whose rank actually moved on a period change', async () => {
    const api = createFakeNaverApi();
    const { handle } = await render(api);

    const rankIn = (period: '1y' | '1m'): Map<string, number | null> =>
      new Map(
        SAMPLE_DATASET.places.map((place) => [
          place.id,
          computeTopPlaces(SAMPLE_DATASET, period, RANKED_LIMIT).entries.find(
            (entry) => entry.place.id === place.id,
          )?.rank ?? null,
        ]),
      );
    const from = rankIn('1y');
    const to = rankIn('1m');
    const moved = SAMPLE_DATASET.places.filter((place) => from.get(place.id) !== to.get(place.id));

    // Sanity: the fixture must have both movers and non-movers for the assertion to mean anything.
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.length).toBeLessThan(SAMPLE_DATASET.places.length);

    const before = api.markers.map((marker) => marker.setIconCalls);
    handle.update(computeTopPlaces(SAMPLE_DATASET, '1m', RANKED_LIMIT));

    for (const [index, place] of SAMPLE_DATASET.places.entries()) {
      const delta = api.markers[index]!.setIconCalls - before[index]!;
      expect(delta).toBe(moved.includes(place) ? 1 : 0);
    }
  });
  it('keeps the painted rank in step across successive period changes', async () => {
    const api = createFakeNaverApi();
    const { handle } = await render(api);

    // Back to the period the map was built with: every marker that moved on the way out has to
    // move back, which only holds if the first update recorded what it painted.
    handle.update(computeTopPlaces(SAMPLE_DATASET, '1m', RANKED_LIMIT));
    const midway = api.markers.map((marker) => badgeText(marker.icon?.content));
    handle.update(computeTopPlaces(SAMPLE_DATASET, '1y', RANKED_LIMIT));

    const restored = api.markers.map((marker) => badgeText(marker.icon?.content));
    const expected = new Map(
      computeTopPlaces(SAMPLE_DATASET, '1y', RANKED_LIMIT).entries.map((entry) => [
        entry.place.id,
        String(entry.rank),
      ]),
    );

    expect(restored).not.toEqual(midway);
    expect(restored).toEqual(
      SAMPLE_DATASET.places.map((place) => expected.get(place.id) ?? null),
    );
  });
});

describe('renderPlaceMap degradation', () => {
  it('shows the documented message when the map script never loads', async () => {
    const root = container();

    const handle = await renderPlaceMap(
      root,
      SAMPLE_DATASET,
      computeTopPlaces(SAMPLE_DATASET, '1y'),
      () => {},
      { loadApi: () => Promise.reject(new Error('blocked')) },
    );

    const fallback = root.querySelector('.place-map-fallback');
    expect(fallback?.textContent).toBe(MAP_ERROR_MESSAGE);
    // Pinned to the literal as well: `docs/runbook.md` names this exact sentence as the intended
    // degraded state, so rewording the constant has to break a test rather than pass silently.
    expect(MAP_ERROR_MESSAGE).toBe('지도를 불러오지 못했습니다.');
    expect(fallback?.getAttribute('role')).toBe('status');
    expect(root.querySelector('.place-map-canvas')).toBeNull();
    // The heading stays: the section is present and explained, not silently missing.
    expect(root.querySelector('h2')?.textContent).toBe(MAP_HEADING);
    // Calls against the handle stay harmless, so the rest of the page never branches on the failure.
    expect(() => {
      handle.update(computeTopPlaces(SAMPLE_DATASET, '1m'));
      handle.select('restaurant_000001');
    }).not.toThrow();
  });

  it('swaps a mounted map for the fallback when the API reports an auth failure', async () => {
    const api = createFakeNaverApi();
    const { root, handle } = await render(api);

    // The map mounted: this failure only exists because the script and the constructors succeeded.
    expect(root.querySelector('.place-map-canvas')).toBeInstanceOf(HTMLElement);
    expect(api.maps).toHaveLength(1);

    // What the v3 API does about a second later on an origin outside the key's allowed-URL list.
    (globalThis as { navermap_authFailure?: () => void }).navermap_authFailure?.();

    const fallback = root.querySelector('.place-map-fallback');
    expect(fallback?.textContent).toBe(MAP_ERROR_MESSAGE);
    expect(fallback?.getAttribute('role')).toBe('status');
    expect(root.querySelector('.place-map-canvas')).toBeNull();
    expect(root.querySelector('h2')?.textContent).toBe(MAP_HEADING);

    // A second call must not append a second message.
    (globalThis as { navermap_authFailure?: () => void }).navermap_authFailure?.();
    expect(root.querySelectorAll('.place-map-fallback')).toHaveLength(1);

    // The page keeps driving the handle after the map is gone; it must stay harmless and inert.
    const painted = api.markers.map((marker) => marker.setIconCalls);
    expect(() => {
      handle.update(computeTopPlaces(SAMPLE_DATASET, '1m', RANKED_LIMIT));
      handle.select(SAMPLE_DATASET.places[0]!.id);
    }).not.toThrow();
    expect(api.markers.map((marker) => marker.setIconCalls)).toEqual(painted);
  });

  it('clears the auth-failure hook when a re-render finds no places', async () => {
    const api = createFakeNaverApi();
    const { root: first } = await render(api);
    expect(authFailureHook()).toBeTypeOf('function');

    const second = container();
    await renderPlaceMap(
      second,
      { ...SAMPLE_DATASET, places: [] },
      computeTopPlaces({ ...SAMPLE_DATASET, places: [] }, '1y', RANKED_LIMIT),
      () => {},
      { loadApi: () => Promise.resolve(api) },
    );

    // The stale closure is gone, so nothing can rewrite the detached first render.
    expect(authFailureHook()).toBeUndefined();
    expect(second.querySelector('.place-map-empty')?.textContent).toBe(MAP_EMPTY_MESSAGE);
    expect(first.querySelector('.place-map-fallback')).toBeNull();
  });

  it('clears the auth-failure hook when a re-render fails to load the script', async () => {
    const api = createFakeNaverApi();
    const { root: first } = await render(api);
    const firstCanvas = first.querySelector('.place-map-canvas');

    const second = container();
    await renderPlaceMap(
      second,
      SAMPLE_DATASET,
      computeTopPlaces(SAMPLE_DATASET, '1y', RANKED_LIMIT),
      () => {},
      { loadApi: () => Promise.reject(new Error('script blocked')) },
    );

    expect(authFailureHook()).toBeUndefined();
    expect(second.querySelector('.place-map-fallback')?.textContent).toBe(MAP_ERROR_MESSAGE);
    // The first render's canvas is left exactly as it was — no stale handler reached it.
    expect(first.querySelector('.place-map-canvas')).toBe(firstCanvas);
    expect(first.querySelector('.place-map-fallback')).toBeNull();
  });

  it('falls back when the script loads but the API throws while mounting', async () => {
    const root = container();
    const api = createFakeNaverApi();
    // What a rejected key or a moved API version looks like: the global is there, and using it
    // throws.
    const broken = { ...api, Map: class { constructor() { throw new Error('auth'); } } };

    const handle = await renderPlaceMap(
      root,
      SAMPLE_DATASET,
      computeTopPlaces(SAMPLE_DATASET, '1y'),
      () => {},
      { loadApi: () => Promise.resolve(broken as unknown as FakeNaverApi) },
    );

    expect(root.querySelector('.place-map-fallback')?.textContent).toBe(MAP_ERROR_MESSAGE);
    expect(root.querySelector('.place-map-canvas')).toBeNull();
    expect(handle).toBeDefined();
  });

  it('never asks for the script when there is nothing to plot', async () => {
    const root = container();
    const loadApi = vi.fn(() => Promise.resolve(createFakeNaverApi()));
    const empty: PlacesDataset = { updatedAt: SAMPLE_DATASET.updatedAt, places: [] };

    await renderPlaceMap(root, empty, computeTopPlaces(empty, '1y'), () => {}, { loadApi });

    expect(root.querySelector('.place-map-empty')?.textContent).toBe(MAP_EMPTY_MESSAGE);
    expect(loadApi).not.toHaveBeenCalled();
  });
});

describe('framing', () => {
  const BANNED = ['추천', '맛집', '베스트', '평점', '별점', '감시', '추적'];

  it('keeps banned framing out of the rendered map', async () => {
    const { root } = await render(createFakeNaverApi());

    for (const phrase of BANNED) {
      expect(root.textContent ?? '').not.toContain(phrase);
    }
  });

  it('keeps banned framing out of every exported string', () => {
    const strings = [
      MAP_HEADING,
      MAP_ERROR_MESSAGE,
      MAP_EMPTY_MESSAGE,
      markerLabel(SAMPLE_DATASET.places[0]!, 1),
      markerLabel(SAMPLE_DATASET.places[0]!, null),
    ];

    for (const value of strings) {
      for (const phrase of BANNED) {
        expect(value).not.toContain(phrase);
      }
    }
  });
});
