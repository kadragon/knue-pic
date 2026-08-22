/**
 * The `data/places.json` wire format — see `docs/architecture.md` → Data Contract.
 *
 * This module is the only place in `src/` that knows the published file's shape; every other
 * module consumes these types instead of re-describing the JSON. Types only: the invariants
 * (unique id, lat/lng in range, amount >= 0, dates inside the rolling window) are enforced by
 * the collector's validator before publication.
 *
 * One of those invariants must also be re-checked in the browser: `src/stats/` throws on a
 * malformed transaction date rather than dropping the row, so whatever loads this file has to
 * validate dates before handing places to the stats layer.
 */

/** One disclosed payment. One transaction is one visit — payments are never merged. */
export interface Transaction {
  /** ISO calendar date, `YYYY-MM-DD`. */
  date: string;
  /** Won, `>= 0`. Never influences ranking. */
  amount: number;
}

/**
 * The coarse venue kind, a closed set the code owns — unlike `category`, which is whatever text
 * Naver's taxonomy supplied. Derived at build time from the full taxonomy path
 * (`collector/kinds.py`), because the published `category` is only that path's first segment and
 * `음식점` alone covers restaurants, cafés and lunchbox shops alike.
 *
 * Values are English slugs, and the Korean labels the reader sees live in `src/ui/kind-filter.ts`
 * with every other user-facing string.
 */
export const PLACE_KINDS = ['restaurant', 'cafe', 'lunchbox', 'other'] as const;

export type PlaceKind = (typeof PLACE_KINDS)[number];

export interface PlaceRecord {
  /** Canonical id, `restaurant_%06d`; assigned once and never reused. */
  id: string;
  name: string;
  /** Cuisine or venue category; `기타` when classification was uncertain. */
  category: string;
  /** The coarse kind the global filter narrows by. Always one of `PLACE_KINDS`. */
  kind: PlaceKind;
  address: string;
  lat: number;
  lng: number;
  naverUrl: string;
  transactions: Transaction[];
}

export interface PlacesDataset {
  /** ISO calendar date the dataset was published; also the anchor for every period window. */
  updatedAt: string;
  places: PlaceRecord[];
}

/** The period selector. Everything is re-derived from `transactions` when this changes. */
export type Period = '1m' | '6m' | '1y';
