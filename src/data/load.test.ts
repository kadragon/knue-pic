import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_DATASET } from './fixtures/sample-dataset';
import { DatasetLoadError, loadPlacesDataset, parseDataset, placesUrl } from './load';

/** A fresh, JSON-round-tripped copy so a mutation in one test cannot leak into another. */
function validPayload(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(SAMPLE_DATASET)) as Record<string, unknown>;
}

/** The first place in the copy, typed loosely so tests can corrupt one field at a time. */
function firstPlace(payload: Record<string, unknown>): Record<string, unknown> {
  return (payload['places'] as Record<string, unknown>[])[0]!;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('placesUrl', () => {
  it('appends the file to the Vite base path', () => {
    expect(placesUrl('/knue-pic/')).toBe('/knue-pic/places.json');
  });

  it('tolerates a base path with no trailing slash', () => {
    expect(placesUrl('/knue-pic')).toBe('/knue-pic/places.json');
  });

  it('defaults to the build-time base path', () => {
    expect(placesUrl()).toBe(`${import.meta.env.BASE_URL}places.json`);
  });
});

describe('parseDataset', () => {
  it('accepts the published shape and returns it unchanged', () => {
    expect(parseDataset(validPayload())).toEqual(SAMPLE_DATASET);
  });

  it.each([
    ['a null root', 'root', () => null],
    ['an array root', 'root', () => []],
    [
      'a missing places array',
      'places',
      () => {
        const payload = validPayload();
        delete payload['places'];
        return payload;
      },
    ],
    [
      'a non-array places',
      'places',
      () => {
        const payload = validPayload();
        payload['places'] = {};
        return payload;
      },
    ],
    [
      'an updatedAt that is not a real calendar day',
      'updatedAt',
      () => {
        const payload = validPayload();
        payload['updatedAt'] = '2026-02-30';
        return payload;
      },
    ],
  ])('rejects %s', (_case, expectedPath, build) => {
    expect(() => parseDataset(build())).toThrow(DatasetLoadError);
    expect(() => parseDataset(build())).toThrow(expectedPath);
  });

  it('rejects a transaction date that matches the pattern but never happened', () => {
    const payload = validPayload();
    (firstPlace(payload)['transactions'] as Record<string, unknown>[])[0]!['date'] = '2026-02-30';

    expect(() => parseDataset(payload)).toThrow(/places\[0\]\.transactions\[0\]\.date/);
  });

  it('rejects a negative amount', () => {
    const payload = validPayload();
    (firstPlace(payload)['transactions'] as Record<string, unknown>[])[0]!['amount'] = -1;

    expect(() => parseDataset(payload)).toThrow(/places\[0\]\.transactions\[0\]\.amount/);
  });

  it('rejects an out-of-range latitude', () => {
    const payload = validPayload();
    firstPlace(payload)['lat'] = 91;

    expect(() => parseDataset(payload)).toThrow(/places\[0\]\.lat/);
  });

  it('rejects an out-of-range longitude', () => {
    const payload = validPayload();
    firstPlace(payload)['lng'] = -181;

    expect(() => parseDataset(payload)).toThrow(/places\[0\]\.lng/);
  });

  it.each(['restaurants', '식당', 'RESTAURANT', '', 42, null])(
    'rejects the kind %p, which is not one the app knows',
    (kind) => {
      const payload = validPayload();
      firstPlace(payload)['kind'] = kind;

      // Every consumer switches on this value, so an unknown one belongs to no filter option and
      // makes its place unreachable through the control that exists to reach it.
      expect(() => parseDataset(payload)).toThrow(/places\[0\]\.kind/);
    },
  );

  it('rejects a place with no kind at all', () => {
    const payload = validPayload();
    delete firstPlace(payload)['kind'];

    expect(() => parseDataset(payload)).toThrow(/places\[0\]\.kind/);
  });

  it('keeps the kind it parsed', () => {
    expect(parseDataset(validPayload()).places[0]?.kind).toBe('restaurant');
  });

  it.each(['name', 'address', 'id', 'category', 'naverUrl'])('rejects an empty %s', (field) => {
    const payload = validPayload();
    firstPlace(payload)[field] = '   ';

    expect(() => parseDataset(payload)).toThrow(new RegExp(`places\\[0\\]\\.${field}`));
  });

  it('rejects a duplicate place id', () => {
    const payload = validPayload();
    const places = payload['places'] as Record<string, unknown>[];
    places[1]!['id'] = places[0]!['id'];

    expect(() => parseDataset(payload)).toThrow(/places\[1\]\.id is a duplicate/);
  });
});

describe('loadPlacesDataset', () => {
  it('fetches the dataset from the base path and returns the parsed result', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(validPayload()));

    await expect(loadPlacesDataset({ baseUrl: '/knue-pic/', fetchImpl })).resolves.toEqual(
      SAMPLE_DATASET,
    );
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/knue-pic/places.json');
  });

  it('reports an HTTP failure — the state before the collector publishes a file', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('', { status: 404, statusText: 'Not Found' }));

    await expect(loadPlacesDataset({ fetchImpl })).rejects.toThrow(DatasetLoadError);
  });

  it('reports a network failure', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));

    await expect(loadPlacesDataset({ fetchImpl })).rejects.toThrow(DatasetLoadError);
  });

  it('reports a body that is not JSON', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('<!doctype html>', { status: 200 }));

    await expect(loadPlacesDataset({ fetchImpl })).rejects.toThrow(/not valid JSON/);
  });

  it('gives up on a request that hangs instead of failing', async () => {
    // A stalled connection is the one failure with no natural end: without the timeout the page
    // would sit on the loading message forever, with no retry control to escape it.
    const fetchImpl = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );

    await expect(loadPlacesDataset({ fetchImpl, timeoutMs: 1 })).rejects.toThrow(
      /did not respond within 1ms/,
    );
  });

  it('reports a schema violation as a load failure, not a partial dataset', async () => {
    const payload = validPayload();
    firstPlace(payload)['lat'] = 'unknown';
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload));

    await expect(loadPlacesDataset({ fetchImpl })).rejects.toThrow(DatasetLoadError);
  });
});

