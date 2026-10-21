import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import { bootstrap } from './bootstrap';
import { renderPageMap } from '../map/place-map';

const key = 'knue-pick:favourites:v1';
// Node's global storage can shadow jsdom's window getter. Use a fresh browser realm.
let storageFrame: HTMLIFrameElement;
beforeEach(() => {
  storageFrame = document.createElement('iframe');
  document.body.append(storageFrame);
  const storage = storageFrame.contentWindow!.localStorage;
  vi.spyOn(window, 'localStorage', 'get').mockReturnValue(storage);
});

afterEach(() => {
  storageFrame.contentWindow!.localStorage.clear();
  vi.restoreAllMocks();
  storageFrame.remove();
  history.replaceState(null, '', location.pathname);
  document.body.replaceChildren();
});
async function mount(id?: string): Promise<HTMLElement> {
  history.replaceState(null, '', location.pathname + (id ? `#place=${id}` : ''));
  const root = document.createElement('div');
  document.body.append(root);
  await bootstrap(root, {
    load: () => Promise.resolve(SAMPLE_DATASET),
    renderMap: (container, places, options) => renderPageMap(container, places, {
      ...options, loadApi: () => Promise.reject(new Error('blocked')),
    }),
  });
  await Promise.resolve();
  return root;
}
function click(root: HTMLElement, selector: string): HTMLButtonElement {
  const button = root.querySelector<HTMLButtonElement>(selector);
  expect(button).not.toBeNull();
  button!.focus();
  button!.click();
  return button!;
}

describe('favourites in the page', () => {
  it('adds from detail, keeps focus, removes, and explains persistence', async () => {
    const place = SAMPLE_DATASET.places[0]!;
    const root = await mount(place.id);
    const button = click(root, '.favourite-toggle');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(button);
    expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual([place.id]);
    expect(root.querySelectorAll('.favourite-place')).toHaveLength(1);
    expect(root.textContent).toContain('기기 간에 동기화되지 않습니다');
    expect(root.textContent).toContain('브라우저 데이터를 삭제하면');
    button.click();
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelectorAll('.favourite-place')).toHaveLength(0);
  });
  it('opens saved places and map links with maps blocked, ignoring missing IDs', async () => {
    const places = SAMPLE_DATASET.places.slice(0, 2);
    window.localStorage.setItem(key, JSON.stringify([...places.map((place) => place.id), 'gone']));
    const root = await mount();
    expect(root.querySelector('.shell-map-note')).not.toBeNull();
    expect(root.querySelectorAll('.favourite-place')).toHaveLength(2);
    expect(root.querySelector('.favourite-place a')?.getAttribute('href')).toMatch(/^https:/);
    const opener = click(root, '.favourite-open');
    expect(location.hash).toBe(`#place=${places[0]!.id}`);
    expect(root.querySelector('.place-detail-name')?.textContent).toBe(places[0]!.name);
    expect(root.querySelector<HTMLElement>('.favourites-slot')?.hidden).toBe(true);
    click(root, '.detail-panel-back');
    expect(document.activeElement).toBe(opener);
    expect(root.querySelector<HTMLElement>('.favourites-slot')?.hidden).toBe(false);
  });
  it('reports write failure without changing the button or list', async () => {
    const root = await mount(SAMPLE_DATASET.places[0]!.id);
    vi.spyOn(Object.getPrototypeOf(window.localStorage) as Storage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const button = click(root, '.favourite-toggle');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelectorAll('.favourite-place')).toHaveLength(0);
    expect(root.querySelector('.favourite-status')?.textContent).toContain('저장하지 못했습니다');
  });
});
