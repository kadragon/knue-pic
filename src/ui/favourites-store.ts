/** Only canonical IDs are persisted; dataset membership is checked on every load and toggle. */
export const FAVOURITES_KEY = 'knue-pick:favourites:v1';

export interface Favourites {
  readonly readable: boolean;
  ids(): string[];
  has(id: string): boolean;
  toggle(id: string): boolean;
}

export function createFavourites(placeIds: readonly string[]): Favourites {
  const known = new Set(placeIds);
  let saved = new Set<string>();
  let storage: Storage | undefined;
  let readable = false;
  try {
    storage = window.localStorage;
    const raw = storage.getItem(FAVOURITES_KEY);
    readable = true;
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    if (Array.isArray(parsed)) {
      saved = new Set(parsed.filter((id): id is string => typeof id === 'string' && known.has(id)));
    }
  } catch {
    // Invalid JSON starts empty. A denied read disables writes to avoid overwriting unseen data.
  }
  return {
    readable,
    ids: () => [...saved],
    has: (id) => saved.has(id),
    toggle(id) {
      if (!readable || !storage || !known.has(id)) return false;
      const next = new Set(saved);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        storage.setItem(FAVOURITES_KEY, JSON.stringify([...next]));
        saved = next;
        return true;
      } catch {
        return false;
      }
    },
  };
}
