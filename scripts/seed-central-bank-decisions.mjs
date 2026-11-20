#!/usr/bin/env node
// @ts-check
//
// Fed and ECB rate decisions for the Lite "Central bank decision" indicator
// (#130; spec docs/engineering/architecture/lite.md, Early indicators ›
// Catalogue, Central bank decisions). The meeting dates are already in
// seed-economic-calendar (FOMC and ECB rows); this seeder reads the decision
// itself as soon as it is published.
//
// Sources (no key; official):
// - The Federal Reserve's monetary policy press releases (RSS). Each "Federal
//   Reserve issues FOMC statement" item links the statement, which says what
//   the Committee decided for the federal funds target range, the vote, and
//   who dissented.
// - The ECB's press RSS. Each "Monetary policy decisions" item links the
//   release, which states the three key ECB rates. The feed holds only about
//   15 items (two to three weeks), so decisions are kept as a log across runs.
//
// Each run reads both feeds and fetches the pages of decisions it has not read
// yet. A page that cannot be read or parsed is kept with `parsed: false` and
// read again on later runs, so the card still says a decision came out. One
// feed failing keeps its decisions from the log for one health budget; past
// that the run fails, so health reports the older feed's age. A 200 answer
// with no RSS items (a maintenance or challenge page) counts as a failure.

import { loadEnvFile, readCanonicalValue, runSeed } from './_seed-utils.mjs';
import { readBoundedFeedText } from './seed-security-advisories.mjs';
import { getOptionalUpstashCreds, upstashCommand } from './_upstash-rest.mjs';
import { isMainModule } from './lib/main-module.mjs';

export const CANONICAL_KEY = 'economic:central-bank-decisions:v1';
export const ACTIVATION_KEY = 'seed-activated:economic:central-bank-decisions';
export const FED_FEED_URL = 'https://www.federalreserve.gov/feeds/press_monetary.xml';
export const ECB_FEED_URL = 'https://www.ecb.europa.eu/rss/press.html';
/** About fifteen months of meetings per bank. */
export const DECISIONS_KEPT = 10;
/** Pages read per run at most (a first run reads the feeds' backlog). */
export const PAGE_READS_PER_RUN = 8;
/** An unread page is retried for this long after publication. */
export const RETRY_DAYS = 3;
export const CB_DECISIONS_TTL_SECONDS = 7 * 24 * 3600;
export const CB_DECISIONS_MAX_STALE_MIN = 90; // a 30 min cadence
/** A feed may fail this long before the run fails with it: the health budget, so freshness follows the older feed. */
export const SOURCE_MAX_AGE_MIN = CB_DECISIONS_MAX_STALE_MIN;
const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const USER_AGENT = 'WorldMonitor central-bank-decisions seeder (+https://worldmonitor.app)';
const DAY_MS = 24 * 3600 * 1000;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘' };
const decode = (s) => String(s ?? '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&(amp|lt|gt|quot|apos|nbsp|ndash|mdash|rsquo|lsquo);/g, (_, e) => ENTITIES[/** @type {keyof typeof ENTITIES} */ (e)])
  .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === 'x' ? Number.parseInt(n.slice(1), 16) : Number(n)));

