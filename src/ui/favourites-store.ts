/** Persist canonical IDs; dataset membership controls visibility, not retention. */
export const FAVOURITES_KEY = 'knue-pick:favourites:v1';

export interface Favourites {
  readonly readable: boolean;
  ids(): string[];
  has(id: string): boolean;
  toggle(id: string): boolean;
}

function readIds(storage: Storage): Set<string> {
  const raw = storage.getItem(FAVOURITES_KEY);
  let parsed: unknown;
  try {
    parsed = raw === null ? [] : JSON.parse(raw);
  } catch {
    return new Set();
  }
  return new Set(Array.isArray(parsed)
    ? parsed.filter((id): id is string => typeof id === 'string' && /^restaurant_\d{6}$/.test(id))
    : []);
}

export function createFavourites(placeIds: readonly string[]): Favourites {
  const known = new Set(placeIds);
  let saved = new Set<string>();
  let storage: Storage | undefined;
  let readable = false;
  try {
    storage = window.localStorage;
    saved = readIds(storage);
    readable = true;
  } catch {
    // A denied read disables writes to avoid overwriting unseen data.
  }
  return {
    readable,
    ids: () => [...saved].filter((id) => known.has(id)),
    has: (id) => known.has(id) && saved.has(id),
    toggle(id) {
      if (!readable || !storage || !known.has(id)) return false;
      try {
        // Preserve other tabs' completed edits and absent places. The visible action is intentional:
        // an old "add" button must not remove a bookmark another tab has already added.
        const next = readIds(storage);
        if (saved.has(id)) next.delete(id);
        else next.add(id);
        storage.setItem(FAVOURITES_KEY, JSON.stringify([...next]));
        saved = next;
        return true;
      } catch {
        return false;
      }
    },
  };
}
