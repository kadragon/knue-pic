import { describe, expect, it } from 'vitest';

import dataset from '../../data/places.json';
import { RETAINED_MONTHS } from './period';

/**
 * `RETAINED_MONTHS` is a claim about `data/places.json`, not a knob: `isPriorWindowComplete`
 * reads it as "there is data this far back", and a floor set past what the file holds makes every
 * place count zero visits in months that were never collected — inventing rank drops. The fixture
 * suites cannot catch that, because the claim is about the published dataset. So this one test
 * reads the committed file and asserts the constant stays true of it.
 */
describe('RETAINED_MONTHS against the published dataset', () => {
  const months = [
    ...new Set(
      dataset.places.flatMap((place) => place.transactions.map((tx) => tx.date.slice(0, 7))),
    ),
  ].sort();

  it('has a transaction in the oldest month the constant claims is retained', () => {
    // Month arithmetic only — the anchor's day never moves the floor's month, and stepping
    // whole months avoids the day-clamping `subtractMonths` exists to handle.
    const [year, month] = dataset.updatedAt.split('-').map(Number) as [number, number, number];
    const total = year * 12 + (month - 1) - (RETAINED_MONTHS - 1);
    const floorMonth = `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
    expect(months[0]).toBe(floorMonth);
  });

  it('leaves no gap between the retention floor and the anchor month', () => {
    const anchorMonth = dataset.updatedAt.slice(0, 7);
    expect(months.at(-1)).toBe(anchorMonth);
    expect(months).toHaveLength(RETAINED_MONTHS);
  });
});