/** A page's visible text on one line. */
export function pageText(html) {
  return decode(String(html ?? '')
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** RSS items: title, link and publication time. */
export function feedItems(xml) {
  return [...String(xml ?? '').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)].map((m) => {
    const field = (name) => decode(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(m[1])?.[1] ?? '').replace(/\s+/g, ' ').trim();
    return { title: field('title'), link: field('link'), at: Date.parse(field('pubDate')) };
  }).filter((i) => i.title && i.link && Number.isFinite(i.at));
}

/** A feed's items, or a throw when the answer is not an RSS feed with items (both feeds list 15 or more). */
function rssItems(xml, name) {
  if (!feedItems(xml).length) throw new Error(`${name} answered without RSS items`);
  return xml;
}

/** The decision items of each feed, with their canonical links. */
export function fedDecisionItems(xml) {
  return feedItems(xml)
    .filter((i) => /\bFOMC statement\b/i.test(i.title) && /^https:\/\/www\.federalreserve\.gov\/newsevents\/pressreleases\/monetary\d{8}a\.htm$/.test(i.link))
    .map((i) => ({ bank: 'fed', url: i.link, at: i.at }));
}

export function ecbDecisionItems(xml) {
  return feedItems(xml)
    .map((i) => ({ ...i, link: i.link.replace(/^https:\/\/www\.ecb\.europa\.eu\/+/, 'https://www.ecb.europa.eu/') }))
    .filter((i) => /^monetary policy decisions$/i.test(i.title) && /^https:\/\/www\.ecb\.europa\.eu\/press\/pr\/date\/\d{4}\/html\/ecb\.mp\d{6}[^/\s]*\.en\.html$/.test(i.link))
    .map((i) => ({ bank: 'ecb', url: i.link, at: i.at }));
}

/** "3-3/4" → 3.75, "4" → 4, "1/4" → 0.25, "1-1/2" → 1.5. */
export function fedNumber(s) {
  const m = /^(?:(\d+)(?:-(\d+)\/(\d+))?|(\d+)\/(\d+))$/.exec(String(s ?? '').trim());
  if (!m) return null;
  if (m[4]) return Number(m[4]) / Number(m[5]);
  return Number(m[1]) + (m[2] ? Number(m[2]) / Number(m[3]) : 0);
}

const pct = (n) => `${n.toFixed(2)}%`;
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** What an FOMC statement decided, or null when its wording is not recognised. */
export function parseFedStatement(text) {
  const m = /The Committee decided to (maintain|raise|lower|reduce|decrease|increase) the target range for the federal funds rate (?:by ([\d/-]+) percentage points? )?(?:to|at) ([\d/-]+) to ([\d/-]+) percent/i.exec(text);
  if (!m) return null;
  const low = fedNumber(m[3]);
  const high = fedNumber(m[4]);
  const by = m[2] ? fedNumber(m[2]) : 0;
  if (low === null || high === null || by === null) return null;
  const verb = m[1].toLowerCase();
  const action = verb === 'maintain' ? 'hold' : /raise|increase/.test(verb) ? 'hike' : 'cut';
  if (action !== 'hold' && !by) return null;
  const votes = /by an? (\d+)\s*[–-]\s*(\d+) vote/i.exec(text) ?? /\bvote of (\d+)\s*[–-]\s*(\d+)/i.exec(text);
  // The dissent sentence runs to the first period that does not close an initial ("Lisa D. Cook").
  const against = /Voting against (?:the|this) (?:monetary policy )?action (?:was|were) (.+?)(?<!\b[A-Z])\.(?:\s|$)/.exec(text);
  const sentence = /The Committee decided to [^.]*? percent[^.]*\./.exec(text)?.[0] ?? m[0];
  return {
    action,
    changeBp: Math.round(by * 100) * (action === 'cut' ? -1 : 1),
    rate: high,
    rateText: `${low.toFixed(2)}–${pct(high)}`,
    rateLabel: 'target range',
    votes: votes ? `${votes[1]}–${votes[2]}` : null,
    dissent: against ? clip(against[1].trim(), 240) : null,
    summary: clip(sentence, 300),
  };
}

/** What an ECB "Monetary policy decisions" release decided, or null. */
export function parseEcbRelease(text) {
  const rates = /interest rates on the deposit facility, the main refinancing operations and the marginal lending facility will (?:be )?(increased|decreased|raised|lowered|reduced|remain unchanged) (?:to|at) (-?\d+(?:\.\d+)?)%, (-?\d+(?:\.\d+)?)% and (-?\d+(?:\.\d+)?)%/i.exec(text);
  if (!rates) return null;
  const [dfr, mro, mlf] = [rates[2], rates[3], rates[4]].map(Number);
  const verb = rates[1].toLowerCase();
  const action = /unchanged/.test(verb) ? 'hold' : /increased|raised/.test(verb) ? 'hike' : 'cut';
  const by = /decided to (?:raise|lower|cut|reduce|increase|decrease) the three key ECB interest rates by (\d+) basis points/i.exec(text);
  const changeBp = action === 'hold' ? 0 : by ? Number(by[1]) * (action === 'cut' ? -1 : 1) : null;
  const decided = /The Governing Council (?:today )?decided to [^.]*\./.exec(text)?.[0];
  const effect = /with effect from (\d{1,2} [A-Z][a-z]+ \d{4})/.exec(text)?.[1];
  return {
    action,
    changeBp,
    rate: dfr,
    rateText: pct(dfr),
    rateLabel: 'deposit facility rate',
    votes: null,
    dissent: null,
    summary: clip([decided, `Deposit facility ${pct(dfr)}, main refinancing ${pct(mro)}, marginal lending ${pct(mlf)}${effect ? `, from ${effect}` : ''}.`].filter(Boolean).join(' '), 300),
  };
}

const UNREAD = { action: null, changeBp: null, rate: null, rateText: '', rateLabel: '', votes: null, dissent: null, summary: '' };

async function fetchText(fetchImpl, url, maxBytes, accept) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return readBoundedFeedText(res, maxBytes);
}

