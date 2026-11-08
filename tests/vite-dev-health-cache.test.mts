import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEV_HEALTH_LAST_KNOWN_TTL_MS,
  DEV_HEALTH_SNAPSHOT_TTL_MS,
  createDevHealthCache,
  type DevHealthResponse,
} from '../scripts/vite-dev-health-cache.mts';

const COMPACT = new URL('http://localhost/api/health?compact=1');
const FULL = new URL('http://localhost/api/health');
const ORIGIN = 'http://localhost:3000';

const verdict = (checkedAt: string): DevHealthResponse => ({
  status: 200,
  headers: [['content-type', 'application/json']],
  body: JSON.stringify({ status: 'HEALTHY', checkedAt }),
});
const PENDING: DevHealthResponse = {
  status: 503,
  headers: [['retry-after', '3']],
  body: JSON.stringify({ status: 'REFRESH_PENDING', retryAfterSeconds: 3 }),
};

function harness(answers: DevHealthResponse[]) {
  let clock = 0;
  let calls = 0;
  const cache = createDevHealthCache(() => clock);
  const run = async () => {
    const answer = answers[Math.min(calls, answers.length - 1)];
    calls += 1;
    return answer;
  };
  return {
    request: (url = COMPACT, origin = ORIGIN) => cache.handle(url, origin, run),
    advance: (ms: number) => { clock += ms; },
    calls: () => calls,
  };
}

describe('dev health cache (healthDevPlugin)', () => {
  it('serves a compact verdict from memory for the snapshot lifetime, then sweeps again', async () => {
    const h = harness([verdict('a'), verdict('b')]);
    assert.equal(JSON.parse((await h.request()).body).checkedAt, 'a');
    h.advance(DEV_HEALTH_SNAPSHOT_TTL_MS - 1);
    assert.equal(JSON.parse((await h.request()).body).checkedAt, 'a');
    assert.equal(h.calls(), 1);
    h.advance(1);
    assert.equal(JSON.parse((await h.request()).body).checkedAt, 'b');
    assert.equal(h.calls(), 2);
  });

  it('answers refresh pending with the last verdict, marked stale like api/health.js', async () => {
    const h = harness([verdict('a'), PENDING]);
    await h.request();
    h.advance(DEV_HEALTH_SNAPSHOT_TTL_MS);
    const response = await h.request();
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), {
      status: 'HEALTHY', checkedAt: 'a', stale: true, staleReason: 'REFRESH_PENDING',
    });
  });

  it('passes refresh pending through with no verdict, or one past the last-known lifetime', async () => {
    const cold = harness([PENDING]);
    assert.equal((await cold.request()).status, 503);

    const old = harness([verdict('a'), PENDING]);
    await old.request();
    old.advance(DEV_HEALTH_LAST_KNOWN_TTL_MS);
    assert.equal((await old.request()).status, 503);
  });

  it('never serves a cached verdict for other failures', async () => {
    const down: DevHealthResponse = { status: 503, headers: [], body: JSON.stringify({ status: 'REDIS_DOWN' }) };
    const h = harness([verdict('a'), down]);
    await h.request();
    h.advance(DEV_HEALTH_SNAPSHOT_TTL_MS);
    assert.equal(JSON.parse((await h.request()).body).status, 'REDIS_DOWN');
  });

  it('shares one sweep between concurrent requests', async () => {
    const h = harness([verdict('a')]);
    const [first, second] = await Promise.all([h.request(), h.request()]);
    assert.equal(first.body, second.body);
    assert.equal(h.calls(), 1);
  });

  it('keeps origins apart and never caches full mode', async () => {
    const h = harness([verdict('a')]);
    await h.request(COMPACT, ORIGIN);
    await h.request(COMPACT, 'https://evil.example');
    assert.equal(h.calls(), 2);
    await h.request(FULL);
    await h.request(FULL);
    assert.equal(h.calls(), 4);
  });
});
