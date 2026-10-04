import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import type { PlaceRecord } from '../data/types';
import type { FakeNaverApi } from './fake-naver-api';
import { createFakeNaverApi } from './fake-naver-api';
import {
  dotLabel,
  pinLabelMarkup,
  renderPageMap,
  resetAuthFailureState,
  type PageMapHandle,
  type PageMapPlace,
  type RenderPageMapOptions,
} from './place-map';

function container(): HTMLElement {
  return document.createElement('div');
}

/**
 * `renderPageMap` installs its auth-failure hook on the real global, so a rendered case
 * would otherwise leave a live closure over a detached DOM for every case that follows.
 */
afterEach(() => {
  // Each render installs an auth-failure listener on the real global, so a case that mounts without
  // releasing leaves a live closure over a detached DOM — and a listener entry — for the cases after
  // it. This clears the entries too, and the rejected-key memo with them: that is remembered for the
  // life of a real page, so one case's hook call would send every later case to the fallback.
  resetAuthFailureState();
});

/** The property, not a call — the re-render case asserts it is absent rather than a no-op. */
function authFailureHook(): (() => void) | undefined {
  return (globalThis as { navermap_authFailure?: () => void }).navermap_authFailure;
}

/**
 * The page map: the first screen, not a dialog's one marker.
 *
 * It draws a numbered pin for each row the list currently shows, and a neutral dot for every other
 * place that passes the period and 업종 filters. No size, shade or hue from the visit count —
 * `docs/design/map-first-layout.md` → Implementation Decision 1 rules the intensity scale out as
 * surveillance framing — and the number on a pin is the rank string the row itself printed, so it
 * is a text channel the reader has already read rather than a second encoding to decode.
 */
