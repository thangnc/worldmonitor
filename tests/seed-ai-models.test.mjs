import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CANONICAL_KEY,
  LITELLM_URL,
  MIN_LISTED,
  MIN_WATCHED,
  OPENROUTER_URL,
  crossCheck,
  declareRecords,
  fetchAiModels,
  mergeChanges,
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

function router({ models = [raw('openai/gpt-x'), raw('anthropic/claude-y', { created: sec(NOW - 30 * DAY) })], litellm = {}, failLitellm = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init?.headers?.['User-Agent']]);
    if (url === OPENROUTER_URL) return { ok: true, status: 200, json: async () => ({ data: [...models, ...older, ...filler] }) };
    if (url === LITELLM_URL) return failLitellm ? { ok: false, status: 503 } : { ok: true, status: 200, json: async () => litellm };
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
    assert.equal(calls.length, 1, 'LiteLLM is read only when a price changed');
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
