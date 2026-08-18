import { describe, expect, it } from 'vitest';
import type { PlacesDataset } from '../data/types';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import { ALL_CATEGORIES, filterPlaces, listCategories } from './search';

const NO_FILTER = { text: '', category: ALL_CATEGORIES };

describe('listCategories', () => {
  it('returns each category once, sorted', () => {
    expect(listCategories(SAMPLE_DATASET)).toEqual(['기타', '분식', '중식', '카페', '한식']);
  });
});

describe('filterPlaces', () => {
  it('returns every place when neither filter is set', () => {
    expect(filterPlaces(SAMPLE_DATASET, NO_FILTER)).toHaveLength(SAMPLE_DATASET.places.length);
  });

  it('matches on name', () => {
    const found = filterPlaces(SAMPLE_DATASET, { ...NO_FILTER, text: '칼국수' });

    expect(found.map((place) => place.id)).toEqual(['restaurant_000006']);
  });

  it('matches on address and on category', () => {
    expect(filterPlaces(SAMPLE_DATASET, { ...NO_FILTER, text: '학천길' }).map((p) => p.id)).toEqual([
      'restaurant_000003',
      'restaurant_000006',
    ]);
    expect(filterPlaces(SAMPLE_DATASET, { ...NO_FILTER, text: '카페' }).map((p) => p.id)).toEqual([
      'restaurant_000002',
    ]);
  });

  it('ignores case and surrounding whitespace', () => {
    const dataset: PlacesDataset = {
      updatedAt: '2026-08-01',
      places: [{ ...SAMPLE_DATASET.places[0]!, name: 'Campus Cafe' }],
    };

    expect(filterPlaces(dataset, { ...NO_FILTER, text: '  cAfE ' })).toHaveLength(1);
  });

  it('applies the text and category filters together', () => {
    const found = filterPlaces(SAMPLE_DATASET, { text: '태성탑연로', category: '한식' });

    expect(found.map((place) => place.id)).toEqual(['restaurant_000001']);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterPlaces(SAMPLE_DATASET, { ...NO_FILTER, text: 'zzz' })).toEqual([]);
  });

  it('preserves dataset order', () => {
    const found = filterPlaces(SAMPLE_DATASET, { ...NO_FILTER, category: '한식' });

    expect(found.map((place) => place.id)).toEqual(['restaurant_000001', 'restaurant_000006']);
  });
});
