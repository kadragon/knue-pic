import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import { createFakeNaverApi } from '../map/fake-naver-api';
import { renderPageMap, resetAuthFailureState } from '../map/place-map';
import { bootstrap, type MatchMedia } from './bootstrap';
import { createDetailPanel } from './detail-panel';

const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };
const views: HTMLElement[] = [];

function viewport(initial: boolean) {
  let matches = initial;
  const listeners: (() => void)[] = [];
  const list = {
    get matches() { return matches; },
    addEventListener: (_: string, listener: () => void) => listeners.push(listener),
  } as unknown as MediaQueryList;
  return {
    matchMedia: (() => list) as MatchMedia,
    set(value: boolean) { matches = value; listeners.forEach((listener) => listener()); },
  };
}

async function setup(wide = true) {
  const root = document.createElement('div');
  document.body.append(root);
  views.push(root);
  const api = createFakeNaverApi();
  const view = viewport(wide);
  const renderDetailMap = vi.fn();
  await bootstrap(root, {
    load: () => Promise.resolve(SAMPLE_DATASET),
    matchMedia: view.matchMedia,
    dialog: { renderMap: renderDetailMap },
    renderMap: (container, places, options) => renderPageMap(container, places, {
      ...options, loadApi: () => Promise.resolve(api),
    }),
  });
  await flush();
  return { root, api, view, renderDetailMap };
}

