#!/usr/bin/env node
// @ts-check
//
// AI funding rounds from SEC Form D filings, for the Lite "AI funding · Form D"
// indicator (#142; spec docs/engineering/architecture/lite.md, Early indicators
// › Catalogue, AI funding rounds).
//
// Source: EDGAR full-text search (efts.sec.gov, no key) for new Form D notices
// (not D/A amendments) of the last FUNDING_WINDOW_DAYS that mention "AI" or
// "artificial intelligence", then each filing's primary document on
// www.sec.gov for the offering: total offering amount, amount sold, industry
// group, fund type and the issuer's state. US-only and noisy: a Form D carries
// little text, so the search matches mostly on names, and only issuers with AI
// in their name are kept (792 of 844 hits from Nov 2025 to Nov 2026; the rest
// were mostly unrelated, such as an oil mill and a business school).
//
// SEC fair access: a declared User-Agent (the repository's SEC one, as
// seed-sec-8k-stream) and requests one at a time, REQUEST_GAP_MS apart.

import { loadEnvFile, runSeed } from './_seed-utils.mjs';
import { getOptionalUpstashCreds, upstashCommand } from './_upstash-rest.mjs';
import { isMainModule } from './lib/main-module.mjs';

export const CANONICAL_KEY = 'tech:ai-funding:v1';
export const ACTIVATION_KEY = 'seed-activated:tech:ai-funding';
export const FUNDING_WINDOW_DAYS = 14;
export const AI_FUNDING_TTL_SECONDS = 36 * 3600; // a 6 h cadence
export const AI_FUNDING_MAX_STALE_MIN = 1080; // 3x the 6 h cadence, as seed-hyperscaler-capex
const SEARCH_URL = 'https://efts.sec.gov/LATEST/search-index';
const QUERIES = ['AI', '"artificial intelligence"'];
const PAGE_SIZE = 100;
/** Search pages per query: two weeks hold about 40 hits, so this is a safety cap. */
const MAX_PAGES = 5;
/** Documents read per run, newest filings first. */
const MAX_DOCS = 120;
const REQUEST_GAP_MS = 150;
// The repository's declared SEC User-Agent (seed-sec-8k-stream): SEC asks for a contact address.
const SEC_USER_AGENT = 'WorldMonitor/2.0 (monitor@worldmonitor.app)';
const DAY_MS = 86_400_000;

/**
 * An issuer name that is about AI: "Harvey AI Corp", "BlackTower Ai", "A.I. Ventures", "Artificial Intelligence
 * Fund", or AI joined on in capitals ("7AI", "OpenAI"). The joined form is case-sensitive: "Shanghai", "Mumbai",
 * "Thai" and "Bonsai" end in "ai" too.
 */
export const isAiName = (name) => /\bA\.?I\b|artificial intelligence/i.test(name) || /[a-z0-9]AI\b/.test(name);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => String(s ?? '')
  .replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTITIES[/** @type {keyof typeof ENTITIES} */ (e)])
  .replace(/&#(\d+);/g, (_, n) => (Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : ''))
  .replace(/\s+/g, ' ')
  .trim();
const tag = (xml, name) => {
  const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);
  return m ? decode(m[1]) : '';
};
/** A dollar amount, or null for "Indefinite" or anything not a number. */
const amount = (s) => (/^\d+(\.\d+)?$/.test(s) ? Number(s) : null);
const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** An EDGAR accession number, "0002161778-26-000001". */
const ADSH = /^\d{10}-\d{2}-\d{6}$/;

/** The filing's fields from its Form D primary document (primary_doc.xml). */
export function parseFormD(xml) {
  const firstSale = /<dateOfFirstSale>\s*<value>([^<]*)<\/value>/.exec(xml)?.[1]?.trim() ?? '';
  const industry = tag(xml, 'industryGroupType');
  return {
    entityName: tag(xml, 'entityName'),
    industry,
    fund: industry === 'Pooled Investment Fund',
    fundType: tag(xml, 'investmentFundType'),
    offering: amount(tag(xml, 'totalOfferingAmount')),
    sold: amount(tag(xml, 'totalAmountSold')),
    firstSale: YMD.test(firstSale) ? firstSale : '',
    state: /<issuerAddress>[\s\S]*?<stateOrCountry>([^<]*)<\/stateOrCountry>/.exec(xml)?.[1]?.trim() ?? '',
  };
}

/** "Nadhi AI, Inc.  (CIK 0002161778)" → "Nadhi AI, Inc.". */
const displayName = (s) => String(s ?? '').replace(/\s*\(CIK \d+\)\s*$/, '').trim();

async function getJson(fetchImpl, url, gapMs) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': SEC_USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  await sleep(gapMs);
  if (!res.ok) throw new Error(`HTTP ${res.status} from efts.sec.gov`);
  return res.json();
}

