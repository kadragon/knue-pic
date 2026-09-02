import { describe, expect, it } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import { monthKey } from '../data/iso-date';
import { computeMonthlyHistogram, histogramSpan } from '../stats/histogram';
import type { HistogramSpan } from '../stats/histogram';
import { DISTANCE_BANDS, distanceBand } from '../stats/distance';
import {
  campusDistanceLabel,
  displayCategory,
  displayDate,
  displayShortDate,
  histogramSpanLabel,
  monthLabel,
  renderKindBadge,
  shortAddress,
} from './place-labels';

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

  it('drops the year from a place\u0027s own date, keeping the leading zeroes', () => {
    // Zero-padded on both fields so a column of dates lines up rather than ragging by a character.
    expect(displayShortDate('2026-07-08')).toBe('07-08');
    expect(displayShortDate('2026-12-25')).toBe('12-25');
  });

  it('leaves a malformed value alone rather than slicing a wrong pair out of it', () => {
    expect(displayShortDate('unknown')).toBe('unknown');
    expect(displayShortDate('2026-07-08T00:00:00')).toBe('2026-07-08T00:00:00');
  });
});

describe('short address', () => {
  it('keeps the city and the district, dropping the province and the street', () => {
    // Every address below is a real row of `data/places.json`.
    expect(shortAddress('충청북도 청주시 흥덕구 가로수로1164번길 38')).toBe('청주 흥덕구');
    expect(shortAddress('충청북도 청주시 상당구 무농정로3번길 56 1층')).toBe('청주 상당구');
  });

  it('keeps a 읍/면 under its district', () => {
    // 강내면 is where the campus itself sits, so collapsing it into 흥덕구 would lose the one
    // distinction a reader near the campus cares about.
    expect(shortAddress('충청북도 청주시 흥덕구 강내면 태성탑연로 390')).toBe('청주 흥덕구 강내면');
  });

  it('keeps the stem of a 광역시/특별자치시, which the district alone would not identify', () => {
    expect(shortAddress('대전광역시 대덕구 덕암북로72번길 20')).toBe('대전 대덕구');
    expect(shortAddress('세종특별자치시 세종로 1219 세종중앙타워 2층')).toBe('세종');
  });

  it('keeps a single-syllable district, which a two-character minimum dropped', () => {
    // 12 of the 504 published rows carry one, and they rendered as a bare city stem.
    expect(shortAddress('대전광역시 서구 가장로 43-1')).toBe('대전 서구');
    expect(shortAddress('대전광역시 중구 사정공원로 70')).toBe('대전 중구');
    expect(shortAddress('서울특별시 중구 세종대로 136')).toBe('서울 중구');
  });

  it('keeps a 군 whole, so a county does not read as a city', () => {
    expect(shortAddress('충청북도 괴산군 괴산읍 임꺽정로 1')).toBe('괴산군 괴산읍');
  });

  it('skips only a listed province abbreviation, never an unsuffixed city name', () => {
    // `대전 중구` without 광역시: skipping the first token would yield `중구`, a district six
    // cities share — the ambiguity the 광역시 branch exists to prevent.
    expect(shortAddress('대전 중구 사정공원로 70')).toBe('대전 중구 사정공원로 70');
  });

  it('tolerates the abbreviated province spelling', () => {
    // `충북 …` is how the test fixtures and some disclosure rows spell it; only the leading token
    // is ever skipped, so the walk still stops at the road name.
    expect(shortAddress('충북 청주시 흥덕구 강내면 태성탑연로 111')).toBe('청주 흥덕구 강내면');
  });

  it('returns an unrecognised address whole rather than inventing a district for it', () => {
    expect(shortAddress('알 수 없음')).toBe('알 수 없음');
    expect(shortAddress('')).toBe('');
  });
});

describe('campus distance label', () => {
  it('states one decimal at every magnitude', () => {
    expect(campusDistanceLabel(3.24)).toBe('거리 3.2km');
    expect(campusDistanceLabel(0.72)).toBe('거리 0.7km');
    expect(campusDistanceLabel(24.75)).toBe('거리 24.8km');
  });
});

