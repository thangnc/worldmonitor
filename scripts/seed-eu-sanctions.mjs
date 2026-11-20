#!/usr/bin/env node
// @ts-check
//
// New EU financial sanctions listings, for the Lite "New sanctions · EU"
// indicator (#129; spec docs/engineering/architecture/lite.md, Early
// indicators › Catalogue, New sanctions).
//
// Source: the European Commission's consolidated list of persons, groups and
// entities subject to EU financial sanctions (Financial Sanctions Files,
// XML v1.1, behind the public token the Commission publishes on
// data.europa.eu). Each run reads the whole list and compares its entity ids
// with the previous run's (`sanctions:eu-sanctions:state:v1`): an id not seen
// before is a new listing, dated by the run that first saw it. The first run
// only sets the baseline.
//
// Guards: a document without its closing tag, a list far shorter than
// expected, or one much shorter than the previous one, fails the run, so a
// truncated download never resets the baseline and then reports every entity
// as new.

import { loadEnvFile, runSeed } from './_seed-utils.mjs';
import { readBoundedFeedText } from './seed-security-advisories.mjs';
import { getOptionalUpstashCreds, upstashCommand } from './_upstash-rest.mjs';
import { isMainModule } from './lib/main-module.mjs';

export const CANONICAL_KEY = 'sanctions:eu-additions:v1';
export const STATE_KEY = 'sanctions:eu-sanctions:state:v1';
export const ACTIVATION_KEY = 'seed-activated:sanctions:eu-additions';
export const EU_FSF_URL = 'https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw';
/** The list holds about 5,000 entities; far fewer means a broken download. */
export const MIN_ENTITIES = 2500;
/** A list this much shorter than the previous one is held, not trusted. */
export const MAX_SHRINK = 0.1;
export const ADDITIONS_KEEP_DAYS = 14;
export const ADDITIONS_MAX = 500;
export const EU_SANCTIONS_TTL_SECONDS = 72 * 3600; // a 6 h cadence
export const STATE_TTL_SECONDS = 60 * 24 * 3600;
export const EU_SANCTIONS_MAX_STALE_MIN = 720;
const MAX_FILE_BYTES = 80 * 1024 * 1024;
// The 26 MB file took 130 s to download on a slow day (2026-11-20); the local runner allows 300 s.
const REQUEST_TIMEOUT_MS = 240_000;
const USER_AGENT = 'WorldMonitor eu-sanctions seeder (+https://worldmonitor.app)';
const DAY_MS = 24 * 3600 * 1000;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => String(s ?? '')
  .replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTITIES[/** @type {keyof typeof ENTITIES} */ (e)])
  .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === 'x' ? Number.parseInt(n.slice(1), 16) : Number(n)))
  .replace(/\s+/g, ' ')
  .trim();

/** The attributes of one start tag, decoded. */
export function attrs(tag) {
  const out = /** @type {Record<string, string>} */ ({});
  for (const m of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1].replace(/^\w+:/, '')] = decode(m[2]);
  return out;
}

