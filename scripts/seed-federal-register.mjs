#!/usr/bin/env node
// @ts-check
//
// Federal Register documents from the Bureau of Industry and Security (export
// controls, Entity List rules) and the US Trade Representative (tariff
// actions), for the Lite "Export controls and tariffs" indicator (#122; spec
// docs/engineering/architecture/lite.md, Early indicators › Catalogue). The
// same key is meant to serve AI rules (#127) and chip export controls on Tech.
//
// Source: the Federal Register API, keyless. The documents are US government
// works (public domain); the API asks only for reasonable request rates. One
// request per run covers the last WINDOW_DAYS days of both agencies.
//
// Kept: rules and proposed rules from either agency, and notices that change
// controls or tariffs (Entity List and EAR notices; Section 301/232 actions,
// exclusions, modifications). Dropped: routine notices (information
// collection, meetings, rosters, advisory committees).

import { loadEnvFile, runSeed } from './_seed-utils.mjs';
import { getOptionalUpstashCreds, upstashCommand } from './_upstash-rest.mjs';
import { isMainModule } from './lib/main-module.mjs';

export const CANONICAL_KEY = 'policy:federal-register:v1';
export const ACTIVATION_KEY = 'seed-activated:policy:federal-register';
export const FR_API_URL = 'https://www.federalregister.gov/api/v1/documents.json';
/** Federal Register agency slugs and the short names the cards use. */
export const AGENCIES = Object.freeze({
  'industry-and-security-bureau': 'BIS',
  'trade-representative-office-of-united-states': 'USTR',
});
export const WINDOW_DAYS = 30;
export const PER_PAGE = 200;
export const MAX_PAGES = 3;
export const MAX_ABSTRACT_CHARS = 400;
export const FEDERAL_REGISTER_TTL_SECONDS = 24 * 3600; // a 2 h cadence; survives a day of failed runs
export const FEDERAL_REGISTER_MAX_STALE_MIN = 360;
const REQUEST_TIMEOUT_MS = 20_000;
const USER_AGENT = 'WorldMonitor Federal Register seeder (+https://worldmonitor.app)';
const DAY_MS = 24 * 3600 * 1000;
const FIELDS = ['document_number', 'title', 'type', 'action', 'abstract', 'publication_date', 'effective_on', 'html_url', 'agencies'];

const ROUTINE = /information collection|paperwork reduction|sunshine act|\bmeetings?\b|roster|request for (applications|nominations)|privacy act|delegation of authority|advisory committee|technical advisory|senior executive service/i;
const EXPORT_CONTROL = /export administration regulations|entity list|export control|unverified list|military end.user|foreign direct product|license (requirements?|exceptions?)|advanced (computing|semiconductors?)|semiconductor|denied persons|temporary denial order/i;
const TRADE_ACTION = /tariffs?|section (301|232|201)|\bdut(y|ies)\b|exclusions?|modification of (section \d+ )?action|retaliat|trade (agreement|remedy)|imports? of/i;
const AI_RELATED = /artificial intelligence|\bAI\b|model weights|frontier model/i;

/**
 * The agency and kind of a document, or null when it is routine. A rule or
 * proposed rule always counts; a notice counts when it changes controls or
 * tariffs.
 * @param {{ type?: string, title?: string, action?: string, agencies?: Array<{ slug?: string }> }} doc
 */
export function classifyDocument(doc) {
  const agency = (doc.agencies ?? []).map((a) => AGENCIES[/** @type {keyof typeof AGENCIES} */ (a?.slug ?? '')]).find(Boolean);
  if (!agency) return null;
  const text = `${doc.title ?? ''} ${doc.action ?? ''}`;
  const kind = agency === 'BIS' ? 'export-control' : 'tariff';
  if (doc.type === 'Rule' || doc.type === 'Proposed Rule') return ROUTINE.test(doc.title ?? '') ? null : { agency, kind };
  if (doc.type !== 'Notice' || ROUTINE.test(text)) return null;
  return (agency === 'BIS' ? EXPORT_CONTROL : TRADE_ACTION).test(text) ? { agency, kind } : null;
}

