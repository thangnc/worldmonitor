import assert from 'node:assert/strict';
import { afterEach, describe, it, before, after } from 'node:test';

import { createDomainGateway } from '../packages/server/gateway.ts';
import { issueSessionToken } from '../api/_session.js';
import { createRedisFetch } from './helpers/fake-upstash-redis.mts';

// A canonical-shaped former user API key. The user-key table is gone, so the
// gateway treats it as any other unknown key: 401 "Invalid API key".
const FORMER_USER_KEY = `wm_${'a'.repeat(40)}`;
const OPERATOR_KEY = 'real-key-123';

const originalKeys = process.env.WORLDMONITOR_VALID_KEYS;
const originalSessionSecret = process.env.WM_SESSION_SECRET;
const originalRedisUrl = process.env.UPSTASH_REDIS_REST_URL;
const originalRedisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
const originalFetch = globalThis.fetch;

function installRateLimitRedisFake(): void {
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
  const { fetchImpl } = createRedisFetch({});
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    if (url.startsWith(process.env.UPSTASH_REDIS_REST_URL || '')) {
      return fetchImpl(input, init);
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}

const ISSUE_4609_GATED_ROUTES = [
  { method: 'GET', path: '/api/market/v1/get-insider-transactions' },
  { method: 'POST', path: '/api/forecast/v1/trigger-simulation' },
  { method: 'POST', path: '/api/scenario/v1/run-scenario' },
  { method: 'GET', path: '/api/scenario/v1/get-scenario-status' },
  { method: 'GET', path: '/api/supply-chain/v1/get-country-chokepoint-index' },
  { method: 'GET', path: '/api/supply-chain/v1/get-bypass-options' },
  { method: 'GET', path: '/api/supply-chain/v1/get-country-cost-shock' },
  { method: 'GET', path: '/api/supply-chain/v1/get-route-explorer-lane' },
  { method: 'GET', path: '/api/supply-chain/v1/get-route-impact' },
  { method: 'GET', path: '/api/supply-chain/v1/get-country-products' },
  { method: 'GET', path: '/api/supply-chain/v1/get-multi-sector-cost-shock' },
  { method: 'GET', path: '/api/supply-chain/v1/get-sector-dependency' },
  { method: 'GET', path: '/api/trade/v1/list-comtrade-flows' },
  { method: 'GET', path: '/api/trade/v1/get-tariff-trends' },
  { method: 'GET', path: '/api/market/v1/analyze-stock' },
  { method: 'GET', path: '/api/market/v1/get-stock-analysis-history' },
  { method: 'GET', path: '/api/market/v1/backtest-stock' },
  { method: 'GET', path: '/api/market/v1/list-stored-stock-backtests' },
] as const;

// Public routes now require a wms_ session token (issue #3541) — header-only
// origin trust is gone. Mint one for tests that previously relied on
// "trusted browser origin = anonymous public read."
process.env.WM_SESSION_SECRET = originalSessionSecret
  ?? 'test-secret-must-be-at-least-32-chars-long-xxx';
let SESSION_TOKEN: string;
before(async () => {
  installRateLimitRedisFake();
  SESSION_TOKEN = (await issueSessionToken()).token;
});

after(() => {
  globalThis.fetch = originalFetch;
  if (originalRedisUrl == null) delete process.env.UPSTASH_REDIS_REST_URL;
  else process.env.UPSTASH_REDIS_REST_URL = originalRedisUrl;
  if (originalRedisToken == null) delete process.env.UPSTASH_REDIS_REST_TOKEN;
  else process.env.UPSTASH_REDIS_REST_TOKEN = originalRedisToken;
});

afterEach(() => {
  if (originalKeys == null) delete process.env.WORLDMONITOR_VALID_KEYS;
  else process.env.WORLDMONITOR_VALID_KEYS = originalKeys;
  installRateLimitRedisFake();
  // Keep the session secret stable across tests so SESSION_TOKEN stays valid.
  process.env.WM_SESSION_SECRET = originalSessionSecret
    ?? 'test-secret-must-be-at-least-32-chars-long-xxx';
});

describe('premium gateway API key enforcement', () => {
  it('enforces premium credentials while allowing public market session auth', async () => {
    const handler = createDomainGateway([
      {
        method: 'GET',
        path: '/api/market/v1/analyze-stock',
        handler: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      },
      {
        method: 'GET',
        path: '/api/resilience/v1/get-resilience-score',
        handler: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      },
      {
        method: 'GET',
        path: '/api/resilience/v1/get-resilience-ranking',
        handler: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      },
      {
        method: 'GET',
        path: '/api/market/v1/list-market-quotes',
        handler: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      },
      {
        method: 'GET',
        path: '/api/market/v1/get-insider-transactions',
        handler: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      },
    ]);

    process.env.WORLDMONITOR_VALID_KEYS = 'real-key-123';

    // Trusted browser origin without credentials — 401 (no API key, no bearer token)
    const browserNoKey = await handler(new Request('https://worldmonitor.app/api/market/v1/analyze-stock?symbol=AAPL', {
      headers: { Origin: 'https://worldmonitor.app' },
    }));
    assert.equal(browserNoKey.status, 401);
    assert.deepEqual(await browserNoKey.json(), { error: 'API key required' });

    const resilienceScoreNoKey = await handler(new Request('https://worldmonitor.app/api/resilience/v1/get-resilience-score?countryCode=US', {
      headers: { Origin: 'https://worldmonitor.app' },
    }));
    assert.equal(resilienceScoreNoKey.status, 401);

    const resilienceRankingNoKey = await handler(new Request('https://worldmonitor.app/api/resilience/v1/get-resilience-ranking', {
      headers: { Origin: 'https://worldmonitor.app' },
    }));
    assert.equal(resilienceRankingNoKey.status, 401);

    // Trusted browser origin with valid API key — 200 (API-key holders bypass entitlement check)
    const browserWithKey = await handler(new Request('https://worldmonitor.app/api/market/v1/analyze-stock?symbol=AAPL', {
      headers: {
        Origin: 'https://worldmonitor.app',
        'X-WorldMonitor-Key': 'real-key-123',
      },
    }));
    assert.equal(browserWithKey.status, 200);

    const resilienceScoreWithKey = await handler(new Request('https://worldmonitor.app/api/resilience/v1/get-resilience-score?countryCode=US', {
      headers: {
        Origin: 'https://worldmonitor.app',
        'X-WorldMonitor-Key': 'real-key-123',
      },
    }));
    assert.equal(resilienceScoreWithKey.status, 200);

    const resilienceRankingWithKey = await handler(new Request('https://worldmonitor.app/api/resilience/v1/get-resilience-ranking', {
      headers: {
        Origin: 'https://worldmonitor.app',
        'X-WorldMonitor-Key': 'real-key-123',
      },
    }));
    assert.equal(resilienceRankingWithKey.status, 200);

    // Unknown origin — blocked (403 from isDisallowedOrigin before key check)
    const unknownNoKey = await handler(new Request('https://external.example.com/api/market/v1/analyze-stock?symbol=AAPL', {
      headers: { Origin: 'https://external.example.com' },
    }));
    assert.equal(unknownNoKey.status, 403);

    // Public endpoints — anonymous browsers authenticate via the wms_ session token
    // (issue #3541; previously this was a trusted-origin bypass).
    const publicAllowed = await handler(new Request('https://worldmonitor.app/api/market/v1/list-market-quotes?symbols=AAPL', {
      headers: { Origin: 'https://worldmonitor.app', 'X-WorldMonitor-Key': SESSION_TOKEN },
    }));
    assert.equal(publicAllowed.status, 200);

    const insiderTransactionsDenied = await handler(new Request('https://worldmonitor.app/api/market/v1/get-insider-transactions?symbol=AAPL', {
      headers: { Origin: 'https://worldmonitor.app', 'X-WorldMonitor-Key': SESSION_TOKEN },
    }));
    assert.equal(insiderTransactionsDenied.status, 401);
  });

  it('issue #4609 Pro RPCs reject a former wm_ user key and an anonymous session with 401', async () => {
    const handler = createDomainGateway(ISSUE_4609_GATED_ROUTES.map(({ method, path }) => ({
      method,
      path,
      handler: async () => new Response(JSON.stringify({ leaked: true }), { status: 200 }),
    })));
    process.env.WORLDMONITOR_VALID_KEYS = OPERATOR_KEY;

    for (const { method, path } of ISSUE_4609_GATED_ROUTES) {
      const keyed = await handler(new Request(`https://worldmonitor.app${path}`, {
        method,
        headers: { Origin: 'https://worldmonitor.app', 'X-Api-Key': FORMER_USER_KEY },
      }));
      assert.equal(keyed.status, 401, `${method} ${path} must reject a wm_ user key`);
      assert.deepEqual(await keyed.json(), { error: 'Invalid API key' });

      const session = await handler(new Request(`https://worldmonitor.app${path}`, {
        method,
        headers: { Origin: 'https://worldmonitor.app', 'X-WorldMonitor-Key': SESSION_TOKEN },
      }));
      assert.equal(session.status, 401, `${method} ${path} must reject an anonymous session`);
      assert.deepEqual(await session.json(), { error: 'Pro authentication required' });
    }
  });

  it('allows issue #4609 Pro RPCs for an operator key', async () => {
    const handler = createDomainGateway(ISSUE_4609_GATED_ROUTES.map(({ method, path }) => ({
      method,
      path,
      handler: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    })));
    process.env.WORLDMONITOR_VALID_KEYS = OPERATOR_KEY;

    for (const { method, path } of ISSUE_4609_GATED_ROUTES) {
      const res = await handler(new Request(`https://worldmonitor.app${path}`, {
        method,
        headers: { Origin: 'https://worldmonitor.app', 'X-Api-Key': OPERATOR_KEY },
      }));
      assert.equal(res.status, 200, `${method} ${path} should allow an operator key`);
      assert.deepEqual(await res.json(), { ok: true });
    }
  });

  it('PR #3557 review: anonymous wms_ session token does NOT unlock premium endpoints', async () => {
    // Regression: an earlier revision returned valid:true for wms_ tokens and
    // the gateway treated any non-wm_ valid key as enterprise → entitlement
    // check skipped → premium content served to any anonymous caller. Lock the
    // contract: wms_ on a premium route must 401 (no Pro auth) — never 200.
    const handler = createDomainGateway([
      {
        method: 'GET',
        path: '/api/market/v1/analyze-stock',
        handler: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      },
      {
        method: 'GET',
        path: '/api/resilience/v1/get-resilience-score',
        handler: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      },
    ]);

    for (const path of ['/api/market/v1/analyze-stock?symbol=AAPL', '/api/resilience/v1/get-resilience-score?countryCode=US']) {
      const res = await handler(new Request(`https://worldmonitor.app${path}`, {
        headers: { Origin: 'https://worldmonitor.app', 'X-WorldMonitor-Key': SESSION_TOKEN },
      }));
      assert.notEqual(res.status, 200, `wms_ MUST NOT unlock ${path} (got ${res.status})`);
    }
  });

  it('serves the freed national-debt and sanctions-pressure routes to an anonymous wms_ session', async () => {
    // Both seeds are already public through /api/bootstrap?tier=slow&public=1,
    // so the gateway must not re-gate the RPCs behind Pro auth or a tier.
    const freedPaths = [
      '/api/economic/v1/get-national-debt',
      '/api/sanctions/v1/list-sanctions-pressure',
    ];
    const handler = createDomainGateway(freedPaths.map((path) => ({
      method: 'GET',
      path,
      handler: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    })));

    for (const path of freedPaths) {
      const res = await handler(new Request(`https://worldmonitor.app${path}`, {
        headers: { Origin: 'https://worldmonitor.app', 'X-WorldMonitor-Key': SESSION_TOKEN },
      }));
      assert.equal(res.status, 200, `wms_ session must reach ${path} (got ${res.status})`);
    }
  });

  it('strips client-supplied x-user-id before an anonymous session reaches handlers', async () => {
    const handler = createDomainGateway([
      {
        method: 'GET',
        path: '/api/market/v1/list-market-quotes',
        handler: async (request) => new Response(JSON.stringify({
          userId: request.headers.get('x-user-id'),
        }), { status: 200 }),
      },
    ]);

    const res = await handler(new Request('https://worldmonitor.app/api/market/v1/list-market-quotes?symbols=AAPL', {
      headers: {
        Origin: 'https://worldmonitor.app',
        'X-WorldMonitor-Key': SESSION_TOKEN,
        'x-user-id': 'attacker-controlled-user',
      },
    }));

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { userId: null });
  });

  it('strips client-supplied x-user-id before an operator key reaches a premium handler (#3548)', async () => {
    const handler = createDomainGateway([
      {
        method: 'GET',
        path: '/api/market/v1/analyze-stock',
        handler: async (req) =>
          new Response(JSON.stringify({ userId: req.headers.get('x-user-id') }), { status: 200 }),
      },
    ]);
    process.env.WORLDMONITOR_VALID_KEYS = OPERATOR_KEY;

    const res = await handler(
      new Request('https://worldmonitor.app/api/market/v1/analyze-stock?symbol=AAPL', {
        headers: {
          Origin: 'https://worldmonitor.app',
          'X-WorldMonitor-Key': OPERATOR_KEY,
          'x-user-id': 'victim-user',
        },
      }),
    );

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { userId: null });
  });
});