describe('renderPageMap', () => {
  /** `CAMPUS_ORIGIN`, handed in rather than imported: `src/map/` never reads `src/stats/`. */
  const ORIGIN = { lat: 36.6084, lng: 127.3582 };

  const [ALWAYS, CAFE] = SAMPLE_DATASET.places as [PlaceRecord, PlaceRecord, ...PlaceRecord[]];

  async function page(
    api: FakeNaverApi,
    places: PageMapPlace[] = [{ place: ALWAYS }, { place: CAFE }],
    extra: Partial<RenderPageMapOptions> = {},
  ): Promise<{ root: HTMLElement; map: PageMapHandle }> {
    const root = container();
    const map = await renderPageMap(root, places, {
      loadApi: () => Promise.resolve(api),
      origin: ORIGIN,
      ...extra,
    });
    return { root, map };
  }

  it('draws one dot per filtered place, on that place\'s own coordinates', async () => {
    const api = createFakeNaverApi();
    const { root } = await page(api);

    expect(root.querySelector('.page-map-canvas')).toBeInstanceOf(HTMLElement);
    expect(api.markers).toHaveLength(2);
    for (const place of [ALWAYS, CAFE]) {
      const marker = api.markers.find((candidate) => candidate.title === dotLabel(place));
      expect(marker?.options.position.lat(), place.name).toBe(place.lat);
      expect(marker?.options.position.lng(), place.name).toBe(place.lng);
      expect(marker?.attached[0], place.name).toBe(api.maps[0]);
    }
  });

  it('leaves the control already in the region standing', async () => {
    const api = createFakeNaverApi();
    const root = container();
    // What the shell puts there (`src/ui/shell.ts` → `mapRegion`).
    const control = document.createElement('button');
    control.className = 'map-recentre';
    root.append(control);

    await renderPageMap(root, [{ place: ALWAYS }], {
      loadApi: () => Promise.resolve(api),
      origin: ORIGIN,
    });

    // The mount is the paint that gives the reader the map; taking their way back to the campus in
    // the same one would leave a map nobody could re-centre.
    expect(root.querySelector('.map-recentre')).toBe(control);
    expect(root.querySelector('.page-map-canvas')).not.toBeNull();
  });

  it('names the place in the dot, so the dot is never its only carrier', async () => {
    const api = createFakeNaverApi();
    await page(api);

    // Naver shows a marker's `title` as its own tooltip, so the dot's colour and size never carry
    // the place's identity on their own.
    expect(dotLabel(ALWAYS)).toBe(ALWAYS.name);
    expect(api.markers.map((marker) => marker.title)).toEqual([ALWAYS.name, CAFE.name]);
  });

  it('gives every dot the same icon, whatever the visit count', async () => {
    const api = createFakeNaverApi();
    await page(api);

    // The fixture really does span different counts, or this would pass on a map that varied.
    const counts = [ALWAYS, CAFE].map((place) => place.transactions.length);
    expect(new Set(counts).size).toBeGreaterThan(1);

    // The whole option object, not one field: a shade smuggled in as a class name or a second
    // content string is the shape this rule is really about.
    const icons = new Set(api.markers.map((marker) => JSON.stringify(marker.options.icon)));
    expect(icons.size).toBe(1);
    expect(api.markers[0]?.options.icon?.content).toContain('page-map-dot');
  });

  it('gives pins the same icon option object whatever the visit count', async () => {
    const api = createFakeNaverApi();
    await page(api, [
      { place: ALWAYS, label: '1' },
      { place: CAFE, label: '2' },
    ]);

    // The fixture really does span different counts, or this would pass on a map that varied.
    const counts = [ALWAYS, CAFE].map((place) => place.transactions.length);
    expect(new Set(counts).size).toBeGreaterThan(1);

    // Size and anchor are the parts a count could have leaked into; the content is allowed to differ
    // by exactly the number, which is the row's own rank and nothing this module computed.
    const [first, second] = api.markers;
    expect(first?.icon?.size?.width).toBe(second?.icon?.size?.width);
    expect(first?.icon?.size?.height).toBe(second?.icon?.size?.height);
    expect(first?.icon?.anchor?.x).toBe(second?.icon?.anchor?.x);
    expect(first?.icon?.anchor?.y).toBe(second?.icon?.anchor?.y);
    expect(first?.icon?.content).toBe(pinLabelMarkup('1', false));
    expect(second?.icon?.content).toBe(pinLabelMarkup('2', false));
  });

  it('opens on the campus origin and returns there on demand', async () => {
    const api = createFakeNaverApi();
    const { map } = await page(api);
    const centre = () => api.maps[0]?.centers.at(-1);

    expect(api.maps[0]?.options.center.lat()).toBe(ORIGIN.lat);
    expect(centre()?.lat(), 'nothing has moved the map yet').toBe(ORIGIN.lat);

    map.recenter();

    // After a pan, so this cannot pass on a map that was never moved at all.
    expect(centre()?.lat()).toBe(ORIGIN.lat);
    expect(centre()?.lng()).toBe(ORIGIN.lng);
    expect(api.maps[0]?.centers).toHaveLength(2);
  });

  it('takes the excluded dots off the map when the filtered set narrows', async () => {
    const api = createFakeNaverApi();
    const { map } = await page(api);

    map.setPlaces([{ place: CAFE }]);

    const dropped = api.markers.find((marker) => marker.title === dotLabel(ALWAYS));
    const kept = api.markers.find((marker) => marker.title === dotLabel(CAFE));
    // A dot left standing is the failure this exists to prevent: the map would answer a question
    // about a window and a filter the list has already moved on from.
    expect(dropped?.attached.at(-1)).toBeNull();
    expect(kept?.attached.at(-1)).toBe(api.maps[0]);
  });

  it('keeps a surviving dot as the same marker rather than drawing a second one', async () => {
    const api = createFakeNaverApi();
    const { map } = await page(api, [{ place: ALWAYS }, { place: CAFE }]);

    map.setPlaces([{ place: CAFE }, { place: ALWAYS }]);

    // Id-keyed, so a reordering or a widening filter costs no marker and no flicker.
    expect(api.markers).toHaveLength(2);
    expect(api.markers.every((marker) => marker.attached.every((at) => at !== null))).toBe(true);
  });

  it('tells the page the map never arrived, and removes the canvas', async () => {
    const root = container();
    const unavailable = vi.fn();

    await renderPageMap(root, [{ place: ALWAYS }], {
      loadApi: () => Promise.reject(new Error('script blocked')),
      origin: ORIGIN,
      onUnavailable: unavailable,
    });

    expect(unavailable).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.page-map-canvas')).toBeNull();
  });

  it('tells the page once however often the key is rejected', async () => {
    const unavailable = vi.fn();
    await page(createFakeNaverApi(), [{ place: ALWAYS }], { onUnavailable: unavailable });

    authFailureHook()?.();
    authFailureHook()?.();

    // One switch to the full-width layout and one sentence at the top of it, whatever the API does.
    expect(unavailable).toHaveBeenCalledTimes(1);
  });

  it('tells every page-map subscriber about the same rejected key', async () => {
    const unavailable = vi.fn();
    await page(createFakeNaverApi(), [{ place: ALWAYS }], { onUnavailable: unavailable });
    const another = vi.fn();
    await page(createFakeNaverApi(), [{ place: CAFE }], { onUnavailable: another });

    authFailureHook()?.();

    // The page map holds the hook for the life of the page, so a handler that only the newest
    // render owns would leave the first screen showing a map the key had already taken away.
    expect(unavailable).toHaveBeenCalledTimes(1);
    expect(another).toHaveBeenCalledTimes(1);
  });

  it('releases the map and stops listening when the page releases it', async () => {
    const unavailable = vi.fn();
    const api = createFakeNaverApi();
    const { map } = await page(api, [{ place: ALWAYS }], { onUnavailable: unavailable });

    map.release();
    authFailureHook()?.();

    expect(api.maps[0]?.destroyCalls).toBe(1);
    // A released render must not raise the page's fallback: the release belongs to the page, and
    // the page is what decides what it shows now.
    expect(unavailable).not.toHaveBeenCalled();
  });

  it('goes straight to the fallback once the key has been rejected', async () => {
    const first = vi.fn();
    const { map } = await page(createFakeNaverApi(), [{ place: ALWAYS }], { onUnavailable: first });
    authFailureHook()?.();
    map.release();

    let loads = 0;
    const second = vi.fn();
    const root = container();
    await renderPageMap(root, [{ place: ALWAYS }], {
      loadApi: () => {
        loads += 1;
        return Promise.resolve(createFakeNaverApi());
      },
      origin: ORIGIN,
      onUnavailable: second,
    });

    // The origin does not change within a page, so a second mount would only buy another ~1.1 s of
    // a map that is about to be taken away again. Each render reports its own unavailability, so
    // the second render's spy is a separate one.
    expect(loads).toBe(0);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.page-map-canvas')).toBeNull();
  });

  it('does nothing on setPlaces or recenter after a release', async () => {
    const api = createFakeNaverApi();
    const { map } = await page(api, [{ place: ALWAYS }, { place: CAFE }]);

    map.release();

    // The UI keeps its handle for the life of the page, so the calls that arrive after a release
    // must be inert rather than throwing into an event handler.
    expect(() => {
      map.setPlaces([{ place: CAFE }]);
      map.recenter();
      map.release();
    }).not.toThrow();
    expect(api.markers).toHaveLength(2);
    expect(api.maps[0]?.centers).toHaveLength(1);
  });

  it('releases the map and stops listening when the key is rejected after the mount', async () => {
    const api = createFakeNaverApi();
    const unavailable = vi.fn();
    const { map } = await page(api, [{ place: ALWAYS }, { place: CAFE }], { onUnavailable: unavailable });

    // The real API calls the hook ~1.1 s after a mounted map (./loader.ts module comment), and this
    // page map is the one that stays mounted for the life of the page: leaving the instance, its
    // markers and the listener behind would keep all three for good.
    authFailureHook()?.();

    expect(api.maps[0]?.destroyCalls).toBe(1);
    expect(api.markers.every((marker) => marker.attached.at(-1) === null)).toBe(true);
    expect(authFailureHook()).toBeUndefined();

    // And the page's own release, which arrives afterwards, must not destroy the same map twice.
    expect(() => map.release()).not.toThrow();
    expect(api.maps[0]?.destroyCalls).toBe(1);
    expect(unavailable).toHaveBeenCalledTimes(1);
  });

  it('hands back a handle even when nothing mounted', async () => {
    const map = await renderPageMap(container(), [{ place: ALWAYS }], {
      loadApi: () => Promise.reject(new Error('script blocked')),
      origin: ORIGIN,
    });

    // The caller never has to branch on whether the map came up.
    expect(() => map.release()).not.toThrow();
  });
});

