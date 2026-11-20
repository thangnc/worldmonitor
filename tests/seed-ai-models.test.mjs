import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AI_MODELS_MAX_STALE_MIN,
  CANONICAL_KEY,
  HF_LABS,
  HF_SEEN_KEEP_DAYS,
  LITELLM_URL,
  MIN_LISTED,
  MIN_WATCHED,
  OPENROUTER_URL,
  crossCheck,
  declareRecords,
  fetchAiModels,
  fetchOpenModels,
  hfModelsUrl,
  mergeChanges,
  normalizeHfModel,
  normalizeModel,
  priceChanges,
  publishTransform,
  validateFn,
} from '../scripts/seed-ai-models.mjs';

const NOW = Date.UTC(2026, 10, 20, 8);
const DAY = 86_400_000;
const sec = (ms) => Math.floor(ms / 1000);
const raw = (id, o = {}) => ({ id, name: `Lab: ${id.split('/')[1]}`, created: sec(NOW - 2 * DAY), context_length: 1_000_000, pricing: { prompt: '0.000002', completion: '0.00001' }, ...o });
// Padding so the list clears MIN_LISTED: models from labs nobody watches.
const filler = Array.from({ length: MIN_LISTED }, (_, i) => raw(`somelab/model-${i}`, { created: sec(NOW - 400 * DAY) }));
// Older watched-lab models, so the watched count clears MIN_WATCHED; outside the 90-day window.
const older = Array.from({ length: MIN_WATCHED }, (_, i) => raw(`google/old-${i}`, { created: sec(NOW - 200 * DAY) }));

// Hugging Face Hub /api/models entries, in the live shape (2026-11-20), trimmed.
const hub = (id, createdDaysAgo, o = {}) => ({
  _id: 'x', id, modelId: id, createdAt: new Date(NOW - createdDaysAgo * DAY).toISOString(), likes: 500, downloads: 20_000, private: false,
  pipeline_tag: 'text-generation', library_name: 'transformers', tags: ['transformers', 'safetensors', 'license:apache-2.0'], ...o,
});
const hubLists = () => Object.fromEntries(Object.keys(HF_LABS).map((a) => [hfModelsUrl(a), [hub(`${a}/Old-${a}`, 200)]]));

function router({ models = [raw('openai/gpt-x'), raw('anthropic/claude-y', { created: sec(NOW - 30 * DAY) })], litellm = {}, failLitellm = false, hf = hubLists() } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init?.headers?.['User-Agent']]);
    if (url === OPENROUTER_URL) return { ok: true, status: 200, json: async () => ({ data: [...models, ...older, ...filler] }) };
    if (url === LITELLM_URL) return failLitellm ? { ok: false, status: 503 } : { ok: true, status: 200, json: async () => litellm };
    if (url in hf) return hf[url] instanceof Error ? { ok: false, status: 503 } : { ok: true, status: 200, json: async () => hf[url] };
    return { ok: false, status: 404 };
  };
  return { fetchImpl, calls };
}

