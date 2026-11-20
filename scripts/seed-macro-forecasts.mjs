#!/usr/bin/env node
// @ts-check
//
// Market-implied forecasts for US CPI and payrolls, the forecast the Lite
// "Macro prints" indicator compares a release with (#128; spec docs/
// engineering/architecture/lite.md, Early indicators › Catalogue).
//
// Source: Kalshi public market data (no key; the host seed-rate-odds and
// seed-prediction-markets read). Each release is an event with a ladder of
// binary markets "Above X": series KXCPI (headline CPI, month on month, %)
// and KXPAYROLLS (the nonfarm payrolls change, jobs). The ladder's prices are
// the probability the print lands above each strike; the forecast is the
// implied median, interpolated between the two rungs either side of 50%.
// Prints come in steps (CPI to 0.1 pt, payrolls to the thousand), so "above
// 0.3" means "0.4 or more": each strike is read as half a step above itself
// (a continuity correction; without it the CPI median ran 0.05 pt low against
// every settled release in the backtest).
// Headline PCE has no open Kalshi series (KXPCE is empty), so PCE keeps the
// prior-print rule.
//
// The markets close a minute before the release and then leave the open
// list, so the payload is a log: each run refreshes the open releases and
// keeps the last snapshot of a closed one for FORECASTS_KEEP_DAYS.

import { loadEnvFile, readCanonicalValue, runSeed } from './_seed-utils.mjs';
import { fetchKalshiMarketsBySeries } from './_prediction-upstream.mjs';
import { getOptionalUpstashCreds, upstashCommand } from './_upstash-rest.mjs';
import { isMainModule } from './lib/main-module.mjs';

export const CANONICAL_KEY = 'economic:macro-forecasts:v1';
export const ACTIVATION_KEY = 'seed-activated:economic:macro-forecasts';
export const KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2';
/**
 * Kalshi series → the economic calendar's event name, the factor to its unit
 * (% m/m, thousands of jobs) and the print's step in the strike's unit.
 */
export const SERIES = Object.freeze([
  { series: 'KXCPI', release: 'CPI', scale: 1, step: 0.1 },
  { series: 'KXPAYROLLS', release: 'Nonfarm Payrolls', scale: 1 / 1000, step: 1000 },
]);
/** A release needs this many priced rungs, and this many contracts traded across them, to count as a forecast. */
export const MIN_RUNGS = 4;
export const MIN_EVENT_VOLUME = 5000;
/** A bid-ask spread wider than this falls back to the last trade. */
export const MAX_SPREAD = 0.15;
export const FORECASTS_KEEP_DAYS = 45;
export const MACRO_FORECASTS_TTL_SECONDS = 72 * 3600; // an hourly cadence; the log outlives a long outage
export const MACRO_FORECASTS_MAX_STALE_MIN = 180;
const USER_AGENT = 'WorldMonitor macro-forecasts seeder (+https://worldmonitor.app)';
const DAY_MS = 24 * 3600 * 1000;

const unit = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
};

/** A rung's probability: the bid-ask midpoint when the spread is tight, else the last trade, else null. */
export function rungPrice(m) {
  const bid = unit(m?.yes_bid_dollars);
  const ask = unit(m?.yes_ask_dollars);
  if (bid !== null && ask !== null && ask >= bid && ask - bid <= MAX_SPREAD && ask > 0) return (bid + ask) / 2;
  const last = unit(m?.last_price_dollars);
  return last !== null && Number(m?.volume_fp) > 0 ? last : null;
}

/**
 * The implied median of one release's "Above X" ladder, in the strike's unit,
 * or null when fewer than MIN_RUNGS are priced or 50% lies outside the ladder.
 * Prices are forced non-increasing first (a thin rung can trade out of order).
 * `step` is the print's step: "above X" is read as "at least X + step / 2".
 */
export function impliedMedian(markets, step = 0) {
  const rungs = markets
    .filter((m) => m?.strike_type === 'greater' && Number.isFinite(Number(m.floor_strike)))
    .map((m) => ({ strike: Number(m.floor_strike), p: rungPrice(m) }))
    .filter((r) => r.p !== null)
    .sort((a, b) => a.strike - b.strike);
  if (rungs.length < MIN_RUNGS) return null;
  let floor = 1;
  for (const r of rungs) r.p = floor = Math.min(floor, /** @type {number} */ (r.p));
  for (let i = 0; i < rungs.length - 1; i++) {
    const a = rungs[i];
    const b = rungs[i + 1];
    if (/** @type {number} */ (a.p) >= 0.5 && /** @type {number} */ (b.p) < 0.5) {
      const share = (/** @type {number} */ (a.p) - 0.5) / (/** @type {number} */ (a.p) - /** @type {number} */ (b.p));
      return a.strike + share * (b.strike - a.strike) + step / 2;
    }
  }
  return null;
}