describe('renderKindBadge', () => {
  it('spells the category out and leaves the colour to the kind', () => {
    const cafe = SAMPLE_DATASET.places.find((place) => place.kind === 'cafe')!;

    const badge = renderKindBadge(cafe);

    // The text is the fact; `data-kind` is only what the stylesheet colours by. Colour alone may
    // not carry a classification (`docs/conventions.md` → Accessibility).
    expect(badge.textContent).toBe(displayCategory(cafe.category));
    expect(badge.dataset['kind']).toBe('cafe');
    expect(badge.className).toBe('place-kind-badge');
  });
});

describe('histogramSpanLabel', () => {
  it('names the span from its ends, not from how many months lie between them', () => {
    // Derived, not hardcoded: moving an end has to move the label, or the label would be free to
    // state a span the chart does not draw.
    expect(histogramSpanLabel({ first: monthKey(2025, 9), last: monthKey(2026, 8) })).toBe(
      `${monthLabel(monthKey(2025, 9))}~${monthLabel(monthKey(2026, 8))}`,
    );
    expect(histogramSpanLabel({ first: monthKey(2025, 10), last: monthKey(2026, 8) })).toBe(
      `${monthLabel(monthKey(2025, 10))}~${monthLabel(monthKey(2026, 8))}`,
    );
    // Pinned literally once as well, so a reword of `monthLabel` cannot leave both sides of the
    // assertions above agreeing on a form no reader ever sees.
    expect(histogramSpanLabel({ first: monthKey(2025, 9), last: monthKey(2026, 8) })).toBe(
      '2025년 9월~2026년 8월',
    );
  });

  it('states a single charted month once rather than as a range onto itself', () => {
    expect(histogramSpanLabel({ first: monthKey(2026, 8), last: monthKey(2026, 8) })).toBe(
      monthLabel(monthKey(2026, 8)),
    );
  });

  it('names both ends of a producer-built series, never the blank the empty branch used to give', () => {
    // The round trip a real caller makes — producer to span to label — over the default charted
    // window. The `''` this used to return for an empty bucket array rendered `" 이용 횟수"` and
    // `"월별 막대는  기준"`, so the absence of a leading or doubled space is the regression being
    // held, not merely the presence of a range.
    const buckets = computeMonthlyHistogram(SAMPLE_DATASET.places[0]!, '2026-08-01');
    const label = histogramSpanLabel(histogramSpan(buckets));

    expect(label).toBe(`${monthLabel(monthKey(2025, 9))}~${monthLabel(monthKey(2026, 8))}`);
    expect(`${label} 이용 횟수`).not.toMatch(/^\s|\s\s/);
  });

  it('refuses a hand-written blank span at compile time, not at render time', () => {
    // The hole this closes: `HistogramSpan.first`/`.last` were plain `string`, so the literal
    // below typechecked and printed `년 NaN월`. The runtime assertion alone would keep passing if
    // the fields were widened back, so the `@ts-expect-error` is the half that holds the type.

    // @ts-expect-error a span's ends are `MonthKey`, and `''` is not one
    const blank: HistogramSpan = { first: '', last: '' };
    // @ts-expect-error an unpadded month is not a `MonthKey` either
    const unpadded: HistogramSpan = { first: '2025-9', last: '2026-8' };

    expect([blank, unpadded]).toHaveLength(2);
  });
});

describe('distance band consistency', () => {
  it('never colours a badge with a band its own printed figure contradicts', () => {
    // The label rounds to one decimal and the band cuts at 2 / 5 / 15, so a raw 1.96km would read
    // `거리 2.0km` in the `~2km` fill unless both round the same way. Walk the boundaries in 10m
    // steps and require the printed number itself to sit inside the band's range.
    for (let metres = 0; metres <= 20_000; metres += 10) {
      const km = metres / 1000;
      const printed = Number(campusDistanceLabel(km).replace(/[^0-9.]/g, ''));
      const band = distanceBand(km);
      const index = DISTANCE_BANDS.findIndex((entry) => entry.band === band);
      const lower = index > 0 ? DISTANCE_BANDS[index - 1]!.maxKm : 0;
      const upper = DISTANCE_BANDS[index]!.maxKm;
      expect(printed).toBeGreaterThanOrEqual(lower);
      expect(printed).toBeLessThan(upper);
    }
  });
});