function row(root: HTMLElement) { return root.querySelector<HTMLButtonElement>('.top-place-body')!; }
function returnedToList(): Promise<void> {
  return new Promise((resolve) => window.addEventListener('hashchange', () => resolve(), { once: true }));
}
function navigate(hash: string) {
  history.replaceState(null, '', location.pathname + location.search + hash);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

afterEach(() => {
  views.forEach((root) => root.remove());
  views.length = 0;
  history.replaceState(null, '', location.pathname + location.search);
  resetAuthFailureState();
});

describe('panel detail and URL selection', () => {
  it('opens a desktop row in the panel without a modal or second map, then restores focus', async () => {
    const { root, renderDetailMap, api } = await setup();
    const opener = row(root);
    const id = opener.closest('[data-place-id]')!.getAttribute('data-place-id')!;
    opener.focus();
    opener.click();
    const card = root.querySelector<HTMLElement>('.detail-panel .place-detail');
    expect(card).not.toBeNull();
    expect(document.activeElement).toBe(card);
    expect(root.querySelector<HTMLElement>('.place-list-slot')?.hidden).toBe(true);
    expect(root.querySelector('.detail-dialog')).toBeNull();
    expect(root.querySelector('.place-detail-map')).toBeNull();
    expect(renderDetailMap).not.toHaveBeenCalled();
    expect(location.hash).toBe(`#place=${id}`);
    const place = SAMPLE_DATASET.places.find((p) => p.id === id)!;
    expect(api.maps[0]?.centers.at(-1)).toMatchObject({ latitude: place.lat, longitude: place.lng });
    const returned = returnedToList();
    root.querySelector<HTMLButtonElement>('.detail-panel-back')!.click();
    await returned;
    expect(location.hash).toBe('');
    expect(root.querySelector<HTMLElement>('.place-list-slot')?.hidden).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('loads a canonical hash and falls back silently for an unknown or malformed id', async () => {
    const place = SAMPLE_DATASET.places[0]!;
    navigate(`#place=${place.id}`);
    const { root } = await setup();
    expect(root.querySelector('.detail-panel .place-detail-name')?.textContent).toBe(place.name);
    navigate('#place=missing');
    expect(root.querySelector('.detail-panel')).toBeNull();
    expect(root.querySelector<HTMLElement>('.place-list-slot')?.hidden).toBe(false);
    navigate('#place=%E0%A4%A');
    expect(root.querySelector('.detail-panel')).toBeNull();
  });

  it('opens a pin and an unranked dot on click and preserves the list marker set', async () => {
    const { root, api } = await setup();
    const marker = api.markers[0]!;
    marker.emit('click');
    expect(root.querySelector('.detail-panel .place-detail-name')?.textContent).toBe(marker.title);
    const returned = returnedToList();
    root.querySelector<HTMLButtonElement>('.detail-panel-back')!.click();
    await returned;
    // A larger fixture makes the last in-window place an unnumbered dot, beyond page one.
    const extra = SAMPLE_DATASET.places[0]!;
    const dataset = { ...SAMPLE_DATASET, places: Array.from({ length: 15 }, (_, i) => ({
      ...extra, id: `restaurant_${String(i + 100).padStart(6, '0')}`, name: `Venue ${i}`,
    })) };
    const other = document.createElement('div'); document.body.append(other); views.push(other);
    const dots = createFakeNaverApi();
    await bootstrap(other, { load: () => Promise.resolve(dataset), matchMedia: viewport(true).matchMedia,
      renderMap: (container, places, options) => renderPageMap(container, places, {
        ...options, loadApi: () => Promise.resolve(dots),
      }),
    });
    await flush();
    const dot = dots.markers.find((m) => m.icon?.content.includes('page-map-dot'))!;
    expect(dot).toBeDefined();
    dot.emit('click');
    expect(other.querySelector('.detail-panel .place-detail-name')?.textContent).toBe(dot.title);
    expect(dots.markers.filter((m) => m.attached.at(-1) !== null)).toHaveLength(15);
  });

  it('opens a search result with its existing figures basis', async () => {
    const { root } = await setup();
    const input = root.querySelector<HTMLInputElement>('.place-search-input')!;
    input.value = SAMPLE_DATASET.places[0]!.name; input.dispatchEvent(new Event('input'));
    root.querySelector<HTMLButtonElement>('.place-search-results button')?.click();
    expect(root.querySelector('.detail-panel')).not.toBeNull();
    expect(root.querySelector('.detail-panel')?.textContent).toContain('최근 1년');
  });

  it('browser Back returns to the list and Forward restores the selected place', async () => {
    const { root } = await setup();
    const opener = row(root); opener.focus(); opener.click();
    const hash = location.hash;
    const back = new Promise<void>((resolve) => window.addEventListener('hashchange', () => resolve(), { once: true }));
    history.back(); await back;
    expect(root.querySelector('.detail-panel')).toBeNull();
    expect(document.activeElement).toBe(opener);
    const forward = new Promise<void>((resolve) => window.addEventListener('hashchange', () => resolve(), { once: true }));
    history.forward(); await forward;
    expect(location.hash).toBe(hash);
    expect(root.querySelector('.detail-panel')).not.toBeNull();
  });

  it('keeps the mobile dialog and migrates an open selection across the breakpoint', async () => {
    const { root, view, renderDetailMap } = await setup(false);
    const opener = row(root); opener.focus(); opener.click();
    expect(root.querySelector<HTMLElement>('.detail-dialog')?.hidden).toBe(false);
    expect(renderDetailMap).toHaveBeenCalledOnce();
    view.set(true);
    expect(root.querySelector('.detail-dialog')).toBeNull();
    expect(root.querySelector('.detail-panel')).not.toBeNull();
    view.set(false);
    expect(root.querySelector<HTMLElement>('.detail-dialog')?.hidden).toBe(false);
    const returned = returnedToList();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await returned;
    expect(location.hash).toBe('');
    expect(document.activeElement).toBe(opener);
  });

  it('pops a pushed detail entry on return so Forward still restores it', async () => {
    const { root } = await setup();
    row(root).click();
    const hash = location.hash;
    const back = new Promise<void>((resolve) => window.addEventListener('hashchange', () => resolve(), { once: true }));
    root.querySelector<HTMLButtonElement>('.detail-panel-back')!.click();
    await back;
    expect(location.hash).toBe('');
    const forward = new Promise<void>((resolve) => window.addEventListener('hashchange', () => resolve(), { once: true }));
    history.forward(); await forward;
    expect(location.hash).toBe(hash);
    expect(root.querySelector('.detail-panel')).not.toBeNull();
  });

  it('restores search figures on Forward and a reload with the same canonical URL', async () => {
    const { root } = await setup();
    const input = root.querySelector<HTMLInputElement>('.place-search-input')!;
    input.value = SAMPLE_DATASET.places[0]!.name; input.dispatchEvent(new Event('input'));
    root.querySelector<HTMLButtonElement>('.place-search-results button')!.click();
    const back = new Promise<void>((resolve) => window.addEventListener('hashchange', () => resolve(), { once: true }));
    history.back(); await back;
    const forward = new Promise<void>((resolve) => window.addEventListener('hashchange', () => resolve(), { once: true }));
    history.forward(); await forward;
    expect(root.querySelector('.place-detail-period')?.textContent).toContain('최근 1년');
    root.remove();
    const reloaded = await setup();
    expect(reloaded.root.querySelector('.place-detail-period')?.textContent).toContain('최근 1년');
  });

  it('lights the selected pin when a shared URL mounts its page map', async () => {
    const place = SAMPLE_DATASET.places[0]!;
    navigate(`#place=${place.id}`);
    const { api } = await setup();
    expect(api.markers.find((marker) => marker.title === place.name)?.icon?.content).toContain('is-active');
  });

  it('reuses an open mobile dialog when a second place is selected', async () => {
    const { root } = await setup(false);
    row(root).click();
    const dialog = root.querySelector('.detail-dialog');
    root.querySelectorAll<HTMLButtonElement>('.top-place-body')[1]!.click();
    expect(root.querySelector('.detail-dialog')).toBe(dialog);
    const returned = returnedToList();
    root.querySelector<HTMLButtonElement>('.detail-dialog-close')!.click();
    await returned;
  });

  it('re-centres and highlights an existing page map when an open mobile selection widens', async () => {
    const { root, api, view } = await setup();
    view.set(false); row(root).click();
    const before = api.maps[0]!.centers.length;
    view.set(true);
    expect(api.maps[0]!.centers.length).toBeGreaterThan(before);
    expect(api.markers.some((marker) => marker.icon?.content.includes('is-active'))).toBe(true);
  });

  it('releases its hash subscription when a dataset view is replaced', () => {
    const container = document.createElement('div');
    document.body.append(container); views.push(container);
    const resolve = vi.fn(() => null);
    const handle = createDetailPanel(container, [], {
      wide: () => true, resolve, dialog: {}, onSelection: () => {},
    });
    handle.release();
    navigate(`#place=${SAMPLE_DATASET.places[0]!.id}`);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('keeps a returned keyboard row pin lit after the history event settles', async () => {
    const { root, api } = await setup();
    const opener = row(root); opener.focus(); opener.click();
    const name = opener.querySelector('.top-place-name')!.textContent;
    const returned = returnedToList();
    root.querySelector<HTMLButtonElement>('.detail-panel-back')!.click();
    await returned;
    expect(document.activeElement).toBe(opener);
    expect(api.markers.find((marker) => marker.title === name)?.icon?.content).toContain('is-active');
  });

  it('does not revive a dismissed row selection after another row is hovered and left', async () => {
    const { root, api } = await setup();
    row(root).click();
    const returned = returnedToList();
    root.querySelector<HTMLButtonElement>('.detail-panel-back')!.click(); await returned;
    const other = root.querySelectorAll('li.top-place')[1]!;
    other.dispatchEvent(new MouseEvent('mouseenter'));
    other.dispatchEvent(new MouseEvent('mouseleave'));
    expect(api.markers.some((marker) => marker.icon?.content.includes('is-active'))).toBe(false);
  });

  it('queues a marker selection made while return-to-list history is still pending', async () => {
    const { root, api } = await setup();
    row(root).click();
    const marker = api.markers[1]!;
    const returned = returnedToList();
    root.querySelector<HTMLButtonElement>('.detail-panel-back')!.click();
    marker.emit('click'); await returned;
    expect(root.querySelector('.place-detail-name')?.textContent).toBe(marker.title);
    expect(location.hash).not.toBe('');
  });

  it('keeps card link focus and a panned map on an unchanged hash selection', async () => {
    const { root, api } = await setup();
    row(root).click();
    const link = root.querySelector<HTMLAnchorElement>('.place-detail-link')!;
    link.focus();
    api.maps[0]!.setCenter(new api.LatLng(36, 127));
    const centers = api.maps[0]!.centers.length;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(document.activeElement).toBe(link);
    expect(api.maps[0]!.centers).toHaveLength(centers);
  });

  it('keeps desktop detail usable after a map failure', async () => {
    const { root } = await setup();
    (globalThis as { navermap_authFailure?: () => void }).navermap_authFailure?.();
    row(root).click();
    expect(root.querySelector('.detail-panel')).not.toBeNull();
    expect(root.querySelector('.map-shell-map')).toBeNull();
    const returned = returnedToList();
    root.querySelector<HTMLButtonElement>('.detail-panel-back')!.click();
    await returned;
    expect(root.querySelector<HTMLElement>('.place-list-slot')?.hidden).toBe(false);
  });
});
