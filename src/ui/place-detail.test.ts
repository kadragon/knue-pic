import { describe, expect, it } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import { computeMonthlyHistogram, histogramMonthsFor } from '../stats/histogram';
import { computePlaceStats } from '../stats/place-stats';
import { LAST_YEAR_MONTH, resolveBasisWindow, type StatBasis } from '../stats/period';
import {
  DETAIL_EMPTY_MESSAGE,
  FIGURE_LABELS,
  histogramHeading,
  NAVER_LINK_LABEL,
  NO_VISIT_IN_PERIOD_MESSAGE,
  amountLabel,
  monthLabel,
  periodStatsHeading,
  renderPlaceDetail,
} from './place-detail';

const PLACE = SAMPLE_DATASET.places[0]!; // 한밭식당

function detailFor(placeIndex = 0, basis: StatBasis = '1y') {
  const place = SAMPLE_DATASET.places[placeIndex]!;
  return {
    place,
    basis,
    anchor: SAMPLE_DATASET.updatedAt,
    stats: computePlaceStats(place, resolveBasisWindow(basis, SAMPLE_DATASET.updatedAt)),
    histogram: computeMonthlyHistogram(place, SAMPLE_DATASET.updatedAt, histogramMonthsFor(basis)),
  };
}

describe('renderPlaceDetail', () => {
  it('shows a placeholder until a place is selected', () => {
    const container = document.createElement('div');

    renderPlaceDetail(container, null);

    expect(container.textContent).toContain(DETAIL_EMPTY_MESSAGE);
    expect(container.querySelector('.place-detail-link')).toBeNull();
  });

  it('names the period the figures were computed for', () => {
    const container = document.createElement('div');

    renderPlaceDetail(container, detailFor(0, '6m'));

    expect(container.textContent).toContain(periodStatsHeading('6m', SAMPLE_DATASET.updatedAt));
  });

  it('names the month itself for a place picked from the 작년 같은 달 column', () => {
    const container = document.createElement('div');

    renderPlaceDetail(container, detailFor(0, LAST_YEAR_MONTH));

    // The label has to spell the month out: every other basis on the page reads 최근 N개월, so
    // "작년 같은 달 기준" would leave the reader unable to check the figure against a disclosure.
    expect(container.textContent).toContain(
      periodStatsHeading(LAST_YEAR_MONTH, SAMPLE_DATASET.updatedAt),
    );
    expect(periodStatsHeading(LAST_YEAR_MONTH, '2026-08-22')).toBe('2025년 8월 기준');
  });

  it('shows the visit count, total, average, and most recent visit', () => {
    const container = document.createElement('div');
    const detail = detailFor(0, '1y');

    renderPlaceDetail(container, detail);
    const text = container.textContent ?? '';

    // 한밭식당 over 1y: 45000 + 32000 + 29000 + 51000 across four visits.
    expect(detail.stats.visitCount).toBe(4);
    // Asserted through the exported constants so the banned-phrase test can reach the same strings.
    for (const label of Object.values(FIGURE_LABELS)) {
      expect(text).toContain(label);
    }
    expect(text).toContain('4회');
    expect(text).toContain(amountLabel(157000));
    expect(text).toContain(amountLabel(39250));
    expect(text).toContain('2026-07-20');
  });

  it('says so when the selected period holds no visit, instead of showing zeros', () => {
    // 000003's visits are all older than the 1m window.
    const container = document.createElement('div');

    renderPlaceDetail(container, detailFor(2, '1m'));

    expect(container.textContent).toContain(NO_VISIT_IN_PERIOD_MESSAGE);
    expect(container.querySelector('.place-detail-figures')).toBeNull();
  });

  it('carries every histogram value as text, not as bar length alone', () => {
    const container = document.createElement('div');

    renderPlaceDetail(container, detailFor(0, '1y'));
    const entries = [...container.querySelectorAll('.place-histogram-entry')];

    expect(container.textContent).toContain(histogramHeading(12));
    expect(entries).toHaveLength(12);
    for (const entry of entries) {
      expect(entry.querySelector('.place-histogram-month')?.textContent).toMatch(/\d+년 \d+월/);
      expect(entry.querySelector('.place-histogram-count')?.textContent).toMatch(/^\d+회$/);
    }
    expect(container.textContent).toContain(`${monthLabel('2026-07')}`);
  });

  it('charts the 작년 같은 달 month the card names, as the oldest bar', () => {
    // The card prints "2025년 8월 기준" over these bars; under the 12-month span that month sat one
    // month outside the chart, so the figures named a month the reader could not find.
    const container = document.createElement('div');

    renderPlaceDetail(container, detailFor(0, LAST_YEAR_MONTH));
    const entries = [...container.querySelectorAll('.place-histogram-entry')];

    expect(entries).toHaveLength(13);
    expect(entries[0]?.querySelector('.place-histogram-month')?.textContent).toBe(
      monthLabel('2025-08'),
    );
    expect(container.textContent).toContain(histogramHeading(13));
  });

  it('scales bars without dividing by zero when the place has no charted visit', () => {
    const container = document.createElement('div');
    const detail = { ...detailFor(0, '1y'), place: { ...PLACE, transactions: [] } };
    detail.histogram = computeMonthlyHistogram(detail.place, SAMPLE_DATASET.updatedAt);

    renderPlaceDetail(container, detail);

    for (const bar of container.querySelectorAll<HTMLElement>('.place-histogram-bar')) {
      expect(bar.style.width).toBe('0%');
    }
  });

  it('renders no link at all when the dataset URL is not https', () => {
    // `src/data/load.ts` accepts `naverUrl` as any non-empty string, so the scheme is checked here.
    for (const naverUrl of ['javascript:alert(1)', 'http://map.naver.com/x', 'not a url']) {
      const container = document.createElement('div');
      const detail = detailFor(0, '1y');

      renderPlaceDetail(container, { ...detail, place: { ...detail.place, naverUrl } });

      expect(container.querySelector('.place-detail-link')).toBeNull();
      expect(container.textContent).not.toContain(NAVER_LINK_LABEL);
      // The rest of the card still renders — one bad field does not blank the whole view.
      expect(container.textContent).toContain(detail.place.name);
    }
  });

  it('links out to Naver Maps without handing the new tab a window handle', () => {
    const container = document.createElement('div');

    renderPlaceDetail(container, detailFor(0, '1y'));
    const link = container.querySelector<HTMLAnchorElement>('.place-detail-link');

    expect(link?.textContent).toBe(NAVER_LINK_LABEL);
    expect(link?.getAttribute('href')).toBe(PLACE.naverUrl);
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
