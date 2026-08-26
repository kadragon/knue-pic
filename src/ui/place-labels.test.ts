import { describe, expect, it } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
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
  it('names the span from the bucket ends, not from how many there are', () => {
    const buckets = [
      { month: '2025-09', visitCount: 0 },
      { month: '2025-10', visitCount: 3 },
      { month: '2026-08', visitCount: 1 },
    ];

    // Derived, not hardcoded: shifting the ends has to move the label, or the label would be free
    // to state a span the chart does not draw.
    expect(histogramSpanLabel(buckets)).toBe(`${monthLabel('2025-09')}~${monthLabel('2026-08')}`);
    expect(histogramSpanLabel(buckets.slice(1))).toBe(
      `${monthLabel('2025-10')}~${monthLabel('2026-08')}`,
    );
  });

  it('states a single charted month once rather than as a range onto itself', () => {
    expect(histogramSpanLabel([{ month: '2026-08', visitCount: 2 }])).toBe(monthLabel('2026-08'));
  });

  it('names no span at all when there are no buckets', () => {
    // A span invented for an empty chart would be a claim about data that is not there.
    expect(histogramSpanLabel([])).toBe('');
  });
});
