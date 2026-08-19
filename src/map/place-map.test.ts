import { describe, expect, it, vi } from 'vitest';
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
