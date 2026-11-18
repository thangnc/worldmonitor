// Tests for the three historical-intelligence RPCs (#5694):
//   POST /api/intelligence/v1/search-intel-history
//   GET /api/intelligence/v1/get-intel-timeline
//   POST /api/intelligence/v1/get-similar-events
//
// The durable history store (Convex `intelHistory`) was removed with Convex and
// the Lite UI does not call these routes. The handlers still enforce the
// request contract, then answer the documented store-outage shape
// (`upstreamUnavailable: true`, no records) without any upstream call.
//
// No network: globalThis.fetch throws for the whole suite.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { PREMIUM_RPC_PATHS } from '../packages/client/shared/premium-paths.ts';
import { getIntelTimeline } from '../packages/server/worldmonitor/intelligence/v1/get-intel-timeline';
import { getSimilarEvents } from '../packages/server/worldmonitor/intelligence/v1/get-similar-events';
import { searchIntelHistory } from '../packages/server/worldmonitor/intelligence/v1/search-intel-history';
import { validationFailure } from './helpers/validation-failure.mts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const ctx = {} as never;

const realFetch = globalThis.fetch;
let fetchCalls = 0;

beforeEach(() => {
  fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error('intel-history handlers must not call any upstream');
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('request contract', () => {
  it('rejects a whitespace-only or empty timeline scope as unscoped', async () => {
    for (const scope of [{ domain: '   ', country: '  ' }, { domain: '', country: '' }]) {
      await assert.rejects(
        getIntelTimeline(ctx, { ...scope, from: 0, to: 0, limit: 0 }),
        validationFailure('domain', /at least one of domain or country/i),
      );
    }
  });

  it('rejects invalid domains, countries, inverted bounds, and excessive limits', async () => {
    const invalidRequests = [
      ['domain', { domain: 'cyber', country: '', from: 0, to: 0, limit: 0 }],
      ['country', { domain: 'conflict', country: 'U1', from: 0, to: 0, limit: 0 }],
      ['from', { domain: 'conflict', country: '', from: 2, to: 1, limit: 0 }],
      ['from', { domain: 'conflict', country: '', from: -1, to: 0, limit: 0 }],
      ['limit', { domain: 'conflict', country: '', from: 0, to: 0, limit: 201 }],
    ] as const;
    for (const [field, request] of invalidRequests) {
      await assert.rejects(getIntelTimeline(ctx, request), validationFailure(field));
    }
  });

  it('rejects oversized timeline cursors', async () => {
    await assert.rejects(
      getIntelTimeline(ctx, { domain: 'conflict', country: '', from: 0, to: 0, limit: 0, cursor: 'x'.repeat(4097) } as never),
      validationFailure('cursor'),
    );
  });

  it('rejects missing or oversized search query text and limits above 64', async () => {
    for (const query of ['', 'x'.repeat(501)]) {
      await assert.rejects(searchIntelHistory(ctx, {
        query, domain: '', country: '', from: 0, to: 0, limit: 0,
      }), validationFailure('query', /must be between/i));
    }
    await assert.rejects(searchIntelHistory(ctx, {
      query: 'strait closure', domain: '', country: '', from: 0, to: 0, limit: 65,
    }), validationFailure('limit'));
  });

  it('rejects missing or oversized situation text and limits above 32', async () => {
    for (const situation of ['short', 'x'.repeat(1001)]) {
      await assert.rejects(getSimilarEvents(ctx, {
        situation, domain: '', country: '', from: 0, to: 0, limit: 0,
      } as never), validationFailure('situation', /must be between/i));
    }
    await assert.rejects(getSimilarEvents(ctx, {
      situation: 'Naval blockade of a strait', domain: '', country: '', from: 0, to: 0, limit: 33,
    } as never), validationFailure('limit'));
  });
});

describe('store-outage answer', () => {
  it('search reports upstreamUnavailable with no records and no upstream call', async () => {
    const res = await searchIntelHistory(ctx, {
      query: 'strait closure', domain: 'conflict', country: 'UA', from: 0, to: 0, limit: 0,
    });
    assert.deepEqual(res, { records: [], query: 'strait closure', partial: false, upstreamUnavailable: true });
    assert.equal(fetchCalls, 0);
  });

  it('timeline reports upstreamUnavailable with no records and no upstream call', async () => {
    const res = await getIntelTimeline(ctx, { domain: '', country: 'UA', from: 0, to: 0, limit: 0 });
    assert.deepEqual(res, { records: [], partial: false, upstreamUnavailable: true, nextCursor: '' });
    assert.equal(fetchCalls, 0);
  });

  it('similar events reports upstreamUnavailable with no records and no upstream call', async () => {
    const situation = 'Naval blockade of a strait';
    const res = await getSimilarEvents(ctx, {
      situation, domain: '', country: '', from: 0, to: 0, limit: 0,
    } as never);
    assert.deepEqual(res, { records: [], situation, partial: false, upstreamUnavailable: true });
    assert.equal(fetchCalls, 0);
  });
});

const read = (rel: string): string => readFileSync(resolve(root, rel), 'utf-8');

const serviceProtoSrc = read('packages/contracts/proto/worldmonitor/intelligence/v1/service.proto');
const recordProtoSrc = read('packages/contracts/proto/worldmonitor/intelligence/v1/intel_history_record.proto');
const searchProtoSrc = read('packages/contracts/proto/worldmonitor/intelligence/v1/search_intel_history.proto');
const timelineProtoSrc = read('packages/contracts/proto/worldmonitor/intelligence/v1/get_intel_timeline.proto');
const similarProtoSrc = read('packages/contracts/proto/worldmonitor/intelligence/v1/get_similar_events.proto');
const handlerIndexSrc = read('packages/server/worldmonitor/intelligence/v1/handler.ts');
const gatewaySrc = read('packages/server/gateway.ts');
const rateLimitSrc = read('packages/server/_shared/rate-limit.ts');
const openApiJson = JSON.parse(read('packages/contracts/openapi/IntelligenceService.openapi.json')) as {
  paths: Record<string, Record<string, unknown>>;
};

const RPCS = [
  {
    rpc: 'SearchIntelHistory',
    file: 'search_intel_history',
    path: '/api/intelligence/v1/search-intel-history',
  },
  {
    rpc: 'GetIntelTimeline',
    file: 'get_intel_timeline',
    path: '/api/intelligence/v1/get-intel-timeline',
  },
  {
    rpc: 'GetSimilarEvents',
    file: 'get_similar_events',
    path: '/api/intelligence/v1/get-similar-events',
  },
] as const;

describe('proto definitions', () => {
  it('defines the shared IntelHistoryRecord once', () => {
    assert.match(recordProtoSrc, /message IntelHistoryRecord/);
    assert.match(recordProtoSrc, /int64 occurred_at = 9 \[\(sebuf\.http\.int64_encoding\) = INT64_ENCODING_NUMBER\]/);
    assert.match(recordProtoSrc, /int64 ingested_at = 10 \[\(sebuf\.http\.int64_encoding\) = INT64_ENCODING_NUMBER\]/);
    assert.match(recordProtoSrc, /double score = 11/);
    // Defined once, reused by all three request files (satellite.proto pattern).
    assert.equal(/message IntelHistoryRecord/.test(searchProtoSrc), false);
    for (const src of [searchProtoSrc, timelineProtoSrc, similarProtoSrc]) {
      assert.match(src, /import "worldmonitor\/intelligence\/v1\/intel_history_record\.proto"/);
    }
  });

  for (const { rpc, file } of RPCS) {
  it(`declares ${rpc} in service.proto`, () => {
      assert.match(
        serviceProtoSrc,
        new RegExp(`rpc ${rpc}\\(${rpc}Request\\) returns \\(${rpc}Response\\)`),
      );
      assert.match(serviceProtoSrc, new RegExp(`import "worldmonitor/intelligence/v1/${file}\\.proto"`));
    });
  }

  it('signals upstream failure with a declared proto field, not an out-of-band cast', () => {
    for (const src of [searchProtoSrc, timelineProtoSrc, similarProtoSrc]) {
      assert.match(src, /bool upstream_unavailable = \d+/);
    }
  });

  it('constrains the free-text inputs', () => {
    assert.match(searchProtoSrc, /\(buf\.validate\.field\)\.string\.min_len = 2/);
    assert.match(searchProtoSrc, /\(buf\.validate\.field\)\.string\.max_len = 500/);
    assert.match(similarProtoSrc, /\(buf\.validate\.field\)\.string\.min_len = 10/);
    assert.match(similarProtoSrc, /\(buf\.validate\.field\)\.string\.max_len = 1000/);
  });

  it('caps limit at the published ceilings', () => {
    assert.match(searchProtoSrc, /\(buf\.validate\.field\)\.int32\.lte = 64/);
    assert.match(timelineProtoSrc, /\(buf\.validate\.field\)\.int32\.lte = 200/);
    assert.match(similarProtoSrc, /\(buf\.validate\.field\)\.int32\.lte = 32/);
  });
});

describe('handler registration', () => {
  it('registers all three handlers in handler.ts', () => {
    for (const name of ['searchIntelHistory', 'getIntelTimeline', 'getSimilarEvents']) {
      assert.match(handlerIndexSrc, new RegExp(`import \\{ ${name} \\} from`));
      assert.match(handlerIndexSrc, new RegExp(`\\s+${name},`));
    }
  });
});

describe('gateway wiring', () => {
  for (const { path } of RPCS) {
    it(`gates ${path} behind an operator key`, () => {
      // Membership in the real Set is what gates the route; a grep of the
      // module text also matches a path sitting in a comment.
      assert.ok(PREMIUM_RPC_PATHS.has(path), `${path} missing from PREMIUM_RPC_PATHS`);
    });
  }

  it('assigns the GET timeline route a slow gateway cache tier', () => {
    assert.match(
      gatewaySrc,
      /'\/api\/intelligence\/v1\/get-intel-timeline':\s*'slow'/,
    );
  });

  it('does not register POST semantic reads in the GET-only gateway cache tier map', () => {
    for (const path of [
      '/api/intelligence/v1/search-intel-history',
      '/api/intelligence/v1/get-similar-events',
    ]) {
      assert.doesNotMatch(gatewaySrc, new RegExp(`'${path}':\\s*'slow'`));
    }
  });

  it('fails closed on the two embedding-backed routes', () => {
    for (const path of [
      '/api/intelligence/v1/search-intel-history',
      '/api/intelligence/v1/get-similar-events',
    ]) {
      const policyIdx = rateLimitSrc.indexOf('export const ENDPOINT_RATE_POLICIES');
      const failClosedIdx = rateLimitSrc.indexOf('export const FAIL_CLOSED_ENDPOINT_RATE_POLICY_REQUIRED');
      assert.ok(rateLimitSrc.slice(policyIdx, failClosedIdx).includes(`'${path}'`), `${path} needs an endpoint policy`);
      assert.ok(rateLimitSrc.slice(failClosedIdx).includes(`'${path}'`), `${path} needs a fail-closed requirement`);
    }
  });
});

describe('generated OpenAPI', () => {
  for (const { path } of RPCS) {
  it(`publishes the expected method for ${path}`, () => {
      assert.ok(openApiJson.paths[path], `${path} missing from IntelligenceService.openapi.json`);
      const method = path.includes('search-intel-history') || path.includes('get-similar-events') ? 'post' : 'get';
      assert.ok(openApiJson.paths[path]?.[method], `${path} must be a ${method.toUpperCase()} operation`);
    });
  }
});
