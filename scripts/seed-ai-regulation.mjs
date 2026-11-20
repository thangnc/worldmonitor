#!/usr/bin/env node
// @ts-check
//
// AI and data regulation from primary sources, for the Lite "AI regulation"
// indicator and the Tech policy panel (#127; spec docs/engineering/
// architecture/lite.md, Early indicators › Catalogue).
//
// Sources, all keyless and official:
// - European Commission, Shaping Europe's digital future news feed (RSS).
// - EUR-Lex: Commission proposals (rssId 161) and acts of the Official
//   Journal L series (rssId 165), each the newest 100 documents.
// - The Federal Register API: rules and proposed rules matching
//   "artificial intelligence" (the API #122's seeder reads).
// Kept: documents whose title (and, for the Federal Register, abstract) is
// about AI or data rules; EU news items must also name an instrument
// (an act, guidelines, an implementing or delegated act, a code of practice).
//
// The feeds are short windows, so the payload is a rolling log: each run
// merges what it finds with the previous payload and keeps LOG_DAYS days.
//
// The EUR-Lex proposals feed gives no item dates. An undated item is dated by
// its first sighting (`dateKind: 'seen'`); the ids already in a feed on its
// first good read are its baseline (`undatedSeen`), so they never read as new.

import { loadEnvFile, readCanonicalValue, runSeed } from './_seed-utils.mjs';
import { parseRssItems, readBoundedFeedText } from './seed-security-advisories.mjs';
import { FR_API_URL } from './seed-federal-register.mjs';
import { getOptionalUpstashCreds, upstashCommand } from './_upstash-rest.mjs';
import { isMainModule } from './lib/main-module.mjs';

export const CANONICAL_KEY = 'policy:ai-regulation:v1';
export const ACTIVATION_KEY = 'seed-activated:policy:ai-regulation';
export const EU_DIGITAL_URL = 'https://digital-strategy.ec.europa.eu/en/rss.xml';
export const EURLEX_FEEDS = Object.freeze([
  { id: 'eurlex-proposals', url: 'https://eur-lex.europa.eu/EN/display-feed.rss?rssId=161', label: 'EUR-Lex, Commission proposals' },
  { id: 'eurlex-oj', url: 'https://eur-lex.europa.eu/EN/display-feed.rss?rssId=165', label: 'EUR-Lex, Official Journal L' },
]);
export const FR_WINDOW_DAYS = 30;
export const LOG_DAYS = 60;
export const LOG_MAX = 120;
/** Undated ids remembered so they never read as new; the proposals feed holds 100. */
export const UNDATED_SEEN_MAX = 600;
export const AI_REGULATION_TTL_SECONDS = 48 * 3600; // a 2 h cadence
export const AI_REGULATION_MAX_STALE_MIN = 360;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_FEED_BYTES = 2 * 1024 * 1024;
const USER_AGENT = 'WorldMonitor ai-regulation seeder (+https://worldmonitor.app)';
const DAY_MS = 24 * 3600 * 1000;

/** AI and data rules, by name or by subject. */
export const AI_TOPIC = /\b(artificial intelligence|AI Act|general[- ]purpose AI|AI (systems?|models?|literacy|office|pact)|machine learning|2024\/1689|Data Act|2023\/2854|Data Governance Act|2022\/868|data protection|GDPR|European (Health )?Data Space)\b/i;
/** An instrument, as opposed to an event or a funding call. */
export const INSTRUMENT = /\b(guidelines?|guidance|code of practice|implementing (act|regulation|decision)|delegated (act|regulation)|regulation|directive|standardi[sz]ation request|template|proposal for a)\b/i;

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** The kind of an EU document from its title. */
export function euKind(title) {
  const t = title.toLowerCase();
  if (/guidelines?|guidance/.test(t)) return 'guidelines';
  if (/code of practice/.test(t)) return 'code of practice';
  if (/implementing (regulation|decision|act)/.test(t)) return 'implementing act';
  if (/delegated (regulation|act)/.test(t)) return 'delegated act';
  if (/proposal for a/.test(t)) return 'proposal';
  if (/\bdirective\b/.test(t)) return 'directive';
  if (/\bregulation\b/.test(t)) return 'regulation';
  return 'notice';
}

/**
 * One RSS item in the published shape, or null when it is not about AI or
 * data rules. EUR-Lex titles carry a "CELEX:…:" or "OJ:…:" prefix, which
 * becomes the id. An item without a date gets `publishedAt: null`; the fetch
 * dates it by its first sighting.
 */