/** This run's items over the previous log: newest first, DECISIONS_KEPT per bank. */
export function mergeDecisions(fresh, previous) {
  const byUrl = new Map();
  for (const d of [...(Array.isArray(previous) ? previous : []), ...fresh]) {
    if (!d || typeof d.url !== 'string' || !Number.isFinite(d.at) || (d.bank !== 'fed' && d.bank !== 'ecb')) continue;
    const prior = byUrl.get(d.url);
    // A parsed reading is never replaced by an unread one.
    byUrl.set(d.url, prior?.parsed && !d.parsed ? prior : { ...prior, ...d });
  }
  const all = [...byUrl.values()].sort((a, b) => b.at - a.at || a.url.localeCompare(b.url));
  return ['fed', 'ecb'].flatMap((bank) => all.filter((d) => d.bank === bank).slice(0, DECISIONS_KEPT)).sort((a, b) => b.at - a.at);
}

async function readPrevious() {
  // Strict: a failed read must fail the run, not drop the log the ECB feed cannot rebuild.
  return readCanonicalValue(CANONICAL_KEY, { strict: true });
}

/**
 * runSeed fetch function.
 * @param {{ fetchImpl?: typeof fetch, nowMs?: number, loadPrevious?: () => Promise<any>, fetchDeadlineAtMs?: number, clock?: () => number }} [opts]
 */
