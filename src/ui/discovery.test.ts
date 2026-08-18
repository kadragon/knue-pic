import { describe, expect, it, vi } from 'vitest';
import type { NewlySeenPlace, TrendingPlace } from '../stats/discovery';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import {
  NEWLY_SEEN_EMPTY_MESSAGE,
  NEWLY_SEEN_HEADING,
  NEW_BADGE_LABEL,
  NEW_BADGE_TEXT,
  TRENDING_EMPTY_MESSAGE,
  TRENDING_HEADING,
  TRENDING_NOTE,
  renderNewlySeenPlaces,
  renderTrendingPlaces,
  visitDeltaLabel,
} from './discovery';

const [FIRST, SECOND] = SAMPLE_DATASET.places;

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
  it('says the section reads a fixed window regardless of the period selector', () => {
    const container = document.createElement('div');

    renderTrendingPlaces(container, [trendingEntry({})], vi.fn());

    expect(container.textContent).toContain(TRENDING_HEADING);
    expect(container.textContent).toContain(TRENDING_NOTE);
  });

  it('shows the movement in visits for a place with a prior-month figure', () => {
    const container = document.createElement('div');

    renderTrendingPlaces(container, [trendingEntry({ visitDelta: 2 })], vi.fn());

    expect(container.textContent).toContain(visitDeltaLabel(2));
    expect(container.querySelector('.discovery-new')).toBeNull();
  });

  it('shows a labelled NEW badge instead of a number when the delta is omitted', () => {
    const container = document.createElement('div');

    renderTrendingPlaces(
      container,
      [trendingEntry({ priorVisits: 0, isNew: true, visitDelta: null })],
      vi.fn(),
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

    renderTrendingPlaces(container, [trendingEntry({})], onSelect);
    container.querySelector<HTMLButtonElement>('.place-select')?.click();

    expect(container.querySelector('.place-select')).toBeInstanceOf(HTMLButtonElement);
    expect(onSelect).toHaveBeenCalledWith(FIRST!.id);
  });

  it('explains an empty section instead of rendering a bare heading', () => {
    const container = document.createElement('div');

    renderTrendingPlaces(container, [], vi.fn());

    expect(container.textContent).toContain(TRENDING_EMPTY_MESSAGE);
    expect(container.querySelector('.discovery-list')).toBeNull();
  });
});

describe('renderNewlySeenPlaces', () => {
  const entries: NewlySeenPlace[] = [{ place: SECOND!, firstVisit: '2026-07-15' }];

  it('shows the first visit date for each place', () => {
    const container = document.createElement('div');

    renderNewlySeenPlaces(container, entries, vi.fn());

    expect(container.textContent).toContain(NEWLY_SEEN_HEADING);
    expect(container.textContent).toContain('첫 이용 2026-07-15');
  });

  it('reports the selected place', () => {
    const container = document.createElement('div');
    const onSelect = vi.fn();

    renderNewlySeenPlaces(container, entries, onSelect);
    container.querySelector<HTMLButtonElement>('.place-select')?.click();

    expect(onSelect).toHaveBeenCalledWith(SECOND!.id);
  });

  it('explains an empty section', () => {
    const container = document.createElement('div');

    renderNewlySeenPlaces(container, [], vi.fn());

    expect(container.textContent).toContain(NEWLY_SEEN_EMPTY_MESSAGE);
  });
});
