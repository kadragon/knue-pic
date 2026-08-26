import { describe, expect, it } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import { computeMonthlyHistogram, histogramSpan } from '../stats/histogram';
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
    expect(histogramSpanLabel({ first: '2025-09', last: '2026-08' })).toBe(
      `${monthLabel('2025-09')}~${monthLabel('2026-08')}`,
    );
    expect(histogramSpanLabel({ first: '2025-10', last: '2026-08' })).toBe(
      `${monthLabel('2025-10')}~${monthLabel('2026-08')}`,
    );
    // Pinned literally once as well, so a reword of `monthLabel` cannot leave both sides of the
    // assertions above agreeing on a form no reader ever sees.
    expect(histogramSpanLabel({ first: '2025-09', last: '2026-08' })).toBe('2025년 9월~2026년 8월');
  });

  it('states a single charted month once rather than as a range onto itself', () => {
    expect(histogramSpanLabel({ first: '2026-08', last: '2026-08' })).toBe(monthLabel('2026-08'));
  });

  it('takes a span, so there is no empty chart for it to name', () => {
    // The `''` this used to return for an empty bucket array would have rendered `" 이용 횟수"`
    // and `"월별 막대는  기준"`. A span has two ends by its type, and `src/stats/histogram.ts` is
    // where a series is proven non-empty before one is derived from it.
    expect(histogramSpanLabel(histogramSpan(computeMonthlyHistogram(SAMPLE_DATASET.places[0]!, '2026-08-01', 1)))).toBe(
      monthLabel('2026-08'),
    );
  });
});
