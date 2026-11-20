#!/usr/bin/env node
// @ts-check
//
// AI model releases and price changes for the Lite "AI models" indicator and
// the Tech screen's model tracker (#126; spec docs/engineering/architecture/
// lite.md, Early indicators › Catalogue, spec gap 5).
//
// Source: the OpenRouter model list (no key): every listed model with its
// listing time, context length and price per token. Only models from the
// watched labs are kept, without the provider variants (":batch", ":free"),
// router entries ("openrouter/…") or aliases ("~openai/…").
//
// New models need no history: the listing time says when a model arrived.
// Price changes compare with the stored previous prices
// (`tech:ai-models:state:v1`); a model seen for the first time sets its
// baseline. A price change is cross-checked against LiteLLM's public price
// file (MIT; fetched only when a change is found).

import { loadEnvFile, runSeed } from './_seed-utils.mjs';
import { getOptionalUpstashCreds, upstashCommand } from './_upstash-rest.mjs';
import { isMainModule } from './lib/main-module.mjs';

export const CANONICAL_KEY = 'tech:ai-models:v1';
export const STATE_KEY = 'tech:ai-models:state:v1';
export const ACTIVATION_KEY = 'seed-activated:tech:ai-models';
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/models';
export const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
/** OpenRouter id prefix → the lab's display name. */
export const WATCHED_LABS = Object.freeze({
  openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', 'meta-llama': 'Meta', meta: 'Meta',
  mistralai: 'Mistral', 'x-ai': 'xAI', deepseek: 'DeepSeek', qwen: 'Qwen',
});
/** The full list holds about 480 models; far fewer means a broken read. */
export const MIN_LISTED = 150;
/** The watched labs list about 210 models; far fewer means OpenRouter changed its ids or fields. */
export const MIN_WATCHED = 20;
export const PRICE_CHANGE_PCT = 20;
export const MODELS_KEPT_DAYS = 90;
export const MODELS_KEPT_MAX = 60;
export const CHANGES_KEEP_DAYS = 30;
export const AI_MODELS_TTL_SECONDS = 72 * 3600; // a 6 h cadence
export const STATE_TTL_SECONDS = 60 * 24 * 3600;
export const AI_MODELS_MAX_STALE_MIN = 1080;
const REQUEST_TIMEOUT_MS = 30_000;
const USER_AGENT = 'WorldMonitor ai-models seeder (+https://worldmonitor.app)';
const DAY_MS = 24 * 3600 * 1000;

const perMillion = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 10000) / 10000 : null;
};

/** One listed model in the stored shape, or null when it is not a watched lab's own model. */
export function normalizeModel(raw) {
  const id = typeof raw?.id === 'string' ? raw.id.trim() : '';
  if (!id || id.includes(':') || id.startsWith('~')) return null;
  const lab = id.split('/')[0];
  const labName = WATCHED_LABS[/** @type {keyof typeof WATCHED_LABS} */ (lab)];
  const created = Number(raw.created);
  if (!labName || !Number.isFinite(created) || created <= 0) return null;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.replace(/^[^:]+:\s*/, '').trim() : id.split('/')[1];
  return {
    id,
    lab,
    labName,
    name,
    releasedAt: created * 1000,
    context: Number.isFinite(Number(raw.context_length)) ? Number(raw.context_length) : null,
    inPrice: perMillion(raw.pricing?.prompt),
    outPrice: perMillion(raw.pricing?.completion),
    url: `https://openrouter.ai/${id}`,
  };
}

// A move to a zero price (a promotion, or an upstream glitch) is not a price change.
const pctChange = (from, to) => (from > 0 && to !== null && to > 0 ? ((to - from) / from) * 100 : null);

/**
 * Price changes of PRICE_CHANGE_PCT or more against the stored prices, on
 * the input or output price. A model without stored prices sets its
 * baseline; a free (zero) price never counts.
 */
export function priceChanges(models, previousPrices, nowMs) {
  const changes = [];
  if (!previousPrices || typeof previousPrices !== 'object') return changes;
  for (const m of models) {
    const prev = previousPrices[m.id];
    if (!Array.isArray(prev)) continue;
    const dIn = pctChange(prev[0], m.inPrice);
    const dOut = pctChange(prev[1], m.outPrice);
    if ((dIn !== null && Math.abs(dIn) >= PRICE_CHANGE_PCT) || (dOut !== null && Math.abs(dOut) >= PRICE_CHANGE_PCT)) {
      changes.push({ at: nowMs, id: m.id, lab: m.lab, labName: m.labName, name: m.name, from: [prev[0], prev[1]], to: [m.inPrice, m.outPrice], url: m.url });
    }
  }
  return changes;
}

/** LiteLLM's input price for an OpenRouter id, per million tokens, or null. */
export function litellmPrice(file, id) {
  const entry = file?.[`openrouter/${id}`];
  return entry ? perMillion(entry.input_cost_per_token) : null;
}

/**
 * "match" when LiteLLM's price for the side that moved (input or output) is
 * within 5% of the new one, "differs", or "missing".
 */
export function crossCheck(file, change) {
  const dIn = pctChange(change.from?.[0], change.to?.[0]);
  const dOut = pctChange(change.from?.[1], change.to?.[1]);
  const side = dOut !== null && (dIn === null || Math.abs(dOut) > Math.abs(dIn)) ? 1 : 0;
  const entry = file?.[`openrouter/${change.id}`];
  const price = entry ? perMillion(side === 1 ? entry.output_cost_per_token : entry.input_cost_per_token) : null;
  const now = change.to?.[side] ?? null;
  if (price === null || now === null) return 'missing';
  const d = pctChange(now, price);
  return d !== null && Math.abs(d) <= 5 ? 'match' : 'differs';
}