/**
 * The numbered pins: the map's answer to "which row is this one?".
 *
 * `label` is the rank string the row already printed, handed in as data. `src/map/` never ranks
 * anything, so these cases read the label the UI chose rather than asserting a number this module
 * could have derived — which is the invariant Decision 2 states, and the one the layer-rule case at
 * the bottom of this file enforces on the imports.
 */
describe('page map pin labels', () => {
  /** `CAMPUS_ORIGIN`, handed in rather than imported: `src/map/` never reads `src/stats/`. */
  const ORIGIN = { lat: 36.6084, lng: 127.3582 };
  const [ALWAYS, CAFE] = SAMPLE_DATASET.places as [PlaceRecord, PlaceRecord, ...PlaceRecord[]];

  async function labelled(
    api: FakeNaverApi,
    places: PageMapPlace[],
  ): Promise<PageMapHandle> {
    return renderPageMap(container(), places, {
      loadApi: () => Promise.resolve(api),
      origin: ORIGIN,
    });
  }

  function markerFor(api: FakeNaverApi, place: PlaceRecord) {
    return api.markers.find((candidate) => candidate.title === dotLabel(place));
  }

  it("prints each visible row's own label and leaves every other filtered place a dot", async () => {
    const api = createFakeNaverApi();
    await labelled(api, [{ place: ALWAYS, label: '1' }, { place: CAFE }]);

    // The pin carries the number the row printed, and nothing about the visit count: the label is
    // what the UI handed over, copied through untouched.
    expect(markerFor(api, ALWAYS)?.icon?.content).toBe(pinLabelMarkup('1', false));
    // A place that passes the filters but has no row on screen stays the neutral dot.
    expect(markerFor(api, CAFE)?.icon?.content).toContain('page-map-dot');
    expect(api.markers).toHaveLength(2);
  });

  it('re-labels the marker it already has when a row\'s rank moves, rather than drawing a second', async () => {
    const api = createFakeNaverApi();
    const map = await labelled(api, [{ place: ALWAYS, label: '1' }, { place: CAFE }]);

    map.setPlaces([{ place: ALWAYS, label: '4' }, { place: CAFE }]);

    // A second marker would put two numbers on the map for one row, and the one the reader saw
    // first would still be standing.
    expect(api.markers).toHaveLength(2);
    expect(markerFor(api, ALWAYS)?.icon?.content).toBe(pinLabelMarkup('4', false));
  });

  it('drops a place back to a dot when its row leaves the visible set', async () => {
    const api = createFakeNaverApi();
    const map = await labelled(api, [{ place: ALWAYS, label: '1' }, { place: CAFE }]);

    // `더 보기` has not run, or the reader switched window and the row is gone: the place is still
    // in the filtered set, so it keeps its marker and loses only the number.
    map.setPlaces([{ place: ALWAYS }, { place: CAFE }]);

    expect(api.markers).toHaveLength(2);
    expect(markerFor(api, ALWAYS)?.icon?.content).toContain('page-map-dot');
    expect(markerFor(api, ALWAYS)?.attached.at(-1)).toBe(api.maps[0]);
  });

  it('stacks a pin above a dot, so a dense cluster cannot bury a rank', async () => {
    const api = createFakeNaverApi();
    await labelled(api, [{ place: ALWAYS, label: '1' }, { place: CAFE }]);

    // Observed at 1440px around 오송: at the vendor's one default level, dots drawn after a pin
    // covered its centre, and rows 2, 4 and 6 had no visible number on the map.
    expect(markerFor(api, ALWAYS)?.zIndex).toBeGreaterThan(markerFor(api, CAFE)?.zIndex ?? Infinity);
  });

  it('restacks a reused marker with its icon, on promotion and on demotion', async () => {
    const api = createFakeNaverApi();
    const map = await labelled(api, [{ place: ALWAYS, label: '1' }, { place: CAFE }]);

    // `더 보기` reuses the dot's marker, so a level set only at creation would keep it under the
    // dots it now has to stand above — and leave a demoted pin standing over them.
    map.setPlaces([{ place: ALWAYS }, { place: CAFE, label: '11' }]);

    expect(markerFor(api, CAFE)?.zIndex).toBeGreaterThan(markerFor(api, ALWAYS)?.zIndex ?? Infinity);
  });

  it('never prints a label it was not handed', async () => {
    const api = createFakeNaverApi();
    await labelled(api, [{ place: ALWAYS }]);

    // The module computes no rank, so with no label there is no number to invent — a rank of 1
    // would be a claim about the data that `src/stats/` owns.
    expect(markerFor(api, ALWAYS)?.icon?.content).not.toMatch(/>\s*\d+\s*</);
  });

  it('escapes a label rather than injecting it as markup', async () => {
    const api = createFakeNaverApi();
    await labelled(api, [{ place: ALWAYS, label: '<img src=x>' }]);

    // The pin body is injected as HTML into the map's own overlay layer, and `label` is the UI's
    // value — today a rank, tomorrow anything. Escaping here is what keeps that a non-issue.
    expect(markerFor(api, ALWAYS)?.icon?.content).toBe(pinLabelMarkup('<img src=x>', false));
    expect(markerFor(api, ALWAYS)?.icon?.content).not.toContain('<img');
  });
});

