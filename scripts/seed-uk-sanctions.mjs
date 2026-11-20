#!/usr/bin/env node
// @ts-check
//
// New UK sanctions designations, for the Lite "New sanctions · UK" indicator
// (#140; spec docs/engineering/architecture/lite.md, Early indicators ›
// Catalogue, UK sanctions list changes).
//
// Source: the UK Sanctions List, the FCDO's single list of UK sanctions
// designations (it replaced the OFSI consolidated list, whose old storage URL
// refused public access on 2026-11-19). The XML is linked from
// https://www.gov.uk/government/publications/the-uk-sanctions-list under the
// Open Government Licence v3.0. Each run reads the whole list and compares its
// designation ids with the previous run's (`sanctions:uk-sanctions:state:v1`),
// the same comparison as the EU list (seed-eu-sanctions, #129): an id not seen
// before is a new listing, dated by the run that first saw it. The first run
// only sets the baseline.
//
// Guards: a document without its closing tag, a list far shorter than
// expected, or one much shorter than the previous one, fails the run, so a
// truncated download never resets the baseline and then reports every
// designation as new.

import { createRequire } from 'node:module';

import { loadEnvFile, runSeed } from './_seed-utils.mjs';
import { readBoundedFeedText } from './seed-security-advisories.mjs';
import { ADDITIONS_KEEP_DAYS, decodeXmlText, mergeAdditions } from './seed-eu-sanctions.mjs';
import { getOptionalUpstashCreds, upstashCommand } from './_upstash-rest.mjs';
import { isMainModule } from './lib/main-module.mjs';

const require = createRequire(import.meta.url);
const { countryNameToIso2 } = require('./shared/country-name-to-iso2.cjs');

export const CANONICAL_KEY = 'sanctions:uk-additions:v1';
export const STATE_KEY = 'sanctions:uk-sanctions:state:v1';
export const ACTIVATION_KEY = 'seed-activated:sanctions:uk-additions';
export const UK_LIST_URL = 'https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.xml';
/** The list holds about 6,400 designations; far fewer means a broken download. */
export const MIN_ENTITIES = 3000;
/** A list this much shorter than the previous one is held, not trusted. */
export const MAX_SHRINK = 0.1;
export const UK_SANCTIONS_TTL_SECONDS = 72 * 3600; // a 6 h cadence
export const STATE_TTL_SECONDS = 60 * 24 * 3600;
export const UK_SANCTIONS_MAX_STALE_MIN = 720;
const MAX_FILE_BYTES = 80 * 1024 * 1024;
// The file is about 22 MB; the local runner allows 300 s.
const REQUEST_TIMEOUT_MS = 240_000;
const USER_AGENT = 'WorldMonitor uk-sanctions seeder (+https://worldmonitor.app)';

/**
 * Country names on the UK list that the shared resolver misses or reads wrong:
 * it maps "Congo (Democratic Republic)" to the Republic of the Congo (CG).
 */
const UK_COUNTRY_ALIASES = Object.freeze(Object.assign(Object.create(null), {
  'congo (democratic republic)': 'CD',
  'occupied palestinian territories': 'PS',
  palestinian: 'PS',
  dprk: 'KP',
}));

/** An ISO2 code for a country name on the UK list, or null. */
export function ukCountryCode(name) {
  const n = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!n) return null;
  return UK_COUNTRY_ALIASES[n.toLowerCase()] ?? countryNameToIso2(n);
}

/**
 * The country a regime targets, by the UniqueID prefix, for a designation that
 * names no nationality or address (most ships): a tanker listed under the
 * Russia regime counts for Russia, not for its flag. Thematic regimes (cyber,
 * human rights, counter-terrorism) have none.
 */
export const REGIME_COUNTRY = Object.freeze({
  AFG: 'AF', BEL: 'BY', BIH: 'BA', CAF: 'CF', DPR: 'KP', DRC: 'CD', GUB: 'GW', GUC: 'GN', HAI: 'HT',
  INU: 'IR', IRN: 'IR', IRQ: 'IQ', LIB: 'LY', MAL: 'ML', MYA: 'MM', NIC: 'NI', RUS: 'RU', SOM: 'SO',
  SSU: 'SS', SUD: 'SD', SYR: 'SY', VEN: 'VE', YEM: 'YE',
});

