#!/usr/bin/env node
//
// Company earnings dates from Finnhub's earnings calendar (key FINNHUB_API_KEY,
// free tier): the past week and the next two weeks. Read by the market
// earnings RPC and, since #138, by the Lite Finance screen's earnings card for
// the default stock list (the watchlist stand-in; spec
// docs/engineering/architecture/lite.md, Early indicators › Catalogue).

import { loadEnvFile, loadSharedConfig, runSeed } from './_seed-utils.mjs';
import { readBoundedFeedText } from './seed-security-advisories.mjs';
import { isMainModule } from './lib/main-module.mjs';

const KEY = 'market:earnings-calendar:v1';
const TTL = 129600; // 36h — 3× a 12h cron interval
export const EARNINGS_CALENDAR_CAP = 100;
const MAX_BYTES = 8 * 1024 * 1024;
const USER_AGENT = 'WorldMonitor earnings-calendar seeder (+https://worldmonitor.app)';

// Keep aligned with NQ_INFLUENCE_SYMBOLS in src/config/nq-context.ts.
export const NQ_INFLUENCE_EARNINGS_SYMBOLS = [
  'AAPL',
  'MSFT',
  'NVDA',
  'AMZN',
  'GOOGL',
  'META',
  'AVGO',
  'TSLA',
];

/** A symbol with an exchange suffix ("0700.HK", "RELIANCE.NS"): not a US listing. */
const NON_US = /\.[A-Z]{1,2}$/;

/**
 * The Lite default stock list's US companies (`stocks.json` defaultSymbols, the
 * watchlist stand-in), without indices: Finnhub's free calendar lists US
 * companies only. Class shares are reserved in both forms ("BRK-B" on the
 * list, "BRK.B" at Finnhub).
 */
export const WATCHLIST_EARNINGS_SYMBOLS = Object.freeze(
  /** @type {string[]} */ (loadSharedConfig('stocks.json').defaultSymbols).filter((s) => !s.startsWith('^') && !NON_US.test(s)),
);
const WATCHLIST_ALL_FORMS = [...WATCHLIST_EARNINGS_SYMBOLS, ...WATCHLIST_EARNINGS_SYMBOLS.filter((s) => s.includes('-')).map((s) => s.replace('-', '.'))];

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function compareEarningsEntries(a, b) {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  return (b.revenueEstimate ?? 0) - (a.revenueEstimate ?? 0);
}

/**
 * Reserve every matching NQ influence and watchlist report from the
 * normalized window, then fill remaining capacity with general chronological
 * rows. Without the watchlist reserve, the cap keeps the window's earliest
 * rows and drops the next two weeks, which the Lite card shows.
 */
export function boundEarningsCalendar(normalized, {
  cap = EARNINGS_CALENDAR_CAP,
  reservedSymbols = [...NQ_INFLUENCE_EARNINGS_SYMBOLS, ...WATCHLIST_ALL_FORMS],
} = {}) {
  const reservedSet = new Set(reservedSymbols);
  const reserved = [];
  const general = [];
  for (const entry of Array.isArray(normalized) ? normalized : []) {
    if (reservedSet.has(entry.symbol)) reserved.push(entry);
    else general.push(entry);
  }
  reserved.sort(compareEarningsEntries);
  general.sort(compareEarningsEntries);
  const remaining = Math.max(0, cap - reserved.length);
  return [...reserved, ...general.slice(0, remaining)].sort(compareEarningsEntries);
}

/** One Finnhub row in the stored shape. */
export function normalizeEarning(e) {
  const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  const epsEst = num(e.epsEstimate);
  const epsAct = num(e.epsActual);
  const revEst = num(e.revenueEstimate);
  const revAct = num(e.revenueActual);
  const hasActuals = epsAct != null;
  let surpriseDirection = '';
  if (hasActuals && epsEst != null) {
    if (epsAct > epsEst) surpriseDirection = 'beat';
    else if (epsAct < epsEst) surpriseDirection = 'miss';
  }
  return {
    symbol: String(e.symbol),
    company: e.name ? String(e.name) : String(e.symbol),
    date: e.date ? String(e.date) : '',
    hour: e.hour ? String(e.hour) : '',
    epsEstimate: epsEst,
    revenueEstimate: revEst,
    epsActual: epsAct,
    revenueActual: revAct,
    hasActuals,
    surpriseDirection,
  };
}

