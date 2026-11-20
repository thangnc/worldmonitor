#!/usr/bin/env node
// @ts-check
//
// Stablecoin supply for the Lite "Stablecoin supply" indicator (#137; spec
// docs/engineering/architecture/lite.md, Early indicators › Catalogue): new
// stablecoin supply is money ready to enter crypto markets.
//
// Source (no key): DefiLlama's stablecoin API (`/stablecoins`), every tracked
// stablecoin's circulating supply now, a day, a week and a month ago, by peg.
// Only US-dollar stablecoins are read (`peggedUSD`, about 99% of the total).
//
// The total's 7-day change compares only coins with a figure both now and a
// week ago: a coin DefiLlama starts tracking this week is not new supply. The
// coins are ranked by the larger of their supply now and a week ago, so a coin
// shrinking fast stays among the five watched; a coin of $1bn or more a week
// ago with no figure today fails the run.
// Stateless: each run reads the whole list.

import { loadEnvFile, runSeed } from './_seed-utils.mjs';
import { readBoundedFeedText } from './seed-security-advisories.mjs';
import { getOptionalUpstashCreds, upstashCommand } from './_upstash-rest.mjs';
import { isMainModule } from './lib/main-module.mjs';

export const CANONICAL_KEY = 'market:stablecoin-supply:v1';
export const ACTIVATION_KEY = 'seed-activated:market:stablecoin-supply';
export const STABLECOINS_URL = 'https://stablecoins.llama.fi/stablecoins';
/** Coins kept, largest first: the trigger reads the top 5, the card names a few more. */
export const COINS_KEPT = 10;
/** DefiLlama tracks about 450 stablecoins; far fewer, or a small total, means a broken answer. */
export const MIN_ASSETS = 100;
export const MIN_TOTAL_USD = 50e9;
/** A coin this large a week ago must have a figure today. */
export const LARGE_COIN_USD = 1e9;
export const SUPPLY_TTL_SECONDS = 3 * 24 * 3600;
export const SUPPLY_MAX_STALE_MIN = 1080; // a 6 h cadence
const MAX_BYTES = 6 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const USER_AGENT = 'WorldMonitor stablecoin-supply seeder (+https://worldmonitor.app)';

const usd = (point) => {
  const v = point?.peggedUSD;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
};

/**
 * The US-dollar stablecoins' total and the largest coins, from DefiLlama's answer.
 * @param {unknown} json
 */
export function supplyFrom(json) {
  const assets = /** @type {any} */ (json)?.peggedAssets;
  if (!Array.isArray(assets)) throw new Error('stablecoins.llama.fi answered without peggedAssets');
  const coins = [];
  for (const a of assets) {
    if (a?.pegType !== 'peggedUSD') continue;
    const current = usd(a.circulating);
    const prevWeek = usd(a.circulatingPrevWeek);
    if (current === null || current === 0) {
      // A large coin without today's figure is a broken answer, not a coin that vanished: fail and keep the last good data.
      if (prevWeek !== null && prevWeek >= LARGE_COIN_USD) throw new Error(`stablecoins.llama.fi: ${a.symbol} has no current supply (a week ago $${(prevWeek / 1e9).toFixed(1)}bn)`);
      continue;
    }
    coins.push({
      id: String(a.id ?? ''), symbol: String(a.symbol ?? ''), name: String(a.name ?? ''),
      current, prevDay: usd(a.circulatingPrevDay), prevWeek, prevMonth: usd(a.circulatingPrevMonth),
    });
  }
  // Largest by supply now or a week ago, so a coin shrinking fast stays among the watched coins.
  coins.sort((x, y) => Math.max(y.current, y.prevWeek ?? 0) - Math.max(x.current, x.prevWeek ?? 0));
  const sum = (list, field) => list.reduce((n, c) => n + c[field], 0);
  const weekly = coins.filter((c) => c.prevWeek !== null && c.prevWeek > 0);
  const monthly = coins.filter((c) => c.prevMonth !== null && c.prevMonth > 0);
  return {
    assets: assets.length,
    total: {
      current: sum(coins, 'current'),
      coins: coins.length,
      // Like for like: the same coins now and a week (a month) ago.
      weekNow: sum(weekly, 'current'), weekAgo: sum(weekly, 'prevWeek'),
      monthNow: sum(monthly, 'current'), monthAgo: sum(monthly, 'prevMonth'),
      newThisWeek: coins.length - weekly.length,
    },
    top: coins.slice(0, COINS_KEPT),
  };
}

/**
 * runSeed fetch function.
 * @param {{ fetchImpl?: typeof fetch, nowMs?: number }} [opts]
 */
export async function fetchStablecoinSupply({ fetchImpl = (...args) => globalThis.fetch(...args), nowMs = Date.now() } = {}) {
  const res = await fetchImpl(STABLECOINS_URL, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from stablecoins.llama.fi`);
  const body = await readBoundedFeedText(res, MAX_BYTES);
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error('stablecoins.llama.fi answered with something other than JSON');
  }
  const { assets, total, top } = supplyFrom(json);
  if (assets < MIN_ASSETS) throw new Error(`stablecoins.llama.fi: ${assets} stablecoins, expected at least ${MIN_ASSETS}`);
  if (total.current < MIN_TOTAL_USD) throw new Error(`stablecoins.llama.fi: total $${(total.current / 1e9).toFixed(1)}bn, expected at least $${MIN_TOTAL_USD / 1e9}bn`);
  const pct = (now, ago) => (ago > 0 ? `${((now / ago - 1) * 100).toFixed(2)}%` : 'n/a');
  console.log(`  DefiLlama: ${assets} stablecoins, ${total.coins} in US$; total $${(total.current / 1e9).toFixed(1)}bn, ${pct(total.weekNow, total.weekAgo)} in 7 days; top ${top.slice(0, 5).map((c) => `${c.symbol} ${c.prevWeek ? pct(c.current, c.prevWeek) : 'n/a'}`).join(', ')}`);
  return { fetchedAt: nowMs, unit: 'USD', total, top };
}

export function validateFn(data) {
  return Boolean(data && Number.isFinite(data.fetchedAt) && Number.isFinite(data.total?.current) && data.total.current >= MIN_TOTAL_USD
    && Array.isArray(data.top) && data.top.length >= 5 && data.top.every((c) => typeof c?.symbol === 'string' && Number.isFinite(c?.current)));
}

export function declareRecords(data) {
  return Array.isArray(data?.top) ? data.top.length : 0;
}

export async function markSupplyActivated() {
  try {
    const creds = getOptionalUpstashCreds();
    if (creds) await upstashCommand(creds, ['SET', ACTIVATION_KEY, '1']);
  } catch (error) {
    console.warn(`  WARN: activation marker write failed: ${error?.message || error}`);
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadEnvFile(import.meta.url);
  runSeed('market', 'stablecoin-supply', CANONICAL_KEY, () => fetchStablecoinSupply(), {
    validateFn,
    declareRecords,
    ttlSeconds: SUPPLY_TTL_SECONDS,
    maxStaleMin: SUPPLY_MAX_STALE_MIN,
    schemaVersion: 1,
    sourceVersion: 'defillama-stablecoins-v1',
    afterPublish: markSupplyActivated,
  }).catch((err) => {
    console.error('FATAL:', err?.message || err);
    process.exit(1);
  });
}