describe('POST-to-GET compatibility hardening', () => {
  async function captureRedisCalls(run: () => Promise<Response>) {
    const delegateFetch = globalThis.fetch;
    const redisCalls: Array<{ url: string; body: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (url.startsWith(process.env.UPSTASH_REDIS_REST_URL || '')) {
        redisCalls.push({
          url,
          body: typeof init?.body === 'string' ? init.body : '',
        });
      }
      return delegateFetch(input, init);
    }) as typeof fetch;
    try {
      return { response: await run(), redisCalls };
    } finally {
      globalThis.fetch = delegateFetch;
    }
  }

  function makePublicMarketHandler() {
    let seenUrl: URL | null = null;
    const handler = createDomainGateway([
      {
        method: 'GET',
        path: '/api/market/v1/list-market-quotes',
        handler: async (req) => {
          seenUrl = new URL(req.url);
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        },
      },
    ]);
    return {
      handler,
      seenUrl: () => seenUrl,
    };
  }

  function compatPost(body: string, headers: Record<string, string> = {}) {
    return new Request('https://worldmonitor.app/api/market/v1/list-market-quotes', {
      method: 'POST',
      headers: {
        Origin: 'https://worldmonitor.app',
        'X-WorldMonitor-Key': SESSION_TOKEN,
        'Content-Type': 'application/json',
        ...headers,
      },
      body,
    });
  }

  it('converts bounded scalar and array JSON bodies to GET query params', async () => {
    const { handler, seenUrl } = makePublicMarketHandler();
    const body = JSON.stringify({ symbols: ['AAPL', 'MSFT'], includeExtended: true });

    const res = await handler(compatPost(body, { 'Content-Length': String(Buffer.byteLength(body)) }));

    assert.equal(res.status, 200);
    assert.deepEqual(seenUrl()?.searchParams.getAll('symbols'), ['AAPL', 'MSFT']);
    assert.equal(seenUrl()?.searchParams.get('includeExtended'), 'true');
  });

  it('rejects POST-to-GET array expansion over 200 values', async () => {
    const { handler } = makePublicMarketHandler();
    const body = JSON.stringify({
      symbols: Array.from({ length: 201 }, (_, i) => `SYM${i}`),
    });

    const res = await handler(compatPost(body, { 'Content-Length': String(Buffer.byteLength(body)) }));

    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), {
      error: 'Too many values for POST compatibility parameter',
      parameter: 'symbols',
      maxValues: 200,
    });
  });

  it('skips POST-to-GET compatibility before reading bodies with missing, invalid, or oversized Content-Length', async () => {
    const { handler } = makePublicMarketHandler();
    const body = JSON.stringify({ symbols: ['AAPL'] });

    const missingReq = compatPost(body);
    missingReq.clone = () => { throw new Error('POST compatibility must not parse missing-length bodies'); };
    const missing = await handler(missingReq);
    assert.equal(missing.status, 405);

    const invalidReq = compatPost(body, { 'Content-Length': 'abc' });
    invalidReq.clone = () => { throw new Error('POST compatibility must not parse invalid-length bodies'); };
    const invalid = await handler(invalidReq);
    assert.equal(invalid.status, 405);

    const oversizedReq = compatPost(body, { 'Content-Length': '1048576' });
    oversizedReq.clone = () => { throw new Error('POST compatibility must not parse oversized bodies'); };
    const oversized = await handler(oversizedReq);
    assert.equal(oversized.status, 405);
  });

  it('rejects malformed JSON instead of falling back to an unfiltered GET', async () => {
    const { handler, seenUrl } = makePublicMarketHandler();
    const body = '{not json';

    const { response: res, redisCalls } = await captureRedisCalls(
      () => handler(compatPost(body, { 'Content-Length': String(Buffer.byteLength(body)) })),
    );

    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'Invalid JSON body for POST compatibility' });
    assert.equal(seenUrl(), null);
    assert.ok(
      redisCalls.some(({ body }) => body.includes('rl:ep') && body.includes('/api/market/v1/list-market-quotes')),
      'malformed compatibility requests must traverse endpoint abuse limiting',
    );
  });

  it('rejects a JSON array body instead of encoding index keys as query params', async () => {
    const { handler, seenUrl } = makePublicMarketHandler();
    const body = JSON.stringify(['AAPL', 'MSFT']);

    const res = await handler(compatPost(body, { 'Content-Length': String(Buffer.byteLength(body)) }));

    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'Unsupported POST compatibility body' });
    assert.equal(seenUrl(), null);
  });

  it('rejects object values without applying sibling scalars', async () => {
    const { handler, seenUrl } = makePublicMarketHandler();
    const body = JSON.stringify({
      symbols: ['AAPL'],
      filter: { sector: 'tech' },
    });

    const res = await handler(compatPost(body, { 'Content-Length': String(Buffer.byteLength(body)) }));

    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), {
      error: 'Unsupported value for POST compatibility parameter',
      parameter: 'filter',
    });
    assert.equal(seenUrl(), null);
  });

  it('rejects non-scalar array members without applying sibling scalars', async () => {
    const { handler, seenUrl } = makePublicMarketHandler();
    const body = JSON.stringify({
      includeExtended: true,
      symbols: ['AAPL', { nested: true }],
    });

    const res = await handler(compatPost(body, { 'Content-Length': String(Buffer.byteLength(body)) }));

    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), {
      error: 'Unsupported value for POST compatibility parameter',
      parameter: 'symbols',
    });
    assert.equal(seenUrl(), null);
  });

  it('rejects null values without applying sibling scalars', async () => {
    const { handler, seenUrl } = makePublicMarketHandler();
    const body = JSON.stringify({
      includeExtended: true,
      symbols: null,
    });

    const res = await handler(compatPost(body, { 'Content-Length': String(Buffer.byteLength(body)) }));

    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), {
      error: 'Unsupported value for POST compatibility parameter',
      parameter: 'symbols',
    });
    assert.equal(seenUrl(), null);
  });

  it('converts empty POST bodies to GET without query params', async () => {
    const { handler, seenUrl } = makePublicMarketHandler();

    const res = await handler(compatPost('', { 'Content-Length': '0' }));

    assert.equal(res.status, 200);
    assert.equal(seenUrl()?.search, '');
  });

  it('converts whitespace-only POST bodies to GET without query params', async () => {
    const { handler, seenUrl } = makePublicMarketHandler();
    const body = ' \n\t ';

    const res = await handler(compatPost(body, { 'Content-Length': String(Buffer.byteLength(body)) }));

    assert.equal(res.status, 200);
    assert.equal(seenUrl()?.search, '');
  });

  it('rejects a JSON null body', async () => {
    const { handler, seenUrl } = makePublicMarketHandler();
    const body = 'null';

    const res = await handler(compatPost(body, { 'Content-Length': String(Buffer.byteLength(body)) }));

    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'Unsupported POST compatibility body' });
    assert.equal(seenUrl(), null);
  });

  it('does not reject an unsupported body when no GET fallback route exists', async () => {
    const { handler, seenUrl } = makePublicMarketHandler();
    const body = JSON.stringify({ filter: { nested: true } });

    const res = await handler(new Request('https://worldmonitor.app/api/market/v1/does-not-exist', {
      method: 'POST',
      headers: {
        Origin: 'https://worldmonitor.app',
        'X-WorldMonitor-Key': SESSION_TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(body)),
      },
      body,
    }));

    assert.equal(res.status, 404);
    assert.equal(seenUrl(), null);
  });

  it('returns 400 when the POST compatibility body cannot be read', async () => {
    const { handler, seenUrl } = makePublicMarketHandler();
    const body = JSON.stringify({ symbols: ['AAPL'] });
    const req = compatPost(body, { 'Content-Length': String(Buffer.byteLength(body)) });
    req.clone = () => ({
      text: async () => {
        throw new Error('stream reset');
      },
    }) as Request;

    const { response: res, redisCalls } = await captureRedisCalls(() => handler(req));

    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'malformed_request' });
    assert.equal(seenUrl(), null);
    assert.ok(
      redisCalls.some(({ body }) => body.includes('rl:ep') && body.includes('/api/market/v1/list-market-quotes')),
      'unreadable compatibility requests must traverse endpoint abuse limiting',
    );
  });

  it('enforces the actual-byte backstop when Content-Length understates a multibyte body', async () => {
    const { handler, seenUrl } = makePublicMarketHandler();
    const body = JSON.stringify({ symbols: ['é'.repeat(524_288)] });
    assert.ok(Buffer.byteLength(body) >= 1_048_576);

    const res = await handler(compatPost(body, { 'Content-Length': '128' }));

    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'malformed_request' });
    assert.equal(seenUrl(), null);
  });
});

