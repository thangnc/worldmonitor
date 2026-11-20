#!/usr/bin/env node
// @ts-check
//
// Upcoming national elections, for the Lite "Elections" indicator (#141; spec
// docs/engineering/architecture/lite.md, Early indicators › Catalogue,
// Elections).
//
// Source: Wikipedia's "<year> national electoral calendar" pages (this year's
// and next year's), read as wikitext through the MediaWiki API. They list
// national elections and referendums by date, with the country and the office
// or chamber. IFES ElectionGuide, the issue's first suggestion, has no feed or
// published terms, and its robots.txt reserves rights over automated reuse
// (content signals `ai-train=no, use=reference`), so it is not scraped.
// Wikipedia text is CC BY-SA 4.0; the card shows only the facts (country,
// date, office) and links the election's article. Last year's page is read too,
// so a vote at the end of December still shows in early January.
//
// Kept: entries with an exact day in a month section. Skipped: month-only or
// undated entries, multi-date entries (indirect elections), and entries in
// italics, which the calendar uses for territories and partly recognised
// states (Transnistria, Northern Cyprus, Jersey).

import { createRequire } from 'node:module';

import { loadEnvFile, runSeed } from './_seed-utils.mjs';
import { getOptionalUpstashCreds, upstashCommand } from './_upstash-rest.mjs';
import { isMainModule } from './lib/main-module.mjs';

const require = createRequire(import.meta.url);
const { countryNameToIso2 } = require('./shared/country-name-to-iso2.cjs');

export const CANONICAL_KEY = 'intelligence:elections:v1';
export const ACTIVATION_KEY = 'seed-activated:intelligence:elections';
export const ELECTIONS_TTL_SECONDS = 72 * 3600; // a 12 h cadence
export const ELECTIONS_MAX_STALE_MIN = 1440;
/**
 * The three pages together list about 100 dated elections; far fewer means a
 * broken read. A sanity floor on the total, not on this year's page: in early
 * January the new year's page can hold fewer than 20 (2027's had 16 on
 * 2026-11-20), and last year's page still counts.
 */
export const MIN_TOTAL_ENTRIES = 20;
/** Elections kept from this many days back, so one held over a weekend still shows. */
const KEEP_PAST_DAYS = 3;
const API = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT = 'WorldMonitor elections seeder (+https://worldmonitor.app)';
const DAY_MS = 86_400_000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The calendar names some countries the shared resolver misses. */
const ALIASES = Object.freeze(Object.assign(Object.create(null), {
  'the gambia': 'GM',
  'republic of the congo': 'CG',
  'democratic republic of the congo': 'CD',
  'east timor': 'TL',
}));

/** ISO2 for a calendar country name, or null. */
export function calendarCountryCode(name) {
  const n = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!n) return null;
  return ALIASES[n.toLowerCase()] ?? countryNameToIso2(n);
}

const stripRefs = (t) => t
  .replace(/<ref[^>]*\/>/g, '')
  .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
  .replace(/<!--[\s\S]*?-->/g, '');
