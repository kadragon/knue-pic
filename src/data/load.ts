import { isIsoDate } from './iso-date';
import type { PlaceRecord, PlacesDataset, Transaction } from './types';

/**
 * Loads and validates `data/places.json`, the product's entire API.
 *
 * `src/data/` is the only module that knows the wire format, so the narrowing from `unknown` to
 * `PlacesDataset` happens here and nowhere else. Validation is not defensive decoration: the stats
 * layer throws on a malformed transaction date instead of dropping the row (see
 * `src/stats/place-stats.ts`), so a bad value that survives this module surfaces as an exception
 * mid-render. Everything below rejects the whole file rather than repairing or skipping a row —
 * a partially loaded dataset produces plausible, wrong counts, which is the one failure the UI
 * cannot show the user.
 *
 * The published file is served as a static asset from Vite's `publicDir`, which this repo points
 * at `data/` (see `vite.config.ts`), so the browser URL is `${BASE_URL}places.json`.
 */

const PLACES_FILE = 'places.json';

/** Every failure path — network, HTTP status, malformed JSON, schema violation. */
export class DatasetLoadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DatasetLoadError';
  }
}

/** Vite guarantees a trailing slash on `BASE_URL`, but a hand-passed base may not have one. */
export function placesUrl(baseUrl: string = import.meta.env.BASE_URL): string {
  return `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}${PLACES_FILE}`;
}

export interface LoadOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export async function loadPlacesDataset(options: LoadOptions = {}): Promise<PlacesDataset> {
  const { baseUrl, fetchImpl = fetch } = options;
  const url = placesUrl(baseUrl);

  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (cause) {
    throw new DatasetLoadError(`Could not reach ${url}`, { cause });
  }

  if (!response.ok) {
    throw new DatasetLoadError(`${url} responded ${response.status} ${response.statusText}`);
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (cause) {
    throw new DatasetLoadError(`${url} is not valid JSON`, { cause });
  }

  return parseDataset(raw);
}

export function parseDataset(raw: unknown): PlacesDataset {
  const root = asRecord(raw, 'root');

  const updatedAt = root['updatedAt'];
  if (!isIsoDate(updatedAt)) {
    throw new DatasetLoadError(`updatedAt is not a real calendar date: ${describe(updatedAt)}`);
  }

  const rawPlaces = root['places'];
  if (!Array.isArray(rawPlaces)) {
    throw new DatasetLoadError(`places must be an array, got ${describe(rawPlaces)}`);
  }

  const seenIds = new Set<string>();
  const places = rawPlaces.map((rawPlace, index) => {
    const place = parsePlace(rawPlace, `places[${index}]`);
    if (seenIds.has(place.id)) {
      throw new DatasetLoadError(`places[${index}].id is a duplicate: "${place.id}"`);
    }
    seenIds.add(place.id);
    return place;
  });

  return { updatedAt, places };
}

function parsePlace(raw: unknown, path: string): PlaceRecord {
  const place = asRecord(raw, path);

  const rawTransactions = place['transactions'];
  if (!Array.isArray(rawTransactions)) {
    throw new DatasetLoadError(
      `${path}.transactions must be an array, got ${describe(rawTransactions)}`,
    );
  }

  return {
    id: requireText(place['id'], `${path}.id`),
    name: requireText(place['name'], `${path}.name`),
    category: requireText(place['category'], `${path}.category`),
    address: requireText(place['address'], `${path}.address`),
    lat: requireCoordinate(place['lat'], `${path}.lat`, 90),
    lng: requireCoordinate(place['lng'], `${path}.lng`, 180),
    naverUrl: requireText(place['naverUrl'], `${path}.naverUrl`),
    transactions: rawTransactions.map((transaction, index) =>
      parseTransaction(transaction, `${path}.transactions[${index}]`),
    ),
  };
}

function parseTransaction(raw: unknown, path: string): Transaction {
  const transaction = asRecord(raw, path);

  const date = transaction['date'];
  if (!isIsoDate(date)) {
    throw new DatasetLoadError(`${path}.date is not a real calendar date: ${describe(date)}`);
  }

  const amount = transaction['amount'];
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
    throw new DatasetLoadError(`${path}.amount must be a number >= 0, got ${describe(amount)}`);
  }

  return { date, amount };
}

function asRecord(raw: unknown, path: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new DatasetLoadError(`${path} must be an object, got ${describe(raw)}`);
  }
  return raw as Record<string, unknown>;
}

function requireText(raw: unknown, path: string): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new DatasetLoadError(`${path} must be a non-empty string, got ${describe(raw)}`);
  }
  return raw;
}

function requireCoordinate(raw: unknown, path: string, limit: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < -limit || raw > limit) {
    throw new DatasetLoadError(
      `${path} must be a number between ${-limit} and ${limit}, got ${describe(raw)}`,
    );
  }
  return raw;
}

/** Short, quotable rendering of a rejected value — enough to find it in the JSON. */
function describe(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  if (value === undefined) return 'undefined';
  // JSON.stringify renders NaN and Infinity as `null`, which would name the wrong problem in a
  // message whose whole job is to point at the bad value.
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  return JSON.stringify(value) ?? String(value);
}