// ---------------------------------------------------------------------------
// Bearer token auth path for premium endpoints
// ---------------------------------------------------------------------------

describe('premium gateway: a bearer token is not a credential', () => {
  let handler: (req: Request) => Promise<Response>;

  before(() => {
    process.env.WORLDMONITOR_VALID_KEYS = OPERATOR_KEY;
    handler = createDomainGateway([
      {
        method: 'GET',
        path: '/api/market/v1/analyze-stock',
        handler: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      },
      {
        method: 'GET',
        path: '/api/resilience/v1/get-resilience-score',
        handler: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      },
      {
        method: 'GET',
        path: '/api/market/v1/list-market-quotes',
        handler: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      },
    ]);
  });

  it('rejects a bearer token alone on premium endpoints → 401', async () => {
    for (const path of ['/api/market/v1/analyze-stock?symbol=AAPL', '/api/resilience/v1/get-resilience-score?countryCode=US']) {
      const res = await handler(new Request(`https://worldmonitor.app${path}`, {
        headers: { Origin: 'https://worldmonitor.app', Authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.pro.sig' },
      }));
      assert.equal(res.status, 401, path);
    }
  });

  it('accepts an operator key on resilience premium endpoints → 200', async () => {
    process.env.WORLDMONITOR_VALID_KEYS = OPERATOR_KEY;
    const res = await handler(new Request('https://worldmonitor.app/api/resilience/v1/get-resilience-score?countryCode=US', {
      headers: { Origin: 'https://worldmonitor.app', 'X-WorldMonitor-Key': OPERATOR_KEY },
    }));
    assert.equal(res.status, 200);
  });

  it('public routes accept the anonymous browser session token', async () => {
    const res = await handler(new Request('https://worldmonitor.app/api/market/v1/list-market-quotes?symbols=AAPL', {
      headers: { Origin: 'https://worldmonitor.app', 'X-WorldMonitor-Key': SESSION_TOKEN },
    }));
    assert.equal(res.status, 200);
  });

  it('public routes WITHOUT a session token are rejected (#3541 — header-only trust is gone)', async () => {
    const res = await handler(new Request('https://worldmonitor.app/api/market/v1/list-market-quotes?symbols=AAPL', {
      headers: { Origin: 'https://worldmonitor.app' },
    }));
    assert.equal(res.status, 401);
  });
});
