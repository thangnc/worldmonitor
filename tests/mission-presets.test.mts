import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import type { PanelConfig } from '../src/types/index.ts';
import {
  ALL_PANELS,
  DEFAULT_MAP_LAYERS,
  VARIANT_DEFAULTS,
  getEffectivePanelConfig,
} from '../src/config/panels.ts';
import {
  LAYER_REGISTRY,
  getAllowedLayerKeys,
  type MapVariant,
} from '../src/config/map-layer-definitions.ts';
import {
  MISSION_PRESET_DISMISSED_KEY,
  MISSION_PRESET_STORAGE_KEY,
  MISSION_PRESETS,
  applyMissionPresetToState,
  clearMissionPreset,
  dismissMissionPresetPrompt,
  filterMissionLayersForRenderer,
  getMissionPreset,
  getMissionPresetsForVariant,
  isMissionPresetAvailableForVariant,
  isMissionPresetPromptDismissed,
  loadStoredMissionPreset,
  onMissionPresetChange,
  resetMissionPresetState,
  saveMissionPreset,
} from '../src/services/mission-presets.ts';
import { MARKET_WATCHLIST_STORAGE_KEY } from '../src/services/market-watchlist.ts';

class MemoryStorage {
  private store = new Map<string, string>();
  throwOnGet = false;
  throwOnSet = false;
  throwOnRemove = false;

  getItem(key: string): string | null {
    if (this.throwOnGet) throw new Error('blocked');
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    if (this.throwOnSet) throw new Error('blocked');
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    if (this.throwOnRemove) throw new Error('blocked');
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

const VARIANTS: MapVariant[] = ['full', 'tech', 'finance', 'commodity', 'energy', 'happy'];

let originalLocalStorage: PropertyDescriptor | undefined;

function defineLocalStorage(value: unknown): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value,
  });
}

function makePanelSettings(variant: string): Record<string, PanelConfig> {
  const settings: Record<string, PanelConfig> = {};
  for (const key of Object.keys(ALL_PANELS)) {
    settings[key] = {
      ...getEffectivePanelConfig(key, variant),
      enabled: false,
    };
  }
  settings['runtime-config'] = { name: 'Desktop Configuration', enabled: true, priority: 2 };
  settings['cw-market-note'] = { name: 'Market Note', enabled: true, priority: 3 };
  settings['mcp-risk-feed'] = { name: 'Risk Feed', enabled: false, priority: 3 };
  return settings;
}

function enabledPanelKeys(settings: Record<string, PanelConfig>): string[] {
  return Object.entries(settings)
    .filter(([, config]) => config.enabled)
    .map(([key]) => key)
    .sort();
}

function enabledWorkspacePanelKeys(settings: Record<string, PanelConfig>): string[] {
  return enabledPanelKeys(settings).filter(
    (key) => key !== 'map' && key !== 'runtime-config' && !key.startsWith('cw-') && !key.startsWith('mcp-'),
  );
}

function defaultWorkspacePanelKeys(variant: string): string[] {
  const reset = resetMissionPresetState(makePanelSettings(variant), DEFAULT_MAP_LAYERS, variant);
  return enabledWorkspacePanelKeys(reset.panelSettings);
}

beforeEach(() => {
  originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  defineLocalStorage(new MemoryStorage());
});