export async function fetchCentralBankDecisions({
  fetchImpl = (...args) => globalThis.fetch(...args),
  nowMs = Date.now(),
  loadPrevious = readPrevious,
  fetchDeadlineAtMs = Number.POSITIVE_INFINITY,
  clock = Date.now,
} = {}) {
  const prior = await loadPrevious();
  const previous = Array.isArray(prior?.decisions) ? prior.decisions : [];
  const feeds = await Promise.allSettled([
    fetchText(fetchImpl, FED_FEED_URL, MAX_FEED_BYTES, 'application/rss+xml, application/xml').then((xml) => fedDecisionItems(rssItems(xml, 'www.federalreserve.gov'))),
    fetchText(fetchImpl, ECB_FEED_URL, MAX_FEED_BYTES, 'application/rss+xml, application/xml').then((xml) => ecbDecisionItems(rssItems(xml, 'www.ecb.europa.eu'))),
  ]);
  const source = (bank, f) => {
    if (f.status === 'fulfilled') return { ok: true, items: f.value.length, okAt: nowMs };
    const okAt = Number.isFinite(prior?.sources?.[bank]?.okAt) ? prior.sources[bank].okAt : null;
    const error = String(f.reason?.message || f.reason).slice(0, 160);
    if (okAt === null || nowMs - okAt > SOURCE_MAX_AGE_MIN * 60_000) {
      throw new Error(`${bank} feed failed (${error}) and ${okAt === null ? 'has no earlier read' : `was last read ${Math.round((nowMs - okAt) / 60_000)} min ago`}`);
    }
    return { ok: false, error, okAt };
  };
  const sources = { fed: source('fed', feeds[0]), ecb: source('ecb', feeds[1]) };
  const items = feeds.flatMap((f) => (f.status === 'fulfilled' ? f.value : []));
  const known = new Map(previous.filter((d) => d && typeof d.url === 'string').map((d) => [d.url, d]));
  // Pages to read, newest first: new items, items a capped run left unread (no try yet), and failed
  // reads still inside the retry window.
  const toRead = [...items, ...previous]
    .filter((d, i, all) => all.findIndex((x) => x.url === d.url) === i)
    .filter((d) => {
      const k = known.get(d.url);
      return !k?.parsed && (!k?.tries || nowMs - d.at <= RETRY_DAYS * DAY_MS);
    })
    .sort((a, b) => b.at - a.at)
    .slice(0, PAGE_READS_PER_RUN);
  const read = [];
  for (const item of toRead) {
    // Leave the rest for the next run rather than lose this one to runSeed's fetch deadline.
    if (clock() + REQUEST_TIMEOUT_MS + 5_000 > fetchDeadlineAtMs) {
      console.warn(`  WARN: fetch deadline near; ${toRead.length - read.length} page(s) left for the next run`);
      break;
    }
    let parsed = null;
    try {
      const text = pageText(await fetchText(fetchImpl, item.url, MAX_PAGE_BYTES, 'text/html'));
      parsed = item.bank === 'fed' ? parseFedStatement(text) : parseEcbRelease(text);
      if (!parsed) console.warn(`  WARN: ${item.bank} decision wording not recognised: ${item.url}`);
    } catch (error) {
      console.warn(`  WARN: ${item.bank} decision page unread (${error?.message || error}): ${item.url}`);
    }
    read.push({ bank: item.bank, url: item.url, at: item.at, ...(parsed ?? UNREAD), parsed: Boolean(parsed), tries: (known.get(item.url)?.tries ?? 0) + 1 });
  }
  const unseen = items.filter((i) => !known.has(i.url) && !read.some((r) => r.url === i.url)).map((i) => ({ ...i, ...UNREAD, parsed: false, tries: 0 }));
  const decisions = mergeDecisions([...read, ...unseen], previous);
  console.log(`  Fed feed: ${sources.fed.ok ? `${sources.fed.items} statements` : `failed (${sources.fed.error})`}; ECB feed: ${sources.ecb.ok ? `${sources.ecb.items} decisions` : `failed (${sources.ecb.error})`}; ${read.length} page(s) read; ${decisions.length} in the log`);
  return { fetchedAt: nowMs, sources, decisions };
}

export function validateFn(data) {
  return Boolean(data && Number.isFinite(data.fetchedAt) && Array.isArray(data.decisions)
    && data.decisions.every((d) => (d?.bank === 'fed' || d?.bank === 'ecb') && typeof d.url === 'string' && Number.isFinite(d.at)));
}

/** Decisions in the log: the Fed feed always lists recent statements, so 0 means a broken read. */
export function declareRecords(data) {
  return Array.isArray(data?.decisions) ? data.decisions.length : 0;
}

export async function markCentralBankDecisionsActivated() {
  try {
    const creds = getOptionalUpstashCreds();
    if (creds) await upstashCommand(creds, ['SET', ACTIVATION_KEY, '1']);
  } catch (error) {
    console.warn(`  WARN: activation marker write failed: ${error?.message || error}`);
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadEnvFile(import.meta.url);
  runSeed('economic', 'central-bank-decisions', CANONICAL_KEY, (ctx) => fetchCentralBankDecisions({ fetchDeadlineAtMs: ctx?.fetchDeadlineAtMs }), {
    validateFn,
    declareRecords,
    ttlSeconds: CB_DECISIONS_TTL_SECONDS,
    maxStaleMin: CB_DECISIONS_MAX_STALE_MIN,
    schemaVersion: 1,
    sourceVersion: 'fed-press-monetary-ecb-press-rss-v1',
    afterPublish: markCentralBankDecisionsActivated,
  }).catch((err) => {
    console.error('FATAL:', err?.message || err);
    process.exit(1);
  });
}
