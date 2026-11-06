import type { MapLayers, PanelConfig } from '@/types';

/**
 * World Monitor Lite deployment profile (docs/architecture/lite.md).
 *
 * The owner's private build of the `full` variant, focused on geopolitics and
 * conflicts, finance and crypto, and technology and AI. It is switched on by
 * `VITE_LITE_PROFILE=true` at build time. When the flag is off, nothing in this
 * module changes behavior: `full` keeps its upstream panels, layers and presets.
 */
// Guarded like IRAN_ATTACKS_ENABLED in panels.ts: node:test has no `window`
// and no import.meta.env, so the flag resolves off there. No optional chaining
// on import.meta.env: Vite must inline this single key, not the env object.
export const LITE_PROFILE_ENABLED: boolean =
  typeof window !== 'undefined' && import.meta.env.VITE_LITE_PROFILE === 'true';

/** Panels enabled by default under the profile, in grid order. */
export const LITE_PANEL_ORDER = [
  'map',
  'insights',
  // Geopolitics and conflicts
  'strategic-posture',
  'cii',
  'strategic-risk',
  'escalation-correlation',
  'threat-timeline',
  'ucdp-events',
  'cross-source-signals',
  // Finance and crypto
  'markets',
  'crypto',
  'crypto-news',
  'stablecoins',
  'etf-flows',
  'macro-signals',
  'fear-greed',
  'economic-calendar',
  'centralbanks',
  // Technology and AI
  'ai',
  'tech',
  'policy',
  'ai-regulation',
  'hardware',
  'tech-readiness',
  'monitors',
] as const;

/**
 * Lite panels that `full` does not define. Their configs come from the
 * `finance` and `tech` catalogs, and their news is read from those editions'
 * digests (`crossEditionCategoryItems` in src/app/data-loader.ts). They must be
 * in the `full` catalog, or mission presets and panel enablement drop them.
 */
export const LITE_CROSS_VARIANT_PANELS = [
  'crypto-news',
  'centralbanks',
  'policy',
  'ai-regulation',
  'hardware',
] as const;

/** Desktop map layers on by default under the profile. All are allowed on `full`. */
export const LITE_MAP_LAYERS = [
  'conflicts',
  'hotspots',
  'military',
  'ciiChoropleth',
  'sanctions',
  'ucdpEvents',
  'datacenters',
] as const satisfies ReadonlyArray<keyof MapLayers>;

/** Mobile map layers on by default under the profile. */
export const LITE_MOBILE_MAP_LAYERS = [
  'conflicts',
  'hotspots',
] as const satisfies ReadonlyArray<keyof MapLayers>;

/**
 * The `full` panel catalog under the profile: Lite panels first, enabled, in
 * `LITE_PANEL_ORDER`; every other `full` panel after them, disabled but still
 * available in Settings. A Lite id with no config in either source is skipped
 * (tests/lite-profile.test.mts guards against that).
 */
export function buildLitePanelCatalog(
  fullPanels: Readonly<Record<string, PanelConfig>>,
  crossVariantPanels: Readonly<Record<string, PanelConfig>>,
): Record<string, PanelConfig> {
  const catalog: Record<string, PanelConfig> = {};
  for (const id of LITE_PANEL_ORDER) {
    const base = fullPanels[id] ?? crossVariantPanels[id];
    if (base) catalog[id] = { ...base, enabled: true };
  }
  for (const [id, config] of Object.entries(fullPanels)) {
    if (!(id in catalog)) catalog[id] = { ...config, enabled: false };
  }
  return catalog;
}

/** Turn every layer off, then turn on exactly `enabled`. */
export function buildLiteMapLayers(
  defaults: Readonly<MapLayers>,
  enabled: ReadonlyArray<keyof MapLayers>,
): MapLayers {
  const layers = { ...defaults };
  for (const key of Object.keys(layers) as Array<keyof MapLayers>) layers[key] = false;
  for (const key of enabled) layers[key] = true;
  return layers;
}
