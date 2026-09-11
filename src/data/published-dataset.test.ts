import { describe, expect, it } from 'vitest';

import dataset from '../../data/places.json';
import raw from '../../data/places.json?raw';
import type { PlaceRecord, PlacesDataset, Transaction } from './types';

/**
 * Two guards over the committed `data/places.json` that keep the "precomputed monthly aggregates"
 * backlog item a decision rather than a drift (`docs/design/deferred-scope.md`).
 *
 * Every period statistic is derived in the browser from `transactions`
 * (`docs/architecture.md` → Key Abstractions 2). The file is bounded by the 15-month rolling window,
 * so it stops growing once the window is full — which it is — and aggregates were judged not worth
 * a second source of truth. These tests hold both halves of that judgement to the file itself.
 */

/**
 * Every wire key, checked against the types in both directions: `satisfies` rejects a key the type
 * lacks, and a key the type gains without being listed here is a missing property.
 */
const PLACE_KEYS = {
  id: true,
  name: true,
  category: true,
  subcategory: true,
  kind: true,
  address: true,
  lat: true,
  lng: true,
  naverUrl: true,
  transactions: true,
} satisfies Record<keyof PlaceRecord, true>;

const ROOT_KEYS = { updatedAt: true, places: true } satisfies Record<keyof PlacesDataset, true>;

const TRANSACTION_KEYS = { date: true, amount: true } satisfies Record<keyof Transaction, true>;

/**
 * A review trigger, not a measured load budget. The file was 412,342 bytes on 2026-08-25 with the
 * window full; nothing in this repo measures the 3s load budget itself, so the ceiling is set at
 * roughly 2.4× that size — far enough above steady state that crossing it means the disclosures
 * themselves grew, which is the condition the backlog item named. Crossing it reopens the decision;
 * it does not license aggregates on its own — measure the load first.
 */
const REVIEW_TRIGGER_BYTES = 1_000_000;

describe('the published dataset', () => {
  it('read the real file, so neither guard below is judging an empty one', () => {
    expect(dataset.places.length).toBeGreaterThan(100);
    expect(raw).toContain('"transactions"');
  });

  it('carries no precomputed field — every figure is derived from transactions', () => {
    const extra = [
      ...Object.keys(dataset).filter((key) => !(key in ROOT_KEYS)),
      ...dataset.places.flatMap((place) => Object.keys(place).filter((key) => !(key in PLACE_KEYS))),
      ...dataset.places.flatMap((place) =>
        place.transactions.flatMap((tx) => Object.keys(tx).filter((key) => !(key in TRANSACTION_KEYS))),
      ),
    ];

    expect([...new Set(extra)], 'a field outside the wire format — see docs/design/deferred-scope.md').toEqual([]);
  });

  it('stays under the size that reopens the monthly-aggregates decision', () => {
    expect(new TextEncoder().encode(raw).length).toBeLessThan(REVIEW_TRIGGER_BYTES);
  });
});
