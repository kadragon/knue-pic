/** Persist canonical IDs; dataset membership controls visibility, not retention. */
export const FAVOURITES_KEY = 'knue-pick:favourites:v1';

export interface Favourites {
  readonly readable: boolean;
  ids(): string[];
  has(id: string): boolean;
  toggle(id: string): boolean;
  /** Calls back after another tab changed the saved IDs; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
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
  const listeners = new Set<() => void>();
  // The storage event fires only in the other tabs, so every notification is an external change.
  // A `null` key means the whole area was cleared.
  const onStorage = (event: StorageEvent): void => {
    if (!readable || !storage || event.storageArea !== storage) return;
    if (event.key !== null && event.key !== FAVOURITES_KEY) return;
    try {
      saved = readIds(storage);
    } catch {
      return;
    }
    for (const listener of [...listeners]) listener();
  };
  return {
    readable,
    ids: () => [...saved].filter((id) => known.has(id)),
    has: (id) => known.has(id) && saved.has(id),
    subscribe(listener) {
      if (!listeners.size) window.addEventListener('storage', onStorage);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) window.removeEventListener('storage', onStorage);
      };
    },
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
