/**
 * Which neutral dots the page map draws as one marker at a given zoom — a pure function of
 * coordinates and zoom, so the grouping is testable without a map.
 *
 * Why it exists: at the zoom the page opens on, the places around campus sit on nearly one block and
 * their dots stack into a smear no reader can click apart (observed on the real map, PR #72 review,
 * 2026-10-03) — the condition the map-first spec had set for clustering. The rules are recorded in
 * `docs/design/map-first-layout.md` → Implementation Decision 3.
 *
 * What it groups by is screen distance and nothing else: no visit count, no rank, no category. A
 * cluster says "N places are here", never how often anyone went (Decision 1).
 */

export interface ClusterPoint {
  id: string;
  lat: number;
  lng: number;
}

export interface Cluster {
  /** Two or more, ascending. */
  ids: string[];
  /**
   * Where the cluster marker stands: its seed — the first member in id order. Not the members' mean:
   * seeds are what the grouping keeps a box apart, so only on its seed can no cluster cover another.
   */
  lat: number;
  lng: number;
}

/**
 * A marker that outranks every cluster in the stacking order — a numbered pin — as a box of screen
 * pixels centred on its coordinate. A cluster standing on it would have its count covered.
 */
export interface ClusterObstacle {
  lat: number;
  lng: number;
  width: number;
  height: number;
}

export interface Clustering {
  clusters: Cluster[];
  /** The ids drawn as themselves, ascending. */
  singles: string[];
}

/** The vendor's tile edge: the whole world is `TILE * 2^zoom` pixels wide. */
const TILE = 256;

/**
 * A coordinate's position on the whole-world pixel plane at `zoom` — Web Mercator.
 *
 * The live v3 bundle's default projection matched this to three decimals (localhost:5173,
 * 2026-10-05: `fromCoordToOffset` moved 58.254 px east for 0.01° of longitude at zoom 13, and
 * `fromCoordToPoint` put campus at (218.566, 99.991) on the zoom-0 plane). Computed here rather than
 * read off the map, because the plane — not the viewport — is what clustering needs: a pan moves
 * nothing on it, so only a zoom change can regroup.
 */
export function worldPixel(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const scale = TILE * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

/**
 * Greedy grouping: in id order, each point joins the first cluster whose seed is less than one
 * marker box away on both axes (`options.width` × `options.height`, screen pixels), or seeds a new
 * one. Every two seeds therefore sit at least a box apart on one axis, and a cluster drawn on its
 * seed cannot cover another's label. Id order rather than input order, so the same filtered set
 * groups the same way however the list happened to hand it over.
 *
 * No cluster seeds where its box would overlap one of `options.obstacles`: a point that sits too
 * close to a pin to seed waits until every seed is down, then joins the first cluster in reach or
 * stays a dot — under the pin, a dot hides nothing a reader needed, a count would. Two such points
 * never group with each other, so one block crowded around a pin draws as dots, not as a smear.
 *
 * From `options.stopZoom` in, nothing groups. The page map hands in the zoom its fits stop at, so a cluster
 * click — which fits the members — always lands on a zoom where the cluster is gone, even when its
 * members share one coordinate.
 */
export function clusterPoints(
  points: ClusterPoint[],
  zoom: number,
  options: { width: number; height: number; stopZoom: number; obstacles?: ClusterObstacle[] },
): Clustering {
  const { width, height, stopZoom, obstacles = [] } = options;
  const ordered = [...points].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (zoom >= stopZoom) return { clusters: [], singles: ordered.map((point) => point.id) };

  const blocked = obstacles.map((obstacle) => ({
    at: worldPixel(obstacle.lat, obstacle.lng, zoom),
    reachX: (width + obstacle.width) / 2,
    reachY: (height + obstacle.height) / 2,
  }));
  const canSeed = (at: { x: number; y: number }): boolean =>
    !blocked.some(
      (obstacle) =>
        Math.abs(obstacle.at.x - at.x) < obstacle.reachX && Math.abs(obstacle.at.y - at.y) < obstacle.reachY,
    );

  const groups: { seed: { x: number; y: number }; members: [ClusterPoint, ...ClusterPoint[]] }[] = [];
  const reach = (at: { x: number; y: number }) =>
    groups.find(({ seed }) => Math.abs(seed.x - at.x) < width && Math.abs(seed.y - at.y) < height);
  const waiting: { point: ClusterPoint; at: { x: number; y: number } }[] = [];
  for (const point of ordered) {
    const at = worldPixel(point.lat, point.lng, zoom);
    const group = reach(at);
    if (group) group.members.push(point);
    else if (canSeed(at)) groups.push({ seed: at, members: [point] });
    else waiting.push({ point, at });
  }

  const singles: string[] = [];
  for (const { point, at } of waiting) {
    const group = reach(at);
    if (group) group.members.push(point);
    else singles.push(point.id);
  }

  const clusters: Cluster[] = [];
  for (const { members } of groups) {
    const [seed] = members;
    if (members.length === 1) {
      singles.push(seed.id);
      continue;
    }
    const ids = members.map((member) => member.id).sort();
    clusters.push({ ids, lat: seed.lat, lng: seed.lng });
  }
  singles.sort();
  return { clusters, singles };
}