const tags = (body, name) => [...body.matchAll(new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>`, 'g'))].map((m) => attrs(m[0]));
const ISO2 = /^[A-Z]{2}$/;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** An eur-lex link, on https (older acts in the file link over http), or ''. */
const eurLex = (u) => (/^https?:\/\/eur-lex\.europa\.eu\//.test(u) ? u.replace(/^http:/, 'https:') : '');

/**
 * One `<sanctionEntity>` in the stored shape, or null without an id or name.
 * The name is the first strong alias (else the first alias); countries come
 * from citizenship and addresses. The listing date is the entity's
 * `designationDate`, else its earliest act (`regulation` or a
 * `regulationSummary` on a name or address). `regulation` and `url` are the
 * entity's own `<regulation>`, the latest act on it: for a new listing, the
 * act that listed it.
 */
export function parseEntity(open, body) {
  const a = attrs(open);
  const id = a.logicalId;
  const aliases = tags(body, 'nameAlias').filter((n) => n.wholeName);
  const alias = aliases.find((n) => n.strong === 'true' && (!n.nameLanguage || n.nameLanguage === 'EN')) ?? aliases.find((n) => n.strong === 'true') ?? aliases[0];
  if (!id || !alias) return null;
  // A `<regulation>` is self-closing or holds its `<publicationUrl>`.
  const acts = [...body.matchAll(/<(?:\w+:)?regulation\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?regulation>)/g)]
    .map((m) => ({ ...attrs(m[1]), url: eurLex(decode(/<(?:\w+:)?publicationUrl>([^<]*)</.exec(m[2] ?? '')?.[1] ?? '')) }))
    .filter((r) => DATE.test(r.publicationDate ?? ''))
    .sort((x, y) => y.publicationDate.localeCompare(x.publicationDate));
  const latest = acts[0];
  const actDates = [...acts, ...tags(body, 'regulationSummary')].map((r) => r.publicationDate).filter((d) => DATE.test(d ?? '')).sort();
  const countries = [...new Set([...tags(body, 'citizenship'), ...tags(body, 'address')].map((c) => (c.countryIso2Code ?? '').toUpperCase()).filter((c) => ISO2.test(c) && c !== '00'))];
  const programmes = [...new Set(acts.map((r) => r.programme).filter(Boolean))];
  const subject = tags(body, 'subjectType')[0]?.code ?? '';
  return {
    id,
    ref: a.euReferenceNumber || '',
    name: alias.wholeName.length > 160 ? `${alias.wholeName.slice(0, 159)}…` : alias.wholeName,
    type: subject === 'person' ? 'person' : subject === 'enterprise' ? 'entity' : subject || 'unknown',
    programmes,
    countries,
    listedOn: DATE.test(a.designationDate ?? '') ? a.designationDate : (actDates[0] ?? ''),
    regulation: latest?.numberTitle ?? '',
    url: latest?.url ?? '',
  };
}

/** Every entity in the file, and the file's generation date. */
export function parseEuList(xml) {
  const generatedAt = Date.parse(/<(?:\w+:)?export\b[^>]*\bgenerationDate="([^"]+)"/.exec(xml)?.[1] ?? '');
  const entities = [];
  for (const m of xml.matchAll(/(<(?:\w+:)?sanctionEntity\b[^>]*>)([\s\S]*?)<\/(?:\w+:)?sanctionEntity>/g)) {
    const e = parseEntity(m[1], m[2]);
    if (e) entities.push(e);
  }
  return { generatedAt: Number.isFinite(generatedAt) ? generatedAt : null, entities };
}

/** This run's new listings over the previous log, newest first, inside ADDITIONS_KEEP_DAYS and ADDITIONS_MAX. */
export function mergeAdditions(fresh, previous, nowMs) {
  const cutoff = nowMs - ADDITIONS_KEEP_DAYS * DAY_MS;
  const seen = new Set();
  return [...fresh, ...(Array.isArray(previous) ? previous : [])]
    .filter((a) => a && typeof a.id === 'string' && Number.isFinite(a.at) && a.at >= cutoff && !seen.has(a.id) && seen.add(a.id))
    .sort((x, y) => y.at - x.at || x.id.localeCompare(y.id))
    .slice(0, ADDITIONS_MAX);
}

async function readState() {
  const creds = getOptionalUpstashCreds();
  if (!creds) return null;
  // A failed read must fail the run: starting fresh would drop the baseline and the log.
  let raw;
  try {
    ({ result: raw } = await upstashCommand(creds, ['GET', STATE_KEY]));
  } catch (err) {
    throw new Error(`eu-sanctions state read failed: ${err?.message || err}`);
  }
  if (raw == null) return null;
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const data = value?.data ?? value;
  return data?.state && typeof data.state === 'object' ? data.state : null;
}

async function fetchList(fetchImpl) {
  const res = await fetchImpl(EU_FSF_URL, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/xml, text/xml' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from webgate.ec.europa.eu`);
  return readBoundedFeedText(res, MAX_FILE_BYTES);
}

const nonRetryable = (message) => Object.assign(new Error(message), { nonRetryable: true });

/**
 * runSeed fetch function: the log of new listings, the list's size and date,
 * and the next state (`state`, stripped from the canonical key by
 * publishTransform).
 */
