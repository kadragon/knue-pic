import { describe, expect, it } from 'vitest';
import { displayCategory, displayDate } from './place-labels';

describe('place display labels', () => {
  it('normalizes comma-separated categories to the UI separator', () => {
    expect(displayCategory('카페,디저트')).toBe('카페·디저트');
  });

  it('formats valid ISO dates for Korean UI copy', () => {
    expect(displayDate('2026-07-08')).toBe('2026. 7. 8.');
  });

  it('keeps malformed values visible rather than inventing a date', () => {
    expect(displayDate('unknown')).toBe('unknown');
  });
});
