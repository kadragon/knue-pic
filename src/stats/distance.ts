import type { PlaceRecord } from '../data/types';

/**
 * Straight-line distance from the campus to a place.
 *
 * Lives in `src/stats/` for the same reason every other figure does: it is pure arithmetic over a
 * place record, with no DOM and no map. `src/map/` is not involved — the ranked list carries this
 * number for every row, and it must be there whether or not the Naver script ever loads.
 *
 * It is a *straight line*, not a route. The app knows a coordinate and nothing about roads, so a
 * travel distance or a walking time would be a claim the data does not support. The label said so
 * on screen — `교원대 직선 3.2km` — until the operator shortened it to `거리 3.2km` for the room it
 * buys at 360px, so this comment, not the label, is where the qualifier is written down.
 */

/**
 * The campus coordinate every distance is measured from.
 *
 * Supplied by the operator from the 한국교원대학교 pin on Naver Map (2026-09-02) and hard-coded
 * here rather than derived: the repo publishes no campus record, and
 * `.claude/skills/knue-expense-collect/scripts/geocode_candidates.py` carries only the
 * `36.6N 127.3E` bounding-box comment its selftest checks against. That box is 36.3–36.9 by
 * 127.0–127.6 — roughly 67km by 53km — so a coordinate taken from it could be wrong by more than
 * any figure on the list.
 */
export const CAMPUS_ORIGIN = { lat: 36.6084, lng: 127.3582 } as const;

/** IUGG mean Earth radius, in kilometres. */
const EARTH_RADIUS_KM = 6371.0088;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Haversine, not the equirectangular approximation.
 *
 * The dataset reaches 대전 and 세종 as well as 청주, and the cheap approximation's error grows with
 * distance — precisely where the reader is relying on the number to tell 20km from 25km. Haversine
 * costs two trig calls more and is exact on a sphere.
 */
export function haversineKm(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Takes the whole record rather than a coordinate pair, so a caller cannot swap lat and lng on the
 * way in — `src/data/types.ts` names the two fields and this is the only reading of them.
 */
export function distanceFromCampusKm(place: PlaceRecord): number {
  return haversineKm(CAMPUS_ORIGIN, place);
}

/**
 * The four distance bands the ranked list colours its distance labels by.
 *
 * Thresholds are in kilometres and each band opens at its predecessor's bound: a place exactly
 * 2.0km out is `close`, not `near`. Written as an ordered array rather than a chain of literals so
 * the boundaries live in exactly one place: `distanceBand` scans it in order, and appending or
 * moving a band needs no second edit anywhere else.
 *
 * 2 / 5 / 15 rather than round decades: the campus sits at the edge of 청주, so most of the dataset
 * falls between 1 and 10km and a 10km first cut would paint nearly the whole list one colour.
 */
export const DISTANCE_BANDS = [
  { band: 'near', maxKm: 2 },
  { band: 'close', maxKm: 5 },
  { band: 'mid', maxKm: 15 },
  { band: 'far', maxKm: Infinity },
] as const;

export type DistanceBand = (typeof DISTANCE_BANDS)[number]['band'];

/**
 * The catch-all for anything the ordered scan does not match — a `NaN` distance, or a future band
 * table whose last entry is bounded. Read off the last entry rather than written as a literal
 * index, so appending a band cannot orphan it the way a hard-coded `DISTANCE_BANDS[3]` did.
 */
const UNBOUNDED_BAND: DistanceBand = DISTANCE_BANDS[DISTANCE_BANDS.length - 1]?.band ?? 'far';

/**
 * The distance as the UI prints it — one decimal, the precision `campusDistanceLabel` uses.
 *
 * Banding reads this rather than the raw figure. A place 1.96km from the campus is labelled
 * `거리 2.0km`, and banding the raw value would give it the `near` fill while its own text reads
 * 2.0 — the badge contradicting the figure printed inside it. The two must round the same way or
 * one of them is lying; `place-labels.test.ts` → `distance band consistency` holds them together.
 */
function shownKm(km: number): number {
  return Number(km.toFixed(1));
}

/**
 * Which band a distance falls in.
 *
 * The band is a *scanning aid* layered on a figure that is already spelled out beside it. Nothing
 * downstream may state the band alone — `docs/conventions.md` → Accessibility bans colour as a
 * sole channel, and a band is a coarser claim than the number it summarises.
 */
export function distanceBand(km: number): DistanceBand {
  const shown = shownKm(km);
  return DISTANCE_BANDS.find((entry) => shown < entry.maxKm)?.band ?? UNBOUNDED_BAND;
}
