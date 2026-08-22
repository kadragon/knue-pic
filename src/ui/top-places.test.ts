import { describe, expect, it } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import type { PlacesDataset } from '../data/types';
import { computeTopPlaces, type TopPlacesResult } from '../stats/top-places';
import { PERIOD_LABELS } from './period-labels';
import {
  EMPTY_MESSAGE,
  NO_COMPARISON_MESSAGE,
  rankDeltaLabel,
  renderTopPlaces,
  topPlacesHeading,
} from './top-places';

function render(result: TopPlacesResult): HTMLElement {
  const container = document.createElement('div');
  renderTopPlaces(container, result);
  return container;
}

const EMPTY_DATASET: PlacesDataset = { updatedAt: '2026-08-01', places: [] };

describe('renderTopPlaces', () => {
  it('renders one ordered list item per ranked place', () => {
    const container = render(computeTopPlaces(SAMPLE_DATASET, '1y'));

    // The fixture's 1y window ranks six places, and the heading names that six — not the limit.
    expect(container.querySelector('h2')?.textContent).toBe('많이 이용한 곳 TOP 6');
    expect(container.querySelectorAll('ol.top-places-list > li')).toHaveLength(6);
  });

  it('names the rendered count in the heading, not a fixed limit', () => {
    const container = render(computeTopPlaces(SAMPLE_DATASET, '1y', 3));

    expect(container.querySelector('h2')?.textContent).toBe(topPlacesHeading(3));
    expect(container.querySelector('h2')?.textContent).toBe('많이 이용한 곳 TOP 3');
    expect(container.querySelectorAll('ol.top-places-list > li')).toHaveLength(3);
  });

  it('names no count when nothing is ranked', () => {
    const container = render(computeTopPlaces(EMPTY_DATASET, '1y'));

    expect(container.querySelector('h2')?.textContent).toBe('많이 이용한 곳');
  });

  it('shows the rank as a number, not by colour alone', () => {
    const container = render(computeTopPlaces(SAMPLE_DATASET, '1y'));

    const badges = [...container.querySelectorAll('.top-place-rank')].map((el) => el.textContent);
    expect(badges).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('shows the visit count and the most recent visit for each place', () => {
    const container = render(computeTopPlaces(SAMPLE_DATASET, '1y'));
    const first = container.querySelector('.top-place');

    // 000001 over 1y: 4 visits, most recent 2026-07-20 (hand-checked against the fixture).
    expect(first?.textContent).toContain('한밭식당');
    expect(first?.textContent).toContain('이용횟수 4회');
    expect(first?.textContent).toContain('최근 이용 2026-07-20');
  });

  it('caps the rendered list at ten', () => {
    const dataset: PlacesDataset = {
      updatedAt: '2026-08-01',
      places: Array.from({ length: 12 }, (_, index) => ({
        id: `restaurant_${String(index + 1).padStart(6, '0')}`,
        name: `가게 ${index + 1}`,
        category: '기타',
        address: '충북 청주시 흥덕구 강내면',
        lat: 36.6,
        lng: 127.3,
        naverUrl: 'https://map.naver.com/p/search/x',
        transactions: Array.from({ length: 12 - index }, (__, visit) => ({
          date: `2026-07-${String(visit + 2).padStart(2, '0')}`,
          amount: 1000,
        })),
      })),
    };

    expect(render(computeTopPlaces(dataset, '1m')).querySelectorAll('li')).toHaveLength(10);
  });

  it('shows the empty message instead of a bare list when nothing was used', () => {
    const container = render(computeTopPlaces(EMPTY_DATASET, '1y'));

    expect(container.textContent).toContain(EMPTY_MESSAGE);
    expect(container.querySelector('ol')).toBeNull();
  });
});

describe('rank delta rendering', () => {
  it('renders no indicator when the delta is omitted', () => {
    // 1y: the prior window predates the retained range, so every delta is null.
    const container = render(computeTopPlaces(SAMPLE_DATASET, '1y'));

    expect(container.querySelectorAll('.top-place-delta')).toHaveLength(0);
  });

  it('explains the absence when there is no prior window to compare against', () => {
    // 1y is the default view and can never have deltas; silence would read as "nothing moved".
    const container = render(computeTopPlaces(SAMPLE_DATASET, '1y'));

    expect(container.textContent).toContain(NO_COMPARISON_MESSAGE);
  });

  it('stays quiet when the prior window is available', () => {
    const container = render(computeTopPlaces(SAMPLE_DATASET, '1m'));

    expect(container.textContent).not.toContain(NO_COMPARISON_MESSAGE);
  });

  it('marks the movement direction for styling as well as text', () => {
    const dataset: PlacesDataset = {
      updatedAt: '2026-08-01',
      places: [
        // 000001 leads the prior window, 000002 overtakes it in the current one.
        {
          id: 'restaurant_000001',
          name: '가나',
          category: '기타',
          address: '충북 청주시',
          lat: 36.6,
          lng: 127.3,
          naverUrl: 'https://map.naver.com/p/search/x',
          transactions: [
            { date: '2026-06-10', amount: 1000 },
            { date: '2026-06-11', amount: 1000 },
            { date: '2026-07-10', amount: 1000 },
          ],
        },
        {
          id: 'restaurant_000002',
          name: '다라',
          category: '기타',
          address: '충북 청주시',
          lat: 36.6,
          lng: 127.3,
          naverUrl: 'https://map.naver.com/p/search/y',
          transactions: [
            { date: '2026-06-12', amount: 1000 },
            { date: '2026-07-11', amount: 1000 },
            { date: '2026-07-12', amount: 1000 },
          ],
        },
      ],
    };

    const container = render(computeTopPlaces(dataset, '1m'));
    const directions = [...container.querySelectorAll('.top-place-delta')].map((el) =>
      el.getAttribute('data-direction'),
    );

    expect(directions).toEqual(['up', 'down']);
  });

  it('renders a direction glyph plus a spoken label when the delta is known', () => {
    // 1m: only 000006 was in the prior window, unchanged at rank 1.
    const container = render(computeTopPlaces(SAMPLE_DATASET, '1m'));
    const deltas = [...container.querySelectorAll('.top-place-delta')];

    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.textContent).toBe('–');
    expect(deltas[0]?.getAttribute('aria-label')).toBe(rankDeltaLabel(0));
    expect(deltas[0]?.getAttribute('data-direction')).toBe('same');
    // Without a role that permits name-from-author, the aria-label above is name-prohibited on a
    // bare span and may never be announced.
    expect(deltas[0]?.getAttribute('role')).toBe('img');
  });

  it('labels movement in both directions', () => {
    expect(rankDeltaLabel(3)).toBe('이전 기간보다 3계단 위');
    expect(rankDeltaLabel(-2)).toBe('이전 기간보다 2계단 아래');
    expect(rankDeltaLabel(0)).toBe('이전 기간과 같은 자리');
  });
});

describe('framing', () => {
  const BANNED = ['추천', '맛집', '베스트', '평점', '별점', '감시', '추적'];

  it('keeps recommendation and surveillance wording out of the rendered list', () => {
    // `docs/conventions.md` → Framing Vocabulary. The repo-wide banned-phrase test is its own
    // backlog item; this guards the strings these modules introduce.
    const text = render(computeTopPlaces(SAMPLE_DATASET, '1y')).textContent ?? '';

    for (const banned of BANNED) {
      expect(text).not.toContain(banned);
    }
  });

  it('covers the strings no rendered list happens to contain', () => {
    // The empty state, the delta labels and the period labels never all appear in one render, so
    // scanning rendered output alone would leave them unguarded.
    const strings = [
      EMPTY_MESSAGE,
      NO_COMPARISON_MESSAGE,
      ...Object.values(PERIOD_LABELS),
      ...[3, 0, -2].map(rankDeltaLabel),
    ];

    for (const value of strings) {
      for (const banned of BANNED) {
        expect(value).not.toContain(banned);
      }
    }
  });
});

describe('renderTopPlaces selection', () => {
  it('makes each entry a button whose children are phrasing content', () => {
    const container = document.createElement('div');
    const selected: string[] = [];

    renderTopPlaces(container, computeTopPlaces(SAMPLE_DATASET, '1y'), (id) => selected.push(id));
    const body = container.querySelector('.top-place-body');
    body?.dispatchEvent(new MouseEvent('click'));

    expect(body).toBeInstanceOf(HTMLButtonElement);
    // `<button>` admits phrasing content only — a `<p>` child would be an invalid content model.
    expect([...(body?.children ?? [])].map((child) => child.tagName)).toEqual(['SPAN', 'SPAN']);
    expect(selected).toEqual(['restaurant_000001']);
  });

  it('renders no control when the list is not wired to a handler', () => {
    const container = document.createElement('div');

    renderTopPlaces(container, computeTopPlaces(SAMPLE_DATASET, '1y'));

    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('.top-place-body')).toBeInstanceOf(HTMLDivElement);
  });
});
