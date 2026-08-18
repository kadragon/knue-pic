/**
 * The `data/places.json` wire format — see `docs/architecture.md` → Data Contract.
 *
 * This module is the only place in `src/` that knows the published file's shape; every other
 * module consumes these types instead of re-describing the JSON. Types only: the invariants
 * (unique id, lat/lng in range, amount >= 0, dates inside the rolling window) are enforced by
 * the collector's validator before publication, not at runtime in the browser.
 */

/** One disclosed payment. One transaction is one visit — payments are never merged. */
export interface Transaction {
  /** ISO calendar date, `YYYY-MM-DD`. */
  date: string;
  /** Won, `>= 0`. Never influences ranking. */
  amount: number;
}

export interface PlaceRecord {
  /** Canonical id, `restaurant_%06d`; assigned once and never reused. */
  id: string;
  name: string;
  /** Cuisine or venue category; `기타` when classification was uncertain. */
  category: string;
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
