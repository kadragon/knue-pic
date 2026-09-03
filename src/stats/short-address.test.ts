import { describe, expect, it } from 'vitest';
import { addressRegion } from './short-address';

// `shortAddress` is covered in `src/ui/place-labels.test.ts`, beside the other display transforms
// it is re-exported with. `addressRegion` is not a display transform — it feeds the Naver Maps
// search query — so its cases live here, against the module that owns the address walk.
describe('address region', () => {
  it('pairs the city with the narrowest unit, dropping what is between them', () => {
    // Every address below is a real row of `data/places.json`.
    expect(addressRegion('충청북도 청주시 흥덕구 강내면 태성탑연로 390')).toBe('청주 강내면');
    expect(addressRegion('충청북도 청주시 흥덕구 가로수로1164번길 38')).toBe('청주 흥덕구');
    expect(addressRegion('충청북도 괴산군 괴산읍 임꺽정로 1')).toBe('괴산군 괴산읍');
  });

  it('keeps the city on a 광역시 district, which alone names five or six places', () => {
    // The narrowest unit alone shipped first and reproduced the bug this feature fixes: in 12 of
    // the 504 published rows it is a bare `서구`/`중구`/`동구`.
    expect(addressRegion('대전광역시 서구 둔산로 136')).toBe('대전 서구');
    expect(addressRegion('대전광역시 중구 사정공원로 70')).toBe('대전 중구');
    expect(addressRegion('서울특별시 중구 세종대로 136')).toBe('서울 중구');
  });

  it('says the city once when the address names no smaller unit', () => {
    expect(addressRegion('세종특별자치시 세종로 1219 세종중앙타워 2층')).toBe('세종');
  });

  it('tolerates the abbreviated province spelling', () => {
    expect(addressRegion('충북 청주시 흥덕구 강내면 태성탑연로 390')).toBe('청주 강내면');
  });

  it('returns null rather than a street fragment when no rule matches', () => {
    // `대전 중구 …` — a metropolitan city written without its 광역시 — matches nothing, and the
    // caller must fall back instead of prefixing a search with `대전`, which the walk never
    // confirmed was a city name (see the note on PROVINCE_ABBREVIATIONS).
    expect(addressRegion('대전 중구 사정공원로 70')).toBeNull();
    expect(addressRegion('가로수로1164번길 38')).toBeNull();
    expect(addressRegion('')).toBeNull();
  });
});
