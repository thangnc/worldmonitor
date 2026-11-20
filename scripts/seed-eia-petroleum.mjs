#!/usr/bin/env node
// @ts-check
//
// EIA weekly petroleum figures (API v2, key EIA_API_KEY): WTI and Brent spot,
// US crude production, and US commercial stocks of crude, gasoline and
// distillate. The stocks feed the Lite "US crude stocks" indicator (#139;
// spec docs/engineering/architecture/lite.md, Early indicators › Catalogue).

import { loadEnvFile, runSeed } from './_seed-utils.mjs';
import { isMainModule } from './lib/main-module.mjs';

export const CANONICAL_KEY = 'energy:eia-petroleum:v1';
const TTL_SECONDS = 7 * 86400; // 7d — covers one weekly EIA cycle + buffer
const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT = 'WorldMonitor eia-petroleum seeder (+https://worldmonitor.app)';

export const SERIES = /** @type {const} */ ({
  wti:        'PET.RWTC.W',    // WTI spot price, weekly
  brent:      'PET.RBRTE.W',   // Brent spot price, weekly
  production: 'PET.WCRFPUS2.W',// US crude oil production, weekly
  inventory:  'PET.WCESTUS1.W',// US commercial crude inventory, weekly
  gasoline:   'PET.WGTSTUS1.W',// US total motor gasoline stocks, weekly (#139)
  distillate: 'PET.WDISTUS1.W',// US distillate fuel oil stocks, weekly (#139)
});

/**
 * @typedef {{ current: number, previous: number | null, date: string, previousDate: string, unit: string }} SeriesPoint
 * @typedef {Partial<Record<keyof typeof SERIES, SeriesPoint>>} EiaPetroleum
 */

/**
 * Parse a single EIA `/v2/seriesid/:id?num=2` response into a SeriesPoint.
 * Returns null when the response has no usable current value.
 *
 * @param {unknown} payload
 * @returns {SeriesPoint | null}
 */
export function parseSeries(payload) {
  const values = /** @type {any} */ (payload)?.response?.data;
  if (!Array.isArray(values) || values.length === 0) return null;
  const current = Number(values[0]?.value);
  if (!Number.isFinite(current)) return null;
  const previousRaw = values[1]?.value;
  const previous = previousRaw == null ? null : (() => {
    const n = Number(previousRaw);
    return Number.isFinite(n) ? n : null;
  })();
  const sourceUnit = String(values[0]?.units ?? values[0]?.unit ?? '');
  const units = /** @type {Record<string, string>} */ ({ MBBL: 'thousand barrels', 'MBBL/D': 'thousand barrels per day', '$/BBL': 'USD per barrel' });
  return {
    current,
    previous,
    date: String(values[0]?.period ?? ''),
    // The week the previous figure is for, so a reader can tell a week-on-week change from a gap.
    previousDate: previous == null ? '' : String(values[1]?.period ?? ''),
    unit: units[sourceUnit] ?? sourceUnit,
  };
}

/**
 * @param {EiaPetroleum | null | undefined} agg
 * @returns {number}
 */
export function countSeries(agg) {
  if (!agg) return 0;
  return Object.keys(SERIES).filter((k) => /** @type {any} */ (agg)[k] != null).length;
}

/**
 * Accept when at least one of the four series returned a usable point.
 * Rejects only the fully-empty case (all 4 upstream calls failed).
 *
 * @param {EiaPetroleum | null | undefined} agg
 */
export function validatePetroleum(agg) {
  return countSeries(agg) >= 1;
}

/**
 * @param {string} key
 * @param {string} seriesId
 * @param {string} apiKey
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<SeriesPoint | null>}
 */
async function fetchOne(key, seriesId, apiKey, fetchImpl) {
  const url = `https://api.eia.gov/v2/seriesid/${seriesId}?api_key=${apiKey}&num=2`;
  try {
    const resp = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) {
      console.warn(`  [EIA] ${key} HTTP ${resp.status}`);
      return null;
    }
    const body = await resp.json();
    const parsed = parseSeries(body);
    if (!parsed) console.warn(`  [EIA] ${key} no usable values`);
    return parsed;
  } catch (err) {
    console.warn(`  [EIA] ${key} fetch error: ${(err instanceof Error ? err.message : String(err))}`);
    return null;
  }
}

/**
 * @param {{ fetchImpl?: typeof fetch, apiKey?: string }} [opts]
 * @returns {Promise<EiaPetroleum>}
 */
export async function fetchEiaPetroleum({ fetchImpl = (...args) => globalThis.fetch(...args), apiKey = process.env.EIA_API_KEY } = {}) {
  if (!apiKey) throw new Error('EIA_API_KEY not set');

  const entries = /** @type {[keyof typeof SERIES, string][]} */ (Object.entries(SERIES));
  const pairs = await Promise.all(
    entries.map(async ([key, id]) => /** @type {const} */ ([key, await fetchOne(key, id, apiKey, fetchImpl)])),
  );

  /** @type {EiaPetroleum} */
  const agg = {};
  for (const [key, value] of pairs) {
    if (value) agg[key] = value;
  }
  return agg;
}

/**
 * @param {EiaPetroleum} data
 */
export function declareRecords(data) {
  return countSeries(data);
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadEnvFile(import.meta.url);
  runSeed('energy', 'eia-petroleum', CANONICAL_KEY, fetchEiaPetroleum, {
    validateFn: validatePetroleum,
    ttlSeconds: TTL_SECONDS,
    sourceVersion: 'eia-petroleum-v1',
    recordCount: (data) => countSeries(data),
    declareRecords,
    schemaVersion: 1,
    maxStaleMin: 4320, // 72h — daily bundle; tolerates 3 missed ticks
  }).catch((err) => {
    const cause = err.cause ? ` (cause: ${err.cause.message || err.cause.code || err.cause})` : '';
    console.error('FATAL:', (err.message || err) + cause);
    process.exit(1);
  });
}
