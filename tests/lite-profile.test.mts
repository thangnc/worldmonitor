// World Monitor Lite deployment profile (docs/engineering/architecture/lite.md).
// node:test runs with VITE_LITE_PROFILE unset, so these checks cover two
// things: the flag-off build is exactly upstream `full`, and the pure builders
// produce a coherent Lite catalog from the real panel and layer registries.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { MapLayers, PanelConfig } from '../src/types/index.ts';
import {
  LITE_CROSS_VARIANT_PANELS,
  LITE_MAP_LAYERS,
  LITE_MOBILE_MAP_LAYERS,
  LITE_PANEL_ORDER,
  LITE_PROFILE_ENABLED,
  buildLiteMapLayers,
  buildLitePanelCatalog,
} from '../src/config/lite-profile.ts';
import {
  DEFAULT_MAP_LAYERS,
  FREE_MAX_PANELS,
  VARIANT_DEFAULTS,
  getEffectivePanelConfig,
  isPanelNativeToVariant,
} from '../src/config/panels.ts';
import { LAYER_REGISTRY, getAllowedLayerKeys } from '../src/config/map-layer-definitions.ts';
import {
  applyMissionPresetToState,
  getMissionPreset,
  getMissionPresetsForVariant,
  isMissionPresetAvailableForVariant,
} from '../src/services/mission-presets.ts';

const catalogFor = (variant: string): Record<string, PanelConfig> =>
  Object.fromEntries((VARIANT_DEFAULTS[variant] ?? []).map((key) => [key, getEffectivePanelConfig(key, variant)]));

// Mirrors src/config/panels.ts: full catalog plus tech, then finance, configs.
const fullPanels = catalogFor('full');
const crossVariantPanels = { ...catalogFor('tech'), ...catalogFor('finance') };
const liteCatalog = buildLitePanelCatalog(fullPanels, crossVariantPanels);

describe('lite profile flag', () => {
  it('is off unless VITE_LITE_PROFILE=true at build time', () => {
    assert.equal(LITE_PROFILE_ENABLED, false);
  });

  it('leaves the upstream full catalog untouched when off', () => {
    for (const id of LITE_CROSS_VARIANT_PANELS) {
      assert.equal(isPanelNativeToVariant(id, 'full'), false, `${id} must stay out of upstream full`);
    }
  });

  it('does not offer the Lite Desk preset when off', () => {
    const preset = getMissionPreset('lite-desk');
    assert.ok(preset, 'lite-desk stays in the catalog so analytics and attribution ids stay in sync');
    assert.equal(isMissionPresetAvailableForVariant(preset, 'full'), false);
    assert.ok(!getMissionPresetsForVariant('full').some((p) => p.id === 'lite-desk'));
    assert.throws(
      () => applyMissionPresetToState('lite-desk', fullPanels, DEFAULT_MAP_LAYERS, 'full'),
      /not available on this variant/,
    );
  });
});

describe('lite panel catalog', () => {
  it('has a config for every Lite panel, from full or a cross-variant catalog', () => {
    for (const id of LITE_PANEL_ORDER) {
      assert.ok(fullPanels[id] ?? crossVariantPanels[id], `${id} has no panel config`);
    }
  });

  it('lists exactly the Lite panels that full does not define as cross-variant', () => {
    const missingFromFull = LITE_PANEL_ORDER.filter((id) => !fullPanels[id]);
    assert.deepEqual([...missingFromFull].sort(), [...LITE_CROSS_VARIANT_PANELS].sort());
  });

  it('puts Lite panels first, enabled, in order', () => {
    const keys = Object.keys(liteCatalog);
    assert.deepEqual(keys.slice(0, LITE_PANEL_ORDER.length), [...LITE_PANEL_ORDER]);
    for (const id of LITE_PANEL_ORDER) assert.equal(liteCatalog[id]?.enabled, true, `${id} must be on`);
  });

  it('keeps every other full panel available but disabled', () => {
    const lite = new Set<string>(LITE_PANEL_ORDER);
    for (const id of Object.keys(fullPanels)) {
      assert.ok(liteCatalog[id], `${id} must stay addressable in Settings`);
      if (!lite.has(id)) assert.equal(liteCatalog[id]?.enabled, false, `${id} must be off under Lite`);
    }
  });

  it('never pulls in long-tail token panels', () => {
    for (const id of ['defi-tokens', 'ai-tokens', 'other-tokens']) assert.equal(id in liteCatalog, false, id);
  });

  it('fits within the free-tier panel cap', () => {
    assert.ok(LITE_PANEL_ORDER.length <= FREE_MAX_PANELS);
    assert.equal(new Set(LITE_PANEL_ORDER).size, LITE_PANEL_ORDER.length, 'Lite panel ids repeat');
  });

  it('carries every Lite Desk preset panel, so applying the preset drops none', () => {
    const preset = getMissionPreset('lite-desk');
    assert.ok(preset);
    for (const id of preset.panels) assert.ok(liteCatalog[id], `${id} would be dropped by the preset`);
  });
});

describe('lite map layers', () => {
  const allowedOnFull = getAllowedLayerKeys('full');

  it('uses only registered layers that full allows', () => {
    for (const key of [...LITE_MAP_LAYERS, ...LITE_MOBILE_MAP_LAYERS]) {
      assert.ok(LAYER_REGISTRY[key], `${key} is not a registered layer`);
      assert.ok(allowedOnFull.has(key), `${key} would be stripped on full`);
    }
  });

  it('turns on exactly the Lite layers', () => {
    const layers = buildLiteMapLayers(DEFAULT_MAP_LAYERS, LITE_MAP_LAYERS);
    const on = (Object.keys(layers) as Array<keyof MapLayers>).filter((key) => layers[key]);
    assert.deepEqual(on.sort(), [...LITE_MAP_LAYERS].sort());
    assert.deepEqual(Object.keys(layers).sort(), Object.keys(DEFAULT_MAP_LAYERS).sort());
  });
});
