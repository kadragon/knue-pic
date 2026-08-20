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

/**
 * A request that hangs rather than failing — captive portal, stalled connection — would never
 * reject, so the page would sit on the loading message with no retry control and no way out short
 * of a reload. That is the one failure this slice exists to surface, so the fetch is timed out.
 */
const DEFAULT_TIMEOUT_MS = 10_000;

export interface LoadOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function loadPlacesDataset(options: LoadOptions = {}): Promise<PlacesDataset> {
  const { baseUrl, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const url = placesUrl(baseUrl);

  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === 'TimeoutError';
    throw new DatasetLoadError(
      timedOut ? `${url} did not respond within ${timeoutMs}ms` : `Could not reach ${url}`,
      { cause },
    );
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
    naverUrl: requireNaverUrl(place['naverUrl'], `${path}.naverUrl`),
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

/**
 * Returns the *trimmed* value, not the input. Storing the padded original would make
 * `"restaurant_000001 "` and `"restaurant_000001"` two distinct ids, so the duplicate-id guard
 * below would wave through a real duplicate — and the padding would reach the UI besides.
 */
function requireText(raw: unknown, path: string): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new DatasetLoadError(`${path} must be a non-empty string, got ${describe(raw)}`);
  }
  return raw.trim();
}

/**
 * `naverUrl` is the only dataset string that reaches an executable position in the app —
 * `src/ui/place-detail.ts` puts it in an `href`. That sink already refuses a non-`https:` value, but
 * this module's contract is to reject a bad value before it reaches `src/stats/`/`src/ui/` at all,
 * the way `lat`/`lng` are range-checked rather than merely non-empty.
 *
 * The host allowlist is deliberately narrower than the scheme check: the field names one thing, a
 * Naver place page, so anything else is a defect in the collector rather than a link worth showing.
 * The suffix test carries its leading dot on purpose — `evilnaver.com` ends with `naver.com`.
 */
const NAVER_HOSTS = ['naver.com', 'naver.me'];

function requireNaverUrl(raw: unknown, path: string): string {
  const text = requireText(raw, path);

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    // A value `new URL` cannot parse is not a URL, which is the same rejection as a wrong scheme.
    throw new DatasetLoadError(`${path} is not a valid URL: ${describe(text)}`);
  }

  const hostAllowed = NAVER_HOSTS.some(
    (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
  );
  if (url.protocol !== 'https:' || !hostAllowed) {
    throw new DatasetLoadError(
      `${path} must be an https URL on ${NAVER_HOSTS.join(' or ')}, got ${describe(text)}`,
    );
  }

  return text;
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
