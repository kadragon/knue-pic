import { describe, expect, it } from 'vitest';

import dataset from '../../data/places.json';
import { RETAINED_MONTHS } from './period';

/**
 * `RETAINED_MONTHS` is a claim about `data/places.json`, not a knob: `isPriorWindowComplete`
 * reads it as "there is data this far back", and a floor set past what the file holds makes every
 * place count zero visits in months that were never collected — inventing rank drops. The fixture
 * suites cannot catch that, because the claim is about the published dataset. So this one test
 * reads the committed file and asserts the constant stays true of it.
 *
 * It checks the claim and nothing more. Asserting that the anchor's own month is populated, or
 * that the span holds no interior gap, would fail on a dataset that is entirely valid — the board
 * lags, so a run early in a month legitimately publishes before that month's first disclosure —
 * and a red for that reason says nothing about the constant.
 */
describe('RETAINED_MONTHS against the published dataset', () => {
  it('has data at least as far back as the constant claims', () => {
    const months = dataset.places
      .flatMap((place) => place.transactions.map((tx) => tx.date.slice(0, 7)))
      .sort();

    // Month arithmetic only — the anchor's day never moves the floor's month, and this mirrors
    // `retentionFloor` in period.ts, which is month-anchored for the same reason.
    const [year, month] = dataset.updatedAt.split('-').map(Number) as [number, number, number];
    const total = year * 12 + (month - 1) - (RETAINED_MONTHS - 1);
    const floorMonth = `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;

    // Sentinel rather than a bare index: an empty dataset would satisfy every per-row check
    // vacuously, and this assertion is the only thing standing between that and a green suite.
    const oldest = months[0] ?? '9999-12';
    expect(oldest <= floorMonth).toBe(true);
  });

  it('has no empty month between the oldest month present and the newest', () => {
    const months = [
      ...new Set(
        dataset.places.flatMap((place) => place.transactions.map((tx) => tx.date.slice(0, 7))),
      ),
    ].sort();

    // An interior hole falsifies the claim as surely as a floor that is too deep: every place
    // counts zero visits in that month, and `isPriorWindowComplete` still says the window is
    // covered. Bounded by the months actually present rather than by the anchor, so the board's
    // publishing lag — the anchor's own month is routinely near-empty — cannot redden this.
    const span = months.length
      ? monthsBetween(months[0] as string, months.at(-1) as string)
      : ([] as string[]);
    expect(months).toEqual(span);
  });
});

function monthsBetween(first: string, last: string): string[] {
  const toIndex = (month: string) => {
    const [year, index] = month.split('-').map(Number) as [number, number];
    return year * 12 + (index - 1);
  };
  const out: string[] = [];
  for (let i = toIndex(first); i <= toIndex(last); i += 1) {
    out.push(`${String(Math.floor(i / 12)).padStart(4, '0')}-${String((i % 12) + 1).padStart(2, '0')}`);
  }
  return out;
}