describe('AI model listing (#126)', () => {
  it('keeps the watched labs\' own models in per-million prices and drops variants, aliases and other labs', () => {
    assert.deepEqual(normalizeModel(raw('openai/gpt-x')), {
      id: 'openai/gpt-x', lab: 'openai', labName: 'OpenAI', name: 'gpt-x', releasedAt: sec(NOW - 2 * DAY) * 1000,
      context: 1_000_000, inPrice: 2, outPrice: 10, url: 'https://openrouter.ai/openai/gpt-x',
    });
    assert.equal(normalizeModel(raw('meta-llama/llama-z')).labName, 'Meta');
    for (const id of ['openai/gpt-x:batch', 'qwen/q:free', '~openai/gpt-latest', 'openrouter/auto', 'somelab/m']) assert.equal(normalizeModel(raw(id)), null, id);
    assert.equal(normalizeModel(raw('openai/gpt-x', { created: 0 })), null);
  });

  it(`reports price changes of 20% or more on input or output, never on a first sighting or a free price`, () => {
    const models = [normalizeModel(raw('openai/a')), normalizeModel(raw('openai/b')), normalizeModel(raw('openai/c')), normalizeModel(raw('openai/d'))];
    const prev = { 'openai/a': [4, 10], 'openai/b': [2, 9], 'openai/c': [0, 0] };
    const changes = priceChanges(models, prev, NOW);
    assert.deepEqual(changes.map((c) => [c.id, c.from, c.to]), [['openai/a', [4, 10], [2, 10]]]);
    // A paid model going free (a promotion or a glitch) is not a price change.
    assert.deepEqual(priceChanges([normalizeModel(raw('openai/e', { pricing: { prompt: '0', completion: '0' } }))], { 'openai/e': [2, 10] }, NOW), []);
    assert.deepEqual(priceChanges(models, null, NOW), []);
  });

  it('cross-checks a change against LiteLLM\'s price file', () => {
    const change = { id: 'openai/a', from: [4, 10], to: [2, 10] };
    assert.equal(crossCheck({ 'openrouter/openai/a': { input_cost_per_token: 0.00000201 } }, change), 'match');
    assert.equal(crossCheck({ 'openrouter/openai/a': { input_cost_per_token: 0.000004 } }, change), 'differs');
    assert.equal(crossCheck({}, change), 'missing');
    // Only the output price moved: the check reads LiteLLM's output price.
    const outOnly = { id: 'openai/a', from: [2, 20], to: [2, 10] };
    assert.equal(crossCheck({ 'openrouter/openai/a': { input_cost_per_token: 0.000002, output_cost_per_token: 0.00001 } }, outOnly), 'match');
    assert.equal(crossCheck({ 'openrouter/openai/a': { input_cost_per_token: 0.000002, output_cost_per_token: 0.00002 } }, outOnly), 'differs');
  });
});

describe('AI model fetch (#126)', () => {
  it('reads OpenRouter with a User-Agent, keeps recent models newest first, and sets the price baseline', async () => {
    const { fetchImpl, calls } = router();
    const data = await fetchAiModels({ fetchImpl, nowMs: NOW, loadState: async () => null });
    assert.match(calls[0][1], /WorldMonitor/);
    assert.ok(!calls.some(([u]) => u === LITELLM_URL), 'LiteLLM is read only when a price changed');
    assert.equal(calls.filter(([u]) => u.startsWith('https://huggingface.co/api/models?author=')).length, Object.keys(HF_LABS).length);
    assert.deepEqual(data.models.map((m) => m.id), ['openai/gpt-x', 'anthropic/claude-y']);
    assert.equal(data.baseline, false);
    assert.deepEqual(data.state.prices['openai/gpt-x'], [2, 10]);
    assert.equal(publishTransform(data).state, undefined);
    assert.equal(validateFn(data), true);
    assert.equal(declareRecords(data), 2);
    assert.equal(CANONICAL_KEY, 'tech:ai-models:v1');
  });

  it('records a price change with its LiteLLM check, and keeps 30 days of changes', async () => {
    const previous = { prices: { 'openai/gpt-x': [4, 20] }, changes: [{ at: NOW - 40 * DAY, id: 'old/x' }, { at: NOW - DAY, id: 'openai/y' }] };
    const { fetchImpl, calls } = router({ litellm: { 'openrouter/openai/gpt-x': { input_cost_per_token: 0.000002 } } });
    const data = await fetchAiModels({ fetchImpl, nowMs: NOW, loadState: async () => previous });
    assert.equal(calls[1][0], LITELLM_URL);
    assert.deepEqual(data.changes.map((c) => [c.id, c.litellm ?? null]), [['openai/gpt-x', 'match'], ['openai/y', null]]);
    assert.equal(data.baseline, true);
    const down = await fetchAiModels({ fetchImpl: router({ failLitellm: true }).fetchImpl, nowMs: NOW, loadState: async () => previous });
    assert.equal(down.changes[0].litellm, 'unavailable');
    assert.deepEqual(mergeChanges([], [{ at: NOW - 31 * DAY, id: 'a' }, { at: NOW, id: 'b' }], NOW).map((c) => c.id), ['b']);
  });

  it('fails on a short list or a bad payload, so the last good data stays', async () => {
    const short = async () => ({ ok: true, status: 200, json: async () => ({ data: [raw('openai/a')] }) });
    await assert.rejects(fetchAiModels({ fetchImpl: short, nowMs: NOW, loadState: async () => null }), /expected at least/);
    await assert.rejects(fetchAiModels({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }), nowMs: NOW, loadState: async () => null }), (e) => e.nonRetryable === true);
    // A full list whose ids or fields changed shape leaves too few watched models: a failure, not an empty success.
    const reshaped = async () => ({ ok: true, status: 200, json: async () => ({ data: filler.concat(filler) }) });
    await assert.rejects(fetchAiModels({ fetchImpl: reshaped, nowMs: NOW, loadState: async () => null }), /from the watched labs/);
    await assert.rejects(fetchAiModels({ fetchImpl: async () => ({ ok: false, status: 503 }), nowMs: NOW, loadState: async () => null }), /HTTP 503 from openrouter\.ai/);
  });
});

