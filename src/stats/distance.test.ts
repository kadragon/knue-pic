import { describe, expect, it } from 'vitest';
import type { PlaceRecord } from '../data/types';
import {
  CAMPUS_ORIGIN,
  DISTANCE_BANDS,
  distanceBand,
  distanceFromCampusKm,
  haversineKm,
} from './distance';

function placeAt(lat: number, lng: number): PlaceRecord {
  return {
    id: 'restaurant_000001',
    name: '테스트',
    category: '한식',
    kind: 'restaurant',
    address: '충청북도 청주시 흥덕구 강내면 태성탑연로 250',
    lat,
    lng,
    naverUrl: 'https://map.naver.com/p/search/테스트',
    transactions: [],
  };
}

describe('straight-line distance from the campus', () => {
  it('measures a place at the origin as zero', () => {
    expect(distanceFromCampusKm(placeAt(CAMPUS_ORIGIN.lat, CAMPUS_ORIGIN.lng))).toBe(0);
  });

  it('matches the meridian arc for a one-degree latitude difference', () => {
    // One degree of latitude is ~111.19km on a sphere of the radius this module uses. A distance
    // computed with lat and lng transposed would land ~10km off here, which is the mistake worth
    // catching.
    const north = distanceFromCampusKm(placeAt(CAMPUS_ORIGIN.lat + 1, CAMPUS_ORIGIN.lng));
    expect(north).toBeGreaterThan(110.7);
    expect(north).toBeLessThan(111.7);
  });

  it('shrinks a degree of longitude by the cosine of the latitude', () => {
    // At 36.6N a degree of longitude is ~89km, not 111km — the check that the formula is spherical
    // rather than a flat-plane approximation over degrees.
    const east = distanceFromCampusKm(placeAt(CAMPUS_ORIGIN.lat, CAMPUS_ORIGIN.lng + 1));
    expect(east).toBeGreaterThan(88);
    expect(east).toBeLessThan(90);
  });

  it('is symmetric', () => {
    const a = { lat: 36.6255708, lng: 127.4265199 };
    const b = { lat: 36.4434267, lng: 127.4242315 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 10);
  });

  it('places a 강내면 venue nearer than a 대전 one', () => {
    // Both coordinates are real rows of the published dataset: 36.5공감 (강내면, beside the campus)
    // and MANDARIN (대전 대덕구). The ordering is the whole point of putting the figure on a row.
    const nearby = distanceFromCampusKm(placeAt(36.6177543, 127.3561614));
    const far = distanceFromCampusKm(placeAt(36.4434267, 127.4242315));
    expect(nearby).toBeLessThan(2);
    expect(far).toBeGreaterThan(15);
  });
});

describe('distanceBand', () => {
  it("opens each band at its predecessor's bound", () => {
    // The boundaries themselves, from both sides. A place exactly 2.0km out belongs to the band
    // above, and nothing in the list may fall between two bands.
    expect(distanceBand(1.999)).toBe('near');
    expect(distanceBand(2)).toBe('close');
    expect(distanceBand(4.999)).toBe('close');
    expect(distanceBand(5)).toBe('mid');
    expect(distanceBand(14.999)).toBe('mid');
    expect(distanceBand(15)).toBe('far');
  });

  it('classifies zero and an arbitrarily distant place', () => {
    expect(distanceBand(0)).toBe('near');
    expect(distanceBand(400)).toBe('far');
  });

  it('has an unbounded last band, so no distance is unclassified', () => {
    // The `?? DISTANCE_BANDS[3]` fallback in `distanceBand` is unreachable only while this holds.
    expect(DISTANCE_BANDS[DISTANCE_BANDS.length - 1]?.maxKm).toBe(Infinity);
  });

  it('bands the two real dataset rows the distance figure was added for', () => {
    // Same coordinates as the ordering test above: 36.5공감 beside the campus, MANDARIN in 대전.
    expect(distanceBand(distanceFromCampusKm(placeAt(36.6177543, 127.3561614)))).toBe('near');
    expect(distanceBand(distanceFromCampusKm(placeAt(36.4434267, 127.4242315)))).toBe('far');
  });
});
