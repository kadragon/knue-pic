import { describe, expect, it } from 'vitest';
import type { PlacesDataset } from '../data/types';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import { displayCategory } from '../ui/place-labels';
import { ALL_CATEGORIES, ALL_KINDS, filterByKind, filterPlaces, listCategories } from './search';

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

  it('finds a comma category typed back in the form the page rendered it', () => {
    // The lists show `displayCategory(c)`, so a reader who copies what they see must reach the same
    // places as the stored spelling — the two separators are folded together inside the matcher.
    const dataset: PlacesDataset = {
      ...SAMPLE_DATASET,
      places: SAMPLE_DATASET.places.map((place, index) =>
        index === 0 ? { ...place, category: '카페,디저트' } : place,
      ),
    };

    expect(filterPlaces(dataset, { ...NO_FILTER, text: '카페,디저트' }).map((p) => p.id)).toEqual(
      filterPlaces(dataset, { ...NO_FILTER, text: displayCategory('카페,디저트') }).map((p) => p.id),
    );
    expect(filterPlaces(dataset, { ...NO_FILTER, text: '카페·디저트' })).toHaveLength(1);
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

// --- Unicode normalization ---------------------------------------------------------------------

// The collector publishes every name and category in NFC (`collector/validate.py` ->
// `normalize_name`), but a query typed or pasted on macOS arrives decomposed, and a hand-edited
// dataset can still carry either spelling. The two are code-point-unequal and name one thing.
const NFD_HANSIK = '\u1112\u1161\u11ab\u1109\u1175\u11a8'; // 한식, decomposed
const NFC_HANSIK = '\uD55C\uC2DD'; // 한식, composed

const mixedSpellings: PlacesDataset = {
  updatedAt: '2026-08-01',
  places: [
    { ...SAMPLE_DATASET.places[0]!, id: 'a', category: NFC_HANSIK },
    { ...SAMPLE_DATASET.places[1]!, id: 'b', category: NFD_HANSIK },
  ],
};

describe('unicode composition', () => {
  it('lists one category for a dataset holding both spellings of it', () => {
    expect(listCategories(mixedSpellings)).toEqual([NFC_HANSIK]);
  });

  it('filters both spellings under either one', () => {
    for (const category of [NFC_HANSIK, NFD_HANSIK]) {
      expect(filterPlaces(mixedSpellings, { text: '', category }).map((place) => place.id)).toEqual([
        'a',
        'b',
      ]);
    }
  });

  it('matches a decomposed query against composed text, and the reverse', () => {
    expect(
      filterPlaces(mixedSpellings, { ...NO_FILTER, text: NFD_HANSIK }).map((place) => place.id),
    ).toEqual(['a', 'b']);

    const decomposedName: PlacesDataset = {
      updatedAt: '2026-08-01',
      places: [{ ...SAMPLE_DATASET.places[0]!, name: NFD_HANSIK }],
    };
    expect(filterPlaces(decomposedName, { ...NO_FILTER, text: NFC_HANSIK })).toHaveLength(1);
  });
});

describe('filterByKind', () => {
  it('returns the dataset untouched when no kind is selected', () => {
    expect(filterByKind(SAMPLE_DATASET, ALL_KINDS)).toBe(SAMPLE_DATASET);
  });

  it('keeps only the places of the selected kind', () => {
    expect(filterByKind(SAMPLE_DATASET, 'cafe').places.map((place) => place.id)).toEqual([
      'restaurant_000002',
    ]);
  });

  it('keeps updatedAt, which anchors every period window', () => {
    // Recomputing the anchor from the subset would move the window boundaries the visit counts are
    // measured against, so a narrowed column would show different numbers for the same month.
    expect(filterByKind(SAMPLE_DATASET, 'cafe').updatedAt).toBe(SAMPLE_DATASET.updatedAt);
  });

  it('narrows what the other filters can see, rather than filtering beside them', () => {
    const cafes = filterByKind(SAMPLE_DATASET, 'cafe');

    expect(listCategories(cafes)).toEqual(['카페']);
    expect(filterPlaces(cafes, { ...NO_FILTER, category: '한식' })).toEqual([]);
  });

  it('is empty, not everything, for a kind no place carries', () => {
    expect(filterByKind(SAMPLE_DATASET, 'lunchbox').places).toEqual([]);
  });
});
