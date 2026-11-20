#!/usr/bin/env node
// @ts-check
//
// Newly listed data breaches for the Lite "Data breach" indicator (#131; spec
// docs/engineering/architecture/lite.md, Early indicators › Catalogue, Data
// breaches).
//
// Source: Have I Been Pwned's breach catalogue (`/api/v3/breaches`, no key;
// CC BY 4.0: identify HIBP as the source and link to haveibeenpwned.com). It
// is the whole catalogue (about 1,050 breaches, 1 MB) with both dates: when
// the breach happened and when HIBP listed it, often weeks or years later.
// The payload keeps the breaches listed in the last LIST_KEEP_DAYS.

import { loadEnvFile, runSeed } from './_seed-utils.mjs';
import { readBoundedFeedText } from './seed-security-advisories.mjs';
import { getOptionalUpstashCreds, upstashCommand } from './_upstash-rest.mjs';
import { isMainModule } from './lib/main-module.mjs';

export const CANONICAL_KEY = 'cyber:breaches:v1';
export const ACTIVATION_KEY = 'seed-activated:cyber:breaches';
export const HIBP_BREACHES_URL = 'https://haveibeenpwned.com/api/v3/breaches';
/** The catalogue holds about 1,050 breaches; far fewer means a broken answer. */
export const MIN_BREACHES = 500;
export const LIST_KEEP_DAYS = 30;
export const LIST_MAX = 100;
export const BREACHES_TTL_SECONDS = 24 * 3600; // a 3 h cadence
export const BREACHES_MAX_STALE_MIN = 540;
const MAX_BYTES = 16 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 60_000;
const USER_AGENT = 'WorldMonitor breaches seeder (+https://worldmonitor.app)';
const DAY_MS = 24 * 3600 * 1000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** One catalogue entry in the stored shape, or null without a name, a listing time or an account count. */
export function toBreach(raw) {
  const name = str(raw?.Name, 120);
  const addedAt = Date.parse(str(raw?.AddedDate, 40));
  const pwnCount = Number(raw?.PwnCount);
  if (!name || !Number.isFinite(addedAt) || !Number.isFinite(pwnCount) || pwnCount < 0) return null;
  const breachDate = str(raw?.BreachDate, 10);
  return {
    name,
    title: str(raw?.Title, 120) || name,
    domain: str(raw?.Domain, 120).toLowerCase(),
    breachDate: DATE.test(breachDate) ? breachDate : '',
    addedAt,
    pwnCount,
    // All of them (HIBP lists up to about 30), so the card's "+N more" is the real count.
    dataClasses: Array.isArray(raw?.DataClasses) ? raw.DataClasses.filter((c) => typeof c === 'string').slice(0, 40).map((c) => c.slice(0, 60)) : [],
    verified: raw?.IsVerified === true,
    fabricated: raw?.IsFabricated === true,
    sensitive: raw?.IsSensitive === true,
    spamList: raw?.IsSpamList === true,
    malware: raw?.IsMalware === true,
    stealerLog: raw?.IsStealerLog === true,
    url: `https://haveibeenpwned.com/Breach/${encodeURIComponent(name)}`,
  };
}

/**
 * runSeed fetch function: the breaches listed in the last LIST_KEEP_DAYS,
 * newest first, and the catalogue's size.
 * @param {{ fetchImpl?: typeof fetch, nowMs?: number }} [opts]
 */
export async function fetchBreaches({ fetchImpl = (...args) => globalThis.fetch(...args), nowMs = Date.now() } = {}) {
  const res = await fetchImpl(HIBP_BREACHES_URL, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from haveibeenpwned.com`);
  const body = await readBoundedFeedText(res, MAX_BYTES);
  let list;
  try {
    list = JSON.parse(body);
  } catch {
    throw new Error('haveibeenpwned.com answered with something other than JSON');
  }
  if (!Array.isArray(list) || list.length < MIN_BREACHES) {
    throw new Error(`HIBP catalogue: ${Array.isArray(list) ? list.length : 'no'} breaches, expected at least ${MIN_BREACHES}`);
  }
  const all = list.map(toBreach).filter(Boolean);
  const cutoff = nowMs - LIST_KEEP_DAYS * DAY_MS;
  const breaches = all
    .filter((b) => b.addedAt >= cutoff && b.addedAt <= nowMs + DAY_MS)
    .sort((a, b) => b.addedAt - a.addedAt || a.name.localeCompare(b.name))
    .slice(0, LIST_MAX);
  console.log(`  HIBP: ${all.length} breaches in the catalogue; ${breaches.length} listed in the last ${LIST_KEEP_DAYS} days`);
  return { fetchedAt: nowMs, total: all.length, keepDays: LIST_KEEP_DAYS, breaches };
}

export function validateFn(data) {
  return Boolean(data && Number.isFinite(data.fetchedAt) && Number(data.total) >= MIN_BREACHES && Array.isArray(data.breaches)
    && data.breaches.every((b) => typeof b?.name === 'string' && Number.isFinite(b?.addedAt) && Number.isFinite(b?.pwnCount)));
}

/** The catalogue's size: a month with no new breach is still a full read. */
export function declareRecords(data) {
  return Number(data?.total) || 0;
}

export async function markBreachesActivated() {
  try {
    const creds = getOptionalUpstashCreds();
    if (creds) await upstashCommand(creds, ['SET', ACTIVATION_KEY, '1']);
  } catch (error) {
    console.warn(`  WARN: activation marker write failed: ${error?.message || error}`);
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadEnvFile(import.meta.url);
  runSeed('cyber', 'breaches', CANONICAL_KEY, () => fetchBreaches(), {
    validateFn,
    declareRecords,
    ttlSeconds: BREACHES_TTL_SECONDS,
    maxStaleMin: BREACHES_MAX_STALE_MIN,
    schemaVersion: 1,
    sourceVersion: 'hibp-v3-breaches-v1',
    afterPublish: markBreachesActivated,
  }).catch((err) => {
    console.error('FATAL:', err?.message || err);
    process.exit(1);
  });
}
