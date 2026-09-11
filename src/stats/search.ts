import type { PlaceKind, PlaceRecord, PlacesDataset } from '../data/types';
import { shortAddress } from './short-address';

/**
 * Text and category filtering over the dataset. Pure — places in, places out; no DOM, no map.
 *
 * It lives beside the statistics rather than in `src/ui/` for the same reason they do: it decides
 * what the user is shown, so it has to be unit-testable without a browser
 * (`docs/architecture.md` → Layer Rules).
 */

/** The category filter's "no filter" value. Not a category name, so it can never collide with one. */
export const ALL_CATEGORIES = null;

/** The kind filter's "no filter" value, same convention: not a member of `PLACE_KINDS`. */
export const ALL_KINDS = null;

/**
 * The dataset narrowed to one kind — a `PlacesDataset`, not a place list.
 *
 * Returning the wrapper is what lets the kind filter reach the ranked list at all: every
 * statistic module takes a dataset (`computeTopPlaces`) and so does
 * `listCategories`, so applying the kind once here narrows the ranked list, the search results
 * and the category options the reader can pick from, with no module below knowing a filter exists.
 *
 * `updatedAt` rides along unchanged — it anchors every period window, and recomputing the windows
 * from a filtered subset would move the boundaries the counts are measured against.
 */
export function filterByKind(dataset: PlacesDataset, kind: PlaceKind | null): PlacesDataset {
  if (kind === ALL_KINDS) return dataset;

  return {
    updatedAt: dataset.updatedAt,
    places: dataset.places.filter((place) => place.kind === kind),
  };
}

export interface PlaceQuery {
  /** Free text; matched against name, category, subcategory, and address. Empty means "no text filter". */
  text: string;
  /** A category or subcategory name (matches either field), or `ALL_CATEGORIES`. */
  category: string | null;
}

/**
 * Every category and subcategory present in the dataset, deduplicated.
 *
 * Derived from the data rather than from a fixed list because the collector's classifier can emit
 * any category, `기타` included (`docs/conventions.md` → Statistics Rules) — a hardcoded list would
 * silently make some places unreachable through the filter the month a new one appears.
 * Subcategories are listed because the 업종 badge shows one in place of the category, and Naver's
 * roots are inconsistent (`음식점>한식` badges `한식`); a badge the reader cannot pick back from this
 * list would be a label that selects nothing.
 */
export function listCategories(dataset: PlacesDataset): string[] {
  const values = dataset.places.flatMap((place) =>
    place.subcategory === undefined ? [place.category] : [place.category, place.subcategory],
  );
  return [...new Set(values.map(toNfc))].sort((a, b) => a.localeCompare(b, 'ko'));
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
  return foldSeparators(toNfc(value).trim().toLowerCase());
}

/**
 * The lists render a category as `카페·디저트` (`src/ui/place-labels.ts` → `displayCategory`) while
 * the dataset stores `카페,디저트`. Folding both spellings to one form on needle and field alike is
 * what lets a reader type back what the page showed them; 92 of the published places carry a
 * comma category, so the mismatch was not hypothetical.
 */
function foldSeparators(value: string): string {
  return value.replace(/[,·]\s*/g, '·');
}

function matchesText(place: PlaceRecord, text: string): boolean {
  const needle = normalize(text);
  if (needle === '') return true;

  // The shortened address is searched as a field of its own rather than by transforming the
  // needle. The ranked row displays `청주 흥덕구` for a stored `충청북도 청주시 흥덕구`, and
  // `docs/conventions.md` -> Accessibility requires a reader to be able to type back what the row
  // showed them. Folding the suffix out of the *needle* did that too, and cost far more than it
  // bought: `스시` became `스` and matched 66 places, most of them not sushi. A field costs one
  // more `includes` per place and changes no other query. `subcategory` is a field for the same
  // reason: the 업종 badge shows it in place of the category when the dataset carries one.
  return [
    place.name,
    place.category,
    place.subcategory ?? '',
    place.address,
    shortAddress(place.address),
  ].some((field) => normalize(field).includes(needle));
}

/** Both filters apply together; dataset order is preserved so the result is stable. */
export function filterPlaces(dataset: PlacesDataset, query: PlaceQuery): PlaceRecord[] {
  // The query side is normalized once, not once per place: this runs on every keystroke.
  const category = query.category === ALL_CATEGORIES ? ALL_CATEGORIES : toNfc(query.category);

  return dataset.places.filter(
    (place) =>
      (category === ALL_CATEGORIES ||
        toNfc(place.category) === category ||
        (place.subcategory !== undefined && toNfc(place.subcategory) === category)) &&
      matchesText(place, query.text),
  );
}
