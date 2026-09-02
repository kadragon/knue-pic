import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import { monthKey } from '../data/iso-date';
import type { PlacesDataset } from '../data/types';
import { HISTOGRAM_MONTHS, histogramSpan, type MonthlyHistogram } from '../stats/histogram';
import { computeTopPlaces, type TopPlacesResult } from '../stats/top-places';
import { PERIOD_LABELS } from './period-labels';
import { campusDistanceLabel, histogramSpanLabel, monthLabel, shortAddress } from './place-labels';
import { distanceFromCampusKm } from '../stats/distance';
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
  trendSpanNote,
} from './top-places';

function render(result: TopPlacesResult): HTMLElement {
  const container = document.createElement('div');
  renderTopPlaces(container, result);
  return container;
}

const EMPTY_DATASET: PlacesDataset = { updatedAt: '2026-08-01', places: [] };

describe('renderTopPlaces', () => {
  it('states where each place is and how far the campus is from it', () => {
    const result = computeTopPlaces(SAMPLE_DATASET, '1y');
    const container = render(result);
    const top = result.entries[0]!.place;

    const meta = container.querySelector('.top-place-location');
    expect(meta?.textContent).toContain(shortAddress(top.address));
    expect(meta?.textContent).toContain(campusDistanceLabel(distanceFromCampusKm(top)));
    // The full address belongs to the dialog, not to the row.
    expect(meta?.textContent).not.toContain(top.address);
  });

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
    // A caller is free to build its subtree and attach it afterwards, so a "is this in the
    // document yet?" guard here would leave such a list with the observer uncreated and no
    // auto-paging at all.
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
    // would otherwise leave its observer watching a detached button, holding the old list alive.
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

  it('disposes the previous observer when the same container renders an empty window', () => {
    // The switch a period selector makes: a paged window, then one with no visits at all. The
    // empty branch returns before the paging machinery is built, so unless the teardown runs
    // ahead of both branches the old observer keeps watching a `더 보기` button that this render
    // just detached — and it retains the whole previous list with it.
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

      renderTopPlaces(container, computeTopPlaces(SAMPLE_DATASET, '1y'), undefined, undefined, {
        pageSize: 2,
      });
      expect(calls).toEqual(['observe']);

      calls.length = 0;
      renderTopPlaces(container, computeTopPlaces(EMPTY_DATASET, '1y'), undefined, undefined, {
        pageSize: 2,
      });

      expect(container.textContent).toContain(EMPTY_MESSAGE);
      expect(calls).toEqual(['disconnect']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows the empty message instead of a bare list when nothing was used', () => {
    const container = render(computeTopPlaces(EMPTY_DATASET, '1y'));

    expect(container.textContent).toContain(EMPTY_MESSAGE);
    expect(container.querySelector('ol')).toBeNull();
    // No bars were drawn, so there is no span to name. Stating one would claim a charted range
    // that does not exist.
    expect(container.querySelector('.top-places-trend-note')).toBeNull();
  });

  it('names the charted span once for the list, not once per row', () => {
    const result = computeTopPlaces(SAMPLE_DATASET, '1y');
    const container = render(result);

    const notes = [...container.querySelectorAll('.top-places-trend-note')];
    expect(result.entries.length).toBeGreaterThan(1);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.textContent).toBe(trendSpanNote(result.chartedSpan));
  });

  it('reads the caption from the result span rather than from the first row', () => {
    // The invariant that every entry is charted together belongs to `computeTopPlaces`, not to
    // `TopPlacesResult`. A caller that merged or partially recomputed entries would otherwise have
    // the whole list labelled with whatever the top row happens to cover — the wrong-period claim
    // the span exists to remove. Row 0 is given a span nothing else shares, so the assertion fails
    // if the caption is ever inferred from it again.
    const result = computeTopPlaces(SAMPLE_DATASET, '1y');
    const stale: MonthlyHistogram = [{ month: monthKey(2019, 1), visitCount: 7 }];
    const container = render({ ...result, entries: [{ ...result.entries[0]!, histogram: stale }] });

    const note = container.querySelector('.top-places-trend-note');
    expect(note?.textContent).toBe(trendSpanNote(result.chartedSpan));
    expect(note?.textContent).not.toContain(monthLabel(monthKey(2019, 1)));
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
      { month: monthKey(2026, 6), visitCount: 2 },
      { month: monthKey(2026, 7), visitCount: 0 },
      { month: monthKey(2026, 8), visitCount: 1 },
    ]);

    // The quiet month is the whole reason the label exists: bars convey a gap by height alone, and
    // dropping it here would leave a screen reader hearing an uninterrupted run.
    expect(label).toBe(
      '2026년 6월~2026년 8월 월별 이용: 2026년 6월 2회, 2026년 7월 0회, 2026년 8월 1회',
    );
  });

  it('names the charted months rather than counting them, so it cannot be read as the period', () => {
    const buckets: MonthlyHistogram = [
      { month: monthKey(2025, 9), visitCount: 1 },
      { month: monthKey(2026, 8), visitCount: 2 },
    ];

    // A count — `최근 12개월` — spells the same thing as the 최근 1년 period button, whose window
    // opens mid-month and covers a different span than these whole calendar months.
    expect(sparklineLabel(buckets)).toContain(histogramSpanLabel(histogramSpan(buckets)));
    expect(sparklineLabel(buckets)).not.toContain(`최근 ${buckets.length}개월`);
  });
});