const text = (body, name) => [...body.matchAll(new RegExp(`<${name}>([^<]*)</${name}>`, 'g'))].map((m) => decodeXmlText(m[1])).filter(Boolean);
const first = (body, name) => text(body, name)[0] ?? '';
/** dd/mm/yyyy → YYYY-MM-DD, or ''. */
const ukDate = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s ?? '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};
const TYPES = { Individual: 'person', Entity: 'entity', Ship: 'ship' };
const IMO_NAME = /^IMO ?\d{7}$/i;

/**
 * One `<Designation>` in the stored shape (the EU listing's), or null without
 * an id or name. The name is the primary name (Name1 to Name6 in order), else
 * the first name; a ship listed under its IMO number also takes its first
 * other name, as "MELICERTES (IMO 9958303)". Countries come from nationalities and addresses, else the
 * regime's country. `programmes` holds the regime code (the UniqueID prefix,
 * e.g. RUS), `regulation` the regime's name, and `listedOn` the designation
 * date. The list links no per-designation page, so `url` is ''.
 */
export function parseDesignation(body) {
  const id = first(body, 'UniqueID');
  const names = [...body.matchAll(/<Name>([\s\S]*?)<\/Name>/g)].map((m) => ({
    type: first(m[1], 'NameType').toLowerCase(),
    whole: [1, 2, 3, 4, 5, 6].map((i) => first(m[1], `Name${i}`)).filter(Boolean).join(' '),
  })).filter((n) => n.whole);
  const primary = (names.find((n) => n.type === 'primary name') ?? names[0])?.whole;
  // Some ships are listed under their IMO number, with the vessel's name only as an alias: show both.
  const vessel = IMO_NAME.test(primary ?? '') ? names.find((n) => !IMO_NAME.test(n.whole))?.whole : undefined;
  const name = vessel ? `${vessel} (${primary})` : primary;
  if (!id || !name) return null;
  const regime = /^[A-Z]+/.exec(id)?.[0] ?? '';
  const named = [...new Set([...text(body, 'Nationality'), ...text(body, 'AddressCountry')].map(ukCountryCode).filter((c) => typeof c === 'string' && /^[A-Z]{2}$/.test(c)))];
  const regimeCountry = REGIME_COUNTRY[/** @type {keyof typeof REGIME_COUNTRY} */ (regime)];
  return {
    id,
    ref: id,
    name: name.length > 160 ? `${name.slice(0, 159)}…` : name,
    type: TYPES[/** @type {keyof typeof TYPES} */ (first(body, 'IndividualEntityShip'))] ?? 'unknown',
    programmes: regime ? [regime] : [],
    countries: named.length ? named : regimeCountry ? [regimeCountry] : [],
    listedOn: ukDate(first(body, 'DateDesignated')),
    regulation: first(body, 'RegimeName').replace(/^The /, ''),
    url: '',
  };
}

/** Every designation in the file, and the file's generation date (midnight UTC of its day). */
export function parseUkList(xml) {
  const day = ukDate(/<DateGenerated>([^<]*)<\/DateGenerated>/.exec(xml)?.[1]?.trim() ?? '');
  const entities = [];
  for (const m of xml.matchAll(/<Designation>([\s\S]*?)<\/Designation>/g)) {
    const e = parseDesignation(m[1]);
    if (e) entities.push(e);
  }
  return { generatedAt: day ? Date.parse(`${day}T00:00:00Z`) : null, entities };
}

async function readState() {
  const creds = getOptionalUpstashCreds();
  if (!creds) return null;
  // A failed read must fail the run: starting fresh would drop the baseline and the log.
  let raw;
  try {
    ({ result: raw } = await upstashCommand(creds, ['GET', STATE_KEY]));
  } catch (err) {
    throw new Error(`uk-sanctions state read failed: ${err?.message || err}`);
  }
  if (raw == null) return null;
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const data = value?.data ?? value;
  return data?.state && typeof data.state === 'object' ? data.state : null;
}

