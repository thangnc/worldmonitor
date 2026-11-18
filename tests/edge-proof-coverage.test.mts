import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

const originalFetch = globalThis.fetch;

import {
  hasUnprovenCloudflareClientIp as serverUnproven,
  hasCloudflareTransitProof as serverProof,
  getClientIp as getServerClientIp,
  resetEdgeProofMismatchWarnedForTest as resetServer,
} from '../packages/server/_shared/client-ip.ts';
import {
  hasUnprovenCloudflareClientIp as apiUnproven,
  hasCloudflareTransitProof as apiProof,
  getClientIp as getApiClientIp,
  resetEdgeProofMismatchWarnedForTest as resetApi,
} from '../api/_client-ip.js';
import {
  checkEndpointRateLimit,
  checkRateLimit,
  checkFailClosedScopedIpRateLimit,
  ENDPOINT_RATE_POLICIES,
  resetEdgeProofRateLimitReportedForTest as resetServerEdgeProofReport,
} from '../packages/server/_shared/rate-limit.ts';
import {
  EDGE_PROOF_TRANSFORM_EXPRESSION,
  EDGE_PROOF_PATH_PREFIXES,
  EDGE_PROOF_PATH_ALTERNATIVES,
  EDGE_PROOF_PATH_MATCHER,
  EDGE_PROOF_PATH_MATCHER_SOURCE,
  pathCoveredByExpression,
} from '../scripts/cloudflare-edge-proof-rule.mjs';

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.CF_EDGE_PROOF_SECRET;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  resetServer();
  resetApi();
  resetServerEdgeProofReport();
});

function requestWith(headers) {
  return new Request('https://worldmonitor.app/api/infrastructure/v1/reverse-geocode', { headers });
}

describe('unproven Cloudflare client IP (#8402)', () => {
  it('is false when the edge-proof secret is unset', () => {
    const req = requestWith({
      'cf-connecting-ip': '203.0.113.7',
      'x-real-ip': '192.0.2.5',
    });
    assert.equal(serverUnproven(req), false);
    assert.equal(apiUnproven(req), false);
  });

  it('is false for a true direct-origin request with no cf-connecting-ip', () => {
    process.env.CF_EDGE_PROOF_SECRET = 'edge-secret-xyz';
    const req = requestWith({ 'x-real-ip': '198.51.100.9' });
    assert.equal(serverUnproven(req), false);
    assert.equal(getServerClientIp(req), '198.51.100.9');
  });

  it('is true for a direct-to-Vercel spoof of cf-connecting-ip', () => {
    process.env.CF_EDGE_PROOF_SECRET = 'edge-secret-xyz';
    const req = requestWith({
      'cf-connecting-ip': '203.0.113.7',
      'x-real-ip': '198.51.100.9',
      'x-wm-edge-proof': 'wrong',
    });
    assert.equal(serverUnproven(req), true);
    assert.equal(apiUnproven(req), true);
    assert.equal(serverProof(req), false);
    assert.equal(apiProof(req), false);
    // getClientIp still refuses the forged CF IP…
    assert.equal(getApiClientIp(req), '198.51.100.9');
  });

  it('is false when the Transform Rule proof matches', () => {
    process.env.CF_EDGE_PROOF_SECRET = 'edge-secret-xyz';
    const req = requestWith({
      'cf-connecting-ip': '203.0.113.7',
      'x-real-ip': '173.245.48.1',
      'x-wm-edge-proof': 'edge-secret-xyz',
    });
    assert.equal(serverUnproven(req), false);
    assert.equal(getServerClientIp(req), '203.0.113.7');
  });
});

