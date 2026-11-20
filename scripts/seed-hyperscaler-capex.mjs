#!/usr/bin/env node
// @ts-check
//
// Quarterly capital spending of Microsoft, Alphabet, Amazon and Meta for the
// Lite "Hyperscaler capital spending" indicator (#135; spec
// docs/engineering/architecture/lite.md, Early indicators › Catalogue):
// where AI infrastructure money is going.
//
// Source (no key): SEC EDGAR's XBRL company concept API on data.sec.gov, the
// figures the companies tag in their 10-Q and 10-K filings. Capital spending
// is the cash-flow line "purchases of property and equipment":
// `PaymentsToAcquirePropertyPlantAndEquipment` for Microsoft, Alphabet and
// Meta; Amazon has tagged it `PaymentsToAcquireProductiveAssets` since 2017.
//
// Filings carry three-month figures for some quarters and only year-to-date
// figures for others (Alphabet and Meta report six and nine months, and the
// 10-K the full year), so a quarter is either a three-month figure or the
// difference between two year-to-date figures from the same start, three
// months apart. A period restated by a later filing takes the newer value; it
// is dated by the filing that first reported it (EDGAR's filing date).
//
// Stateless: every run reads each company's whole history, so nothing carries
// over between runs. Any company failing fails the run, and the last good
// value stays in Redis until health's budget runs out.

import { loadEnvFile, runSeed } from './_seed-utils.mjs';
import { readBoundedFeedText } from './seed-security-advisories.mjs';
import { getOptionalUpstashCreds, upstashCommand } from './_upstash-rest.mjs';
import { isMainModule } from './lib/main-module.mjs';

export const CANONICAL_KEY = 'tech:hyperscaler-capex:v1';
export const ACTIVATION_KEY = 'seed-activated:tech:hyperscaler-capex';
export const conceptUrl = (cik, concept) => `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${concept}.json`;
export const COMPANIES = Object.freeze([
  { ticker: 'MSFT', name: 'Microsoft', cik: '0000789019', concept: 'PaymentsToAcquirePropertyPlantAndEquipment' },
  { ticker: 'GOOGL', name: 'Alphabet', cik: '0001652044', concept: 'PaymentsToAcquirePropertyPlantAndEquipment' },
  { ticker: 'AMZN', name: 'Amazon', cik: '0001018724', concept: 'PaymentsToAcquireProductiveAssets' },
  { ticker: 'META', name: 'Meta', cik: '0001326801', concept: 'PaymentsToAcquirePropertyPlantAndEquipment' },
]);
/** Quarters kept per company, newest first: enough for the latest, the one before, and both a year earlier. */
export const QUARTERS_KEPT = 9;
/** The trigger needs the latest quarter, the one before and both a year earlier: six quarters at least. */
export const MIN_QUARTERS = 6;
/** A latest quarter ending longer ago than this means the company stopped tagging the concept (Amazon, 2017). */
export const MAX_LATEST_AGE_DAYS = 200;
export const CAPEX_TTL_SECONDS = 7 * 24 * 3600;
export const CAPEX_MAX_STALE_MIN = 1080; // a 6 h cadence
const MAX_CONCEPT_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
/** SEC needs a declared User-Agent with a contact (same convention as seed-sec-8k-stream). */
const SEC_USER_AGENT = 'WorldMonitor/2.0 (monitor@worldmonitor.app)';
/** SEC allows 10 requests a second; stay well under. */
const REQUEST_GAP_MS = 250;

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const days = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const dayAfter = (date) => new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
const isQuarterLong = (d) => d >= 80 && d <= 100;

/**
 * @typedef {{ start: string, end: string, value: number, filed: string, form: string, accn: string, derived: boolean, doubt?: 'restated' | 'negative' }} Quarter
 * `filed` is the date of the filing that first reported the quarter (for a derived quarter, its later year-to-date
 * figure): the card's time. `form` and `accn` are the filing the value comes from, the newest that reported it, so
 * the link shows the number on the card. `doubt` marks a derived quarter not to compare: its two year-to-date figures
 * come from different filings and one of them restated earlier figures (two accounting bases), or the difference is
 * negative.
 */

/**
 * Single quarters, newest first, from a concept's USD facts.
 * @param {Array<{ start?: string, end?: string, val?: number, filed?: string, form?: string, accn?: string }>} facts
 * @returns {Array<Quarter>}
 */
