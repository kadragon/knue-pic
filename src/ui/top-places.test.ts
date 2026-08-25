import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import type { PlacesDataset } from '../data/types';
import { computeTopPlaces, type TopPlacesResult } from '../stats/top-places';
import { PERIOD_LABELS } from './period-labels';
import {
  allRenderedLabel,
  EMPTY_MESSAGE,
  LIST_PAGE_SIZE,
  moreLabel,
  rankDeltaLabel,
  renderedCountLabel,
  renderSparkline,
  renderTopPlaces,
  sparklineLabel,
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

    // The fixture's 1y window ranks six places — fewer than one page, so all six are on screen.
    expect(container.querySelector('h2')?.textContent).toBe(topPlacesHeading());
    expect(container.querySelectorAll('ol.top-places-list > li')).toHaveLength(6);
  });

  it('counts under the list rather than in the heading, which cannot stay true as it grows', () => {
    const container = render(computeTopPlaces(SAMPLE_DATASET, '1y'));

    expect(container.querySelector('h2')?.textContent).toBe('많이 이용한 곳');
    expect(container.querySelector('.top-places-count')?.textContent).toBe(allRenderedLabel(6));
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
    expect(first?.textContent).toContain('4회 이용');
    expect(first?.textContent).toContain('최근 이용 07-20');
    expect(first?.textContent).not.toContain('2026년 7월 20일');
  });

  it('carries the 업종 badge on every row, with the category as text', () => {
    const container = render(computeTopPlaces(SAMPLE_DATASET, '1y'));
    const badge = container.querySelector<HTMLElement>('.top-place .place-kind-badge');

    expect(badge?.textContent).toBe('한식');
    expect(badge?.dataset['kind']).toBe('restaurant');
  });

  it('pages the list instead of capping it, and says what is held back', () => {
    const placeCount = LIST_PAGE_SIZE * 2 + 3;
    const dataset: PlacesDataset = {
      updatedAt: '2026-08-01',
      places: Array.from({ length: placeCount }, (_, index) => ({
        id: `restaurant_${String(index + 1).padStart(6, '0')}`,
        name: `가게 ${index + 1}`,
        category: '기타',
        kind: 'other',
        address: '충북 청주시 흥덕구 강내면',
        lat: 36.6,
        lng: 127.3,
        naverUrl: 'https://map.naver.com/p/search/x',
        transactions: Array.from({ length: placeCount - index }, (__, visit) => ({
          date: `2026-07-${String(visit + 2).padStart(2, '0')}`,
          amount: 1000,
        })),
      })),
    };

    const container = render(computeTopPlaces(dataset, '1m', placeCount));
    const rowsAfter = (): number => container.querySelectorAll('li').length;
    const button = (): HTMLButtonElement | null =>
      container.querySelector<HTMLButtonElement>('.top-places-more-button');

    expect(rowsAfter()).toBe(LIST_PAGE_SIZE);
    expect(container.querySelector('.top-places-count')?.textContent).toBe(
      renderedCountLabel(LIST_PAGE_SIZE, placeCount),
    );
    expect(button()?.textContent).toBe(moreLabel(placeCount - LIST_PAGE_SIZE));

    // The button is the sentinel as well as the control: jsdom has no `IntersectionObserver`, so
    // this is the path a reader who cannot generate a scroll takes.
    button()?.dispatchEvent(new MouseEvent('click'));
    expect(rowsAfter()).toBe(LIST_PAGE_SIZE * 2);

    button()?.dispatchEvent(new MouseEvent('click'));
    expect(rowsAfter()).toBe(placeCount);
    // Nothing left to load: the control goes rather than sitting there inert.
    expect(button()).toBeNull();
    expect(container.querySelector('.top-places-count')?.textContent).toBe(
      allRenderedLabel(placeCount),
    );
  });

  it('watches the button even while the list is still detached from the document', () => {
    // Every caller renders into a subtree it attaches afterwards — `place-list.ts` fills the list
    // cell before appending the section — so a "is this in the document yet?" guard here left the
    // observer uncreated on every render, and scrolling loaded nothing.
    const observed: Element[] = [];
    class FakeObserver {
      observe(target: Element): void {
        observed.push(target);
      }
      disconnect(): void {}
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver);

    try {
      const container = document.createElement('div');
      expect(container.isConnected).toBe(false);

      renderTopPlaces(container, computeTopPlaces(SAMPLE_DATASET, '1y'), undefined, undefined, {
        pageSize: 2,
      });

      expect(observed).toEqual([container.querySelector('.top-places-more-button')]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('never watches a list that has nothing left to load', () => {
    const observed: Element[] = [];
    class FakeObserver {
      observe(target: Element): void {
        observed.push(target);
      }
      disconnect(): void {}
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver);

    try {
      // Six ranked places, one page of ten: the button is already gone, so there is nothing to
      // watch and no detached node left behind holding a live observer.
      render(computeTopPlaces(SAMPLE_DATASET, '1y'));

      expect(observed).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps focus in the list when the last page removes the button under it', () => {
    // Activating 더 보기 on the final page destroys the focused element; a detached activeElement
    // drops the caret to the top of the document, throwing the reader to the page header the
    // moment they asked for the rest of the list.
    const container = document.createElement('div');
    document.body.append(container);

    try {
      renderTopPlaces(container, computeTopPlaces(SAMPLE_DATASET, '1y'), vi.fn(), undefined, {
        pageSize: 4,
      });
      const button = container.querySelector<HTMLButtonElement>('.top-places-more-button');
      button?.focus();
      expect(document.activeElement).toBe(button);
      button?.dispatchEvent(new MouseEvent('click'));

      // The first row of the page that just arrived — where the reader was reading.
      expect(container.querySelector('.top-places-more-button')).toBeNull();
      expect(document.activeElement).toBe(
        container.querySelectorAll('.top-place')[4]?.querySelector('button.top-place-body'),
      );
    } finally {
      container.remove();
    }
  });

  it('leaves focus alone when the last page was not requested from the button', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);

    try {
      renderTopPlaces(container, computeTopPlaces(SAMPLE_DATASET, '1y'), vi.fn(), undefined, {
        pageSize: 4,
      });
      elsewhere.focus();
      container.querySelector<HTMLButtonElement>('.top-places-more-button')?.click();

      // A scroll-driven page must not steal the caret from whatever the reader was using.
      expect(document.activeElement).toBe(elsewhere);
    } finally {
      container.remove();
      elsewhere.remove();
    }
  });

  it('re-arms the observer after a page, and drops it when the container is re-rendered', () => {
    // `IntersectionObserver` reports a transition, so a sentinel still on screen after a page was
    // appended emits nothing and auto-paging stalls; and a container rebuilt by the 업종 filter
    // would otherwise leave its observer watching a detached button, holding the old column alive.
    const calls: string[] = [];
    class FakeObserver {
      observe(): void {
        calls.push('observe');
      }
      unobserve(): void {
        calls.push('unobserve');
      }
      disconnect(): void {
        calls.push('disconnect');
      }
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver);

    try {
      const container = document.createElement('div');
      const result = computeTopPlaces(SAMPLE_DATASET, '1y');

      renderTopPlaces(container, result, undefined, undefined, { pageSize: 2 });
      expect(calls).toEqual(['observe']);

      container.querySelector<HTMLButtonElement>('.top-places-more-button')?.click();
      expect(calls).toEqual(['observe', 'unobserve', 'observe']);

      // Same container, fresh render — what `renderPlaceList` does on every 업종 change.
      calls.length = 0;
      renderTopPlaces(container, result, undefined, undefined, { pageSize: 2 });
      expect(calls).toEqual(['disconnect', 'observe']);
    } finally {
      vi.unstubAllGlobals();
    }
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

  it('marks the movement direction for styling as well as text', () => {
    const dataset: PlacesDataset = {
      updatedAt: '2026-08-01',
      places: [
        // 000001 leads the prior window, 000002 overtakes it in the current one.
        {
          id: 'restaurant_000001',
          name: '가나',
          category: '기타',
          kind: 'other',
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
          kind: 'other',
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
    expect(rankDeltaLabel(3)).toBe('직전 기간보다 3계단 상승');
    expect(rankDeltaLabel(-2)).toBe('직전 기간보다 2계단 하락');
    expect(rankDeltaLabel(0)).toBe('직전 기간과 같은 자리');
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
      allRenderedLabel(6),
      renderedCountLabel(10, 47),
      moreLabel(37),
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

describe('sparklineLabel', () => {
  it('names every charted month, including the empty ones', () => {
    const label = sparklineLabel([
      { month: '2026-06', visitCount: 2 },
      { month: '2026-07', visitCount: 0 },
      { month: '2026-08', visitCount: 1 },
    ]);

    // The quiet month is the whole reason the label exists: bars convey a gap by height alone, and
    // dropping it here would leave a screen reader hearing an uninterrupted run.
    expect(label).toBe('최근 3개월 월별 이용: 2026년 6월 2회, 2026년 7월 0회, 2026년 8월 1회');
  });
});

describe('renderSparkline', () => {
  it('draws one bar per bucket, scaled against the place\'s own busiest month', () => {
    const chart = renderSparkline([
      { month: '2026-06', visitCount: 2 },
      { month: '2026-07', visitCount: 0 },
      { month: '2026-08', visitCount: 4 },
    ]);

    const bars = [...chart.querySelectorAll<HTMLElement>('.top-place-trend-bar')];
    expect(bars).toHaveLength(3);
    expect(bars.map((bar) => bar.style.height)).toEqual(['50%', '0%', '100%']);
    expect(bars.map((bar) => bar.dataset['empty'])).toEqual(['false', 'true', 'false']);
  });

  it('carries the series as text a screen reader can reach', () => {
    const buckets = [{ month: '2026-08', visitCount: 3 }];
    const chart = renderSparkline(buckets);

    // `role="img"` is load-bearing: WAI-ARIA prohibits naming a bare span, so without it the
    // label is dropped and the chart exists for sighted readers only.
    expect(chart.getAttribute('role')).toBe('img');
    expect(chart.getAttribute('aria-label')).toBe(sparklineLabel(buckets));
  });

  it('writes no NaN width when nothing was charted', () => {
    const chart = renderSparkline([
      { month: '2026-07', visitCount: 0 },
      { month: '2026-08', visitCount: 0 },
    ]);

    expect(
      [...chart.querySelectorAll<HTMLElement>('.top-place-trend-bar')].map((bar) => bar.style.height),
    ).toEqual(['0%', '0%']);
  });

  it('gives every rendered row its trend chart', () => {
    const container = render(computeTopPlaces(SAMPLE_DATASET, '1y'));

    const rows = [...container.querySelectorAll('.top-place')];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.querySelector('.top-place-trend')).not.toBeNull();
    }
  });
});