/**
 * Both directions, because one of them alone answers a question the other does not.
 *
 * Row → pin is "what is this row's place?" and pin → row is "what is this pin?"; a reader who
 * touched the map has no row in hand to look up from, which is the whole reason the second
 * direction exists.
 */
describe('page map highlight sync', () => {
  const ORIGIN = { lat: 36.6084, lng: 127.3582 };
  const [ALWAYS, CAFE] = SAMPLE_DATASET.places as [PlaceRecord, PlaceRecord, ...PlaceRecord[]];

  async function withPins(
    api: FakeNaverApi,
    options: Partial<RenderPageMapOptions> = {},
  ): Promise<PageMapHandle> {
    return renderPageMap(container(), [{ place: ALWAYS, label: '1' }, { place: CAFE }], {
      loadApi: () => Promise.resolve(api),
      origin: ORIGIN,
      ...options,
    });
  }

  function pinFor(api: FakeNaverApi, place: PlaceRecord) {
    return api.markers.find((candidate) => candidate.title === dotLabel(place));
  }

  it('puts the matching pin on its active icon and takes it off again', async () => {
    const api = createFakeNaverApi();
    const map = await withPins(api);

    map.highlight(ALWAYS.id);
    expect(pinFor(api, ALWAYS)?.icon?.content).toBe(pinLabelMarkup('1', true));

    // Leaving the row has to undo it: a pin left active would claim a row the reader is not on.
    map.highlight(null);
    expect(pinFor(api, ALWAYS)?.icon?.content).toBe(pinLabelMarkup('1', false));
  });

  it('lifts the lit pin above the other pins and lets it back down', async () => {
    const api = createFakeNaverApi();
    const map = await withPins(api);
    map.setPlaces([{ place: ALWAYS, label: '1' }, { place: CAFE, label: '2' }]);
    const resting = pinFor(api, CAFE)?.zIndex;

    // Neighbouring pins overlap at the default zoom, and the one the reader is on is the one that
    // has to be read whole.
    map.highlight(ALWAYS.id);
    expect(pinFor(api, ALWAYS)?.zIndex).toBeGreaterThan(resting ?? Infinity);

    map.highlight(null);
    expect(pinFor(api, ALWAYS)?.zIndex).toBe(resting);
  });

  it('moves the highlight from one place to the next without leaving the first lit', async () => {
    const api = createFakeNaverApi();
    const map = await withPins(api);

    map.highlight(ALWAYS.id);
    map.highlight(CAFE.id);

    // CAFE has no row, so it stays the dot it is — but ALWAYS must not keep a highlight the reader
    // moved on from.
    expect(pinFor(api, ALWAYS)?.icon?.content).toBe(pinLabelMarkup('1', false));
    expect(pinFor(api, CAFE)?.icon?.content).toContain('page-map-dot');
  });

  it('keeps a labelled place lit across a filter change that kept it', async () => {
    const api = createFakeNaverApi();
    const map = await withPins(api);
    map.highlight(ALWAYS.id);

    map.setPlaces([{ place: ALWAYS, label: '1' }]);

    // The marker survives a filter change by id, so the state it was left in has to survive it too.
    expect(pinFor(api, ALWAYS)?.icon?.content).toBe(pinLabelMarkup('1', true));
  });

  it('drops the highlight when the row leaves the visible set, so it cannot come back lit', async () => {
    const api = createFakeNaverApi();
    const map = await withPins(api);
    map.highlight(ALWAYS.id);

    // `highlight(null)` skips dots, so a marker demoted while lit would keep a stale `active` —
    // and `더 보기` bringing its row back would then paint a pin lit for a row nobody is on.
    map.setPlaces([{ place: ALWAYS }, { place: CAFE }]);
    expect(pinFor(api, ALWAYS)?.icon?.content).toContain('page-map-dot');

    map.setPlaces([{ place: ALWAYS, label: '1' }, { place: CAFE }]);
    expect(pinFor(api, ALWAYS)?.icon?.content).toBe(pinLabelMarkup('1', false));
  });

  it('stops reporting once a pin is demoted to a dot', async () => {
    const api = createFakeNaverApi();
    const onPinHover = vi.fn();
    const map = await withPins(api, { onPinHover });
    const demoted = pinFor(api, ALWAYS)!;

    // A window change takes the row away while the place stays in the filtered set.
    map.setPlaces([{ place: ALWAYS }, { place: CAFE }]);
    demoted.emit('mouseover');
    demoted.emit('mouseout');

    // The listeners stay attached — the vendor surface has no per-marker remove this module needs —
    // so the guard has to read the marker's *current* state. A demoted marker reporting `null` on
    // the way out would clear the row the reader had actually moved onto.
    expect(onPinHover).not.toHaveBeenCalled();
  });

  it('tells the page which pin the reader touched, so it can highlight that row', async () => {
    const api = createFakeNaverApi();
    const onPinHover = vi.fn();
    await withPins(api, { onPinHover });

    pinFor(api, ALWAYS)?.emit('mouseover');
    pinFor(api, ALWAYS)?.emit('mouseout');

    // `null` on the way out is the half that matters: without it the row the reader left stays lit
    // for as long as the map lives.
    expect(onPinHover).toHaveBeenNthCalledWith(1, ALWAYS.id);
    expect(onPinHover).toHaveBeenNthCalledWith(2, null);
  });

  it('has no listener on a dot, because a place with no row has no row to light', async () => {
    const api = createFakeNaverApi();
    const onPinHover = vi.fn();
    await withPins(api, { onPinHover });

    // A dot hovered reporting a row that does not exist would clear whatever row the reader was
    // actually on, which is worse than the dot doing nothing.
    pinFor(api, CAFE)?.emit('mouseover');

    expect(onPinHover).not.toHaveBeenCalled();
  });

  it('gives a dot listeners when `더 보기` promotes it to a pin', async () => {
    const api = createFakeNaverApi();
    const onPinHover = vi.fn();
    const map = await withPins(api, { onPinHover });

    // The paging path the ticket names: this marker was built as a dot and is *reused* as a pin, so
    // attaching the listeners only where a marker is created would leave every paged-in pin mute.
    map.setPlaces([{ place: ALWAYS, label: '1' }, { place: CAFE, label: '11' }]);
    pinFor(api, CAFE)?.emit('mouseover');

    expect(onPinHover).toHaveBeenCalledWith(CAFE.id);
  });

  it('attaches the listeners once, so a re-ranking pin does not report twice', async () => {
    const api = createFakeNaverApi();
    const onPinHover = vi.fn();
    const map = await withPins(api, { onPinHover });

    // A window switch re-labels a pin that already had listeners; adding a second pair would make
    // one hover report the place twice.
    map.setPlaces([{ place: ALWAYS, label: '4' }, { place: CAFE }]);
    pinFor(api, ALWAYS)?.emit('mouseover');

    expect(onPinHover).toHaveBeenCalledTimes(1);
  });

  it('does nothing on highlight after a release', async () => {
    const api = createFakeNaverApi();
    const map = await withPins(api);
    map.release();

    // The UI keeps its handle for the life of the page, so a hover that lands after the release must
    // be inert rather than throwing into the vendor's own event dispatch.
    expect(() => map.highlight(ALWAYS.id)).not.toThrow();
    expect(api.markers).toHaveLength(2);
  });
});