/** This run's forecasts: one per open, liquid release with a median inside its ladder. */
export function buildForecasts(markets, nowMs) {
  const byEvent = new Map();
  for (const m of markets) {
    if (typeof m?.event_ticker !== 'string') continue;
    const list = byEvent.get(m.event_ticker) ?? [];
    list.push(m);
    byEvent.set(m.event_ticker, list);
  }
  const out = [];
  for (const [event, list] of byEvent) {
    const def = SERIES.find((s) => event.startsWith(`${s.series}-`));
    if (!def) continue;
    const closeAt = Math.min(...list.map((m) => Date.parse(m.close_time ?? '')).filter(Number.isFinite));
    if (!Number.isFinite(closeAt) || closeAt <= nowMs) continue;
    const volume = Math.round(list.reduce((sum, m) => sum + (Number(m.volume_fp) || 0), 0));
    const median = impliedMedian(list, def.step);
    if (median === null || volume < MIN_EVENT_VOLUME) {
      console.log(`  ${event}: skipped (${median === null ? 'no median inside the ladder' : `volume ${volume} < ${MIN_EVENT_VOLUME}`})`);
      continue;
    }
    out.push({
      series: def.series, release: def.release, event,
      // The markets close a minute before the 08:30 New York release.
      releaseAt: closeAt + 60_000,
      median: Math.round(median * def.scale * 1000) / 1000,
      volume, at: nowMs,
      url: `https://kalshi.com/markets/${def.series.toLowerCase()}`,
    });
  }
  return out;
}

/** This run's snapshots over the previous log: an open release takes the newest, a closed one keeps its last. */
export function mergeForecasts(fresh, previous, nowMs) {
  const cutoff = nowMs - FORECASTS_KEEP_DAYS * DAY_MS;
  const byEvent = new Map();
  for (const f of [...(Array.isArray(previous) ? previous : []), ...fresh]) {
    if (!f || typeof f.event !== 'string' || !Number.isFinite(f.releaseAt) || !Number.isFinite(f.median) || f.releaseAt < cutoff) continue;
    byEvent.set(f.event, f);
  }
  return [...byEvent.values()].sort((a, b) => a.releaseAt - b.releaseAt || a.event.localeCompare(b.event));
}

// A failed read fails the run: starting fresh would drop the closed releases' last snapshots.
async function readPrevious() {
  if (!getOptionalUpstashCreds()) return null;
  return readCanonicalValue(CANONICAL_KEY, { strict: true });
}

/** runSeed fetch function. Fails when Kalshi fails or the log would be empty, so the last good payload stays. */
export async function fetchMacroForecasts({
  fetchImpl = (...args) => globalThis.fetch(...args),
  nowMs = Date.now(),
  loadPrevious = readPrevious,
} = {}) {
  const previous = await loadPrevious();
  const markets = await fetchKalshiMarketsBySeries(SERIES.map((s) => s.series), { fetchFn: fetchImpl, baseUrl: KALSHI_BASE, userAgent: USER_AGENT, maxRequests: 6 });
  // Kalshi answers an unknown series with an empty list, not an error. Each series lists
  // the next two releases, so none open means it was renamed or withdrawn: fail the run,
  // so health turns stale instead of the other series keeping an old snapshot live.
  const missing = SERIES.filter((s) => !markets.some((m) => typeof m?.event_ticker === 'string' && m.event_ticker.startsWith(`${s.series}-`)));
  if (missing.length) throw Object.assign(new Error(`Kalshi: no open markets for ${missing.map((s) => s.series).join(', ')}`), { nonRetryable: true });
  const fresh = buildForecasts(markets, nowMs);
  const forecasts = mergeForecasts(fresh, previous?.forecasts, nowMs);
  console.log(`  Kalshi ${SERIES.map((s) => s.series).join(', ')}: ${markets.length} markets, ${fresh.length} open forecasts (${fresh.map((f) => `${f.event} ${f.median}`).join(', ') || 'none'}); ${forecasts.length} in the log`);
  return { fetchedAt: nowMs, forecasts };
}

export function validateFn(data) {
  return Boolean(data && Number.isFinite(data.fetchedAt) && Array.isArray(data.forecasts) && data.forecasts.length > 0
    && data.forecasts.every((f) => typeof f?.release === 'string' && Number.isFinite(f?.releaseAt) && Number.isFinite(f?.median) && Number.isFinite(f?.at)));
}

export function declareRecords(data) {
  return Array.isArray(data?.forecasts) ? data.forecasts.length : 0;
}

export async function markMacroForecastsActivated() {
  try {
    const creds = getOptionalUpstashCreds();
    if (creds) await upstashCommand(creds, ['SET', ACTIVATION_KEY, '1']);
  } catch (error) {
    console.warn(`  WARN: activation marker write failed: ${error?.message || error}`);
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadEnvFile(import.meta.url);
  runSeed('economic', 'macro-forecasts', CANONICAL_KEY, () => fetchMacroForecasts(), {
    validateFn,
    declareRecords,
    ttlSeconds: MACRO_FORECASTS_TTL_SECONDS,
    maxStaleMin: MACRO_FORECASTS_MAX_STALE_MIN,
    schemaVersion: 1,
    sourceVersion: 'kalshi-kxcpi-kxpayrolls-v1',
    afterPublish: markMacroForecastsActivated,
  }).catch((err) => {
    console.error('FATAL:', err?.message || err);
    process.exit(1);
  });
}