/** One kept document in the browser shape, or null. */
export function summarizeDocument(doc) {
  const id = typeof doc?.document_number === 'string' ? doc.document_number.trim() : '';
  const publishedAt = typeof doc?.publication_date === 'string' ? doc.publication_date.slice(0, 10) : '';
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(publishedAt) || typeof doc.title !== 'string' || !doc.title.trim()) return null;
  const cls = classifyDocument(doc);
  if (!cls) return null;
  const abstract = typeof doc.abstract === 'string' ? doc.abstract.replace(/\s+/g, ' ').trim() : '';
  return {
    id,
    title: doc.title.replace(/\s+/g, ' ').trim(),
    type: doc.type,
    action: typeof doc.action === 'string' ? doc.action.trim() : '',
    agency: cls.agency,
    kind: cls.kind,
    publishedAt,
    effectiveOn: typeof doc.effective_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(doc.effective_on) ? doc.effective_on : '',
    url: typeof doc.html_url === 'string' && doc.html_url.startsWith('https://www.federalregister.gov/') ? doc.html_url : '',
    abstract: abstract.length > MAX_ABSTRACT_CHARS ? `${abstract.slice(0, MAX_ABSTRACT_CHARS - 1)}…` : abstract,
    aiRelated: AI_RELATED.test(`${doc.title} ${abstract}`),
  };
}

export function buildUrl(since, page = 1) {
  const params = new URLSearchParams({ order: 'newest', per_page: String(PER_PAGE), page: String(page), 'conditions[publication_date][gte]': since });
  for (const slug of Object.keys(AGENCIES)) params.append('conditions[agencies][]', slug);
  for (const field of FIELDS) params.append('fields[]', field);
  return `${FR_API_URL}?${params}`;
}

/**
 * runSeed fetch function: the last WINDOW_DAYS days of BIS and USTR documents,
 * kept documents newest first. An empty window means the API answered
 * nothing for two active agencies over a month, so it is treated as a failure
 * and the last good payload stays.
 */
export async function fetchFederalRegister({ fetchImpl = (...args) => globalThis.fetch(...args), nowMs = Date.now() } = {}) {
  const since = new Date(nowMs - WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  const docs = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetchImpl(buildUrl(since, page), {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const error = new Error(`Federal Register HTTP ${res.status}`);
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) Object.assign(error, { nonRetryable: true });
      throw error;
    }
    const body = await res.json();
    if (!body || !Array.isArray(body.results)) throw Object.assign(new Error('Federal Register: no results array'), { nonRetryable: true });
    docs.push(...body.results);
    if (!(Number(body.total_pages) > page)) break;
  }
  if (docs.length === 0) throw new Error(`Federal Register: no BIS or USTR document since ${since}`);
  const seen = new Set();
  const items = docs
    .map(summarizeDocument)
    .filter((d) => d && !seen.has(d.id) && seen.add(d.id))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.id.localeCompare(a.id));
  console.log(`  Federal Register: ${docs.length} BIS/USTR documents since ${since}, ${items.length} kept`);
  return { fetchedAt: nowMs, windowDays: WINDOW_DAYS, scanned: docs.length, items };
}

export function validateFn(data) {
  return Boolean(data && Number.isFinite(data.fetchedAt) && data.fetchedAt > 0 && Array.isArray(data.items) && Number(data.scanned) > 0
    && data.items.every((i) => typeof i?.id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(i?.publishedAt ?? '')));
}

export function declareRecords(data) {
  return Array.isArray(data?.items) ? data.items.length : 0;
}

export async function markFederalRegisterActivated() {
  try {
    const creds = getOptionalUpstashCreds();
    if (creds) await upstashCommand(creds, ['SET', ACTIVATION_KEY, '1']);
  } catch (error) {
    console.warn(`  WARN: activation marker write failed: ${error?.message || error}`);
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadEnvFile(import.meta.url);
  runSeed('policy', 'federal-register', CANONICAL_KEY, () => fetchFederalRegister(), {
    validateFn,
    declareRecords,
    ttlSeconds: FEDERAL_REGISTER_TTL_SECONDS,
    maxStaleMin: FEDERAL_REGISTER_MAX_STALE_MIN,
    schemaVersion: 1,
    zeroIsValid: true,
    sourceVersion: 'federal-register-bis-ustr-v1',
    afterPublish: markFederalRegisterActivated,
  }).catch((err) => {
    console.error('FATAL:', err?.message || err);
    process.exit(1);
  });
}
