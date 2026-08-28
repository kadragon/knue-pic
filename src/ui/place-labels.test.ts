import { describe, expect, it } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import { monthKey } from '../data/iso-date';
import { computeMonthlyHistogram, histogramSpan } from '../stats/histogram';
import type { HistogramSpan } from '../stats/histogram';
import {
  displayCategory,
  displayDate,
  displayShortDate,
  histogramSpanLabel,
  monthLabel,
  renderKindBadge,
} from './place-labels';

describe('place display labels', () => {
  it('normalizes comma-separated categories to the UI separator', () => {
    expect(displayCategory('카페,디저트')).toBe('카페·디저트');
  });

  it('formats valid ISO dates in the same form as the period headings', () => {
    expect(displayDate('2026-07-08')).toBe('2026년 7월 8일');
  });

  it('keeps malformed values visible rather than inventing a date', () => {
    expect(displayDate('unknown')).toBe('unknown');
    expect(displayDate('알 수 없-음-값')).toBe('알 수 없-음-값');
    expect(displayDate('2026-07-08T00:00:00')).toBe('2026-07-08T00:00:00');
  });

  it('drops the year from a place\u0027s own date, keeping the leading zeroes', () => {
    // Zero-padded on both fields so a column of dates lines up rather than ragging by a character.
    expect(displayShortDate('2026-07-08')).toBe('07-08');
    expect(displayShortDate('2026-12-25')).toBe('12-25');
  });

  it('leaves a malformed value alone rather than slicing a wrong pair out of it', () => {
    expect(displayShortDate('unknown')).toBe('unknown');
    expect(displayShortDate('2026-07-08T00:00:00')).toBe('2026-07-08T00:00:00');
  });
});

describe('renderKindBadge', () => {
  it('spells the category out and leaves the colour to the kind', () => {
    const cafe = SAMPLE_DATASET.places.find((place) => place.kind === 'cafe')!;

    const badge = renderKindBadge(cafe);

    // The text is the fact; `data-kind` is only what the stylesheet colours by. Colour alone may
    // not carry a classification (`docs/conventions.md` → Accessibility).
    expect(badge.textContent).toBe(displayCategory(cafe.category));
    expect(badge.dataset['kind']).toBe('cafe');
    expect(badge.className).toBe('place-kind-badge');
  });
});

describe('histogramSpanLabel', () => {
  it('names the span from its ends, not from how many months lie between them', () => {
    // Derived, not hardcoded: moving an end has to move the label, or the label would be free to
    // state a span the chart does not draw.
    expect(histogramSpanLabel({ first: monthKey(2025, 9), last: monthKey(2026, 8) })).toBe(
      `${monthLabel(monthKey(2025, 9))}~${monthLabel(monthKey(2026, 8))}`,
    );
    expect(histogramSpanLabel({ first: monthKey(2025, 10), last: monthKey(2026, 8) })).toBe(
      `${monthLabel(monthKey(2025, 10))}~${monthLabel(monthKey(2026, 8))}`,
    );
    // Pinned literally once as well, so a reword of `monthLabel` cannot leave both sides of the
    // assertions above agreeing on a form no reader ever sees.
    expect(histogramSpanLabel({ first: monthKey(2025, 9), last: monthKey(2026, 8) })).toBe(
      '2025년 9월~2026년 8월',
    );
  });

  it('states a single charted month once rather than as a range onto itself', () => {
    expect(histogramSpanLabel({ first: monthKey(2026, 8), last: monthKey(2026, 8) })).toBe(
      monthLabel(monthKey(2026, 8)),
    );
  });

  it('names both ends of a producer-built series, never the blank the empty branch used to give', () => {
    // The round trip a real caller makes — producer to span to label — over the default charted
    // window. The `''` this used to return for an empty bucket array rendered `" 이용 횟수"` and
    // `"월별 막대는  기준"`, so the absence of a leading or doubled space is the regression being
    // held, not merely the presence of a range.
    const buckets = computeMonthlyHistogram(SAMPLE_DATASET.places[0]!, '2026-08-01');
    const label = histogramSpanLabel(histogramSpan(buckets));

    expect(label).toBe(`${monthLabel(monthKey(2025, 9))}~${monthLabel(monthKey(2026, 8))}`);
    expect(`${label} 이용 횟수`).not.toMatch(/^\s|\s\s/);
  });

  it('refuses a hand-written blank span at compile time, not at render time', () => {
    // The hole this closes: `HistogramSpan.first`/`.last` were plain `string`, so the literal
    // below typechecked and printed `년 NaN월`. The runtime assertion alone would keep passing if
    // the fields were widened back, so the `@ts-expect-error` is the half that holds the type.

    // @ts-expect-error a span's ends are `MonthKey`, and `''` is not one
    const blank: HistogramSpan = { first: '', last: '' };
    // @ts-expect-error an unpadded month is not a `MonthKey` either
    const unpadded: HistogramSpan = { first: '2025-9', last: '2026-8' };

    expect([blank, unpadded]).toHaveLength(2);
  });
});