/**
 * runSeed fetch function: the past week and the next two weeks.
 * @param {{ fetchImpl?: typeof fetch, apiKey?: string, nowMs?: number }} [opts]
 */
export async function fetchEarningsCalendar({
  fetchImpl = (...args) => globalThis.fetch(...args),
  apiKey = process.env.FINNHUB_API_KEY,
  nowMs = Date.now(),
} = {}) {
  if (!apiKey) {
    console.warn('  FINNHUB_API_KEY not set — skipping');
    return { earnings: [], unavailable: true, asOf: new Date(nowMs).toISOString() };
  }

  // #4922/#4929 review: include the past week so brief consumers can show
  // recent beats/misses — a today-forward window can only ever contain
  // same-day morning reporters.
  const from = new Date(nowMs - 7 * 86_400_000);
  const to = new Date(nowMs + 14 * 86_400_000);

  const url = `https://finnhub.io/api/v1/calendar/earnings?from=${toDateStr(from)}&to=${toDateStr(to)}`;

  const resp = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT, 'X-Finnhub-Token': apiKey },
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    throw new Error(`Finnhub earnings calendar HTTP ${resp.status}`);
  }

  const body = await readBoundedFeedText(resp, MAX_BYTES);
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error('finnhub.io answered with something other than JSON');
  }
  const raw = Array.isArray(data?.earningsCalendar) ? data.earningsCalendar : [];
  const watch = new Set(WATCHLIST_ALL_FORMS);

  const normalized = raw
    .filter(e => e.symbol)
    .map(normalizeEarning)
    // Keep companies with meaningful analyst coverage:
    // - revenue estimate > 0 && >= $10M → large/mid-cap (primary filter)
    // - revenue estimate === 0 OR null → pre-revenue (biotech, SPACs) or financial/REIT
    //   with no revenue line — use |EPS| >= $0.05 as proxy for analyst coverage depth
    //   ($0.05 keeps well-covered loss-making companies; $0.10 was too aggressive)
    // - revenue estimate > 0 && < $10M → small-cap / micro-cap → always drop
    // A watchlist company is always kept (#138).
    .filter(e => {
      if (watch.has(e.symbol)) return true;
      if (e.revenueEstimate != null && e.revenueEstimate > 0) return e.revenueEstimate >= 10_000_000;
      if (e.epsEstimate != null) return Math.abs(e.epsEstimate) >= 0.05;
      return false;
    })
    // Within same date, largest companies first; across dates, chronological
    .sort(compareEarningsEntries);

  const earnings = boundEarningsCalendar(normalized);
  const listed = earnings.filter((e) => watch.has(e.symbol)).map((e) => `${e.symbol} ${e.date}`);

  console.log(`  Fetched ${earnings.length} earnings entries (from ${raw.length} total); watchlist: ${listed.join(', ') || 'none in the window'}`);
  return { earnings, unavailable: false, asOf: new Date(nowMs).toISOString() };
}

export function validate(data) {
  // >= 3 distinguishes a healthy result from an over-aggressive filter or a near-empty API response
  return Array.isArray(data?.earnings) && data.earnings.length >= 3;
}

export function declareRecords(data) {
  return Array.isArray(data?.earnings) ? data.earnings.length : 0;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadEnvFile(import.meta.url);
  runSeed('market', 'earnings-calendar', KEY, () => fetchEarningsCalendar(), {
    validateFn: validate,
    ttlSeconds: TTL,
    sourceVersion: 'finnhub-v1',
    declareRecords,
    schemaVersion: 1,
    maxStaleMin: 1440,
  }).catch(err => { console.error('FATAL:', err.message || err); process.exit(1); });
}