export function mergeChanges(fresh, previousLog, nowMs) {
  const cutoff = nowMs - CHANGES_KEEP_DAYS * DAY_MS;
  return [...fresh, ...(Array.isArray(previousLog) ? previousLog : [])]
    .filter((c) => c && Number.isFinite(c.at) && c.at >= cutoff && typeof c.id === 'string')
    .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))
    .slice(0, 200);
}

async function readState() {
  const creds = getOptionalUpstashCreds();
  if (!creds) return null;
  // A failed read must fail the run: starting fresh would drop the price baseline.
  let raw;
  try {
    ({ result: raw } = await upstashCommand(creds, ['GET', STATE_KEY]));
  } catch (err) {
    throw new Error(`ai-models state read failed: ${err?.message || err}`);
  }
  if (raw == null) return null;
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const data = value?.data ?? value;
    return data?.state && typeof data.state === 'object' ? data.state : null;
  } catch (err) {
    console.warn(`  WARN: stored ai-models state is not JSON, starting fresh: ${err?.message || err}`);
    return null;
  }
}

async function getJson(fetchImpl, url) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) {
    const error = new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) Object.assign(error, { nonRetryable: true });
    throw error;
  }
  return res.json();
}

/**
 * runSeed fetch function: the watched labs' models, this run's price changes
 * (cross-checked), and the next state (`state`, stripped from the canonical
 * key by publishTransform).
 */
export async function fetchAiModels({
  fetchImpl = (...args) => globalThis.fetch(...args),
  nowMs = Date.now(),
  loadState = readState,
} = {}) {
  const previous = await loadState();
  const body = await getJson(fetchImpl, OPENROUTER_URL);
  const listed = Array.isArray(body?.data) ? body.data : null;
  if (!listed) throw Object.assign(new Error('OpenRouter: no data array'), { nonRetryable: true });
  if (listed.length < MIN_LISTED) throw new Error(`OpenRouter listed ${listed.length} models, expected at least ${MIN_LISTED}`);
  const seen = new Set();
  const models = listed.map(normalizeModel).filter((m) => m && !seen.has(m.id) && seen.add(m.id));
  if (models.length < MIN_WATCHED) throw new Error(`OpenRouter: ${models.length} models from the watched labs, expected at least ${MIN_WATCHED}`);

  const fresh = priceChanges(models, previous?.prices, nowMs);
  if (fresh.length) {
    try {
      const file = await getJson(fetchImpl, LITELLM_URL);
      for (const c of fresh) c.litellm = crossCheck(file, c);
    } catch (err) {
      console.warn(`  LiteLLM cross-check unavailable: ${err?.message || err}`);
      for (const c of fresh) c.litellm = 'unavailable';
    }
  }
  const prices = { ...(previous?.prices ?? {}) };
  for (const m of models) if (m.inPrice !== null || m.outPrice !== null) prices[m.id] = [m.inPrice, m.outPrice];
  const changes = mergeChanges(fresh, previous?.changes, nowMs);
  const recent = models
    .filter((m) => nowMs - m.releasedAt <= MODELS_KEPT_DAYS * DAY_MS)
    .sort((a, b) => b.releasedAt - a.releasedAt || a.id.localeCompare(b.id))
    .slice(0, MODELS_KEPT_MAX);
  console.log(`  OpenRouter: ${listed.length} listed, ${models.length} from watched labs, ${recent.length} in the last ${MODELS_KEPT_DAYS} days; ${fresh.length} price changes this run`);
  return {
    fetchedAt: nowMs,
    listed: listed.length,
    watched: models.length,
    baseline: Boolean(previous?.prices && Object.keys(previous.prices).length),
    models: recent,
    changes,
    state: { prices, changes },
  };
}

/** The public payload: everything except the stored prices. */
export function publishTransform(data) {
  const { state: _state, ...published } = data ?? {};
  return published;
}

export function validateFn(data) {
  return Boolean(data && Number.isFinite(data.fetchedAt) && Number(data.listed) >= MIN_LISTED && Number(data.watched) >= MIN_WATCHED && Array.isArray(data.models) && Array.isArray(data.changes)
    && data.models.every((m) => typeof m?.id === 'string' && Number.isFinite(m?.releasedAt)));
}

export function declareRecords(data) {
  return Array.isArray(data?.models) ? data.models.length : 0;
}

export async function markAiModelsActivated() {
  try {
    const creds = getOptionalUpstashCreds();
    if (creds) await upstashCommand(creds, ['SET', ACTIVATION_KEY, '1']);
  } catch (error) {
    console.warn(`  WARN: activation marker write failed: ${error?.message || error}`);
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadEnvFile(import.meta.url);
  runSeed('tech', 'ai-models', CANONICAL_KEY, () => fetchAiModels(), {
    validateFn,
    declareRecords,
    ttlSeconds: AI_MODELS_TTL_SECONDS,
    maxStaleMin: AI_MODELS_MAX_STALE_MIN,
    schemaVersion: 1,
    sourceVersion: 'openrouter-models-v1',
    publishTransform,
    extraKeys: [{
      key: STATE_KEY,
      ttl: STATE_TTL_SECONDS,
      transform: (data) => ({ state: data?.state ?? null }),
      allowPrePublishFields: ['state'],
      declareRecords: (data) => Object.keys(data?.state?.prices ?? {}).length,
    }],
    preserveKeyTtls: [{ key: STATE_KEY, ttlSeconds: STATE_TTL_SECONDS }],
    afterPublish: markAiModelsActivated,
  }).catch((err) => {
    console.error('FATAL:', err?.message || err);
    process.exit(1);
  });
}
