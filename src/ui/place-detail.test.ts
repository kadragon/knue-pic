import { describe, expect, it } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import { monthKey } from '../data/iso-date';
import { computeMonthlyHistogram } from '../stats/histogram';
import { computePlaceStats } from '../stats/place-stats';
import { resolvePeriodWindow } from '../stats/period';
import type { Period } from '../data/types';
import {
  DETAIL_EMPTY_MESSAGE,
  FIGURE_LABELS,
  histogramHeading,
  META_SEPARATOR,
  NAVER_LINK_LABEL,
  NO_VISIT_IN_PERIOD_MESSAGE,
  periodStatsHeading,
  renderPlaceDetail,
} from './place-detail';
import { campusDistanceLabel, monthLabel } from './place-labels';
import { distanceBand, distanceFromCampusKm } from '../stats/distance';

const PLACE = SAMPLE_DATASET.places[0]!; // 한밭식당

function detailFor(placeIndex = 0, basis: Period = '1y') {
  const place = SAMPLE_DATASET.places[placeIndex]!;
  return {
    place,
    basis,
    stats: computePlaceStats(place, resolvePeriodWindow(basis, SAMPLE_DATASET.updatedAt)),
    histogram: computeMonthlyHistogram(place, SAMPLE_DATASET.updatedAt),
  };
}