/**
 * Where the map looks, given that part of it is always under the page.
 *
 * The map fills the viewport behind the desktop column and the mobile sheet, so "the middle of the
 * map" is a point a reader may not be able to see. The page hands in what covers it; the map frames
 * the filtered set inside what is left, and centres a focused place there. Margins and offsets are
 * pinned as literals: a value recomputed with the module's own arithmetic would agree with any
 * arithmetic.
 */
describe('page map framing', () => {
  const ORIGIN = { lat: 36.6084, lng: 127.3582 };
  const [ALWAYS, CAFE, THIRD] = SAMPLE_DATASET.places as [
    PlaceRecord,
    PlaceRecord,
    PlaceRecord,
    ...PlaceRecord[],
  ];
  /** The half-open mobile sheet: 300px of a phone-height map under the panel. */
  const SHEET = { top: 0, right: 0, bottom: 300, left: 0 };

  async function framed(
    api: FakeNaverApi,
    places: PageMapPlace[],
    insets: () => { top: number; right: number; bottom: number; left: number } = () => SHEET,
  ): Promise<PageMapHandle> {
    return renderPageMap(container(), places, {
      loadApi: () => Promise.resolve(api),
      origin: ORIGIN,
      coveredInsets: insets,
    });
  }

  const coords = (api: FakeNaverApi, fit = -1) =>
    api.maps[0]?.fits.at(fit)?.coords.map((point) => [point.lat(), point.lng()]);
  const pans = (api: FakeNaverApi) => api.maps[0]?.pans.map(({ x, y }) => [x, y]);

  it('frames every filtered dot on mount, reserving the covered edge at the vendor\'s 2x', async () => {
    const api = createFakeNaverApi();
    await framed(api, [{ place: ALWAYS }, { place: CAFE, label: '1' }]);

    expect(api.maps[0]?.fits).toHaveLength(1);
    expect(coords(api)).toEqual([
      [ALWAYS.lat, ALWAYS.lng],
      [CAFE.lat, CAFE.lng],
    ]);
    // 16px gap on every side, the sheet's 300px on the bottom — each doubled, because the bundle
    // widens the frame by half of what it is handed (measured 2026-10-04, `./naver-api.ts`).
    expect(api.maps[0]?.fits[0]?.options).toEqual({ top: 32, right: 32, bottom: 632, left: 32, maxZoom: 16 });
  });

  it('re-frames when a filter changes which places are drawn, not when a row is relabelled', async () => {
    const api = createFakeNaverApi();
    const map = await framed(api, [{ place: ALWAYS }, { place: CAFE }]);

    map.setPlaces([{ place: ALWAYS, label: '1' }, { place: CAFE, label: '2' }]);
    expect(api.maps[0]?.fits, '`더 보기` paged rows in; the set is the same').toHaveLength(1);

    map.setPlaces([{ place: ALWAYS }, { place: CAFE }, { place: THIRD }]);
    expect(api.maps[0]?.fits).toHaveLength(2);
    expect(coords(api)).toEqual([
      [ALWAYS.lat, ALWAYS.lng],
      [CAFE.lat, CAFE.lng],
      [THIRD.lat, THIRD.lng],
    ]);
  });

  it('centres a lone place in the uncovered part, and leaves an empty set where it is', async () => {
    const api = createFakeNaverApi();
    const map = await framed(api, [{ place: ALWAYS }, { place: CAFE }]);

    map.setPlaces([]);
    expect(api.maps[0]?.fits).toHaveLength(1);
    expect(api.maps[0]?.centers).toHaveLength(1);

    // `fitBounds` over one coordinate did not move the live map at all, so one place is a centring.
    map.setPlaces([{ place: CAFE }]);
    expect(api.maps[0]?.fits).toHaveLength(1);
    expect(api.maps[0]?.centers.at(-1)?.lat()).toBe(CAFE.lat);
    expect(pans(api)).toEqual([[0, 150]]);
  });

  it('centres a focused place above the sheet rather than under it', async () => {
    const api = createFakeNaverApi();
    const map = await framed(api, [{ place: ALWAYS }, { place: CAFE }]);

    map.focusPlace(CAFE);

    expect(api.maps[0]?.centers.at(-1)?.lat()).toBe(CAFE.lat);
    expect(api.maps[0]?.centers.at(-1)?.lng()).toBe(CAFE.lng);
    // Half the sheet: the view moves down by 150px, so the place sits 150px above the map's middle —
    // the middle of the 300px of map the sheet leaves uncovered on a 600px screen.
    expect(pans(api)).toEqual([[0, 150]]);
  });

  it('centres beside the desktop column and below the masthead', async () => {
    const api = createFakeNaverApi();
    const map = await framed(api, [{ place: ALWAYS }, { place: CAFE }], () => ({
      top: 196,
      right: 0,
      bottom: 0,
      left: 360,
    }));

    map.focusPlace(CAFE);
    map.recenter();

    expect(pans(api)).toEqual([
      [-180, -98],
      [-180, -98],
    ]);
    expect(api.maps[0]?.centers.at(-1)?.lat()).toBe(ORIGIN.lat);
  });

  it('holds the focused place across a filter change, and lets go when the detail closes', async () => {
    const api = createFakeNaverApi();
    const map = await framed(api, [{ place: ALWAYS }, { place: CAFE }]);

    map.focusPlace(CAFE);
    map.setPlaces([{ place: CAFE }, { place: THIRD }]);
    expect(api.maps[0]?.fits, 'a reader reading one place keeps it in view').toHaveLength(1);

    map.focusPlace(null);
    expect(api.maps[0]?.centers.at(-1)?.lat(), 'closing moves nothing').toBe(CAFE.lat);
    map.setPlaces([{ place: ALWAYS }, { place: THIRD }]);
    expect(api.maps[0]?.fits).toHaveLength(2);
  });

  it('re-centres the focused place against the sheet\'s new height after a snap', async () => {
    const api = createFakeNaverApi();
    let insets = SHEET;
    const map = await framed(api, [{ place: ALWAYS }, { place: CAFE }], () => insets);

    map.keepFocusVisible();
    expect(pans(api), 'nothing focused: a snap must not move a map the reader panned').toEqual([]);

    map.focusPlace(CAFE);
    insets = { top: 0, right: 0, bottom: 104, left: 0 };
    map.keepFocusVisible();

    expect(api.maps[0]?.centers.at(-1)?.lat()).toBe(CAFE.lat);
    expect(pans(api)).toEqual([
      [0, 150],
      [0, 52],
    ]);
  });

  it('does not frame or pan after a release', async () => {
    const api = createFakeNaverApi();
    const map = await framed(api, [{ place: ALWAYS }, { place: CAFE }]);
    map.focusPlace(CAFE);
    map.release();

    map.keepFocusVisible();
    map.focusPlace(null);
    map.setPlaces([{ place: THIRD }, { place: ALWAYS }]);

    expect(api.maps[0]?.fits).toHaveLength(1);
    expect(api.maps[0]?.pans).toHaveLength(1);
  });
});

/**
 * The layer rule, asserted over the sources rather than left to review.
 *
 * `src/map/` computes no statistic and reads nothing from `src/stats/`: the campus origin and the
 * rank labels both cross as data. Reading a rank from `computeTopPlaces` here would put a second
 * definition of "the row's rank" in the app, and the page map has no window or filter of its own to
 * rank over.
 */
describe('the map layer rule', () => {
  it('scans the map sources, so an empty glob cannot pass', () => {
    const sources = import.meta.glob('/src/map/*.ts', { query: '?raw', import: 'default', eager: true });

    expect(Object.keys(sources).length).toBeGreaterThan(3);
  });

  it('imports nothing from src/stats/', () => {
    const sources = import.meta.glob('/src/map/*.ts', { query: '?raw', import: 'default', eager: true });

    const offenders = Object.entries(sources).flatMap(([path, text]) =>
      /from '\.\.\/stats\//.test(text) ? [path] : [],
    );

    // Test files are excluded by the glob's own path shape only if the pattern excludes them; it
    // does not, and they may read the fixture either way — so the rule is over the shipped sources.
    expect(offenders.filter((path) => !path.endsWith('.test.ts'))).toEqual([]);
  });
});
