#!/usr/bin/env node
// @ts-check
//
// Fed rate-decision odds for the Lite "Fed decision odds" indicator (#125; spec
// docs/engineering/architecture/lite.md, Early indicators › Catalogue): a free
// stand-in for CME FedWatch from one venue.
//
// Sources:
// - Kalshi public market data, series KXFED (no key; the same host
//   seed-prediction-markets reads; Kalshi's API terms are under review in the
//   source manifest). Each meeting is an event with a ladder of binary markets,
//   "Above X%" on the upper bound of the target range after the meeting. The
//   ladder gives the probability of each outcome, now (last trade) and a day
//   earlier (Kalshi's previous price), so a one-day shift needs no history.
// - FRED DFEDTARU, the current upper bound (FRED_API_KEY), to tell a hold from
//   a move. Without it the payload carries the last known value, or none, and
//   only the most-likely-outcome rule can fire.

import { fredFetchJson, loadEnvFile, readCanonicalValue, resolveProxyForConnect, runSeed } from './_seed-utils.mjs';
import { fetchKalshiMarketsBySeries } from './_prediction-upstream.mjs';
import { getOptionalUpstashCreds, upstashCommand } from './_upstash-rest.mjs';
import { isMainModule } from './lib/main-module.mjs';

export const CANONICAL_KEY = 'economic:rate-odds:v1';
export const ACTIVATION_KEY = 'seed-activated:economic:rate-odds';
export const KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2';
export const SERIES = 'KXFED';
export const MEETINGS_KEPT = 3;
/** A meeting needs this many ladder rungs to give a distribution. */
export const MIN_RUNGS = 3;
export const RATE_ODDS_TTL_SECONDS = 12 * 3600; // an hourly cadence
export const RATE_ODDS_MAX_STALE_MIN = 180;
/** DFEDTARU is daily; a target older than this (FRED down, the last value carried) reads as stale content. */
export const TARGET_MAX_AGE_MIN = 5 * 24 * 60;
const USER_AGENT = 'WorldMonitor rate-odds seeder (+https://worldmonitor.app)';
const FRED_TARGET_URL = 'https://api.stlouisfed.org/fred/series/observations';

const price = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
};
const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * One meeting's outcome distribution from its "Above X%" ladder. The
 * cumulative prices are forced non-increasing (a thin rung can trade out of
 * order), then each bucket is the drop between rungs: the outcome whose upper
 * bound is the next rung's strike. Rungs without a price on one side are
 * dropped from both sides, so the two distributions compare like for like.
 * @param {Array<{ floor_strike?: unknown, strike_type?: string, last_price_dollars?: unknown, previous_price_dollars?: unknown }>} markets
 */
export function meetingDistribution(markets) {
  const rungs = markets
    .filter((m) => m?.strike_type === 'greater' && Number.isFinite(Number(m.floor_strike)))
    .map((m) => ({ strike: Number(m.floor_strike), now: price(m.last_price_dollars), prev: price(m.previous_price_dollars) }))
    .filter((r) => r.now !== null && r.prev !== null)
    .sort((a, b) => a.strike - b.strike);
  if (rungs.length < MIN_RUNGS) return null;
  const cum = (key) => {
    let floor = 1;
    return rungs.map((r) => (floor = Math.min(floor, /** @type {number} */ (r[key]))));
  };
  const now = cum('now');
  const prev = cum('prev');
  const buckets = [];
  // At or below the lowest rung, then each step, then above the highest rung.
  buckets.push({ upper: rungs[0].strike, below: true, p: 1 - now[0], pPrev: 1 - prev[0] });
  for (let i = 0; i < rungs.length - 1; i++) {
    buckets.push({ upper: rungs[i + 1].strike, p: now[i] - now[i + 1], pPrev: prev[i] - prev[i + 1] });
  }
  const last = rungs.length - 1;
  buckets.push({ upper: null, above: rungs[last].strike, p: now[last], pPrev: prev[last] });
  return buckets.map((b) => ({ ...b, p: round3(b.p), pPrev: round3(b.pPrev) }));
}

/** Meetings in the series, soonest first, with their distributions. */
export function buildMeetings(markets, nowMs) {
  const byEvent = new Map();
  for (const m of markets) {
    if (typeof m?.event_ticker !== 'string') continue;
    const list = byEvent.get(m.event_ticker) ?? [];
    list.push(m);
    byEvent.set(m.event_ticker, list);
  }
  const meetings = [];
  for (const [event, list] of byEvent) {
    const closeAt = Math.min(...list.map((m) => Date.parse(m.close_time ?? '')).filter(Number.isFinite));
    if (!Number.isFinite(closeAt) || closeAt <= nowMs) continue;
    const buckets = meetingDistribution(list);
    if (!buckets) continue;
    const volume = list.reduce((sum, m) => sum + (Number(m.volume_fp) || 0), 0);
    meetings.push({ event, decisionAt: closeAt, volume: Math.round(volume), url: `https://kalshi.com/markets/${SERIES.toLowerCase()}`, buckets });
  }
  return meetings.sort((a, b) => a.decisionAt - b.decisionAt).slice(0, MEETINGS_KEPT);
}

