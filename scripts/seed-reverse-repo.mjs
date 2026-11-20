#!/usr/bin/env node
// @ts-check
//
// The Fed's daily overnight reverse repo take-up for the Lite "Fed liquidity"
// indicator (#136; spec docs/engineering/architecture/lite.md, Early
// indicators › Catalogue): cash parked at the Fed drains or returns to markets.
// The other half, the Fed's balance sheet (FRED WALCL), is already published
// by seed-fred-rates and read through the FRED batch RPC.
//
// Source (no key): the New York Fed Markets API, reverse repo operation
// results (`/api/rp/reverserepo/propositions/search.json`). An operation runs
// each business day around 12:45-13:15 New York time; its result is the
// amount accepted in US dollars. Small Value Exercises (test operations run
// next to the real one) and today's operation before 13:15 New York time are
// left out; other operations on one date are summed.
//
// Stateless: each run reads the last LOOKBACK_DAYS of operations, so nothing
// carries over between runs.

import { loadEnvFile, runSeed } from './_seed-utils.mjs';
import { readBoundedFeedText } from './seed-security-advisories.mjs';
import { getOptionalUpstashCreds, upstashCommand } from './_upstash-rest.mjs';
import { isMainModule } from './lib/main-module.mjs';

export const CANONICAL_KEY = 'economic:reverse-repo:v1';
export const ACTIVATION_KEY = 'seed-activated:economic:reverse-repo';
export const rrpUrl = (startDate, endDate) => `https://markets.newyorkfed.org/api/rp/reverserepo/propositions/search.json?startDate=${startDate}&endDate=${endDate}`;
/** Calendar days of operations read each run: about 30 business days. */
export const LOOKBACK_DAYS = 45;
export const DAYS_KEPT = 30;
/** A latest operation older than this (a long weekend is 4 days) means the answer is frozen or the facility stopped. */
export const MAX_LATEST_AGE_DAYS = 5;
export const RRP_TTL_SECONDS = 2 * 24 * 3600;
export const RRP_MAX_STALE_MIN = 540; // a 3 h cadence
const MAX_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const USER_AGENT = 'WorldMonitor reverse-repo seeder (+https://worldmonitor.app)';
const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Results are published after the operation closes at 13:15 New York time. */
export const RESULTS_AT_NY_MINUTES = 13 * 60 + 15;

/** The New York date and minutes past midnight at `ms`. */
export function newYorkClock(ms) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/**
 * Amount accepted per operation date, newest first. An operation without a numeric amount (not yet settled, or
 * cancelled) is left out rather than read as zero, which would look like a drain; so is today's operation before its
 * results are due, in case a pending one is listed with a zero.
 * @param {unknown} json
 * @param {number} [nowMs]
 * @returns {Array<{ date: string, accepted: number, operations: number }>}
 */
export function dailyTakeUp(json, nowMs = Date.now()) {
  const clock = newYorkClock(nowMs);
  const ops = /** @type {any} */ (json)?.repo?.operations;
  if (!Array.isArray(ops)) throw new Error('markets.newyorkfed.org answered without repo.operations');
  /** @type {Map<string, { date: string, accepted: number, operations: number }>} */
  const byDate = new Map();
  for (const op of ops) {
    if (!/^reverse repo$/i.test(String(op?.operationType ?? '').trim())) continue;
    // A Small Value Exercise is a test run next to the day's real operation ("the daily ON RRP operation will still
    // take place"), not take-up.
    if (/small value exercise/i.test(String(op?.note ?? ''))) continue;
    const date = String(op?.operationDate ?? '');
    const amount = op?.totalAmtAccepted;
    if (!ISO_DATE.test(date) || typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) continue;
    if (date > clock.date || (date === clock.date && clock.minutes < RESULTS_AT_NY_MINUTES)) continue;
    const day = byDate.get(date) ?? { date, accepted: 0, operations: 0 };
    day.accepted += amount;
    day.operations += 1;
    byDate.set(date, day);
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * runSeed fetch function: the last DAYS_KEPT business days of take-up.
 * @param {{ fetchImpl?: typeof fetch, nowMs?: number }} [opts]
 */
export async function fetchReverseRepo({ fetchImpl = (...args) => globalThis.fetch(...args), nowMs = Date.now() } = {}) {
  const url = rrpUrl(isoDay(nowMs - LOOKBACK_DAYS * DAY_MS), isoDay(nowMs));
  const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from markets.newyorkfed.org`);
  const body = await readBoundedFeedText(res, MAX_BYTES);
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error('markets.newyorkfed.org answered with something other than JSON');
  }
  const days = dailyTakeUp(json, nowMs).slice(0, DAYS_KEPT);
  if (days.length < 2) throw new Error(`reverse repo: ${days.length} operation day(s) in ${LOOKBACK_DAYS} days, expected about 30`);
  const age = Math.round((Date.parse(`${isoDay(nowMs)}T00:00:00Z`) - Date.parse(`${days[0].date}T00:00:00Z`)) / DAY_MS);
  if (age > MAX_LATEST_AGE_DAYS) throw new Error(`reverse repo: latest operation ${days[0].date}, ${age} days ago`);
  const [latest, prev] = days;
  console.log(`  NY Fed: ${days.length} operation days; ${latest.date} $${(latest.accepted / 1e9).toFixed(2)}bn (${prev.date} $${(prev.accepted / 1e9).toFixed(2)}bn)`);
  return { fetchedAt: nowMs, unit: 'USD', days };
}

export function validateFn(data) {
  return Boolean(data && Number.isFinite(data.fetchedAt) && Array.isArray(data.days) && data.days.length >= 2
    && data.days.every((d) => ISO_DATE.test(d?.date) && Number.isFinite(d?.accepted)));
}

export function declareRecords(data) {
  return Array.isArray(data?.days) ? data.days.length : 0;
}

export async function markReverseRepoActivated() {
  try {
    const creds = getOptionalUpstashCreds();
    if (creds) await upstashCommand(creds, ['SET', ACTIVATION_KEY, '1']);
  } catch (error) {
    console.warn(`  WARN: activation marker write failed: ${error?.message || error}`);
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadEnvFile(import.meta.url);
  runSeed('economic', 'reverse-repo', CANONICAL_KEY, () => fetchReverseRepo(), {
    validateFn,
    declareRecords,
    ttlSeconds: RRP_TTL_SECONDS,
    maxStaleMin: RRP_MAX_STALE_MIN,
    schemaVersion: 1,
    sourceVersion: 'nyfed-rrp-propositions-v1',
    afterPublish: markReverseRepoActivated,
  }).catch((err) => {
    console.error('FATAL:', err?.message || err);
    process.exit(1);
  });
}