describe('rejection messages', () => {
  it('names a non-finite amount as itself, not as null', () => {
    const payload = validPayload();
    (firstPlace(payload)['transactions'] as Record<string, unknown>[])[0]!['amount'] = Number.NaN;

    expect(() => parseDataset(payload)).toThrow(/got NaN/);
  });
});

describe('text normalisation', () => {
  it('stores trimmed text so padding cannot smuggle a duplicate id past the guard', () => {
    const payload = validPayload();
    const places = payload['places'] as Record<string, unknown>[];
    places[1]!['id'] = `${places[0]!['id'] as string} `;

    expect(() => parseDataset(payload)).toThrow(/places\[1\]\.id is a duplicate/);
  });

  it('trims surrounding whitespace off displayed fields', () => {
    const payload = validPayload();
    firstPlace(payload)['name'] = '  한밭식당  ';

    expect(parseDataset(payload).places[0]?.name).toBe('한밭식당');
  });
});

describe('naverUrl', () => {
  it.each([
    'https://map.naver.com/p/entry/place/1',
    'https://naver.me/xAbCdEf',
    'https://m.map.naver.com/p/entry/place/1',
    // Both parsers read host `naver.com` and the rest as path — kept so the gate and the
    // loader are pinned to the same answer on the backslash case in both directions.
    'https://naver.com\\@evil.com/x',
    'https://xn--h32b.naver.com/x',
  ])('accepts %s', (url) => {
    const payload = validPayload();
    firstPlace(payload)['naverUrl'] = url;

    expect(parseDataset(payload).places[0]?.naverUrl).toBe(url);
  });

  it.each([
    // The sink in `src/ui/place-detail.ts` already refuses this one; the loader must not be the
    // weaker of the two, since it is what the stats layer and every other reader trust.
    'javascript:alert(1)',
    'http://map.naver.com/p/entry/place/1',
    // A leading dot on the suffix test is the whole point: this host merely ends with `naver.com`.
    'https://evilnaver.com/p/entry/place/1',
    'https://example.com/p/entry/place/1',
    // WHATWG reads the backslash as an authority separator for a special scheme, so the host
    // here is `evil.com`. `collector/validate.py` normalises the same way; a parser that did
    // not would pass this at the gate and then blank the site here.
    'https://evil.com\\@naver.com/x',
  ])('rejects %s', (url) => {
    const payload = validPayload();
    firstPlace(payload)['naverUrl'] = url;

    expect(() => parseDataset(payload)).toThrow(DatasetLoadError);
    expect(() => parseDataset(payload)).toThrow(/places\[0\]\.naverUrl must be an https URL/);
  });

  it.each([
    '한밭식당',
    // `new URL` runs IDNA on the host and throws outright on a label that claims to be punycode
    // without being it, so this fails at the parse rather than at the host allowlist.
    // `collector/validate.py` decodes the host for the same reason — see its own regression case.
    'https://xn--a.naver.com/x',
  ])('rejects %s as unparseable', (url) => {
    const payload = validPayload();
    firstPlace(payload)['naverUrl'] = url;

    expect(() => parseDataset(payload)).toThrow(/places\[0\]\.naverUrl is not a valid URL/);
  });
});