/** The Form D notices the search finds for one query in the window, newest first. */
async function searchQuery(fetchImpl, q, startdt, enddt, gapMs) {
  const out = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${SEARCH_URL}?q=${encodeURIComponent(q)}&forms=D&dateRange=custom&startdt=${startdt}&enddt=${enddt}&from=${page * PAGE_SIZE}`;
    const body = await getJson(fetchImpl, url, gapMs);
    const hits = body?.hits?.hits;
    if (!Array.isArray(hits)) throw new Error(`EDGAR search: unexpected response for ${q}`);
    for (const h of hits) {
      const s = h?._source;
      // A malformed hit (no accession number, CIK or filing date) is skipped, not published.
      const cik = Number(Array.isArray(s?.ciks) ? s.ciks[0] : NaN);
      if (!s || s.form !== 'D' || !ADSH.test(s.adsh ?? '') || !Number.isInteger(cik) || cik <= 0 || !YMD.test(s.file_date ?? '')) continue;
      out.push({ adsh: s.adsh, cik: String(cik), name: displayName(s.display_names?.[0]), fileDate: s.file_date });
    }
    if (hits.length < PAGE_SIZE) break;
  }
  return out;
}

/** The primary document, trying the filer's CIK and then the accession prefix (a filing agent's). */
async function fetchDoc(fetchImpl, hit, gapMs) {
  const folder = hit.adsh.replace(/-/g, '');
  for (const cik of [...new Set([hit.cik, String(Number(hit.adsh.slice(0, 10)))])]) {
    const res = await fetchImpl(`https://www.sec.gov/Archives/edgar/data/${cik}/${folder}/primary_doc.xml`, { headers: { 'User-Agent': SEC_USER_AGENT, Accept: 'application/xml, text/xml' }, signal: AbortSignal.timeout(30_000) });
    await sleep(gapMs);
    if (res.ok) return { xml: await res.text(), cik };
    if (res.status !== 404) throw new Error(`HTTP ${res.status} from www.sec.gov`);
  }
  return null;
}

/** runSeed fetch function: the window's AI-named Form D notices with their offerings, newest first. */
export async function fetchAiFunding({ fetchImpl = (...args) => globalThis.fetch(...args), nowMs = Date.now(), gapMs = REQUEST_GAP_MS } = {}) {
  const enddt = new Date(nowMs).toISOString().slice(0, 10);
  const startdt = new Date(nowMs - FUNDING_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  const byAdsh = new Map();
  for (const q of QUERIES) for (const h of await searchQuery(fetchImpl, q, startdt, enddt, gapMs)) if (!byAdsh.has(h.adsh)) byAdsh.set(h.adsh, h);
  const hits = [...byAdsh.values()];
  const named = hits.filter((h) => isAiName(h.name)).sort((a, b) => b.fileDate.localeCompare(a.fileDate) || a.adsh.localeCompare(b.adsh));
  const filings = [];
  let docErrors = 0;
  for (const h of named.slice(0, MAX_DOCS)) {
    let doc = null;
    let d = null;
    try {
      doc = await fetchDoc(fetchImpl, h, gapMs);
      d = doc ? parseFormD(doc.xml) : null;
    } catch (err) {
      console.warn(`  WARN: ${h.adsh}: ${err?.message || err}`);
    }
    if (!doc || !d) {
      docErrors++;
      continue;
    }
    filings.push({
      adsh: h.adsh,
      cik: doc.cik,
      name: d.entityName || h.name,
      fileDate: h.fileDate,
      firstSale: d.firstSale,
      offering: d.offering,
      sold: d.sold,
      industry: d.industry,
      fund: d.fund,
      fundType: d.fundType,
      state: d.state,
      url: `https://www.sec.gov/Archives/edgar/data/${doc.cik}/${h.adsh.replace(/-/g, '')}/${h.adsh}-index.htm`,
    });
  }
  // More than half unreadable means SEC is refusing or failing: keep the last good payload rather than publish a
  // window that looks quiet because its filings were not read.
  const tried = Math.min(named.length, MAX_DOCS);
  if (tried > 0 && docErrors > tried / 2) throw new Error(`Form D documents: ${docErrors} of ${tried} unreadable`);
  console.log(`  EDGAR: ${hits.length} Form D notices in ${FUNDING_WINDOW_DAYS} days, ${named.length} with AI in the name; ${filings.length} read${docErrors ? `, ${docErrors} unreadable` : ''}`);
  return { fetchedAt: nowMs, windowDays: FUNDING_WINDOW_DAYS, searched: hits.length, named: named.length, docErrors, filings };
}

export function validateFn(data) {
  return Boolean(data && Number.isFinite(data.fetchedAt) && Array.isArray(data.filings) && Number.isFinite(data.searched)
    && data.filings.every((f) => typeof f?.adsh === 'string' && YMD.test(f?.fileDate ?? '') && typeof f?.url === 'string'));
}

/** Form D notices the search returned: a quiet fortnight is still a full read. */
export function declareRecords(data) {
  return Number(data?.searched) || 0;
}

export async function markAiFundingActivated() {
  try {
    const creds = getOptionalUpstashCreds();
    if (creds) await upstashCommand(creds, ['SET', ACTIVATION_KEY, '1']);
  } catch (error) {
    console.warn(`  WARN: activation marker write failed: ${error?.message || error}`);
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadEnvFile(import.meta.url);
  runSeed('tech', 'ai-funding', CANONICAL_KEY, () => fetchAiFunding(), {
    validateFn,
    declareRecords,
    ttlSeconds: AI_FUNDING_TTL_SECONDS,
    maxStaleMin: AI_FUNDING_MAX_STALE_MIN,
    schemaVersion: 1,
    sourceVersion: 'edgar-fts-form-d-v1',
    afterPublish: markAiFundingActivated,
  }).catch((err) => {
    console.error('FATAL:', err?.message || err);
    process.exit(1);
  });
}
