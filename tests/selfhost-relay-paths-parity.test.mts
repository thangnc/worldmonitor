import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SELFHOST_RELAY_PATHS, isSelfHostRelayPath } from '../shared/selfhost-relay-paths.js';
import { PREMIUM_RPC_PATHS } from '../src/shared/premium-paths.ts';

// REST v2 is the API product; it is never relayed.
const isRestV2Path = (p: string): boolean => p.startsWith('/api/v2/');

// The Docker image ships neither src/ nor server/, so the self-host relay reads
// a JS mirror of "premium paths minus API-only paths" (plan 2026-11-04-001,
// KTD6). This suite is what keeps the mirror honest: a path added to either
// source set without updating shared/selfhost-relay-paths.js fails here.
describe('self-host relay path mirror', () => {
  it('equals PREMIUM_RPC_PATHS minus REST v2', () => {
    const expected = [...PREMIUM_RPC_PATHS].filter((p) => !isRestV2Path(p)).sort();
    assert.deepEqual([...SELFHOST_RELAY_PATHS].sort(), expected);
  });

  it('never relays REST v2', () => {
    for (const p of SELFHOST_RELAY_PATHS) {
      assert.ok(!isRestV2Path(p), `${p} is REST v2`);
    }
    for (const p of ['/api/v2/shipping/route-intelligence', '/api/v2/shipping/webhooks']) {
      assert.equal(isSelfHostRelayPath(p), false, `${p} must not be relayed`);
    }
  });

  it('matches exact paths only', () => {
    assert.equal(isSelfHostRelayPath('/api/market/v1/analyze-stock'), true);
    assert.equal(isSelfHostRelayPath('/api/market/v1/analyze-stock/'), false);
    assert.equal(isSelfHostRelayPath('/api/market/v1/analyze-stock-x'), false);
    assert.equal(isSelfHostRelayPath('/api/market/v1/list-market-quotes'), false);
  });

  it('cannot be mutated at runtime', () => {
    assert.throws(() => (SELFHOST_RELAY_PATHS as Set<string>).add('/api/bootstrap'));
    assert.equal(isSelfHostRelayPath('/api/bootstrap'), false);
  });
});