describe('IP-scoped endpoint rate limits reject unproven CF client IP (#8402)', () => {
  it('rejects unproven CF headers in global and pre-auth scoped budgets before Redis', async () => {
    process.env.CF_EDGE_PROOF_SECRET = 'edge-secret-xyz';
    const request = requestWith({ 'cf-connecting-ip': '203.0.113.7' });
    for (const response of [
      await checkRateLimit(request, {}, { failClosed: false }),
      await checkFailClosedScopedIpRateLimit(request, 'proof-test', 10, '60 s', {}),
    ]) {
      assert.equal(response?.status, 403);
      assert.equal(response?.headers.get('X-RateLimit-Mode'), 'edge-proof');
    }
    assert.equal(await checkRateLimit(request, {}, { principalUserId: 'user_test', failClosed: false }), null);
  });

  it('returns 403 instead of trusting a forged cf-connecting-ip', async () => {
    process.env.CF_EDGE_PROOF_SECRET = 'edge-secret-xyz';
    // Intentionally omit Upstash env: the edge-proof gate must fire before the
    // Redis availability check so fail-open Redis outages cannot re-admit spoofs.
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    const pathname = '/api/infrastructure/v1/reverse-geocode';
    assert.ok(pathname in ENDPOINT_RATE_POLICIES, 'fixture path must carry an endpoint policy');

    const response = await checkEndpointRateLimit(
      requestWith({
        'cf-connecting-ip': '203.0.113.7',
        'x-real-ip': '198.51.100.9',
      }),
      pathname,
      {},
      { failClosed: false },
    );

    assert.ok(response, 'must reject rather than admit');
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('X-RateLimit-Mode'), 'edge-proof');
    assert.deepEqual(await response.json(), { error: 'Cloudflare edge proof required' });
  });

  it('does not reject when a principal-scoped budget is in use', async () => {
    process.env.CF_EDGE_PROOF_SECRET = 'edge-secret-xyz';
    // Leave Upstash unset: principal-scoped budgets skip the edge-proof gate
    // and then hit the deterministic missing-config degraded path (503), which
    // also proves the forged CF header did not take the edge-proof 403 branch.
    // Avoid pointing at a fake host that would attempt an outbound Redis call.
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    const response = await checkEndpointRateLimit(
      requestWith({
        'cf-connecting-ip': '203.0.113.7',
        'x-real-ip': '198.51.100.9',
      }),
      '/api/infrastructure/v1/reverse-geocode',
      {},
      { principalUserId: 'user_test_principal' },
    );

    assert.ok(response, 'missing Redis must degrade rather than admit');
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('X-RateLimit-Mode'), 'degraded');
  });
});

describe('Cloudflare edge-proof Transform Rule coverage (#8402)', () => {
  it('documents path prefixes that must receive x-wm-edge-proof', () => {
    assert.equal(
      EDGE_PROOF_TRANSFORM_EXPRESSION,
      `(http.request.uri.path matches "${EDGE_PROOF_PATH_MATCHER_SOURCE}")`,
    );
    assert.deepEqual([...EDGE_PROOF_PATH_ALTERNATIVES], ['api', 'mcp', 'ask', 'oauth', 'a2a', 'docs/mcp']);
    assert.deepEqual(EDGE_PROOF_PATH_PREFIXES, ['/api/', '/mcp', '/ask', '/oauth/', '/a2a', '/docs/mcp']);
  });

  it('covers every ENDPOINT_RATE_POLICIES path with the published expression', () => {
    // Re-parse the matcher from the published expression so a drifted
    // EDGE_PROOF_TRANSFORM_EXPRESSION cannot pass while pathCoveredByExpression
    // still uses the old source.
    const embedded = EDGE_PROOF_TRANSFORM_EXPRESSION.match(/matches "([^"]+)"/)?.[1];
    assert.equal(embedded, EDGE_PROOF_PATH_MATCHER_SOURCE);
    const fromExpression = new RegExp(embedded!);
    assert.equal(fromExpression.source, EDGE_PROOF_PATH_MATCHER.source);
    for (const pathname of [...Object.keys(ENDPOINT_RATE_POLICIES), ...EDGE_PROOF_PATH_PREFIXES]) {
      const matched = fromExpression.test(pathname);
      assert.ok(
        matched,
        `${pathname} must match the Transform Rule expression ${EDGE_PROOF_TRANSFORM_EXPRESSION}`,
      );
      assert.equal(pathCoveredByExpression(pathname), matched);
    }
  });
});
