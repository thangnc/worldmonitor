#!/usr/bin/env node
// @ts-check
//
// Travel advisory level changes for the Lite "Travel advisories" indicator
// (#124; spec docs/engineering/architecture/lite.md, Early indicators ›
// Catalogue). seed-security-advisories keeps the latest level per country for
// the risk scores; this seeder keeps each country's previous level and
// publishes the changes.
//
// Sources, both keyless and official:
// - US State Department: the travel advisory RSS register (one item per
//   country, "Iran - Level 4: Do Not Travel"). It is read directly; a register
//   naming fewer than US_MIN_COUNTRIES countries counts as a failed read.
// - UK FCDO: the GOV.UK Content API. One index request lists every country's
//   page and its last update; only pages updated since the last run are
//   fetched (UK_FETCH_MAX per run) for their `alert_status` flags
//   ("avoid_all_travel_to_parts", "avoid_all_but_essential_travel_to_whole_country").
//   Crown copyright under the Open Government Licence.
//
// A country seen for the first time sets its baseline and produces no change.
// A failed source keeps its stored levels, so a partial read never turns into
// a burst of false changes.

import { loadEnvFile, loadSharedConfig, runSeed } from './_seed-utils.mjs';
import { parseRssItems, readBoundedFeedText } from './seed-security-advisories.mjs';
import { isMainModule } from './lib/main-module.mjs';
import { getOptionalUpstashCreds, upstashCommand } from './_upstash-rest.mjs';

export const CANONICAL_KEY = 'intelligence:travel-levels:v1';
export const STATE_KEY = 'intelligence:travel-levels:state:v1';
export const ACTIVATION_KEY = 'seed-activated:intelligence:travel-levels';
export const US_RSS_URL = 'https://travel.state.gov/_res/rss/TAsTWs.xml';
export const UK_INDEX_URL = 'https://www.gov.uk/api/content/foreign-travel-advice';
export const UK_PAGE_URL = 'https://www.gov.uk/api/content/foreign-travel-advice/';
export const US_MIN_COUNTRIES = 150;
export const UK_MIN_COUNTRIES = 150;
export const UK_FETCH_MAX = 40;
export const CHANGES_KEEP_DAYS = 14;
export const CHANGES_MAX = 300;
export const TRAVEL_TTL_SECONDS = 24 * 3600; // a 2 h cadence
export const STATE_TTL_SECONDS = 30 * 24 * 3600; // outlives the canonical key so a few failed days keep the baseline
export const TRAVEL_MAX_STALE_MIN = 360;
/** "Newly listed" counts only when the stored register was about this close in size. */
export const US_REGISTER_SLACK = 3;
/** The UK page loop stops after this long, so a slow GOV.UK cannot outlive the run. */
export const UK_LOOP_BUDGET_MS = 120_000;
const REQUEST_TIMEOUT_MS = 20_000;
const UK_STAGGER_MS = 150;
const MAX_US_BYTES = 4 * 1024 * 1024;
const USER_AGENT = 'WorldMonitor travel advisory seeder (+https://worldmonitor.app)';
const DAY_MS = 24 * 3600 * 1000;

/** The UK flags that advise against travel, most severe first. */
export const UK_FLAGS = Object.freeze([
  'avoid_all_travel_to_whole_country',
  'avoid_all_travel_to_parts',
  'avoid_all_but_essential_travel_to_whole_country',
  'avoid_all_but_essential_travel_to_parts',
]);

const COUNTRY_NAMES = /** @type {Record<string, string>} */ (loadSharedConfig('country-names.json'));
const NAME_ENTRIES = Object.entries(COUNTRY_NAMES);

