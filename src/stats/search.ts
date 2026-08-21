import type { PlaceRecord, PlacesDataset } from '../data/types';

/**
 * Text and category filtering over the dataset. Pure — places in, places out; no DOM, no map.
 *
 * It lives beside the statistics rather than in `src/ui/` for the same reason they do: it decides
 * what the user is shown, so it has to be unit-testable without a browser
 * (`docs/architecture.md` → Layer Rules).
 */

/** The category filter's "no filter" value. Not a category name, so it can never collide with one. */
export const ALL_CATEGORIES = null;

export interface PlaceQuery {
  /** Free text; matched against name, category, and address. Empty means "no text filter". */
  text: string;
  /** A category name, or `ALL_CATEGORIES`. */
  category: string | null;
}

/**
 * Every category present in the dataset, deduplicated.
 *
 * Derived from the data rather than from a fixed list because the collector's classifier can emit
 * any category, `기타` included (`docs/conventions.md` → Statistics Rules) — a hardcoded list would
 * silently make some places unreachable through the filter the month a new one appears.
 */
export function listCategories(dataset: PlacesDataset): string[] {
  return [...new Set(dataset.places.map((place) => toNfc(place.category)))].sort((a, b) =>
    a.localeCompare(b, 'ko'),
  );
}

/**
 * Unicode-composition-insensitive. The collector publishes every name and category in NFC
 * (`collector/validate.py` -> `normalize_name`), but a query typed or pasted on macOS arrives
 * decomposed, and the two spellings of one Korean word are code-point-unequal. Applied to the
 * needle and to the field alike, so neither side has to be the composed one.
 */
function toNfc(value: string): string {
  return value.normalize('NFC');
}

/**
 * Case- and surrounding-whitespace-insensitive. Korean has no case, but names and addresses in this
 * dataset carry latin fragments, and a user typing `cafe` should reach `Cafe`.
 */
function normalize(value: string): string {
  return toNfc(value).trim().toLowerCase();
}

function matchesText(place: PlaceRecord, text: string): boolean {
  const needle = normalize(text);
  if (needle === '') return true;

  return [place.name, place.category, place.address].some((field) =>
    normalize(field).includes(needle),
  );
}

/** Both filters apply together; dataset order is preserved so the result is stable. */
export function filterPlaces(dataset: PlacesDataset, query: PlaceQuery): PlaceRecord[] {
  return dataset.places.filter(
    (place) =>
      (query.category === ALL_CATEGORIES || toNfc(place.category) === toNfc(query.category)) &&
      matchesText(place, query.text),
  );
}