/** The latest DFEDTARU observation, or null when FRED is unavailable. */
export async function fetchTargetUpper({ fredFetch = fredFetchJson, apiKey = process.env.FRED_API_KEY } = {}) {
  if (!apiKey) {
    console.warn('  FRED_API_KEY missing: keeping the last known target');
    return null;
  }
  const params = new URLSearchParams({ series_id: 'DFEDTARU', api_key: apiKey, file_type: 'json', sort_order: 'desc', limit: '10' });
  try {
    const body = await fredFetch(`${FRED_TARGET_URL}?${params}`, resolveProxyForConnect());
    const obs = (body?.observations ?? []).find((o) => Number.isFinite(Number(o?.value)) && /^\d{4}-\d{2}-\d{2}$/.test(o?.date ?? ''));
    return obs ? { value: Number(obs.value), date: obs.date } : null;
  } catch (err) {
    console.warn(`  FRED DFEDTARU: ${err?.message || err}`);
    return null;
  }
}

async function readPrevious() {
  try {
    if (!getOptionalUpstashCreds()) return null;
    // readCanonicalValue decodes the stored codec and unwraps the contract envelope.
    return await readCanonicalValue(CANONICAL_KEY);
  } catch {
    return null;
  }
}

/** runSeed fetch function. Fails when Kalshi gives no usable meeting, so the last good payload stays. */
export async function fetchRateOdds({
  fetchImpl = (...args) => globalThis.fetch(...args),
  nowMs = Date.now(),
  loadTarget = () => fetchTargetUpper(),
  loadPrevious = readPrevious,
} = {}) {
  const markets = await fetchKalshiMarketsBySeries([SERIES], { fetchFn: fetchImpl, baseUrl: KALSHI_BASE, userAgent: USER_AGENT, maxRequests: 5 });
  const meetings = buildMeetings(markets, nowMs);
  if (!meetings.length) throw new Error(`Kalshi ${SERIES}: no open meeting with a ${MIN_RUNGS}-rung ladder (${markets.length} markets)`);
  // A failed FRED read keeps the last known target rather than dropping the move rule.
  const target = (await loadTarget()) ?? (await loadPrevious())?.target ?? null;
  const next = meetings[0];
  console.log(`  Kalshi ${SERIES}: ${markets.length} markets, ${meetings.length} meetings; next ${new Date(next.decisionAt).toISOString().slice(0, 10)} (${next.buckets.length} outcomes); target upper ${target ? `${target.value}% (${target.date})` : 'unknown'}`);
  return { fetchedAt: nowMs, series: SERIES, target, meetings };
}

/** Content age is the FRED target's date: a target carried for days may predate a Fed move. */
export function contentMeta(data) {
  const at = Date.parse(`${data?.target?.date ?? ''}T00:00:00Z`);
  return Number.isFinite(at) ? { newestItemAt: at, oldestItemAt: at } : null;
}

export function validateFn(data) {
  return Boolean(data && Number.isFinite(data.fetchedAt) && Array.isArray(data.meetings) && data.meetings.length > 0
    && data.meetings.every((m) => Number.isFinite(m?.decisionAt) && Array.isArray(m?.buckets) && m.buckets.length >= MIN_RUNGS
      && Math.abs(m.buckets.reduce((s, b) => s + b.p, 0) - 1) < 0.01));
}

export function declareRecords(data) {
  return Array.isArray(data?.meetings) ? data.meetings.length : 0;
}

export async function markRateOddsActivated() {
  try {
    const creds = getOptionalUpstashCreds();
    if (creds) await upstashCommand(creds, ['SET', ACTIVATION_KEY, '1']);
  } catch (error) {
    console.warn(`  WARN: activation marker write failed: ${error?.message || error}`);
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadEnvFile(import.meta.url);
  runSeed('economic', 'rate-odds', CANONICAL_KEY, () => fetchRateOdds(), {
    validateFn,
    declareRecords,
    ttlSeconds: RATE_ODDS_TTL_SECONDS,
    maxStaleMin: RATE_ODDS_MAX_STALE_MIN,
    schemaVersion: 1,
    sourceVersion: 'kalshi-kxfed-fred-dfedtaru-v1',
    contentMeta,
    maxContentAgeMin: TARGET_MAX_AGE_MIN,
    afterPublish: markRateOddsActivated,
  }).catch((err) => {
    console.error('FATAL:', err?.message || err);
    process.exit(1);
  });
}
