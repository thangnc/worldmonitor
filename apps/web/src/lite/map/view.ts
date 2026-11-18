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

/** Aggregate diameter bounds in px, and the size from which the count is printed inside. */
export const AGGREGATE_MIN = 12;
export const AGGREGATE_MAX = 40;
export const AGGREGATE_LABEL_MIN = 22;

/**
 * Aggregate diameter: area ∝ count (square-root scale), reaching the 40 px
 * maximum at `fullAt`, never below 12 px.
 */
export function aggregateDiameter(count: number, fullAt: number): number {
  const d = AGGREGATE_MAX * Math.sqrt(Math.max(0, count) / Math.max(1, fullAt));
  return Math.round(Math.min(AGGREGATE_MAX, Math.max(AGGREGATE_MIN, d)));
}

/** `412`, `1.2k`, `15k`. */
export function compactCount(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k < 10 ? k.toFixed(1).replace(/\.0$/, '') : Math.round(k)}k`;
}

interface Point {
  x: number;
  y: number;
}
interface Size {
  w: number;
  h: number;
}

/**
 * Where a marker's detail card sits: off to the side away from the map's
 * centre, kept inside the map, with the point on the card nearest the marker
 * for the leader line.
 */
export function placeCard(marker: Point, card: Size, map: Size, gap = 28, margin = 12): { left: number; top: number; attach: Point } {
  const keepInside = (v: number, size: number, room: number) => Math.max(margin, Math.min(v, room - size - margin));
  const left = keepInside(marker.x < map.w / 2 ? marker.x + gap : marker.x - gap - card.w, card.w, map.w);
  const top = keepInside(marker.y < map.h / 2 ? marker.y + gap : marker.y - gap - card.h, card.h, map.h);
  const attach = {
    x: Math.min(Math.max(marker.x, left), left + card.w),
    y: Math.min(Math.max(marker.y, top), top + card.h),
  };
  return { left, top, attach };
}
