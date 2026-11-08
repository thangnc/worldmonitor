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
  /** Reported-violence shading steps 1–4. */
  violence: readonly [string, string, string, string];
  /** Context overlays: amber for disrupted lanes and new sanctions, red for incidents. */
  elev: string;
  crit: string;
}

// Mirrors src/lite/lite.css. Used only when the CSS variables are not
// readable (tests, or a style read before the stylesheet applies).
const FALLBACK_TOKENS: LiteMapTokens = {
  bg: '#0a0c0f',
  surface: '#111419',
  track: '#2e3540',
  dim: '#5f6874',
  violence: ['#1f3a5c', '#24508a', '#2f6fc4', '#5b9cf0'],
  elev: '#e8c547',
  crit: '#f2555a',
};

/** Reads the Lite `@theme` colors from CSS variables. */
export function readLiteMapTokens(root: Element = document.documentElement): LiteMapTokens {
  const css = getComputedStyle(root);
  const read = (name: string, fallback: string) => css.getPropertyValue(`--color-${name}`).trim() || fallback;
  const v = FALLBACK_TOKENS.violence;
  return {
    bg: read('bg', FALLBACK_TOKENS.bg),
    surface: read('surface', FALLBACK_TOKENS.surface),
    track: read('track', FALLBACK_TOKENS.track),
    dim: read('dim', FALLBACK_TOKENS.dim),
    elev: read('elev', FALLBACK_TOKENS.elev),
    crit: read('crit', FALLBACK_TOKENS.crit),
    violence: [read('violence-1', v[0]), read('violence-2', v[1]), read('violence-3', v[2]), read('violence-4', v[3])],
  };
}

/** The country polygons (`/data/countries.geojson`) shaded by a 0–4 `step` feature state. */
export const COUNTRY_FILL_SOURCE = 'lite-countries';
export const COUNTRY_FILL_LAYER = 'lite-country-fill';
/** The ISO 3166-1 alpha-2 property the polygons carry, promoted to the feature id. */
export const COUNTRY_CODE_PROPERTY = 'ISO3166-1-Alpha-2';

/**
 * The shading layer, drawn under the borders and labels. A data fill, so it
 * is a MapLibre layer (owner's decision, 2026-11-08); everything interactive
 * over the map stays a Preact element.
 */
export function countryFillLayer(tokens: LiteMapTokens = FALLBACK_TOKENS) {
  const [s1, s2, s3, s4] = tokens.violence;
  return {
    id: COUNTRY_FILL_LAYER,
    type: 'fill' as const,
    source: COUNTRY_FILL_SOURCE,
    paint: {
      'fill-color': ['match', ['coalesce', ['feature-state', 'step'], 0], 1, s1, 2, s2, 3, s3, 4, s4, 'rgba(0,0,0,0)'] as ExpressionSpecification,
      'fill-opacity': 0.85,
    },
  };
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
