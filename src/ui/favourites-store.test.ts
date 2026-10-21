import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFavourites, FAVOURITES_KEY } from './favourites-store';

const ids = ['restaurant_000001', 'restaurant_000002'];
// Node's global storage can shadow jsdom's window getter. Use a fresh browser realm.
let storageFrame: HTMLIFrameElement;
beforeEach(() => {
  storageFrame = document.createElement('iframe');
  document.body.append(storageFrame);
  const storage = storageFrame.contentWindow!.localStorage;
  vi.spyOn(window, 'localStorage', 'get').mockReturnValue(storage);
});

afterEach(() => { storageFrame.contentWindow!.localStorage.clear(); vi.restoreAllMocks(); storageFrame.remove(); });

describe('personal favourites storage', () => {
  it('persists two IDs across recreation and removes a saved ID', () => {
    const store = createFavourites(ids);
    expect(store.toggle(ids[0]!)).toBe(true);
    expect(store.toggle(ids[1]!)).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(FAVOURITES_KEY)!)).toEqual(ids);
    const reloaded = createFavourites(ids);
    expect(reloaded.ids()).toEqual(ids);
    expect(reloaded.toggle(ids[0]!)).toBe(true);
    expect(createFavourites(ids).ids()).toEqual([ids[1]]);
  });
  it('ignores missing, duplicate and non-string IDs and refuses unknown additions', () => {
    window.localStorage.setItem(FAVOURITES_KEY, JSON.stringify([...ids, ids[0], 'gone', {}, 3]));
    const store = createFavourites([ids[0]!]);
    expect(store.ids()).toEqual([ids[0]]);
    expect(store.toggle('gone')).toBe(false);
  });
  it.each(['{broken', '{}', 'null', '42'])('ignores malformed storage: %s', (raw) => {
    window.localStorage.setItem(FAVOURITES_KEY, raw);
    expect(createFavourites(ids).ids()).toEqual([]);
  });
  it('handles a denied storage getter without throwing or claiming a save', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('denied'); });
    const store = createFavourites(ids);
    expect(store.readable).toBe(false);
    expect(store.toggle(ids[0]!)).toBe(false);
    expect(store.ids()).toEqual([]);
  });
  it('handles failed reads without overwriting existing data', () => {
    vi.spyOn(Object.getPrototypeOf(window.localStorage) as Storage, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const write = vi.spyOn(Object.getPrototypeOf(window.localStorage) as Storage, 'setItem');
    const store = createFavourites(ids);
    expect(store.toggle(ids[0]!)).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
  it('keeps the previous state when saving or removing fails and supports retry', () => {
    const store = createFavourites(ids);
    store.toggle(ids[0]!);
    const write = vi.spyOn(Object.getPrototypeOf(window.localStorage) as Storage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(store.toggle(ids[1]!)).toBe(false);
    expect(store.toggle(ids[0]!)).toBe(false);
    expect(store.ids()).toEqual([ids[0]]);
    write.mockRestore();
    expect(store.toggle(ids[1]!)).toBe(true);
  });
});