/** [[target|text]] → text, [[target]] → target. */
const linkText = (s) => s.replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, target, text) => (text ?? target).trim());
const plain = (s) => linkText(s).replace(/\{\{[^}]*\}\}/g, '').replace(/'{2,}/g, '').replace(/\s+/g, ' ').trim();
const pad = (n) => String(n).padStart(2, '0');
const articleUrl = (target) => `https://en.wikipedia.org/wiki/${encodeURIComponent(target.trim().replace(/ /g, '_')).replace(/%2F/g, '/')}`;

/**
 * One entry ("[[Elections in Spain|Spain]], [[2026 Spanish general election|Senate and Congress of Deputies]]")
 * on a date, or null when it is in italics or its country does not resolve.
 */
function parseEntry(entry, date, endDate) {
  const text = entry.trim();
  if (!text || text.startsWith("''")) return null;
  const links = [...text.matchAll(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g)];
  if (!links.length) return null;
  const [first, ...rest] = links;
  const countryName = (first[2] ?? first[1]).trim();
  const country = calendarCountryCode(countryName);
  if (!country) return null;
  const after = text.slice((first.index ?? 0) + first[0].length).replace(/^\s*,\s*/, '');
  const body = plain(after);
  // An article in the main namespace only: no namespace or interwiki prefix ("meta:", "File:").
  const article = rest.find((m) => !/^(Elections|Politics) (in|of) /.test(m[1]) && !m[1].includes(':'));
  return {
    date,
    ...(endDate ? { endDate } : {}),
    country,
    countryName: plain(countryName),
    body: body.length > 160 ? `${body.slice(0, 159)}…` : body,
    url: article ? articleUrl(article[1]) : '',
  };
}

/**
 * The elections with an exact day on one calendar page: `* 29 November: <entry>`,
 * or `* 4 October:` followed by `** <entry>` lines. A range ("9–10 October")
 * keeps its first day as `date` and its last as `endDate`.
 */
export function parseCalendar(wikitext, year) {
  const out = [];
  /** @type {string[]} */
  const skippedLines = [];
  const skip = (line) => { skippedLines.push(line.slice(0, 160)); };
  let month = -1;
  /** @type {{ date: string, endDate: string | null } | null} */
  let open = null;
  for (const raw of stripRefs(String(wikitext ?? '')).split('\n')) {
    const line = raw.trim();
    const heading = /^==\s*([^=]+?)\s*==$/.exec(line);
    if (heading) {
      month = MONTHS.indexOf(heading[1]);
      open = null;
      continue;
    }
    if (month < 0 || !line.startsWith('*')) continue;
    if (line.startsWith('**')) {
      if (!open) continue;
      const e = parseEntry(line.slice(2), open.date, open.endDate);
      if (e) out.push(e); else skip(line);
      continue;
    }
    open = null;
    const m = /^\*\s*(\d{1,2})(?:\s*[–-]\s*(\d{1,2}))?\s+([A-Z][a-z]+)\s*:?\s*(.*)$/.exec(line);
    if (!m || MONTHS.indexOf(m[3]) < 0) {
      skip(line);
      continue;
    }
    const mi = MONTHS.indexOf(m[3]);
    const date = `${year}-${pad(mi + 1)}-${pad(Number(m[1]))}`;
    const endDate = m[2] ? `${year}-${pad(mi + 1)}-${pad(Number(m[2]))}` : null;
    if (Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      skip(line);
      continue;
    }
    if (m[4]) {
      const e = parseEntry(m[4], date, endDate);
      if (e) out.push(e); else skip(line);
    } else {
      open = { date, endDate };
    }
  }
  return { elections: out, skipped: skippedLines.length, skippedLines };
}

/** One page's wikitext, or null when the page does not exist (next year's page can be missing early on). */
async function fetchPage(fetchImpl, year) {
  const url = `${API}?action=parse&page=${encodeURIComponent(`${year} national electoral calendar`)}&prop=wikitext&format=json&formatversion=2&redirects=1`;
  const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from en.wikipedia.org (${year} calendar)`);
  const body = await res.json();
  if (body?.error?.code === 'missingtitle') return null;
  const text = body?.parse?.wikitext;
  if (typeof text !== 'string') throw new Error(`${year} calendar: no wikitext (${body?.error?.code ?? 'unexpected response'})`);
  return text;
}

/**
 * runSeed fetch function: elections from KEEP_PAST_DAYS ago, by date, from last
 * year's, this year's and next year's pages. Last year's keeps a vote on 29–31
 * December in early January; next year's covers the 30-day window in December.
 */
export async function fetchElections({ fetchImpl = (...args) => globalThis.fetch(...args), nowMs = Date.now() } = {}) {
  const year = new Date(nowMs).getUTCFullYear();
  const pages = [];
  for (const y of [year - 1, year, year + 1]) {
    const text = await fetchPage(fetchImpl, y);
    if (text === null && y === year) throw new Error(`${y} calendar: page missing`);
    const parsed = text === null ? { elections: [], skipped: 0 } : parseCalendar(text, y);
    pages.push({ year: y, found: text !== null, entries: parsed.elections.length, skipped: parsed.skipped, elections: parsed.elections });
  }
  const total = pages.reduce((n, p) => n + p.entries, 0);
  if (total < MIN_TOTAL_ENTRIES) throw new Error(`calendars ${year - 1}–${year + 1}: ${total} dated elections, expected at least ${MIN_TOTAL_ENTRIES}`);
  const from = new Date(nowMs - KEEP_PAST_DAYS * DAY_MS).toISOString().slice(0, 10);
  const seen = new Set();
  const elections = pages.flatMap((p) => p.elections)
    .filter((e) => (e.endDate ?? e.date) >= from && !seen.has(`${e.date}|${e.country}|${e.body}`) && seen.add(`${e.date}|${e.country}|${e.body}`))
    .sort((a, b) => a.date.localeCompare(b.date) || a.country.localeCompare(b.country));
  console.log(`  Calendars: ${pages.map((p) => `${p.year} ${p.found ? `${p.entries} dated, ${p.skipped} skipped` : 'missing'}`).join('; ')}; ${elections.length} from ${from}`);
  return {
    fetchedAt: nowMs,
    pages: pages.map(({ year: y, found, entries }) => ({ year: y, found, entries })),
    elections,
  };
}

export function validateFn(data) {
  return Boolean(data && Number.isFinite(data.fetchedAt) && Array.isArray(data.elections) && Array.isArray(data.pages)
    && data.pages.reduce((n, p) => n + (p?.found ? Number(p.entries) || 0 : 0), 0) >= MIN_TOTAL_ENTRIES
    && data.elections.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e?.date ?? '') && /^[A-Z]{2}$/.test(e?.country ?? '')));
}

/** Every dated election read this run: an empty upcoming list is still a full read. */
export function declareRecords(data) {
  return Array.isArray(data?.pages) ? data.pages.reduce((n, p) => n + (Number(p?.entries) || 0), 0) : 0;
}

export async function markElectionsActivated() {
  try {
    const creds = getOptionalUpstashCreds();
    if (creds) await upstashCommand(creds, ['SET', ACTIVATION_KEY, '1']);
  } catch (error) {
    console.warn(`  WARN: activation marker write failed: ${error?.message || error}`);
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadEnvFile(import.meta.url);
  runSeed('intelligence', 'elections', CANONICAL_KEY, () => fetchElections(), {
    validateFn,
    declareRecords,
    ttlSeconds: ELECTIONS_TTL_SECONDS,
    maxStaleMin: ELECTIONS_MAX_STALE_MIN,
    schemaVersion: 1,
    sourceVersion: 'wikipedia-national-electoral-calendar-v1',
    afterPublish: markElectionsActivated,
  }).catch((err) => {
    console.error('FATAL:', err?.message || err);
    process.exit(1);
  });
}