describe('open-weight releases on the Hugging Face Hub (#132)', () => {
  it('keeps a lab\'s own releases and drops format variants, quantized or adapter repos, skipped tasks and other owners', () => {
    assert.deepEqual(normalizeHfModel(hub('deepseek-ai/DeepSeek-V4.1-Flash', 2), 'deepseek-ai'), {
      id: 'deepseek-ai/DeepSeek-V4.1-Flash', lab: 'deepseek-ai', labName: 'DeepSeek', name: 'DeepSeek-V4.1-Flash', createdAt: NOW - 2 * DAY, task: 'text-generation',
      license: 'apache-2.0', likes: 500, downloads: 20_000, url: 'https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash',
    });
    for (const name of ['Mistral-Large-4-1T-A52B-NVFP4', 'Llama-4-Maverick-17B-128E-Instruct-FP8', 'Qwen3-8B-GGUF', 'gemma-4-12B-it-qat-q4_0', 'Llama-4-Scout-Original']) {
      assert.equal(normalizeHfModel(hub(`mistralai/${name}`, 2), 'mistralai'), null, name);
    }
    assert.equal(normalizeHfModel(hub('Qwen/Qwen3-8B-Thinking', 2, { tags: ['base_model:quantized:Qwen/Qwen3-8B'] }), 'Qwen'), null);
    assert.equal(normalizeHfModel(hub('mistralai/Timestral-209M', 2, { pipeline_tag: 'time-series-forecasting' }), 'mistralai'), null);
    assert.equal(normalizeHfModel(hub('someone/Qwen-copy', 2), 'Qwen'), null);
    // Mistral's repos often name no task: kept, the task left blank.
    assert.equal(normalizeHfModel(hub('mistralai/Mistral-Large-4-1T-A52B', 2, { pipeline_tag: undefined }), 'mistralai')?.task, '');
  });

  it('dates the backlog by creation on the first read, then a model by the run that first saw it', async () => {
    const first = await fetchOpenModels(router({ hf: { ...hubLists(), [hfModelsUrl('Qwen')]: [hub('Qwen/Qwen3.8-27B', 3), hub('Qwen/Old-Qwen', 200)] } }).fetchImpl, null, NOW);
    assert.deepEqual(first.open.models.map((m) => [m.id, m.firstSeenAt]), [['Qwen/Qwen3.8-27B', NOW - 3 * DAY]]);
    assert.equal(first.open.baseline, false);
    assert.deepEqual(first.open.latest.find((m) => m.lab === 'Qwen'), { lab: 'Qwen', labName: 'Qwen', name: 'Qwen3.8-27B', firstSeenAt: NOW - 3 * DAY, url: 'https://huggingface.co/Qwen/Qwen3.8-27B' });
    // A repo created 40 days ago but published (first listed) now is new now.
    const later = NOW + DAY;
    const second = await fetchOpenModels(router({ hf: { ...hubLists(), [hfModelsUrl('Qwen')]: [hub('Qwen/Qwen3.8-Coder', 40), hub('Qwen/Qwen3.8-27B', 3), hub('Qwen/Old-Qwen', 200)] } }).fetchImpl, first.state, later);
    assert.deepEqual(second.open.models.map((m) => [m.id, m.firstSeenAt]), [['Qwen/Qwen3.8-Coder', later], ['Qwen/Qwen3.8-27B', NOW - 3 * DAY]]);
    assert.equal(second.open.baseline, true);
    // A model the lab still lists keeps its first-seen date however old, so it never becomes new again.
    assert.equal(second.state.hfSeen['Qwen/Old-Qwen'], NOW - 200 * DAY);
    const third = await fetchOpenModels(router({ hf: { ...hubLists(), [hfModelsUrl('Qwen')]: [hub('Qwen/Qwen3.8-27B', 3)] } }).fetchImpl, second.state, later + (HF_SEEN_KEEP_DAYS + 1) * DAY);
    assert.equal(third.state.hfSeen['Qwen/Old-Qwen'], undefined, 'forgotten once the lab no longer lists it');
  });

  it('never dates an old model as new: not after an empty list, a lost date, or for a lab added later', async () => {
    const meta = [hub('meta-llama/Llama-3.3-70B-Instruct', 480), hub('meta-llama/Llama-4-Scout', 360)];
    const first = await fetchOpenModels(router({ hf: { ...hubLists(), [hfModelsUrl('meta-llama')]: meta } }).fetchImpl, null, NOW);
    // An empty list is a failed read: the lab keeps its dates and the Hub okAt does not advance.
    const empty = await fetchOpenModels(router({ hf: { ...hubLists(), [hfModelsUrl('meta-llama')]: [] } }).fetchImpl, first.state, NOW + 3600_000);
    assert.deepEqual([empty.open.failedLabs, empty.open.okAt], [['meta-llama'], NOW]);
    assert.equal(empty.state.hfSeen['meta-llama/Llama-4-Scout'], NOW - 360 * DAY);
    // Even with its dates lost, an old repo coming back is dated by creation, never new.
    const lost = { ...empty.state, hfSeen: Object.fromEntries(Object.entries(empty.state.hfSeen).filter(([id]) => id !== 'meta-llama/Llama-4-Scout')) };
    const back = await fetchOpenModels(router({ hf: { ...hubLists(), [hfModelsUrl('meta-llama')]: meta } }).fetchImpl, lost, NOW + 6 * 3600_000);
    assert.equal(back.state.hfSeen['meta-llama/Llama-4-Scout'], NOW - 360 * DAY);
    assert.equal(back.open.models.length, 0);
    // A lab with no dates yet (added to HF_LABS later) gets its own baseline.
    const noQwen = { ...back.state, hfSeen: Object.fromEntries(Object.entries(back.state.hfSeen).filter(([id]) => !id.startsWith('Qwen/'))) };
    const added = await fetchOpenModels(router({ hf: { ...hubLists(), [hfModelsUrl('Qwen')]: [hub('Qwen/Qwen3.8-27B', 20)] } }).fetchImpl, noQwen, NOW + DAY);
    assert.equal(added.state.hfSeen['Qwen/Qwen3.8-27B'], NOW - 20 * DAY);
    assert.equal(added.open.baseline, false, 'the quiet line says a lab is on its first read');
  });

  it('keeps a failed lab\'s models for one health budget, then fails the run', async () => {
    const first = await fetchOpenModels(router({ hf: { ...hubLists(), [hfModelsUrl('google')]: [hub('google/gemma-5-9b', 2), hub('google/Old-google', 200)] } }).fetchImpl, null, NOW);
    const googleDown = { ...hubLists(), [hfModelsUrl('google')]: new Error('down') };
    const soon = await fetchOpenModels(router({ hf: googleDown }).fetchImpl, first.state, NOW + 3600_000);
    assert.deepEqual([soon.open.failedLabs, soon.open.okAt, soon.open.models.map((m) => m.id)], [['google'], NOW, ['google/gemma-5-9b']]);
    // The failed lab's old dates are kept too, so its listed models are not new when it recovers.
    assert.equal(soon.state.hfSeen['google/Old-google'], NOW - 200 * DAY);
    await assert.rejects(fetchOpenModels(router({ hf: googleDown }).fetchImpl, soon.state, NOW + (AI_MODELS_MAX_STALE_MIN + 1) * 60_000), /google unread .* last read/);
    await assert.rejects(fetchOpenModels(router({ hf: googleDown }).fetchImpl, null, NOW), /no earlier read/);
    // The whole run fails with it, so seed-meta never advances on a stale Hub block.
    await assert.rejects(fetchAiModels({ fetchImpl: router({ hf: googleDown }).fetchImpl, nowMs: NOW, loadState: async () => null }), /Hugging Face: google unread/);
  });
});
