/** Map views for the Lite conflict map: [[west, south], [east, north]]. */
export type Bounds = [[number, number], [number, number]];

/** The inhabited world, without the polar caps. */
export const WORLD_BOUNDS: Bounds = [[-170, -55], [180, 75]];

/** Bounds around the points, padded by 2°, and never narrower than 8°. */
export function markerBounds(points: ReadonlyArray<{ lat: number; lon: number }>): Bounds {
  if (!points.length) return WORLD_BOUNDS;
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const p of points) {
    w = Math.min(w, p.lon);
    e = Math.max(e, p.lon);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  const padLon = Math.max(2, (8 - (e - w)) / 2);
  const padLat = Math.max(2, (8 - (n - s)) / 2);
  return [
    [Math.max(-180, w - padLon), Math.max(-85, s - padLat)],
    [Math.min(180, e + padLon), Math.min(85, n + padLat)],
  ];
}