describe('renderPlaceDetail', () => {
  it('keeps the separator out of the accessibility tree', () => {
    const container = document.createElement('div');

    renderPlaceDetail(container, detailFor(0, '1y'));
    const separator = container.querySelector('.place-detail-address span[aria-hidden="true"]');

    // A spoken "middle dot" between two facts a screen reader already reads as separate elements is
    // noise. `aria-hidden` subtrees are excluded from name computation, so the dot is drawn and not
    // announced.
    expect(separator?.textContent).toBe(`\u00A0${META_SEPARATOR}`);
  });

  it('separates the address from the distance with a dot that cannot wrap away from it', () => {
    const container = document.createElement('div');
    const detail = detailFor(0, '1y');

    renderPlaceDetail(container, detail);
    const distance = container.querySelector('.place-detail-distance');

    // One node, not a sibling separator: at 360px the address wraps and a separate flex item was
    // pushed to the head of the next line, leaving the dot stranded above its figure.
    expect(distance?.textContent).toBe(campusDistanceLabel(distanceFromCampusKm(detail.place)));
    // Trailing the address, so a wrap never strands it at the head of the next line.
    expect(container.querySelector('.place-detail-address')?.textContent).toBe(
      `${detail.place.address}\u00A0${META_SEPARATOR}`,
    );
  });

  it('adds the campus distance beside the full address rather than replacing it', () => {
    const container = document.createElement('div');
    const detail = detailFor(0, '1y');

    renderPlaceDetail(container, detail);

    // The dialog is where the exact location is read, so the address stays whole here; the
    // distance is the one thing the address does not tell the reader.
    expect(container.querySelector('.place-detail-address')?.textContent).toBe(
      `${detail.place.address}\u00A0${META_SEPARATOR}`,
    );
    expect(container.querySelector('.place-detail-distance')?.textContent).toBe(
      campusDistanceLabel(distanceFromCampusKm(detail.place)),
    );
  });

  it('carries the same distance band the ranked row does', () => {
    const container = document.createElement('div');
    const detail = detailFor(0, '1y');

    renderPlaceDetail(container, detail);
    const distance = container.querySelector<HTMLElement>('.place-detail-distance');

    // One classifier for both screens: a place that reads as 가까움 in the list must not change
    // colour in the card the list opened.
    expect(distance?.dataset['band']).toBe(distanceBand(distanceFromCampusKm(detail.place)));
    expect(distance?.textContent).toBe(campusDistanceLabel(distanceFromCampusKm(detail.place)));
  });

  it('shows a placeholder until a place is selected', () => {
    const container = document.createElement('div');

    renderPlaceDetail(container, null);

    expect(container.textContent).toContain(DETAIL_EMPTY_MESSAGE);
    expect(container.querySelector('.place-detail-link')).toBeNull();
  });

  it('names the period the figures were computed for', () => {
    const container = document.createElement('div');

    renderPlaceDetail(container, detailFor(0, '6m'));

    expect(container.textContent).toContain(periodStatsHeading('6m'));
    expect(periodStatsHeading('6m')).toBe('최근 6개월 기준');
  });

  it('carries the place\u0027s 업종 badge with its category spelled out', () => {
    const container = document.createElement('div');
    const detail = detailFor(0, '1y');

    renderPlaceDetail(container, detail);
    const badge = container.querySelector<HTMLElement>('.place-kind-badge');

    // Colour alone may not carry the classification, so the category is text on the badge and the
    // kind reaches the stylesheet as data rather than as a colour picked here.
    expect(badge?.textContent).toBe(detail.place.category.replace(/,\s*/g, '\u00b7'));
    expect(badge?.dataset['kind']).toBe(detail.place.kind);
  });

  it('shows visit counts and the most recent visit without amount figures', () => {
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
    expect(container.querySelectorAll('.place-detail-figure')).toHaveLength(2);
    expect(text).toContain('4회');
    expect(text).toContain('07-20');
    // The year is the footer's job, not a row's: every date here sits inside the named window.
    expect(text).not.toContain('2026년 7월 20일');
    expect(text).not.toContain('합계');
    expect(text).not.toContain('평균');
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

    const buckets = detailFor(0, '1y').histogram;
    expect(container.textContent).toContain(histogramHeading(buckets));
    // Months, not a count: `최근 12개월` reads as the 최근 1년 window above it, which covers a
    // different span than these whole calendar months.
    expect(container.textContent).not.toContain(`최근 ${buckets.length}개월 이용 횟수`);
    expect(entries).toHaveLength(12);
    for (const entry of entries) {
      expect(entry.querySelector('.place-histogram-month')?.textContent).toMatch(/\d+년 \d+월/);
      expect(entry.querySelector('.place-histogram-count')?.textContent).toMatch(/^\d+회$/);
    }
    expect(container.textContent).toContain(`${monthLabel(monthKey(2026, 7))}`);
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

  it('renders no link at all when the dataset URL is not https and the address names no region', () => {
    // `src/data/load.ts` accepts `naverUrl` as any non-empty string, so the scheme is checked here.
    // The address is one `addressRegion` refuses, so the composed URL cannot stand in for the
    // rejected one — this is the path where the dataset string is the only candidate.
    for (const naverUrl of ['javascript:alert(1)', 'http://map.naver.com/x', 'not a url']) {
      const container = document.createElement('div');
      const detail = detailFor(0, '1y');

      renderPlaceDetail(container, {
        ...detail,
        place: { ...detail.place, naverUrl, address: '태성탑연로 111' },
      });

      expect(container.querySelector('.place-detail-link')).toBeNull();
      expect(container.textContent).not.toContain(NAVER_LINK_LABEL);
      // The rest of the card still renders — one bad field does not blank the whole view.
      expect(container.textContent).toContain(detail.place.name);
    }
  });

  it('searches the narrowest region beside the name, not the name alone', () => {
    const container = document.createElement('div');

    renderPlaceDetail(container, detailFor(0, '1y'));
    const link = container.querySelector<HTMLAnchorElement>('.place-detail-link');

    // 한밭식당 sits in 강내면 (`충북 청주시 흥덕구 강내면 태성탑연로 111`). The dataset's own
    // `naverUrl` searches the trade name alone, which finds a same-named place elsewhere in the
    // country — the whole point of composing the query here.
    expect(link?.getAttribute('href')).toBe(
      `https://map.naver.com/p/search/${encodeURIComponent('강내면 한밭식당')}`,
    );
    expect(link?.getAttribute('href')).not.toBe(PLACE.naverUrl);
  });

  it('falls back to the dataset URL when the address names no administrative unit', () => {
    const container = document.createElement('div');
    const detail = detailFor(0, '1y');

    // Prefixing a street fragment would send the search somewhere the data never claimed.
    renderPlaceDetail(container, {
      ...detail,
      place: { ...detail.place, address: '태성탑연로 111' },
    });
    const link = container.querySelector<HTMLAnchorElement>('.place-detail-link');

    expect(link?.getAttribute('href')).toBe(PLACE.naverUrl);
  });

  it('links out to Naver Maps without handing the new tab a window handle', () => {
    const container = document.createElement('div');

    renderPlaceDetail(container, detailFor(0, '1y'));
    const link = container.querySelector<HTMLAnchorElement>('.place-detail-link');

    expect(link?.textContent).toBe(NAVER_LINK_LABEL);
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