export function euItem(raw, source, { needInstrument }) {
  let title = clean(raw?.title);
  const docId = /^(CELEX|OJ):([^:\s]+):\s*/.exec(title);
  if (docId) title = title.slice(docId[0].length);
  const text = `${title} ${clean(raw?.description).slice(0, 600)}`;
  if (!title || !AI_TOPIC.test(text) || (needInstrument && !INSTRUMENT.test(title))) return null;
  const at = raw?.pubDate ? Date.parse(raw.pubDate) : null;
  const link = clean(raw?.link);
  if (at !== null && !Number.isFinite(at)) return null;
  if (!/^https:\/\/(digital-strategy\.ec\.europa\.eu|eur-lex\.europa\.eu)\//.test(link)) return null;
  return {
    id: docId ? `${docId[1].toLowerCase()}:${docId[2]}` : `eu:${link}`,
    jurisdiction: 'EU',
    source,
    kind: euKind(title),
    title: title.length > 240 ? `${title.slice(0, 239)}…` : title,
    url: link,
    publishedAt: at,
  };
}

/** One Federal Register document in the published shape, or null when its title and abstract are not about AI. */
export function frItem(doc) {
  const title = clean(doc?.title);
  const abstract = clean(doc?.abstract);
  const date = typeof doc?.publication_date === 'string' ? doc.publication_date : '';
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !AI_TOPIC.test(`${title} ${abstract}`)) return null;
  if (doc.type !== 'Rule' && doc.type !== 'Proposed Rule') return null;
  const agency = (doc.agencies ?? []).map((a) => clean(a?.name)).filter(Boolean).pop() ?? '';
  return {
    id: `fr:${clean(doc.document_number)}`,
    jurisdiction: 'US',
    source: 'Federal Register',
    kind: doc.type === 'Rule' ? 'final rule' : 'proposed rule',
    title: title.length > 240 ? `${title.slice(0, 239)}…` : title,
    agency,
    url: typeof doc.html_url === 'string' && doc.html_url.startsWith('https://www.federalregister.gov/') ? doc.html_url : '',
    // Published around 08:45 New York time.
    publishedAt: Date.parse(`${date}T14:00:00Z`),
  };
}

async function getText(fetchImpl, url, accept) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return readBoundedFeedText(res, MAX_FEED_BYTES);
}

export function frUrl(since) {
  const params = new URLSearchParams({ order: 'newest', per_page: '100', 'conditions[term]': '"artificial intelligence"', 'conditions[publication_date][gte]': since });
  for (const t of ['RULE', 'PRORULE']) params.append('conditions[type][]', t);
  for (const f of ['document_number', 'title', 'type', 'abstract', 'publication_date', 'html_url', 'agencies']) params.append('fields[]', f);
  return `${FR_API_URL}?${params}`;
}

/** This run's items and the previous log, deduplicated, newest first, inside LOG_DAYS and LOG_MAX. */
export function mergeLog(fresh, previous, nowMs) {
  const cutoff = nowMs - LOG_DAYS * DAY_MS;
  const byId = new Map();
  for (const item of [...(Array.isArray(previous) ? previous : []), ...fresh]) {
    if (!item || typeof item.id !== 'string' || !Number.isFinite(item.publishedAt) || item.publishedAt < cutoff) continue;
    byId.set(item.id, { ...byId.get(item.id), ...item, seenAt: byId.get(item.id)?.seenAt ?? item.seenAt ?? nowMs });
  }
  return [...byId.values()].sort((a, b) => b.publishedAt - a.publishedAt || a.id.localeCompare(b.id)).slice(0, LOG_MAX);
}

// A failed read fails the run: starting fresh would drop the log and every
// source's last good read, and publish an empty success.
async function readPrevious() {
  if (!getOptionalUpstashCreds()) return null;
  return readCanonicalValue(CANONICAL_KEY, { strict: true });
}

/**
 * Dates undated items by their first sighting. Ids already in the log or in
 * `seen` are skipped (the log keeps their first date); on a source's first
 * good read (`baseline`) the ids are only remembered.
 */
export function dateUndated(items, { seen, logIds, baseline, nowMs }) {
  const out = [];
  for (const item of items) {
    if (item.publishedAt !== null) { out.push(item); continue; }
    if (seen.has(item.id) || logIds.has(item.id)) continue;
    seen.add(item.id);
    if (!baseline) out.push({ ...item, publishedAt: nowMs, dateKind: 'seen' });
  }
  return out;
}

const nonRetryable = (message) => Object.assign(new Error(message), { nonRetryable: true });

/**
 * runSeed fetch function. Each source fails on its own; the run fails only
 * when every source failed, so the last good log stays.
 */
