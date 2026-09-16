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
  KAKAO_LINK_LABEL,
  NAVER_LINK_LABEL,
  NO_VISIT_IN_PERIOD_MESSAGE,
  periodStatsHeading,
  renderPlaceDetail,
  visitCountLabel,
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
  it('puts both badges on one row and the full address alone on the next', () => {
    const container = document.createElement('div');
    const detail = detailFor(0, '1y');

    renderPlaceDetail(container, detail);
    const meta = container.querySelector('.place-detail-meta');
    const address = container.querySelector('.place-detail-address');

    // Sharing one line, the address wrapped at 360px and stranded a trailing dot with the distance
    // badge dropped below it. The badges now share a row, so the address needs no separator and
    // stays whole — the dialog is where the exact location is read.
    expect(meta?.querySelector('.place-kind-badge')).not.toBeNull();
    expect(meta?.querySelector('.place-detail-distance')?.textContent).toBe(
      campusDistanceLabel(distanceFromCampusKm(detail.place)),
    );
    expect(meta?.contains(address ?? null)).toBe(false);
    expect(address?.textContent).toBe(detail.place.address);
    expect(meta?.nextElementSibling).toBe(address);
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
    // The year is the provenance band's job, not a row's: every date sits inside the named window.
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
    entries.forEach((entry, index) => {
      const bucket = buckets[index]!;
      // The column draws only the month number and the count, but the text still reads in full.
      expect(entry.querySelector('.place-histogram-month')?.textContent).toBe(monthLabel(bucket.month));
      expect(entry.querySelector('.place-histogram-count')?.textContent).toBe(
        visitCountLabel(bucket.visitCount),
      );
      // Read as one phrase: the drawn parts are hidden from assistive tech, the full phrase is not.
      expect(entry.querySelector(':scope > .visually-hidden')?.textContent).toBe(
        `${monthLabel(bucket.month)} ${visitCountLabel(bucket.visitCount)}`,
      );
      expect(entry.querySelectorAll(':scope > [aria-hidden="true"]')).toHaveLength(3);
    });
    expect(container.textContent).toContain(`${monthLabel(monthKey(2026, 7))}`);
  });

  it('marks empty months and draws the year only where it starts', () => {
    const container = document.createElement('div');
    const detail = detailFor(0, '1y');

    renderPlaceDetail(container, detail);
    const entries = [...container.querySelectorAll<HTMLElement>('.place-histogram-entry')];

    const empties = entries.map((entry) => entry.dataset['empty']);
    expect(empties).toEqual(detail.histogram.map((bucket) => String(bucket.visitCount === 0)));
    // The fixture must hold both kinds of month, or the mapping above could not tell them apart.
    expect(empties).toContain('true');
    expect(empties).toContain('false');

    const starts = entries.flatMap((entry, index) =>
      entry.querySelector<HTMLElement>('.place-histogram-year')?.dataset['start'] === 'true' ? [index] : [],
    );
    const expected = detail.histogram.flatMap((bucket, index) =>
      (index === 0 && !detail.histogram[1]?.month.endsWith('-01')) || bucket.month.endsWith('-01')
        ? [index]
        : [],
    );
    expect(starts).toEqual(expected);
    // A span crossing a new year, so the January marker is exercised and not only the first column.
    expect(expected.length).toBeGreaterThan(1);
  });

  it('leaves the first column unlabelled when the next column is a January', () => {
    const container = document.createElement('div');
    const months = [monthKey(2025, 12), ...Array.from({ length: 11 }, (_, i) => monthKey(2026, i + 1))];
    const [first, ...rest] = months.map((month) => ({ month, visitCount: 1 }));
    const detail = { ...detailFor(0, '1y'), histogram: [first!, ...rest] as const };

    renderPlaceDetail(container, detail);
    const starts = [...container.querySelectorAll<HTMLElement>('.place-histogram-year')].map(
      (year) => year.dataset['start'],
    );

    // Both labels are wider than a 360px column and spill right, so a December first column and
    // the January beside it would draw `2025년` and `2026년` over each other.
    expect(starts[0]).toBe('false');
    expect(starts[1]).toBe('true');
    expect(starts.filter((start) => start === 'true')).toHaveLength(1);
    // The first column still reads in full.
    expect(container.querySelector('.place-histogram-month')?.textContent).toBe(monthLabel(months[0]!));
  });

  it('scales bars without dividing by zero when the place has no charted visit', () => {
    const container = document.createElement('div');
    const detail = { ...detailFor(0, '1y'), place: { ...PLACE, transactions: [] } };
    detail.histogram = computeMonthlyHistogram(detail.place, SAMPLE_DATASET.updatedAt);

    renderPlaceDetail(container, detail);

    const bars = [...container.querySelectorAll<HTMLElement>('.place-histogram-bar')];
    expect(bars).toHaveLength(12);
    for (const bar of bars) {
      expect(bar.style.height).toBe('0%');
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
      // The wrapper goes with them — an empty row would still take the margin above the links.
      expect(container.querySelector('.place-detail-links')).toBeNull();
      expect(container.textContent).not.toContain(NAVER_LINK_LABEL);
      expect(container.textContent).not.toContain(KAKAO_LINK_LABEL);
      // The rest of the card still renders — one bad field does not blank the whole view.
      expect(container.textContent).toContain(detail.place.name);
    }
  });

  it('searches the city and the narrowest region beside the name, not the name alone', () => {
    const container = document.createElement('div');

    renderPlaceDetail(container, detailFor(0, '1y'));
    const link = container.querySelector<HTMLAnchorElement>('[data-service="naver"]');

    // 한밭식당 sits in 청주's 강내면 (`충북 청주시 흥덕구 강내면 태성탑연로 111`), so the query is
    // `청주 강내면 한밭식당` — city, then narrowest unit, then the name. The dataset's own
    // `naverUrl` searches the trade name alone, which finds a same-named place elsewhere in the
    // country — the whole point of composing the query here.
    expect(link?.getAttribute('href')).toBe(
      `https://map.naver.com/p/search/${encodeURIComponent('청주 강내면 한밭식당')}`,
    );
    expect(link?.getAttribute('href')).not.toBe(PLACE.naverUrl);
  });

  it('still links when the address names a region and the dataset URL is unusable', () => {
    // The state the scheme guard used to blank: before the composed query, a non-https `naverUrl`
    // meant no link at all. It no longer does, and that is the intended reading of the change — the
    // composed href is a constant https prefix over a percent-encoded query, so no dataset string
    // reaches an executable position on this path and there is nothing for the guard to catch. The
    // guard covers the fallback, which is the only path a dataset string still reaches.
    for (const naverUrl of ['javascript:alert(1)', 'http://map.naver.com/x', 'not a url']) {
      const container = document.createElement('div');
      const detail = detailFor(0, '1y');

      renderPlaceDetail(container, { ...detail, place: { ...detail.place, naverUrl } });
      const link = container.querySelector<HTMLAnchorElement>('[data-service="naver"]');

      expect(link?.getAttribute('href')).toBe(
        `https://map.naver.com/p/search/${encodeURIComponent('청주 강내면 한밭식당')}`,
      );
    }
  });

  it('falls back to the dataset URL when the address names no administrative unit', () => {
    const container = document.createElement('div');
    const detail = detailFor(0, '1y');

    // Prefixing a street fragment would send the search somewhere the data never claimed.
    renderPlaceDetail(container, {
      ...detail,
      place: { ...detail.place, address: '태성탑연로 111' },
    });
    const link = container.querySelector<HTMLAnchorElement>('[data-service="naver"]');

    expect(link?.getAttribute('href')).toBe(PLACE.naverUrl);
  });

  it('links out to both map services without handing the new tab a window handle', () => {
    const container = document.createElement('div');

    renderPlaceDetail(container, detailFor(0, '1y'));
    const links = [...container.querySelectorAll<HTMLAnchorElement>('.place-detail-link')];

    // Source order is Naver then Kakao; the labels are pinned so a swap has to be deliberate.
    expect(links.map((link) => link.textContent)).toEqual([NAVER_LINK_LABEL, KAKAO_LINK_LABEL]);
    expect(links.map((link) => link.dataset['service'])).toEqual(['naver', 'kakao']);
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      // Peers: the same class, so the stylesheet cannot give one of them more weight than the
      // other without doing it to both.
      expect(link.className).toBe('place-detail-link');
      expect(link.parentElement?.className).toBe('place-detail-links');
    }
  });

  it('searches the same composed query on Kakao Map as on Naver Maps', () => {
    const container = document.createElement('div');

    renderPlaceDetail(container, detailFor(0, '1y'));
    const kakao = container.querySelector<HTMLAnchorElement>('[data-service="kakao"]');

    // `https://map.kakao.com/link/search/<q>` answers 302 to this form, so the link is written as
    // the destination rather than as the hop to it.
    expect(kakao?.getAttribute('href')).toBe(
      `https://map.kakao.com/?q=${encodeURIComponent('청주 강내면 한밭식당')}`,
    );
  });

  it('composes the Kakao link from the address, never from the dataset URL', () => {
    // The dataset has no Kakao field, and `naverUrl` is the one string a place carries that could
    // be mistaken for one. A `naverUrl` this unusable must change nothing about the Kakao link.
    for (const naverUrl of ['javascript:alert(1)', 'http://map.naver.com/x', 'not a url']) {
      const container = document.createElement('div');
      const detail = detailFor(0, '1y');

      renderPlaceDetail(container, { ...detail, place: { ...detail.place, naverUrl } });

      expect(
        container.querySelector<HTMLAnchorElement>('[data-service="kakao"]')?.getAttribute('href'),
      ).toBe(`https://map.kakao.com/?q=${encodeURIComponent('청주 강내면 한밭식당')}`);
    }
  });

  it('renders no Kakao link when the address names no administrative unit', () => {
    const container = document.createElement('div');
    const detail = detailFor(0, '1y');

    // Naver still links, by falling back to the dataset URL. Kakao has no such fallback, and the
    // trade name alone is the nationwide-collision search the composed query exists to avoid.
    renderPlaceDetail(container, {
      ...detail,
      place: { ...detail.place, address: '태성탑연로 111' },
    });

    expect(container.querySelector('[data-service="kakao"]')).toBeNull();
    expect(container.textContent).not.toContain(KAKAO_LINK_LABEL);
    expect(
      container.querySelector<HTMLAnchorElement>('[data-service="naver"]')?.getAttribute('href'),
    ).toBe(
      PLACE.naverUrl,
    );
  });
});