const normalize = (s) => String(s ?? '').normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  .replace(/['’]/g, '').replace(/[.(),/&-]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * ISO2 for a country name as an advisory names it. An exact match wins;
 * otherwise the name that appears first ("Israel, the West Bank and Gaza" is
 * Israel), the longest at the same position.
 */
export function countryCodeOf(name) {
  const n = normalize(name).replace(/^the /, '').replace(/ travel advisory$/, '');
  if (!n) return null;
  if (COUNTRY_NAMES[n]) return COUNTRY_NAMES[n];
  let best = null;
  for (const [key, code] of NAME_ENTRIES) {
    const at = ` ${n} `.indexOf(` ${key} `);
    if (at < 0) continue;
    if (!best || at < best.at || (at === best.at && key.length > best.len)) best = { at, len: key.length, code };
  }
  return best?.code ?? null;
}

/** One US register item as { code, name, level, url, updatedAt }, or null. */
export function parseUsItem(item) {
  const m = /^(.*?)\s*-\s*Level (\d)\b/i.exec(item?.title ?? '');
  if (!m) return null;
  const level = Number(m[2]);
  const code = countryCodeOf(m[1]);
  if (!code || level < 1 || level > 4) return null;
  const updatedAt = Date.parse(item.pubDate ?? '');
  return {
    code,
    name: m[1].replace(/\s*Travel Advisory$/i, '').trim(),
    level,
    url: typeof item.link === 'string' && item.link.startsWith('https://travel.state.gov/') ? item.link : '',
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : null,
  };
}

/** The UK advice flags from a page's `alert_status`, most severe first. */
export function ukFlags(alertStatus) {
  const set = new Set(Array.isArray(alertStatus) ? alertStatus : []);
  return UK_FLAGS.filter((f) => set.has(f));
}

async function getJson(fetchImpl, url) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** The US register as a map of ISO2 → item. Throws when the register looks partial. */
export async function fetchUsLevels(fetchImpl) {
  const res = await fetchImpl(US_RSS_URL, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/xml' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`US register HTTP ${res.status}`);
  const xml = await readBoundedFeedText(res, MAX_US_BYTES);
  const levels = new Map();
  for (const raw of parseRssItems(xml)) {
    const item = parseUsItem(raw);
    // Two items for one country (rare re-issues): keep the higher level.
    if (item && (!levels.has(item.code) || levels.get(item.code).level < item.level)) levels.set(item.code, item);
  }
  if (levels.size < US_MIN_COUNTRIES) throw new Error(`US register named ${levels.size} countries, expected at least ${US_MIN_COUNTRIES}`);
  return levels;
}

/** The GOV.UK index as ISO2 → { slug, name, updatedAt }. Throws when it looks partial. */
export async function fetchUkIndex(fetchImpl) {
  const body = await getJson(fetchImpl, UK_INDEX_URL);
  const pages = new Map();
  for (const child of body?.links?.children ?? []) {
    const country = child?.details?.country;
    const code = countryCodeOf(country?.name);
    const slug = typeof country?.slug === 'string' && /^[a-z0-9-]+$/.test(country.slug) ? country.slug : null;
    if (code && slug && !pages.has(code)) pages.set(code, { slug, name: country.name, updatedAt: String(child.public_updated_at ?? '') });
  }
  if (pages.size < UK_MIN_COUNTRIES) throw new Error(`UK index listed ${pages.size} countries, expected at least ${UK_MIN_COUNTRIES}`);
  return pages;
}

/**
 * Compares this run's reads with the stored state. Returns the next state and
 * the changes. A source that failed (`us`/`ukIndex` null) keeps its state.
 */
export const hasUsBaseline = (state) => Boolean(state?.us && typeof state.us === 'object' && Object.keys(state.us).length);

export function diffLevels({ previous, us, ukIndex, ukPages, nowMs }) {
  // An empty or missing US map is no baseline: comparing with it would list every country as new.
  const prevUs = hasUsBaseline(previous) ? previous.us : null;
  const prevUk = previous?.uk && typeof previous.uk === 'object' ? previous.uk : {};
  const prevSize = Number(previous?.usRegisterSize) || 0;
  // A country absent from a stored register that was much smaller (a short read, or a
  // country-name mapping added since) is a baseline gap, not a new listing.
  const newListingsCount = Boolean(prevUs && us && prevSize && us.size - prevSize <= US_REGISTER_SLACK);
  const changes = [];
  let nextUs = prevUs;
  if (us) {
    nextUs = {};
    for (const [code, item] of us) {
      nextUs[code] = item.level;
      if (!prevUs) continue; // the first read sets the baseline
      const before = prevUs[code];
      if (before === item.level || (before === undefined && !newListingsCount)) continue;
      changes.push({ at: nowMs, source: 'US', country: code, name: item.name, from: before ?? null, to: item.level, url: item.url, updatedAt: item.updatedAt });
    }
    // A country missing from one read keeps its last level rather than "dropping".
    for (const [code, level] of Object.entries(prevUs ?? {})) if (!(code in nextUs)) nextUs[code] = level;
  }
  const nextUk = { ...prevUk };
  for (const [code, page] of ukPages) {
    const before = prevUk[code];
    nextUk[code] = { flags: page.flags, updatedAt: page.updatedAt };
    if (!before) continue; // first fetch of this page: baseline
    const same = before.flags.length === page.flags.length && before.flags.every((f, i) => f === page.flags[i]);
    if (same) continue;
    changes.push({ at: nowMs, source: 'UK', country: code, name: page.name, from: before.flags, to: page.flags, url: `https://www.gov.uk/foreign-travel-advice/${page.slug}`, updatedAt: Date.parse(page.updatedAt) || null, note: page.note });
  }
  const okAt = { US: us ? nowMs : previous?.okAt?.US ?? null, UK: ukIndex ? nowMs : previous?.okAt?.UK ?? null };
  return {
    state: {
      us: nextUs, uk: nextUk, ukIndexed: ukIndex ? ukIndex.size : previous?.ukIndexed ?? 0,
      usRegisterSize: us ? us.size : prevSize || null,
      okAt, startedAt: Number.isFinite(previous?.startedAt) ? previous.startedAt : nowMs,
    },
    changes,
  };
}

/** This run's changes, then the stored ones, inside the window and the cap. */
export function mergeChanges(fresh, previousLog, nowMs) {
  const cutoff = nowMs - CHANGES_KEEP_DAYS * DAY_MS;
  return [...fresh, ...(Array.isArray(previousLog) ? previousLog : [])]
    .filter((c) => c && Number.isFinite(c.at) && c.at >= cutoff && (c.source === 'US' || c.source === 'UK'))
    .sort((a, b) => b.at - a.at || a.source.localeCompare(b.source) || a.country.localeCompare(b.country))
    .slice(0, CHANGES_MAX);
}

async function readState() {
  const creds = getOptionalUpstashCreds();
  if (!creds) return null;
  // A failed read must fail the run: starting fresh would drop the baseline.
  let raw;
  try {
    ({ result: raw } = await upstashCommand(creds, ['GET', STATE_KEY]));
  } catch (err) {
    throw new Error(`travel-levels state read failed: ${err?.message || err}`);
  }
  if (raw == null) return null;
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const data = value?.data ?? value;
    return data?.state && typeof data.state === 'object' ? data.state : null;
  } catch (err) {
    console.warn(`  WARN: stored travel-levels state is not JSON, starting fresh: ${err?.message || err}`);
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * runSeed fetch function. Reads both sources, compares them with the stored
 * state, and returns the public payload plus the next state (`state`,
 * stripped from the canonical key by publishTransform). Fails only when both
 * sources fail, so the last good payload stays.
 */
export async function fetchTravelAdvisories({
  fetchImpl = (...args) => globalThis.fetch(...args),
  nowMs = Date.now(),
  loadState = readState,
  staggerMs = UK_STAGGER_MS,
  clock = () => Date.now(),
} = {}) {
  const startedAt = clock();
  const previous = await loadState();
  let us = null;
  let usError = null;
  try {
    us = await fetchUsLevels(fetchImpl);
  } catch (err) {
    usError = String(err?.message || err).slice(0, 200);
    console.warn(`  US register: ${usError}`);
  }
  let ukIndex = null;
  let ukError = null;
  try {
    ukIndex = await fetchUkIndex(fetchImpl);
  } catch (err) {
    ukError = String(err?.message || err).slice(0, 200);
    console.warn(`  UK index: ${ukError}`);
  }
  if (!us && !ukIndex) throw new Error(`both travel advisory sources failed (US: ${usError}; UK: ${ukError})`);

  // UK pages updated since the stored read, up to the cap: pages already in the
  // baseline first (only they can change), then the oldest unknown ones.
  const stored = previous?.uk ?? {};
  const due = ukIndex
    ? [...ukIndex.entries()].filter(([code, page]) => stored[code]?.updatedAt !== page.updatedAt)
      .sort((a, b) => Number(!stored[a[0]]) - Number(!stored[b[0]]) || a[1].updatedAt.localeCompare(b[1].updatedAt))
    : [];
  const ukPages = new Map();
  let ukFailed = 0;
  for (const [code, page] of due.slice(0, UK_FETCH_MAX)) {
    if (clock() - startedAt > UK_LOOP_BUDGET_MS) {
      console.warn('  UK page budget spent; the rest wait for the next run');
      break;
    }
    try {
      const body = await getJson(fetchImpl, `${UK_PAGE_URL}${page.slug}`);
      // A page without the flags (a schema change, an error body) must not read as "all warnings lifted".
      if (!Array.isArray(body?.details?.alert_status)) throw new Error('no alert_status');
      const note = typeof body?.details?.change_description === 'string' ? body.details.change_description.replace(/\s+/g, ' ').trim().slice(0, 240) : '';
      ukPages.set(code, { ...page, flags: ukFlags(body?.details?.alert_status), note });
    } catch (err) {
      ukFailed += 1;
      console.warn(`  UK ${page.slug}: ${err?.message || err}`);
    }
    if (staggerMs) await sleep(staggerMs);
  }

  const { state, changes } = diffLevels({ previous, us, ukIndex, ukPages, nowMs });
  // A source down longer than the health budget fails the run, so health turns stale
  // instead of the other source keeping the feed "live" (freshness is the oldest source's).
  const staleMs = TRAVEL_MAX_STALE_MIN * 60_000;
  for (const src of ['US', 'UK']) {
    const lastOk = state.okAt[src] ?? state.startedAt;
    if (nowMs - lastOk > staleMs) throw new Error(`${src} travel advisory source not read since ${new Date(lastOk).toISOString()} (US: ${usError ?? 'ok'}; UK: ${ukError ?? 'ok'})`);
  }
  const log = mergeChanges(changes, previous?.changes, nowMs);
  const ukKnown = Object.keys(state.uk).length;
  const usLevels = Object.values(state.us ?? {});
  console.log(`  US: ${us ? `${us.size} countries` : 'failed'} · UK: ${ukIndex ? `${ukIndex.size} indexed, ${ukPages.size} fetched (${due.length} due, ${ukFailed} failed), ${ukKnown} known` : 'failed'} · ${changes.length} changes this run, ${log.length} kept`);
  return {
    fetchedAt: nowMs,
    keepDays: CHANGES_KEEP_DAYS,
    us: { ok: Boolean(us), okAt: state.okAt.US, error: usError, countries: usLevels.length, level4: usLevels.filter((l) => l === 4).length, level3: usLevels.filter((l) => l === 3).length, baseline: hasUsBaseline(previous) },
    uk: { ok: Boolean(ukIndex), okAt: state.okAt.UK, error: ukError, indexed: state.ukIndexed, known: ukKnown, pending: Math.max(0, due.length - ukPages.size) },
    changes: log,
    state: { ...state, changes: log },
  };
}

/** The public payload: everything except the stored levels. */
export function publishTransform(data) {
  const { state: _state, ...published } = data ?? {};
  return published;
}

export function validateFn(data) {
  return Boolean(data && Number.isFinite(data.fetchedAt) && data.us && data.uk && (data.us.ok || data.uk.ok)
    && Array.isArray(data.changes) && data.changes.every((c) => typeof c?.country === 'string' && Number.isFinite(c?.at)));
}

export function declareRecords(data) {
  return Array.isArray(data?.changes) ? data.changes.length : 0;
}

export async function markTravelLevelsActivated() {
  try {
    const creds = getOptionalUpstashCreds();
    if (creds) await upstashCommand(creds, ['SET', ACTIVATION_KEY, '1']);
  } catch (error) {
    console.warn(`  WARN: activation marker write failed: ${error?.message || error}`);
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadEnvFile(import.meta.url);
  runSeed('intelligence', 'travel-levels', CANONICAL_KEY, () => fetchTravelAdvisories(), {
    validateFn,
    declareRecords,
    ttlSeconds: TRAVEL_TTL_SECONDS,
    maxStaleMin: TRAVEL_MAX_STALE_MIN,
    schemaVersion: 1,
    zeroIsValid: true,
    sourceVersion: 'state-rss-govuk-content-v1',
    lockTtlMs: 300_000,
    publishTransform,
    extraKeys: [{
      key: STATE_KEY,
      ttl: STATE_TTL_SECONDS,
      transform: (data) => ({ state: data?.state ?? null }),
      allowPrePublishFields: ['state'],
      declareRecords: (data) => Object.keys(data?.state?.us ?? {}).length + Object.keys(data?.state?.uk ?? {}).length,
    }],
    // A failed run would otherwise cut the state back to the canonical key's TTL.
    preserveKeyTtls: [{ key: STATE_KEY, ttlSeconds: STATE_TTL_SECONDS }],
    afterPublish: markTravelLevelsActivated,
  }).catch((err) => {
    console.error('FATAL:', err?.message || err);
    process.exit(1);
  });
}
