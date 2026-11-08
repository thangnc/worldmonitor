import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl';

/**
 * The Lite conflict map's MapLibre style: OpenFreeMap vector tiles (the
 * OpenMapTiles schema, the same host the dashboard falls back to in
 * src/config/basemap.ts), drawn with only land, water, country borders and
 * place names. Colors come from the Lite `@theme` tokens in lite.css, so the
 * map follows the same palette as the Tailwind UI around it.
 */
export const OPENFREEMAP_TILEJSON = 'https://tiles.openfreemap.org/planet';
export const OPENFREEMAP_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const LABEL_FONT = ['Noto Sans Regular'];
/** The credit OpenFreeMap and OpenStreetMap require, shown on the map. */
export const MAP_CREDITS = [
  { label: 'OpenFreeMap', href: 'https://openfreemap.org' },
  { label: '© OpenMapTiles', href: 'https://www.openmaptiles.org/' },
  { label: '© OpenStreetMap', href: 'https://www.openstreetmap.org/copyright' },
] as const;

export interface LiteMapTokens {
  bg: string;
  surface: string;
  track: string;
  dim: string;
  /** Context overlays: amber for disrupted lanes and new sanctions, red for incidents. */
  elev: string;
  crit: string;
  /** Technology overlays: DDoS target shading. */
  tech: string;
}

// Mirrors src/lite/lite.css. Used only when the CSS variables are not
// readable (tests, or a style read before the stylesheet applies).
const FALLBACK_TOKENS: LiteMapTokens = {
  bg: '#0a0c0f',
  surface: '#111419',
  track: '#2e3540',
  dim: '#5f6874',
  elev: '#e8c547',
  crit: '#f2555a',
  tech: '#b18cff',
};

/** Reads the Lite `@theme` colors from CSS variables. */
export function readLiteMapTokens(root: Element = document.documentElement): LiteMapTokens {
  const css = getComputedStyle(root);
  const read = (name: keyof LiteMapTokens) => css.getPropertyValue(`--color-${name}`).trim() || FALLBACK_TOKENS[name];
  return { bg: read('bg'), surface: read('surface'), track: read('track'), dim: read('dim'), elev: read('elev'), crit: read('crit'), tech: read('tech') };
}

export function buildLiteMapStyle(tokens: LiteMapTokens = FALLBACK_TOKENS): StyleSpecification {
  const name: ExpressionSpecification = ['coalesce', ['get', 'name:en'], ['get', 'name']];
  return {
    version: 8,
    glyphs: OPENFREEMAP_GLYPHS,
    sources: {
      openmaptiles: { type: 'vector', url: OPENFREEMAP_TILEJSON },
    },
    layers: [
      // OpenMapTiles has no land polygon: the background is the land.
      { id: 'land', type: 'background', paint: { 'background-color': tokens.surface } },
      { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: { 'fill-color': tokens.bg } },
      {
        id: 'country-border',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'boundary',
        filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1], ['!=', ['get', 'disputed'], 1]],
        paint: { 'line-color': tokens.track, 'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.5, 6, 1.2] },
      },
      {
        id: 'country-border-disputed',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'boundary',
        filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1], ['==', ['get', 'disputed'], 1]],
        paint: { 'line-color': tokens.track, 'line-width': 1, 'line-dasharray': [2, 2] },
      },
      {
        id: 'country-label',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        minzoom: 2,
        filter: ['==', ['get', 'class'], 'country'],
        layout: { 'text-field': name, 'text-font': LABEL_FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10, 6, 13], 'text-max-width': 8 },
        paint: { 'text-color': tokens.dim, 'text-halo-color': tokens.bg, 'text-halo-width': 1 },
      },
      {
        id: 'city-label',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        minzoom: 5,
        filter: ['==', ['get', 'class'], 'city'],
        layout: { 'text-field': name, 'text-font': LABEL_FONT, 'text-size': 11 },
        paint: { 'text-color': tokens.dim, 'text-halo-color': tokens.bg, 'text-halo-width': 1 },
      },
    ],
  };
}