afterEach(() => {
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  } else {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

describe('mission preset definitions', () => {
  it('defines the v1 role presets with stable ids', () => {
    assert.deepEqual(
      MISSION_PRESETS.map((preset) => preset.id),
      [
        'crisis-desk',
        'supply-chain-risk',
        'energy-security',
        'osint-newsroom',
        'macro-market-watch',
        'tech-ai-watch',
        'good-news-explorer',
        'nq-day-trader',
        'country-watcher',
        'lite-desk',
      ],
    );
  });

  it('uses approachable first-run labels for broad audience personas', () => {
    assert.equal(getMissionPreset('osint-newsroom')?.label, 'News Seeker');
    assert.equal(getMissionPreset('osint-newsroom')?.shortLabel, 'News');
    assert.equal(getMissionPreset('macro-market-watch')?.label, 'Stock Geek');
    assert.equal(getMissionPreset('macro-market-watch')?.shortLabel, 'Stocks');
    assert.equal(getMissionPreset('tech-ai-watch')?.label, 'Tech / AI Watcher');
    assert.equal(getMissionPreset('tech-ai-watch')?.shortLabel, 'Tech');
    assert.equal(getMissionPreset('good-news-explorer')?.label, 'Good News Explorer');
    assert.equal(getMissionPreset('good-news-explorer')?.shortLabel, 'Good');
  });

  it('uses known panel and layer keys without duplicate ids', () => {
    const ids = new Set<string>();
    for (const preset of MISSION_PRESETS) {
      assert.equal(ids.has(preset.id), false, `${preset.id} is duplicated`);
      ids.add(preset.id);
      assert.ok(preset.label.length > 0, `${preset.id} needs a label`);
      assert.ok(preset.description.length > 0, `${preset.id} needs a description`);
      assert.ok(preset.panels.includes('map'), `${preset.id} must include the map panel`);
      assert.ok(preset.panels.length > 3, `${preset.id} should enable a useful panel set`);
      assert.ok(preset.layers.length > 0, `${preset.id} should enable map layers`);
      assert.equal(new Set(preset.panels).size, preset.panels.length, `${preset.id} repeats panel ids`);
      assert.equal(new Set(preset.layers).size, preset.layers.length, `${preset.id} repeats layer ids`);

      for (const panelId of preset.panels) {
        assert.ok(ALL_PANELS[panelId], `${preset.id} references unknown panel ${panelId}`);
      }
      for (const layerId of preset.layers) {
        assert.ok(LAYER_REGISTRY[layerId], `${preset.id} references unknown layer ${String(layerId)}`);
      }
    }
  });

  it('returns null for unknown preset ids', () => {
    assert.equal(getMissionPreset('missing'), null);
    assert.equal(getMissionPreset(null), null);
  });
});

describe('applyMissionPresetToState', () => {
  it('applies a coherent full-variant preset while preserving dynamic panels', () => {
    const current = makePanelSettings('full');
    const applied = applyMissionPresetToState('crisis-desk', current, DEFAULT_MAP_LAYERS, 'full');

    assert.equal(applied.preset.id, 'crisis-desk');
    assert.equal(applied.panelSettings.map?.enabled, true);
    assert.equal(applied.panelSettings['live-news']?.enabled, true);
    assert.equal(applied.panelSettings['strategic-risk']?.enabled, true);
    assert.equal(applied.panelSettings.markets?.enabled, false);
    assert.equal(applied.panelSettings['cw-market-note']?.enabled, true);
    assert.equal(applied.panelSettings['mcp-risk-feed']?.enabled, false);
    assert.deepEqual(applied.panelOrder.slice(0, 5), [
      'live-news',
      'insights',
      'strategic-posture',
      'cii',
      'strategic-risk',
    ]);
    assert.equal(applied.mapLayers.conflicts, true);
    assert.equal(applied.mapLayers.ciiChoropleth, true);
  });

  it('lists NQ Day Trader only on finance and rejects it on other variants', () => {
    const financeIds = getMissionPresetsForVariant('finance').map((preset) => preset.id);
    assert.equal(financeIds.length, 9);
    assert.ok(financeIds.includes('nq-day-trader'));
    for (const variant of VARIANTS.filter((item) => item !== 'finance')) {
      const ids = getMissionPresetsForVariant(variant).map((preset) => preset.id);
      assert.equal(ids.length, 8, `${variant} should keep the eight shared missions`);
      assert.ok(!ids.includes('nq-day-trader'), `${variant} must not offer NQ Day Trader`);
    }

    const before = makePanelSettings('full');
    const snapshot = structuredClone(before);
    assert.throws(
      () => applyMissionPresetToState('nq-day-trader', before, DEFAULT_MAP_LAYERS, 'full'),
      /not available on this variant/,
    );
    assert.deepEqual(before, snapshot);
  });

  it('applies the NQ Day Trader workspace without touching the market watchlist', () => {
    const originalWatchlist = '["AAPL","MSFT","NVDA"]';
    localStorage.setItem(MARKET_WATCHLIST_STORAGE_KEY, originalWatchlist);

    const current = makePanelSettings('finance');
    const applied = applyMissionPresetToState('nq-day-trader', current, DEFAULT_MAP_LAYERS, 'finance');

    assert.equal(applied.preset.id, 'nq-day-trader');
    assert.equal(applied.preset.view, 'america');
    assert.equal(applied.preset.timeRange, '24h');
    assert.deepEqual(applied.panelOrder, [
      'nq-pulse',
      'nq-catalysts',
      'nq-news',
      'live-news',
      'heatmap',
      'economic',
      'fear-greed',
      'fsi',
      'yield-curve',
      'markets',
    ]);
    for (const key of applied.panelOrder) {
      assert.equal(applied.panelSettings[key]?.enabled, true, `${key} should be enabled`);
    }
    assert.equal(applied.mapLayers.stockExchanges, true);
    assert.equal(applied.mapLayers.financialCenters, true);
    assert.equal(applied.mapLayers.centralBanks, true);
    assert.equal(applied.mapLayers.economic, true);
    assert.equal(applied.mapLayers.outages, true);
    assert.equal(applied.mapLayers.conflicts, false);
    assert.equal(localStorage.getItem(MARKET_WATCHLIST_STORAGE_KEY), originalWatchlist);

    const reset = resetMissionPresetState(applied.panelSettings, DEFAULT_MAP_LAYERS, 'finance');
    assert.equal(reset.panelSettings['nq-pulse']?.enabled, false);
    assert.equal(reset.panelSettings['nq-catalysts']?.enabled, false);
    assert.equal(reset.panelSettings['nq-news']?.enabled, false);
    assert.equal(localStorage.getItem(MARKET_WATCHLIST_STORAGE_KEY), originalWatchlist);
  });

  it('filters enabled panels to the active variant instead of creating mini-variants', () => {
    for (const variant of VARIANTS) {
      const allowedPanels = new Set(VARIANT_DEFAULTS[variant] ?? []);
      for (const preset of MISSION_PRESETS) {
        if (!isMissionPresetAvailableForVariant(preset, variant)) continue;
        const applied = applyMissionPresetToState(
          preset.id,
          makePanelSettings(variant),
          DEFAULT_MAP_LAYERS,
          variant,
        );
        for (const panelId of enabledPanelKeys(applied.panelSettings)) {
          if (panelId === 'map' || panelId === 'runtime-config' || panelId.startsWith('cw-') || panelId.startsWith('mcp-')) {
            continue;
          }
          assert.ok(
            allowedPanels.has(panelId),
            `${preset.id} enabled ${panelId} outside ${variant} variant defaults`,
          );
        }
      }
    }
  });

  it('falls back to variant defaults when a preset has too few matching panels', () => {
    for (const preset of MISSION_PRESETS.filter((preset) => (
      preset.id !== 'good-news-explorer'
      && preset.id !== 'country-watcher'
      && isMissionPresetAvailableForVariant(preset, 'happy')
    ))) {
      const applied = applyMissionPresetToState(
        preset.id,
        makePanelSettings('happy'),
        DEFAULT_MAP_LAYERS,
        'happy',
      );
      assert.deepEqual(
        enabledWorkspacePanelKeys(applied.panelSettings),
        defaultWorkspacePanelKeys('happy'),
        `happy/${preset.id} should fall back to happy defaults`,
      );
    }

    const happyApplied = applyMissionPresetToState(
      'good-news-explorer',
      makePanelSettings('happy'),
      DEFAULT_MAP_LAYERS,
      'happy',
    );
    assert.deepEqual(happyApplied.panelOrder.slice(0, 4), [
      'positive-feed',
      'progress',
      'counters',
      'spotlight',
    ]);
    assert.equal(happyApplied.mapLayers.positiveEvents, true);
    assert.equal(happyApplied.mapLayers.speciesRecovery, true);

    const happyCountryWatcher = applyMissionPresetToState(
      'country-watcher',
      makePanelSettings('happy'),
      DEFAULT_MAP_LAYERS,
      'happy',
    );
    assert.deepEqual(happyCountryWatcher.panelOrder, [
      'positive-feed',
      'progress',
      'spotlight',
      'species',
      'renewable',
    ]);
    assert.notDeepEqual(
      enabledWorkspacePanelKeys(happyCountryWatcher.panelSettings),
      defaultWorkspacePanelKeys('happy'),
    );
    assert.equal(happyCountryWatcher.mapLayers.happiness, true);

    const techApplied = applyMissionPresetToState(
      'tech-ai-watch',
      makePanelSettings('tech'),
      DEFAULT_MAP_LAYERS,
      'tech',
    );
    assert.deepEqual(techApplied.panelOrder.slice(0, 5), [
      'live-news',
      'insights',
      'ai',
      'tech',
      'startups',
    ]);
    assert.equal(techApplied.mapLayers.datacenters, true);
    assert.equal(techApplied.mapLayers.startupHubs, true);

    for (const [variant, presetId] of [
      ['tech', 'energy-security'],
      ['commodity', 'osint-newsroom'],
      ['energy', 'osint-newsroom'],
    ] as const) {
      const applied = applyMissionPresetToState(
        presetId,
        makePanelSettings(variant),
        DEFAULT_MAP_LAYERS,
        variant,
      );
      assert.deepEqual(
        enabledWorkspacePanelKeys(applied.panelSettings),
        defaultWorkspacePanelKeys(variant),
        `${variant}/${presetId} should fall back to ${variant} defaults`,
      );
    }
  });

  it('never applies a preset as an empty or single-panel workspace across variants', () => {
    for (const variant of VARIANTS) {
      for (const preset of MISSION_PRESETS) {
        if (!isMissionPresetAvailableForVariant(preset, variant)) continue;
        const applied = applyMissionPresetToState(
          preset.id,
          makePanelSettings(variant),
          DEFAULT_MAP_LAYERS,
          variant,
        );
        assert.ok(
          enabledWorkspacePanelKeys(applied.panelSettings).length >= 2,
          `${variant}/${preset.id} should keep a useful workspace`,
        );
      }
    }
  });

  it('sanitizes preset layers through each variant allowlist', () => {
    for (const variant of VARIANTS) {
      const allowedLayers = getAllowedLayerKeys(variant);
      for (const preset of MISSION_PRESETS) {
        if (!isMissionPresetAvailableForVariant(preset, variant)) continue;
        const applied = applyMissionPresetToState(
          preset.id,
          makePanelSettings(variant),
          DEFAULT_MAP_LAYERS,
          variant,
        );
        for (const [layerId, enabled] of Object.entries(applied.mapLayers)) {
          if (!enabled) continue;
          assert.ok(
            allowedLayers.has(layerId as keyof typeof LAYER_REGISTRY),
            `${preset.id} enabled layer ${layerId} outside ${variant} allowlist`,
          );
        }
      }
    }
  });
});

describe('resetMissionPresetState', () => {
  it('restores active variant defaults and preserves dynamic panels', () => {
    const current = makePanelSettings('full');
    current['live-news']!.enabled = false;
    current.markets!.enabled = true;
    current['cw-market-note']!.enabled = true;

    const reset = resetMissionPresetState(current, DEFAULT_MAP_LAYERS, 'full');

    assert.deepEqual(reset.panelOrder, VARIANT_DEFAULTS.full.filter((key) => key !== 'map'));
    assert.equal(reset.panelSettings.map?.enabled, true);
    assert.equal(reset.panelSettings['live-news']?.enabled, getEffectivePanelConfig('live-news', 'full').enabled);
    assert.equal(reset.panelSettings['energy-risk-overview']?.enabled, false);
    assert.equal(reset.panelSettings['cw-market-note']?.enabled, true);
    assert.deepEqual(reset.mapLayers, DEFAULT_MAP_LAYERS);
  });
});

describe('mission preset renderer filtering', () => {
  it('removes DeckGL-only energy layers on the mobile/SVG fallback path', () => {
    const applied = applyMissionPresetToState(
      'energy-security',
      makePanelSettings('energy'),
      DEFAULT_MAP_LAYERS,
      'energy',
    );

    assert.equal(applied.mapLayers.storageFacilities, true);
    assert.equal(applied.mapLayers.fuelShortages, true);
    assert.equal(applied.mapLayers.liveTankers, true);

    const filtered = filterMissionLayersForRenderer(applied.mapLayers, 'svg', DEFAULT_MAP_LAYERS);

    assert.equal(filtered.storageFacilities, false);
    assert.equal(filtered.fuelShortages, false);
    assert.equal(filtered.liveTankers, false);
    assert.ok(Object.values(filtered).some(Boolean), 'renderer filtering should keep executable context layers');
  });

  it('also filters fallback layers when every preset layer is renderer-incompatible', () => {
    const presetLayers = { ...DEFAULT_MAP_LAYERS };
    for (const key of Object.keys(presetLayers) as Array<keyof typeof presetLayers>) {
      presetLayers[key] = false;
    }
    presetLayers.storageFacilities = true;

    const fallbackLayers = { ...DEFAULT_MAP_LAYERS, storageFacilities: true };
    const filtered = filterMissionLayersForRenderer(presetLayers, 'svg', fallbackLayers);

    assert.equal(filtered.storageFacilities, false);
    assert.ok(Object.values(filtered).some(Boolean), 'filtered fallback should keep executable default layers');
  });

  it('removes supply-chain resilienceScore on the mobile/SVG fallback path', () => {
    const applied = applyMissionPresetToState(
      'supply-chain-risk',
      makePanelSettings('full'),
      DEFAULT_MAP_LAYERS,
      'full',
    );

    assert.equal(applied.mapLayers.resilienceScore, true);

    const filtered = filterMissionLayersForRenderer(applied.mapLayers, 'svg', DEFAULT_MAP_LAYERS);

    assert.equal(filtered.resilienceScore, false);
    assert.equal(filtered.tradeRoutes, true);
    assert.ok(Object.values(filtered).some(Boolean), 'renderer filtering should keep executable supply-chain layers');
  });
});

describe('mission preset persistence', () => {
  it('saves, loads, clears, and dismisses mission state', () => {
    assert.equal(loadStoredMissionPreset(), null);
    assert.equal(isMissionPresetPromptDismissed(), false);

    saveMissionPreset('crisis-desk');

    assert.equal(localStorage.getItem(MISSION_PRESET_STORAGE_KEY), 'crisis-desk');
    assert.equal(localStorage.getItem(MISSION_PRESET_DISMISSED_KEY), '1');
    assert.equal(loadStoredMissionPreset()?.id, 'crisis-desk');
    assert.equal(isMissionPresetPromptDismissed(), true);

    clearMissionPreset();

    assert.equal(loadStoredMissionPreset(), null);
    assert.equal(localStorage.getItem(MISSION_PRESET_STORAGE_KEY), null);
    assert.equal(isMissionPresetPromptDismissed(), true);
  });

  it('treats unknown stored ids as absent', () => {
    localStorage.setItem(MISSION_PRESET_STORAGE_KEY, 'stale');

    assert.equal(loadStoredMissionPreset(), null);
  });

  it('ignores a stored NQ Day Trader preset on a non-finance variant', () => {
    localStorage.setItem(MISSION_PRESET_STORAGE_KEY, 'nq-day-trader');
    assert.equal(loadStoredMissionPreset('full'), null);
    assert.equal(loadStoredMissionPreset('finance')?.id, 'nq-day-trader');
  });

  it('does not throw when storage is unavailable', () => {
    defineLocalStorage({
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
      removeItem() { throw new Error('blocked'); },
    });

    assert.doesNotThrow(() => saveMissionPreset('crisis-desk'));
    assert.equal(loadStoredMissionPreset()?.id, 'crisis-desk');
    assert.doesNotThrow(() => clearMissionPreset());
    assert.doesNotThrow(() => dismissMissionPresetPrompt());
    assert.equal(loadStoredMissionPreset(), null);
    assert.equal(isMissionPresetPromptDismissed(), true);
  });

  it('publishes same-tab mission changes and isolates listener failures', () => {
    const seen: Array<string | null> = [];
    const stopThrowing = onMissionPresetChange(() => { throw new Error('consumer failed'); });
    const stop = onMissionPresetChange((preset) => seen.push(preset?.id ?? null));

    saveMissionPreset('crisis-desk');
    clearMissionPreset();

    assert.deepEqual(seen, ['crisis-desk', null]);
    stopThrowing();
    stop();
    saveMissionPreset('country-watcher');
    assert.deepEqual(seen, ['crisis-desk', null]);
  });
});

describe('country-watcher preset', () => {
  it('defines country-watcher with the verified panel keys and no variant gate', () => {
    const preset = MISSION_PRESETS.find((p) => p.id === 'country-watcher');
    assert.ok(preset, 'country-watcher preset missing');
    // KTD6: keys verified against the FULL catalog — displacement is the
    // UNHCR panel (there is no `unhcr` key) and there is no `world-news`.
    assert.deepEqual(preset!.panels, [
      'map', 'live-news', 'cii', 'strategic-risk', 'sanctions-pressure',
      'security-advisories', 'gdelt-intel', 'displacement',
      'population-exposure', 'economic',
    ]);
    for (const key of preset!.panels) {
      if (key === 'map') continue;
      assert.ok(key in ALL_PANELS, `country-watcher panel '${key}' not in ALL_PANELS`);
    }
    assert.equal(preset!.variants, undefined, 'country-watcher must be offered on every variant');
  });
});
