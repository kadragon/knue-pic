import { describe, expect, it, vi } from 'vitest';
import type { TrendingPlace } from '../stats/discovery';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import {
  NEW_BADGE_LABEL,
  NEW_BADGE_TEXT,
  TRENDING_EMPTY_MESSAGE,
  TRENDING_NOTE,
  remainderLabel,
  renderTrendingPlaces,
  visitDeltaLabel,
  visitDeltaText,
} from './discovery';

const [FIRST] = SAMPLE_DATASET.places;

/** The column supplies both; the list module owns neither. */
const OPTIONS = { heading: '최근 뜨는 곳 TOP 10', limit: 10 };

function trendingEntry(overrides: Partial<TrendingPlace>): TrendingPlace {
  return {
    place: FIRST!,
    recentVisits: 3,
    priorVisits: 1,
    isNew: false,
    visitDelta: 2,
    ...overrides,
  };
}

describe('renderTrendingPlaces', () => {
  it('renders the heading it is given and says which window it reads', () => {
    const container = document.createElement('div');

    renderTrendingPlaces(container, [trendingEntry({})], vi.fn(), OPTIONS);

    expect(container.querySelector('h2')?.textContent).toBe(OPTIONS.heading);
    expect(container.textContent).toContain(TRENDING_NOTE);
  });

  it('shows the movement in visits for a place with a prior-month figure', () => {
    const container = document.createElement('div');

    renderTrendingPlaces(container, [trendingEntry({ visitDelta: 2 })], vi.fn(), OPTIONS);

    const movement = container.querySelector('.discovery-delta');
    expect(movement?.textContent).toBe(visitDeltaText(2));
    // The glyph says nothing on its own, so the sentence has to reach a screen reader.
    expect(movement?.getAttribute('aria-label')).toBe(visitDeltaLabel(2));
    expect(movement?.getAttribute('role')).toBe('img');
    expect(container.querySelector('.discovery-new')).toBeNull();
  });

  it('shows a labelled NEW badge instead of a number when the delta is omitted', () => {
    const container = document.createElement('div');

    renderTrendingPlaces(
      container,
      [trendingEntry({ priorVisits: 0, isNew: true, visitDelta: null })],
      vi.fn(),
      OPTIONS,
    );

    const badge = container.querySelector('.discovery-new');
    expect(badge?.textContent).toBe(NEW_BADGE_TEXT);
    expect(badge?.getAttribute('aria-label')).toBe(NEW_BADGE_LABEL);
    expect(badge?.getAttribute('role')).toBe('img');
    // Nothing may render a count derived from a zero prior figure.
    expect(container.textContent).not.toContain('늘었습니다');
  });

  it('reports the selected place through a keyboard-operable button', () => {
    const container = document.createElement('div');
    const onSelect = vi.fn();

    renderTrendingPlaces(container, [trendingEntry({})], onSelect, OPTIONS);
    container.querySelector<HTMLButtonElement>('.place-select')?.click();

    expect(container.querySelector('.place-select')).toBeInstanceOf(HTMLButtonElement);
    expect(onSelect).toHaveBeenCalledWith(FIRST!.id);
  });

  it('explains an empty column instead of rendering a bare heading', () => {
    const container = document.createElement('div');

    renderTrendingPlaces(container, [], vi.fn(), OPTIONS);

    expect(container.textContent).toContain(TRENDING_EMPTY_MESSAGE);
    expect(container.querySelector('.discovery-list')).toBeNull();
  });
});

describe('trending list cap', () => {
  const trendingRows = (count: number): TrendingPlace[] =>
    Array.from({ length: count }, (_unused, index) => ({
      place: { ...SAMPLE_DATASET.places[0]!, id: `restaurant_00100${index}` },
      recentVisits: 3,
      priorVisits: 2,
      isNew: false,
      visitDelta: 1,
    }));

  it('renders at most the given limit and says how many are held back', () => {
    const container = document.createElement('div');

    renderTrendingPlaces(container, trendingRows(OPTIONS.limit + 3), vi.fn(), OPTIONS);

    expect(container.querySelectorAll('.discovery-place')).toHaveLength(OPTIONS.limit);
    // Truncating silently would let a partial list read as the whole set.
    expect(container.textContent).toContain(remainderLabel(3));
  });

  it('says nothing about a remainder when everything fits', () => {
    const container = document.createElement('div');

    renderTrendingPlaces(container, trendingRows(2), vi.fn(), OPTIONS);

    expect(container.querySelectorAll('.discovery-place')).toHaveLength(2);
    expect(container.querySelector('.discovery-remainder')).toBeNull();
  });
});
