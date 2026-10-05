import { describe, expect, it } from 'vitest';
import { clusterPoints, worldPixel, type ClusterPoint } from './cluster';

/** Campus, so every figure below is the one the page map actually meets. */
const ORIGIN = { lat: 36.6084, lng: 127.3582 };

/** What the page map hands in — `CLUSTER_WIDTH` and `FIT_MAX_ZOOM` — restated so this suite pins them. */
const WIDTH = 40;
const HEIGHT = 24;
const OPTIONS = { width: WIDTH, height: HEIGHT, stopZoom: 16 };

/** `lng` shifted by `dx` screen pixels at `zoom` — the inverse of the x half of `worldPixel`. */
function eastBy(dx: number, zoom: number): number {
  return ORIGIN.lng + (dx * 360) / (256 * 2 ** zoom);
}

function point(id: string, lng: number, lat = ORIGIN.lat): ClusterPoint {
  return { id, lat, lng };
}

describe('worldPixel', () => {
  it('matches the live v3 projection: 0.01° of longitude is 58.254 px at zoom 13', () => {
    // Read off `map.getProjection().fromCoordToOffset` on the live bundle, localhost:5173,
    // 2026-10-05: (36.6084, 127.3582) → (36.6184, 127.3682) moved (58.254, -72.575) at zoom 13.
    const a = worldPixel(ORIGIN.lat, ORIGIN.lng, 13);
    const b = worldPixel(36.6184, 127.3682, 13);
    expect(b.x - a.x).toBeCloseTo(58.254, 2);
    expect(b.y - a.y).toBeCloseTo(-72.575, 2);
  });

  it('doubles per zoom level', () => {
    const a = worldPixel(ORIGIN.lat, ORIGIN.lng, 14);
    const b = worldPixel(36.6184, 127.3682, 14);
    expect(b.x - a.x).toBeCloseTo(2 * 58.254, 2);
  });
});

describe('clusterPoints', () => {
  it('groups points closer than the radius and leaves a far one on its own', () => {
    const result = clusterPoints(
      [point('a', ORIGIN.lng), point('b', eastBy(WIDTH - 1, 13)), point('c', eastBy(200, 13))],
      13,
      OPTIONS,
    );
    expect(result.clusters.map((cluster) => cluster.ids)).toEqual([['a', 'b']]);
    expect(result.singles).toEqual(['c']);
  });

  it('keeps two points one pixel past the radius apart', () => {
    const result = clusterPoints([point('a', ORIGIN.lng), point('b', eastBy(WIDTH + 1, 13))], 13, OPTIONS);
    expect(result.clusters).toEqual([]);
    expect(result.singles).toEqual(['a', 'b']);
  });

  it('splits at a closer zoom what it grouped further out', () => {
    const points = [point('a', ORIGIN.lng), point('b', eastBy(WIDTH - 1, 13))];
    expect(clusterPoints(points, 13, OPTIONS).clusters).toHaveLength(1);
    // One level in, the same pair is twice as far apart on screen.
    expect(clusterPoints(points, 14, OPTIONS).clusters).toHaveLength(0);
  });

  it('clusters nothing from the zoom a fit stops at, so a cluster click can always dissolve it', () => {
    const together = [point('a', ORIGIN.lng), point('b', ORIGIN.lng)];
    expect(clusterPoints(together, 15, OPTIONS).clusters).toHaveLength(1);
    expect(clusterPoints(together, 16, OPTIONS)).toEqual({ clusters: [], singles: ['a', 'b'] });
  });

  it('gives the same grouping whatever order the points arrive in', () => {
    const points = [
      point('a', ORIGIN.lng),
      point('b', eastBy(WIDTH - 2, 13)),
      point('c', eastBy(2 * WIDTH - 4, 13)),
    ];
    const forward = clusterPoints(points, 13, OPTIONS);
    const backward = clusterPoints([...points].reverse(), 13, OPTIONS);
    expect(backward).toEqual(forward);
  });

  it('stands a cluster on its seed, the first member in id order', () => {
    const [cluster] = clusterPoints(
      [point('b', 127.0002, 36.0002), point('a', 127.0, 36.0)],
      13,
      OPTIONS,
    ).clusters;
    expect(cluster).toEqual({ ids: ['a', 'b'], lat: 36.0, lng: 127.0 });
  });

  it('groups by the marker box: wide apart on x, close on y still groups until a width away', () => {
    const near = [point('a', ORIGIN.lng), point('b', eastBy(WIDTH - 1, 13))];
    expect(clusterPoints(near, 13, OPTIONS).clusters).toHaveLength(1);
    // Half a box down is still inside it; a full box down is not.
    const lower = (dy: number) => ORIGIN.lat - (dy * 360) / (256 * 2 ** 13) / Math.cos((ORIGIN.lat * Math.PI) / 180);
    expect(clusterPoints([point('a', ORIGIN.lng), point('b', ORIGIN.lng, lower(HEIGHT / 2))], 13, OPTIONS).clusters).toHaveLength(1);
    expect(clusterPoints([point('a', ORIGIN.lng), point('b', ORIGIN.lng, lower(HEIGHT + 1))], 13, OPTIONS).clusters).toHaveLength(0);
  });

  it('never stands two clusters close enough to overlap, on a dense random field', () => {
    // Deterministic pseudo-random field: 500 places in a ~18km × 17km box around campus.
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const field = Array.from({ length: 500 }, (_, index) =>
      point(`p${String(index).padStart(3, '0')}`, ORIGIN.lng + (random() - 0.5) * 0.2, ORIGIN.lat + (random() - 0.5) * 0.15),
    );
    const { clusters } = clusterPoints(field, 13, OPTIONS);
    expect(clusters.length).toBeGreaterThan(3);
    const at = clusters.map(({ lat, lng }) => worldPixel(lat, lng, 13));
    for (const [i, a] of at.entries()) {
      for (const b of at.slice(i + 1)) {
        expect(Math.abs(a.x - b.x) >= WIDTH || Math.abs(a.y - b.y) >= HEIGHT).toBe(true);
      }
    }
  });
});