export function quarterly(facts) {
  /** @type {Map<string, { start: string, end: string, val: number, filed: string, form: string, accn: string, newest: string }>} */
  const periods = new Map();
  /** Filings that changed a figure an earlier filing had reported. */
  const restating = new Set();
  const usable = (Array.isArray(facts) ? facts : []).filter((f) => f && ISO_DATE.test(String(f.start)) && ISO_DATE.test(String(f.end)) && ISO_DATE.test(String(f.filed))
    && typeof f.val === 'number' && Number.isFinite(f.val) && /^10-[QK]/.test(String(f.form ?? '')));
  // Oldest filing first, so "an earlier filing" is well defined.
  usable.sort((a, b) => String(a.filed).localeCompare(String(b.filed)));
  for (const f of usable) {
    const start = String(f.start), end = String(f.end), filed = String(f.filed), val = /** @type {number} */ (f.val);
    const form = String(f.form), accn = /^\d{10}-\d{2}-\d{6}$/.test(String(f.accn)) ? String(f.accn) : '';
    const k = `${start}|${end}`;
    const p = periods.get(k);
    if (!p) { periods.set(k, { start, end, val, filed, form, accn, newest: filed }); continue; }
    if (val !== p.val && accn && accn !== p.accn) restating.add(accn);
    Object.assign(p, { val, form, accn, newest: filed });
  }
  /** @type {Map<string, Quarter>} */
  const quarters = new Map();
  for (const p of periods.values()) {
    if (isQuarterLong(days(p.start, p.end)) && p.val >= 0) quarters.set(p.end, { start: p.start, end: p.end, value: p.val, filed: p.filed, form: p.form, accn: p.accn, derived: false });
  }
  // Year-to-date figures from the same start, three months apart: their difference is the quarter between.
  const byStart = new Map();
  for (const p of periods.values()) {
    const d = days(p.start, p.end);
    if (d < 80 || d > 380) continue;
    if (!byStart.has(p.start)) byStart.set(p.start, []);
    byStart.get(p.start).push(p);
  }
  for (const list of byStart.values()) {
    list.sort((a, b) => a.end.localeCompare(b.end));
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      if (quarters.has(b.end) || !isQuarterLong(days(a.end, b.end))) continue;
      const value = b.val - a.val;
      const mixed = a.accn !== b.accn && (restating.has(a.accn) || restating.has(b.accn));
      /** @type {Quarter} */
      const q = { start: dayAfter(a.end), end: b.end, value, filed: b.filed, form: b.form, accn: b.accn, derived: true };
      if (value < 0) q.doubt = 'negative';
      else if (mixed) q.doubt = 'restated';
      quarters.set(b.end, q);
    }
  }
  return [...quarters.values()].sort((x, y) => y.end.localeCompare(x.end));
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** One company's quarters; throws on an HTTP error, a non-JSON answer, too few quarters or a stale concept. */
async function readCompany(fetchImpl, company, nowMs) {
  const url = conceptUrl(company.cik, company.concept);
  const res = await fetchImpl(url, { headers: { 'User-Agent': SEC_USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${company.name}: HTTP ${res.status} from data.sec.gov`);
  const body = await readBoundedFeedText(res, MAX_CONCEPT_BYTES);
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error(`${company.name}: data.sec.gov answered with something other than JSON`);
  }
  const quarters = quarterly(json?.units?.USD);
  if (quarters.length < MIN_QUARTERS) {
    throw Object.assign(new Error(`${company.name}: ${quarters.length} quarters of ${company.concept}, expected at least ${MIN_QUARTERS}`), { nonRetryable: true });
  }
  const age = days(quarters[0].end, new Date(nowMs).toISOString().slice(0, 10));
  if (age > MAX_LATEST_AGE_DAYS) {
    throw Object.assign(new Error(`${company.name}: latest ${company.concept} quarter ends ${quarters[0].end}, ${age} days ago; has the company changed its tag?`), { nonRetryable: true });
  }
  return { ticker: company.ticker, name: company.name, cik: company.cik, concept: company.concept, quarters: quarters.slice(0, QUARTERS_KEPT) };
}

/**
 * runSeed fetch function: each company's latest quarters of capital spending.
 * @param {{ fetchImpl?: typeof fetch, nowMs?: number, gapMs?: number }} [opts]
 */
export async function fetchHyperscalerCapex({
  fetchImpl = (...args) => globalThis.fetch(...args),
  nowMs = Date.now(),
  gapMs = REQUEST_GAP_MS,
} = {}) {
  const companies = [];
  for (const [i, company] of COMPANIES.entries()) {
    if (i) await sleep(gapMs);
    const c = await readCompany(fetchImpl, company, nowMs);
    const [q] = c.quarters;
    console.log(`  ${c.name}: ${q.start} to ${q.end} $${(q.value / 1e9).toFixed(1)}bn${q.derived ? ' (from year-to-date)' : ''}, filed ${q.filed}; ${c.quarters.length} quarters`);
    for (const d of c.quarters.filter((x) => x.doubt)) console.warn(`  WARN: ${c.name} ${d.end}: ${d.doubt === 'negative' ? 'a negative quarter from year-to-date figures' : 'year-to-date figures on two bases (a filing restated earlier figures)'}; not compared`);
    companies.push(c);
  }
  return { fetchedAt: nowMs, unit: 'USD', companies };
}

export function validateFn(data) {
  return Boolean(data && Number.isFinite(data.fetchedAt) && Array.isArray(data.companies) && data.companies.length === COMPANIES.length
    && data.companies.every((c) => Array.isArray(c?.quarters) && c.quarters.length >= MIN_QUARTERS
      && c.quarters.every((q) => ISO_DATE.test(q?.end) && ISO_DATE.test(q?.filed) && Number.isFinite(q?.value))));
}

export function declareRecords(data) {
  return Array.isArray(data?.companies) ? data.companies.reduce((n, c) => n + (Array.isArray(c?.quarters) ? c.quarters.length : 0), 0) : 0;
}

export async function markCapexActivated() {
  try {
    const creds = getOptionalUpstashCreds();
    if (creds) await upstashCommand(creds, ['SET', ACTIVATION_KEY, '1']);
  } catch (error) {
    console.warn(`  WARN: activation marker write failed: ${error?.message || error}`);
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadEnvFile(import.meta.url);
  runSeed('tech', 'hyperscaler-capex', CANONICAL_KEY, () => fetchHyperscalerCapex(), {
    validateFn,
    declareRecords,
    ttlSeconds: CAPEX_TTL_SECONDS,
    maxStaleMin: CAPEX_MAX_STALE_MIN,
    schemaVersion: 1,
    sourceVersion: 'sec-companyconcept-capex-v1',
    afterPublish: markCapexActivated,
  }).catch((err) => {
    console.error('FATAL:', err?.message || err);
    process.exit(1);
  });
}