export async function fetchEuSanctions({
  fetchImpl = (...args) => globalThis.fetch(...args),
  nowMs = Date.now(),
  loadState = readState,
} = {}) {
  const previous = await loadState();
  const xml = await fetchList(fetchImpl);
  // A cut-off download would drop ids from the baseline and report them as new on the next full read.
  if (!/<\/(?:\w+:)?export>\s*$/.test(xml)) throw new Error(`EU list: incomplete document (${xml.length} bytes, no closing </export>)`);
  const { generatedAt, entities } = parseEuList(xml);
  if (entities.length < MIN_ENTITIES) throw new Error(`EU list: ${entities.length} entities, expected at least ${MIN_ENTITIES}`);
  const prevIds = Array.isArray(previous?.ids) ? previous.ids.filter((x) => typeof x === 'string') : null;
  if (prevIds && entities.length < prevIds.length * (1 - MAX_SHRINK)) {
    throw nonRetryable(`EU list: ${entities.length} entities against ${prevIds.length} on the last run; held as a broken download (if the EU really removed them, delete ${STATE_KEY} to set a new baseline)`);
  }
  const known = new Set(prevIds ?? []);
  const fresh = prevIds ? entities.filter((e) => !known.has(e.id)).map((e) => ({ ...e, at: nowMs })) : [];
  const additions = mergeAdditions(fresh, previous?.additions, nowMs);
  const ids = entities.map((e) => e.id).sort();
  console.log(`  EU list: ${entities.length} entities (generated ${generatedAt ? new Date(generatedAt).toISOString() : 'unknown'}); ${prevIds ? `${fresh.length} new since the last run` : 'baseline set'}; ${additions.length} in the ${ADDITIONS_KEEP_DAYS}-day log`);
  return {
    fetchedAt: nowMs,
    generatedAt,
    entityCount: entities.length,
    baselineAt: Number.isFinite(previous?.baselineAt) ? previous.baselineAt : nowMs,
    windowDays: ADDITIONS_KEEP_DAYS,
    additions,
    state: { ids, additions, baselineAt: Number.isFinite(previous?.baselineAt) ? previous.baselineAt : nowMs },
  };
}

/** The public payload: everything except the stored ids. */
export function publishTransform(data) {
  const { state: _state, ...published } = data ?? {};
  return published;
}

export function validateFn(data) {
  return Boolean(data && Number.isFinite(data.fetchedAt) && Number(data.entityCount) >= MIN_ENTITIES && Array.isArray(data.additions)
    && data.additions.every((a) => typeof a?.id === 'string' && Number.isFinite(a?.at) && Array.isArray(a?.countries)));
}

/** The list's size: a run with no new listing is still a full read. */
export function declareRecords(data) {
  return Number(data?.entityCount) || 0;
}

export async function markEuSanctionsActivated() {
  try {
    const creds = getOptionalUpstashCreds();
    if (creds) await upstashCommand(creds, ['SET', ACTIVATION_KEY, '1']);
  } catch (error) {
    console.warn(`  WARN: activation marker write failed: ${error?.message || error}`);
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadEnvFile(import.meta.url);
  runSeed('sanctions', 'eu-additions', CANONICAL_KEY, () => fetchEuSanctions(), {
    validateFn,
    declareRecords,
    // Longer than the 240 s download, so a slow run keeps its lock (as seed-travel-advisories).
    lockTtlMs: 300_000,
    ttlSeconds: EU_SANCTIONS_TTL_SECONDS,
    maxStaleMin: EU_SANCTIONS_MAX_STALE_MIN,
    schemaVersion: 1,
    sourceVersion: 'eu-fsf-xml-1.1-v1',
    publishTransform,
    extraKeys: [{
      key: STATE_KEY,
      ttl: STATE_TTL_SECONDS,
      transform: (data) => ({ state: data?.state ?? null }),
      allowPrePublishFields: ['state'],
      declareRecords: (data) => (Array.isArray(data?.state?.ids) ? data.state.ids.length : 0),
    }],
    preserveKeyTtls: [{ key: STATE_KEY, ttlSeconds: STATE_TTL_SECONDS }],
    afterPublish: markEuSanctionsActivated,
  }).catch((err) => {
    console.error('FATAL:', err?.message || err);
    process.exit(1);
  });
}