describe('trendSpanNote', () => {
  it('states the same span the spoken label states', () => {
    const buckets: MonthlyHistogram = [
      { month: monthKey(2025, 9), visitCount: 1 },
      { month: monthKey(2026, 8), visitCount: 2 },
    ];
    const span = histogramSpan(buckets);

    expect(trendSpanNote(span)).toContain(histogramSpanLabel(span));
    expect(sparklineLabel(buckets)).toContain(histogramSpanLabel(span));
    // The frame is pinned too, not just the span: a note reduced to the bare range would still
    // satisfy the assertion above while losing the words that say what the range belongs to.
    expect(trendSpanNote(span)).toBe(`월별 막대는 ${histogramSpanLabel(span)} 기준`);
  });
});

describe('renderSparkline', () => {
  it('draws one bar per bucket, scaled against the place\'s own busiest month', () => {
    const buckets: MonthlyHistogram = [
      { month: monthKey(2026, 6), visitCount: 2 },
      { month: monthKey(2026, 7), visitCount: 0 },
      { month: monthKey(2026, 8), visitCount: 4 },
    ];
    const chart = renderSparkline(buckets);

    const bars = [...chart.querySelectorAll<HTMLElement>('.top-place-trend-bar')];
    expect(bars).toHaveLength(3);
    expect(bars.map((bar) => bar.style.height)).toEqual(['50%', '0%', '100%']);
    expect(bars.map((bar) => bar.dataset['empty'])).toEqual(['false', 'true', 'false']);
  });

  it('carries the series as text a screen reader can reach', () => {
    const buckets: MonthlyHistogram = [{ month: monthKey(2026, 8), visitCount: 3 }];
    const chart = renderSparkline(buckets);

    // `role="img"` is load-bearing: WAI-ARIA prohibits naming a bare span, so without it the
    // label is dropped and the chart exists for sighted readers only.
    expect(chart.getAttribute('role')).toBe('img');
    expect(chart.getAttribute('aria-label')).toBe(sparklineLabel(buckets));
  });

  it('writes no NaN width when nothing was charted', () => {
    const quiet: MonthlyHistogram = [
      { month: monthKey(2026, 7), visitCount: 0 },
      { month: monthKey(2026, 8), visitCount: 0 },
    ];
    const chart = renderSparkline(quiet);

    expect(
      [...chart.querySelectorAll<HTMLElement>('.top-place-trend-bar')].map((bar) => bar.style.height),
    ).toEqual(['0%', '0%']);
  });

  it('gives every rendered row a full-span trend chart', () => {
    const container = render(computeTopPlaces(SAMPLE_DATASET, '1y'));

    const rows = [...container.querySelectorAll('.top-place')];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // The bar count, not merely the chart's presence: a row handed a truncated slice would
      // still carry a `.top-place-trend`, and the span the chart covers is the thing the label
      // beside it claims.
      expect(row.querySelectorAll('.top-place-trend-bar')).toHaveLength(HISTOGRAM_MONTHS);
    }
  });
});