export async function fetchAiRegulation({
  fetchImpl = (...args) => globalThis.fetch(...args),
  nowMs = Date.now(),
  loadPrevious = readPrevious,
} = {}) {
  const previous = await loadPrevious();
  const prevOk = new Map((Array.isArray(previous?.sources) ? previous.sources : []).map((s) => [s?.id, Number.isFinite(s?.okAt) ? s.okAt : null]));
  const startedAt = Number.isFinite(previous?.startedAt) ? previous.startedAt : nowMs;
  const prevSeen = Array.isArray(previous?.undatedSeen) ? previous.undatedSeen.filter((x) => typeof x === 'string') : [];
  const seen = new Set(prevSeen);
  const logIds = new Set((Array.isArray(previous?.items) ? previous.items : []).map((i) => i?.id));
  const sources = [];
  const fresh = [];
  const read = async (id, label, fn) => {
    try {
      const items = dateUndated(await fn(), { seen, logIds, baseline: !prevOk.get(id), nowMs });
      fresh.push(...items);
      sources.push({ id, label, ok: true, okAt: nowMs, kept: items.length });
    } catch (err) {
      const error = String(err?.message || err).slice(0, 200);
      console.warn(`  ${label}: ${error}`);
      sources.push({ id, label, ok: false, okAt: prevOk.get(id) ?? null, kept: 0, error });
    }
  };
  await read('eu-digital', 'European Commission, digital strategy', async () =>
    parseRssItems(await getText(fetchImpl, EU_DIGITAL_URL, 'application/rss+xml')).map((r) => euItem(r, 'European Commission', { needInstrument: true })).filter(Boolean));
  for (const feed of EURLEX_FEEDS) {
    await read(feed.id, feed.label, async () =>
      parseRssItems(await getText(fetchImpl, feed.url, 'application/rss+xml, application/xml')).map((r) => euItem(r, 'EUR-Lex', { needInstrument: false })).filter(Boolean));
  }
  await read('federal-register', 'Federal Register', async () => {
    const since = new Date(nowMs - FR_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
    const body = JSON.parse(await getText(fetchImpl, frUrl(since), 'application/json'));
    if (!Array.isArray(body?.results)) throw new Error('Federal Register: no results array');
    return body.results.map(frItem).filter(Boolean);
  });
  if (!sources.some((s) => s.ok)) throw nonRetryable(`every AI regulation source failed: ${sources.map((s) => `${s.id}: ${s.error}`).join('; ')}`);
  // The log is as fresh as its oldest source: one unread past the health budget fails the run,
  // so health turns stale instead of the other sources keeping it live. Both
  // throws are final for this run: runSeed's retries would only read the same
  // sources again. A source added later reads against the log's startedAt.
  for (const src of sources) {
    const lastOk = src.okAt ?? startedAt;
    if (nowMs - lastOk > AI_REGULATION_MAX_STALE_MIN * 60_000) throw nonRetryable(`${src.label} not read since ${new Date(lastOk).toISOString()}: ${src.error}`);
  }
  const items = mergeLog(fresh.map((i) => ({ ...i, seenAt: nowMs })), previous?.items, nowMs);
  console.log(`  AI regulation: ${sources.map((s) => `${s.id} ${s.ok ? s.kept : 'failed'}`).join(', ')}; ${items.length} in the ${LOG_DAYS}-day log`);
  const prevSet = new Set(prevSeen);
  const undatedSeen = [...seen].filter((x) => !prevSet.has(x)).concat(prevSeen).slice(0, UNDATED_SEEN_MAX);
  return { fetchedAt: nowMs, startedAt, logDays: LOG_DAYS, sources, items, undatedSeen };
}

export function validateFn(data) {
  return Boolean(data && Number.isFinite(data.fetchedAt) && Array.isArray(data.sources) && data.sources.some((s) => s?.ok)
    && Array.isArray(data.items) && data.items.every((i) => typeof i?.id === 'string' && Number.isFinite(i?.publishedAt)));
}

export function declareRecords(data) {
  return Array.isArray(data?.items) ? data.items.length : 0;
}

export async function markAiRegulationActivated() {
  try {
    const creds = getOptionalUpstashCreds();
    if (creds) await upstashCommand(creds, ['SET', ACTIVATION_KEY, '1']);
  } catch (error) {
    console.warn(`  WARN: activation marker write failed: ${error?.message || error}`);
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadEnvFile(import.meta.url);
  runSeed('policy', 'ai-regulation', CANONICAL_KEY, () => fetchAiRegulation(), {
    validateFn,
    declareRecords,
    ttlSeconds: AI_REGULATION_TTL_SECONDS,
    maxStaleMin: AI_REGULATION_MAX_STALE_MIN,
    schemaVersion: 1,
    zeroIsValid: true,
    sourceVersion: 'ec-eurlex-federal-register-v1',
    afterPublish: markAiRegulationActivated,
  }).catch((err) => {
    console.error('FATAL:', err?.message || err);
    process.exit(1);
  });
}
