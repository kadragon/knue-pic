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
    expect(fetchImpl).toHaveBeenCalledWith('/knue-pic/places.json');
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
