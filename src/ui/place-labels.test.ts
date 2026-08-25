import { describe, expect, it } from 'vitest';
import { displayCategory, displayDate } from './place-labels';

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
});