async function fetchList(fetchImpl) {
  const res = await fetchImpl(UK_LIST_URL, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/xml, text/xml' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from sanctionslist.fcdo.gov.uk`);
  return readBoundedFeedText(res, MAX_FILE_BYTES);
}

const nonRetryable = (message) => Object.assign(new Error(message), { nonRetryable: true });

/**
 * runSeed fetch function: the log of new listings, the list's size and date,
 * and the next state (`state`, stripped from the canonical key by
 * publishTransform).
 */
export async function fetchUkSanctions({
  fetchImpl = (...args) => globalThis.fetch(...args),
  nowMs = Date.now(),
  loadState = readState,
} = {}) {
  const previous = await loadState();
  const xml = await fetchList(fetchImpl);
  // A cut-off download would drop ids from the baseline and report them as new on the next full read.
  if (!/<\/Designations>\s*$/.test(xml)) throw new Error(`UK list: incomplete document (${xml.length} bytes, no closing </Designations>)`);
  const { generatedAt, entities } = parseUkList(xml);
  if (entities.length < MIN_ENTITIES) throw new Error(`UK list: ${entities.length} designations, expected at least ${MIN_ENTITIES}`);
  const prevIds = Array.isArray(previous?.ids) ? previous.ids.filter((x) => typeof x === 'string') : null;
  if (prevIds && entities.length < prevIds.length * (1 - MAX_SHRINK)) {
    throw nonRetryable(`UK list: ${entities.length} designations against ${prevIds.length} on the last run; held as a broken download (if the UK really removed them, delete ${STATE_KEY} to set a new baseline)`);
  }
  const known = new Set(prevIds ?? []);
  const fresh = prevIds ? entities.filter((e) => !known.has(e.id)).map((e) => ({ ...e, at: nowMs })) : [];
  const additions = mergeAdditions(fresh, previous?.additions, nowMs);
  const ids = entities.map((e) => e.id).sort();
  const baselineAt = Number.isFinite(previous?.baselineAt) ? previous.baselineAt : nowMs;
  console.log(`  UK list: ${entities.length} designations (generated ${generatedAt ? new Date(generatedAt).toISOString().slice(0, 10) : 'unknown'}); ${prevIds ? `${fresh.length} new since the last run` : 'baseline set'}; ${additions.length} in the ${ADDITIONS_KEEP_DAYS}-day log`);
  return {
    fetchedAt: nowMs,
    generatedAt,
    entityCount: entities.length,
    baselineAt,
    windowDays: ADDITIONS_KEEP_DAYS,
    additions,
    state: { ids, additions, baselineAt },
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

export async function markUkSanctionsActivated() {
  try {
    const creds = getOptionalUpstashCreds();
    if (creds) await upstashCommand(creds, ['SET', ACTIVATION_KEY, '1']);
  } catch (error) {
    console.warn(`  WARN: activation marker write failed: ${error?.message || error}`);
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadEnvFile(import.meta.url);
  runSeed('sanctions', 'uk-additions', CANONICAL_KEY, () => fetchUkSanctions(), {
    validateFn,
    declareRecords,
    // Longer than the 240 s download, so a slow run keeps its lock (as seed-eu-sanctions).
    lockTtlMs: 300_000,
    ttlSeconds: UK_SANCTIONS_TTL_SECONDS,
    maxStaleMin: UK_SANCTIONS_MAX_STALE_MIN,
    schemaVersion: 1,
    sourceVersion: 'uk-sanctions-list-xml-v1',
    publishTransform,
    extraKeys: [{
      key: STATE_KEY,
      ttl: STATE_TTL_SECONDS,
      transform: (data) => ({ state: data?.state ?? null }),
      allowPrePublishFields: ['state'],
      declareRecords: (data) => (Array.isArray(data?.state?.ids) ? data.state.ids.length : 0),
    }],
    preserveKeyTtls: [{ key: STATE_KEY, ttlSeconds: STATE_TTL_SECONDS }],
    afterPublish: markUkSanctionsActivated,
  }).catch((err) => {
    console.error('FATAL:', err?.message || err);
    process.exit(1);
  });
}
