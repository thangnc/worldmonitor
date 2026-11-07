import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { geoEquirectangular, geoPath } from 'd3';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Tone } from '../data/transforms';

/**
 * A dot-matrix world drawn from the repo's own land shapes
 * (public/data/countries-110m.json): land is rasterized once on an offscreen
 * canvas, then sampled on a grid into SVG dots. Markers use the same
 * projection, so a lat/lon lands where it should.
 */
export const MAP_W = 600;
export const MAP_H = 250;
const LON_MIN = -125;
const LON_MAX = 175;
const LAT_MAX = 75;
const LAT_MIN = -50;
const STEP = 6; // view units between dots

export function project(lat: number, lon: number): [number, number] {
  return [((lon - LON_MIN) / (LON_MAX - LON_MIN)) * MAP_W, ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * MAP_H];
}

let dotsPromise: Promise<Array<[number, number]>> | null = null;

function loadLandDots(): Promise<Array<[number, number]>> {
  dotsPromise ??= (async () => {
    const resp = await fetch('/data/countries-110m.json');
    if (!resp.ok) throw new Error(`land shapes: HTTP ${resp.status}`);
    const topo = (await resp.json()) as Topology<{ land: GeometryCollection }>;
    const land = feature(topo, topo.objects.land);
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = MAP_W * scale;
    canvas.height = MAP_H * scale;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [];
    // Same equirectangular frame as project(), in canvas pixels.
    const kx = (MAP_W * scale) / (LON_MAX - LON_MIN);
    const projection = geoEquirectangular()
      .scale((kx * 180) / Math.PI)
      .translate([(-LON_MIN) * kx, LAT_MAX * kx])
      .precision(0.5);
    const yScale = ((MAP_H * scale) / (LAT_MAX - LAT_MIN)) / kx;
    ctx.setTransform(1, 0, 0, yScale, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    geoPath(projection, ctx)(land);
    ctx.fill();
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const dots: Array<[number, number]> = [];
    for (let y = STEP / 2; y < MAP_H; y += STEP) {
      for (let x = STEP / 2; x < MAP_W; x += STEP) {
        const px = Math.floor(x * scale);
        const py = Math.floor(y * scale);
        if ((pixels[(py * canvas.width + px) * 4 + 3] ?? 0) > 100) dots.push([x, y]);
      }
    }
    return dots;
  })();
  return dotsPromise;
}

const TONE_FILL: Record<Tone, string> = {
  crit: 'var(--color-crit)', high: 'var(--color-high)', elev: 'var(--color-elev)', ok: 'var(--color-ok)', muted: 'var(--color-muted)', dim: 'var(--color-dim)',
};

export interface MapMarker {
  id: string;
  lat: number;
  lon: number;
  tone: Tone;
  /** Halo radius in view units. */
  radius: number;
  title: string;
}

export function DotMap({
  markers, zoom = 1, children,
}: { markers: readonly MapMarker[]; zoom?: number; children?: ComponentChildren }) {
  const [dots, setDots] = useState<Array<[number, number]>>([]);
  useEffect(() => {
    let live = true;
    loadLandDots().then((d) => live && setDots(d)).catch(() => live && setDots([]));
    return () => {
      live = false;
    };
  }, []);

  // Zoom around the centre of mass of the markers, or the map centre.
  const cx = markers.length ? markers.reduce((s, m) => s + project(m.lat, m.lon)[0], 0) / markers.length : MAP_W / 2;
  const cy = markers.length ? markers.reduce((s, m) => s + project(m.lat, m.lon)[1], 0) / markers.length : MAP_H / 2;
  const w = MAP_W / zoom;
  const h = MAP_H / zoom;
  const vx = Math.min(Math.max(cx - w / 2, 0), MAP_W - w);
  const vy = Math.min(Math.max(cy - h / 2, 0), MAP_H - h);

  return (
    <svg
      viewBox={`${vx} ${vy} ${w} ${h}`}
      preserveAspectRatio="xMidYMid slice"
      class="absolute inset-0 h-full w-full"
      role="img"
      aria-label="Conflict map"
    >
      <g fill="var(--color-track)">
        {dots.map(([x, y]) => (
          <circle key={`${x},${y}`} cx={x} cy={y} r={1.1} />
        ))}
      </g>
      {markers.map((m) => {
        const [x, y] = project(m.lat, m.lon);
        const fill = TONE_FILL[m.tone];
        return (
          <g key={m.id} data-marker={m.id}>
            <title>{m.title}</title>
            <circle cx={x} cy={y} r={m.radius} fill={fill} fill-opacity={0.2} stroke={fill} stroke-opacity={0.55} stroke-width={0.6} />
            <circle cx={x} cy={y} r={2.6} fill={fill} />
          </g>
        );
      })}
      {children}
    </svg>
  );
}
