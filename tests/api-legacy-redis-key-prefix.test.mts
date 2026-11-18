/**
 * #7674 — the legacy api/_upstash-json.js layer must resolve the deployment
 * key prefix exactly like packages/server/_shared/redis.ts: app-owned keys ride the
 * `preview:<sha>:` namespace by default (reads AND writes), while
 * seeder-owned keys are read raw in every environment because the Railway
 * fleet publishes them bare.
 *
 * Production is unaffected by any of this (the prefix is '' there); these
 * tests run the real consumers under VERCEL_ENV=preview with a stubbed
 * Upstash and assert the EXACT keys requested — the same recipe
 * tests/supply-chain-raw-keys.test.mts uses for the server layer.
 *
 * Covered asymmetries from the issue:
 *   - The health sweep classified the route-stamped temporal producer keys
 *     against production rows while reading every seeder key bare.
 *   - get-risk-scores raw-read the app-owned temporal:anomalies:v1 snapshot.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

const SHA = 'deadbeefcafe4321';
const PREFIX = `preview:${SHA.slice(0, 8)}:`;
const UPSTASH = 'https://upstash.test';

process.env.VERCEL_ENV = 'preview';
process.env.VERCEL_GIT_COMMIT_SHA = SHA;
process.env.UPSTASH_REDIS_REST_URL = UPSTASH;
process.env.UPSTASH_REDIS_REST_TOKEN = 'upstash-token';
delete process.env.LOCAL_API_MODE;

// Imported AFTER the env above.
const upstash = await import('../api/_upstash-json.js');
const { isAppOwnedRedisKey } = await import('../api/_redis-key-ownership.js');

/** Decoded /get/<key> paths, in call order. */
const getPaths = [];
/** Decoded command arrays from every pipeline POST, in call order. */
const pipelineBodies = [];

function resetRecordings() {
  getPaths.length = 0;
  pipelineBodies.length = 0;
}

after(() => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

beforeEach(() => {
  // Restore the module-level preview env in case a prior test in this file
  // juggled it; the api prefix is computed per call, so no cache reset hook
  // exists or is needed.
  process.env.VERCEL_ENV = 'preview';
  process.env.VERCEL_GIT_COMMIT_SHA = SHA;
  resetRecordings();
});

/** Record Upstash traffic; return null for every GET (cache miss). */
function stubUpstash() {
  globalThis.fetch = (async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith(`${UPSTASH}/get/`)) {
      getPaths.push(decodeURIComponent(url.slice(`${UPSTASH}/get/`.length)));
      return Response.json({ result: null });
    }
    if (url.startsWith(`${UPSTASH}/pipeline`)) {
      const commands = JSON.parse(init.body);
      pipelineBodies.push(commands);
      return Response.json(commands.map(() => ({ result: null })));
    }
    if (url.startsWith(UPSTASH)) return Response.json({ result: null });
    throw new Error(`unexpected global fetch: ${url}`);
  }) as typeof fetch;
}

describe('api/_upstash-json.js deployment key prefix mechanics (#7674)', () => {
  it('sanity: the suite really runs under a non-empty deployment prefix', () => {
    assert.equal(upstash.getKeyPrefix(), PREFIX);
    assert.equal(upstash.applyRedisKeyPrefix('k'), `${PREFIX}k`);
  });

  it('readJsonFromUpstash prefixes by default and reads raw on request', async () => {
    stubUpstash();
    await upstash.readJsonFromUpstash('app:owned:v1');
    await upstash.readJsonFromUpstash('seed:owned:v1', 3_000, true);
    assert.deepEqual(getPaths, [`${PREFIX}app:owned:v1`, 'seed:owned:v1']);
  });

  it('readRawJsonFromUpstash prefixes by default and reads raw on request', async () => {
    stubUpstash();
    await upstash.readRawJsonFromUpstash('app:owned:v1');
    await upstash.readRawJsonFromUpstash('seed:owned:v1', 3_000, true);
    assert.deepEqual(getPaths, [`${PREFIX}app:owned:v1`, 'seed:owned:v1']);
  });

  it('readJsonFromUpstashWithStatus delegates the raw flag', async () => {
    stubUpstash();
    await upstash.readJsonFromUpstashWithStatus('app:owned:v1');
    await upstash.readJsonFromUpstashWithStatus('seed:owned:v1', 3_000, true);
    assert.deepEqual(getPaths, [`${PREFIX}app:owned:v1`, 'seed:owned:v1']);
  });

  it('readJsonBatchFromUpstashWithStatus prefixes every key unless raw', async () => {
    stubUpstash();
    await upstash.readJsonBatchFromUpstashWithStatus(['app:a', 'app:b']);
    await upstash.readJsonBatchFromUpstashWithStatus(['seed:a'], 3_000, true);
    assert.deepEqual(pipelineBodies, [
      [['GET', `${PREFIX}app:a`], ['GET', `${PREFIX}app:b`]],
      [['GET', 'seed:a']],
    ]);
  });

  it('setCachedData writes prefixed by default and verbatim when raw', async () => {
    stubUpstash();
    await upstash.setCachedData('app:owned:v1', { x: 1 }, 60);
    await upstash.setCachedData('seed:owned:v1', { x: 1 }, 60, true);
    assert.deepEqual(pipelineBodies, [
      [['SET', `${PREFIX}app:owned:v1`, '{"x":1}', 'EX', '60']],
      [['SET', 'seed:owned:v1', '{"x":1}', 'EX', '60']],
    ]);
  });

  it('redisPipeline prefixes the key argument of every command unless raw', async () => {
    stubUpstash();
    await upstash.redisPipeline([
      ['GET', 'app:a'],
      ['SET', 'app:b', '1', 'EX', '60'],
      ['INCR', 'app:c'],
      ['ZRANGE', 'app:d', '0', '-1'],
    ]);
    await upstash.redisPipeline([['GET', 'seed:a']], 5_000, true);
    assert.deepEqual(pipelineBodies, [
      [
        ['GET', `${PREFIX}app:a`],
        ['SET', `${PREFIX}app:b`, '1', 'EX', '60'],
        ['INCR', `${PREFIX}app:c`],
        ['ZRANGE', `${PREFIX}app:d`, '0', '-1'],
      ],
      [['GET', 'seed:a']],
    ]);
  });

  it('redisPipeline prefixes EVAL KEYS via the key-count argument, mirroring the server layer', async () => {
    stubUpstash();
    await upstash.redisPipeline([
      ['EVAL', 'script', '2', 'app:k1', 'app:k2', 'arg1'],
      ['EVAL', 'script', '1', 'seed:k1', 'arg1'],
    ]);
    assert.deepEqual(pipelineBodies, [
      [
        ['EVAL', 'script', '2', `${PREFIX}app:k1`, `${PREFIX}app:k2`, 'arg1'],
        // raw only matters per-pipeline; this EVAL's key is a non-key slot
        // ('script') and its KEYS are still finalized.
        ['EVAL', 'script', '1', `${PREFIX}seed:k1`, 'arg1'],
      ],
    ]);
  });

  it('non-string verbs/keys pass through untouched', async () => {
    stubUpstash();
    await upstash.redisPipeline([['GET', 42]]);
    assert.deepEqual(pipelineBodies, [[['GET', 42]]]);
  });

  it('the prefix recomputes per call when the env changes (never memoized)', () => {
    process.env.VERCEL_GIT_COMMIT_SHA = 'cafe0001abcd';
    try {
      assert.equal(upstash.getKeyPrefix(), 'preview:cafe0001:');
      assert.equal(upstash.applyRedisKeyPrefix('k'), 'preview:cafe0001:k');
    } finally {
      process.env.VERCEL_GIT_COMMIT_SHA = SHA;
    }
    assert.equal(upstash.getKeyPrefix(), PREFIX);
    assert.equal(upstash.applyRedisKeyPrefix('k'), `${PREFIX}k`);
  });

  it('production and non-Vercel runtimes get an empty prefix (byte-identical wire keys)', () => {
    const savedEnv = process.env.VERCEL_ENV;
    const savedSha = process.env.VERCEL_GIT_COMMIT_SHA;
    try {
      process.env.VERCEL_ENV = 'production';
      assert.equal(upstash.getKeyPrefix(), '');
      assert.equal(upstash.applyRedisKeyPrefix('seed:owned:v1'), 'seed:owned:v1');

      delete process.env.VERCEL_ENV;
      assert.equal(upstash.getKeyPrefix(), '', 'the Railway digest runtime (no VERCEL_ENV) must stay bare');

      delete process.env.VERCEL_GIT_COMMIT_SHA;
      process.env.VERCEL_ENV = 'preview';
      assert.equal(upstash.getKeyPrefix(), 'preview:dev:', 'a missing SHA falls back to dev');
    } finally {
      if (savedEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = savedEnv;
      if (savedSha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
      else process.env.VERCEL_GIT_COMMIT_SHA = savedSha;
    }
  });

  it('the api prefix implementation stays byte-identical to the server mirror', async () => {
    const serverRedis = await import('../packages/server/_shared/redis.ts');
    const savedEnv = process.env.VERCEL_ENV;
    const savedSha = process.env.VERCEL_GIT_COMMIT_SHA;
    try {
      for (const [env, sha] of [
        ['preview', SHA],
        ['production', undefined],
        [undefined, undefined],
      ] as const) {
        if (env === undefined) delete process.env.VERCEL_ENV;
        else process.env.VERCEL_ENV = env;
        if (sha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
        else process.env.VERCEL_GIT_COMMIT_SHA = sha;
        serverRedis.__resetKeyPrefixCacheForTests();
        assert.equal(upstash.getKeyPrefix(), serverRedis.getKeyPrefix(),
          `api and server prefixes must agree for VERCEL_ENV=${env ?? '<unset>'}`);
      }
    } finally {
      if (savedEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = savedEnv;
      if (savedSha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
      else process.env.VERCEL_GIT_COMMIT_SHA = savedSha;
      serverRedis.__resetKeyPrefixCacheForTests();
    }
  });
});

describe('isAppOwnedRedisKey (#7674)', () => {
  it('names the route-owned exceptions and leaves the seeder fleet raw', () => {
    assert.equal(isAppOwnedRedisKey('temporal:anomalies:v1'), true);
    assert.equal(isAppOwnedRedisKey('seed-meta:temporal:anomalies'), true);
    assert.equal(isAppOwnedRedisKey('risk:scores:sebuf:v14'), true);
    assert.equal(isAppOwnedRedisKey('risk:scores:sebuf:stale:v14'), true);
    assert.equal(isAppOwnedRedisKey('risk:scores:sebuf:rejected:v14'), true);
    assert.equal(isAppOwnedRedisKey('seed-meta:intelligence:risk-scores'), true);
    assert.equal(isAppOwnedRedisKey('risk:scores:history:IR'), true);
    assert.equal(isAppOwnedRedisKey('risk:scores:history:US'), true);
    assert.equal(isAppOwnedRedisKey('risk:scores:history:index'), true);
    assert.equal(isAppOwnedRedisKey('seed-meta:intelligence:risk-scores-history'), true);
    assert.equal(isAppOwnedRedisKey('seed-activated:intelligence:risk-scores-history'), true);
    assert.equal(isAppOwnedRedisKey('risk:scores:history:IR:extra'), false);
    assert.equal(isAppOwnedRedisKey('risk:scores:history:ir'), false);
    assert.equal(isAppOwnedRedisKey('supply_chain:chokepoints:v4'), true);
    assert.equal(isAppOwnedRedisKey('seed-meta:supply_chain:chokepoints'), true);
    assert.equal(isAppOwnedRedisKey('cable-health-v1'), true);
    assert.equal(isAppOwnedRedisKey('seed-meta:cable-health'), true);
    assert.equal(isAppOwnedRedisKey('seed-meta:market:crypto'), false);
    assert.equal(isAppOwnedRedisKey('temporal:anomalies:v1:lookalike'), false);
    assert.equal(isAppOwnedRedisKey('risk:scores:sebuf:stale:v7'), false);
    assert.equal(isAppOwnedRedisKey(undefined), false);
  });
});

describe('health sweep classifies the temporal producer keys into the preview namespace (#7674)', () => {
  it('temporal data + stamp are prefixed; every seeder key and marker stays raw', async () => {
    const { handleHealth, __testing__ } = await import('../api/health.js');
    process.env.WORLDMONITOR_VALID_KEYS = 'prefix-health-test-key';

    globalThis.fetch = (async (input, init = {}) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith(`${UPSTASH}/get/`)) {
        getPaths.push(decodeURIComponent(url.slice(`${UPSTASH}/get/`.length)));
        return Response.json({ result: null });
      }
      if (url.startsWith(`${UPSTASH}/pipeline`)) {
        const commands = JSON.parse(init.body);
        pipelineBodies.push(commands);
        const results = commands.map(([op, key]) => {
          if (op === 'STRLEN' || op === 'LLEN') return { result: 128 };
          if (op === 'EXISTS') return { result: 0 };
          if (op === 'HEXISTS') return { result: 0 };
          if (op === 'HSETNX' || op === 'HGET' || op === 'HDEL' || op === 'PEXPIRE') return { result: 'OK' };
          if (op === 'GET' && String(key).includes('health:verdict')) return { result: null };
          if (op === 'GET' && String(key).endsWith('health:failure-log-sig')) return { result: '' };
          if (op === 'GET') return { result: JSON.stringify({ fetchedAt: Date.now(), recordCount: 10_000 }) };
          return { result: 'OK' };
        });
        return Response.json(results);
      }
      throw new Error(`unexpected global fetch: ${url}`);
    }) as typeof fetch;

    const response = await handleHealth(
      new Request('https://api.worldmonitor.app/api/health', {
        headers: { 'x-worldmonitor-key': 'prefix-health-test-key' },
      }),
      undefined,
      { now: Date.parse('2026-09-05T00:00:00Z') },
    );
    assert.equal(response.status, 200);

    // The verdict snapshot read happened through the deployment-prefixed key
    // (health.js pre-prefixes its own verdict keys via healthVerdictRedisKey
    // and sends those pipelines verbatim). Asserted exactly, plus a negative
    // guard: a doubled prefix (preview:<sha>:preview:<sha>:…) would still
    // start with the prefix, so the verdict paths must contain exactly one.
    const verdictSnapshotKeys = pipelineBodies
      .flat()
      .flatMap((command) => command[0] === 'EVAL'
        ? command.slice(3, 3 + Number(command[2])).map(String)
        : [String(command[1])])
      .filter((key) => key.includes('health:verdict'));
    assert.ok(
      verdictSnapshotKeys.some((key) => key === `${PREFIX}health:verdict:v2`
        || key === `${PREFIX}health:verdict:compact:v2`),
      'the verdict snapshot must be read from the deployment namespace',
    );
    assert.ok(
      verdictSnapshotKeys.every((key) => key.indexOf(PREFIX) === key.lastIndexOf(PREFIX)),
      'no verdict key may carry the deployment prefix twice',
    );

    const snapshotWriteKeys = pipelineBodies.flat()
      .filter((command) => command[0] === 'EVAL' && command[1] === __testing__.HEALTH_VERDICT_WRITE_SNAPSHOT_SCRIPT)
      .flatMap((command) => command.slice(4, 6));
    assert.deepEqual(snapshotWriteKeys.sort(), [
      `${PREFIX}health:verdict:v2`,
      `${PREFIX}health:verdict:compact:v2`,
    ].sort(), 'both fenced snapshot writes must use this deployment namespace');

    // The sweep is the pipeline that starts with the data-key STRLEN/LLEN
    // commands.
    const sweep = pipelineBodies.find((commands) => commands[0]?.[0] === 'STRLEN');
    assert.ok(sweep, 'the registry sweep must have run');
    const sweepKeys = new Set(sweep.map((command) => command[1]));

    // Route-owned temporal keys: this deployment's own snapshot and stamp.
    assert.ok(sweepKeys.has(`${PREFIX}temporal:anomalies:v1`), 'temporal snapshot must be prefixed');
    assert.ok(sweepKeys.has(`${PREFIX}seed-meta:temporal:anomalies`), 'temporal stamp must be prefixed');
    // The other RPC-written producer keys follow the same rule.
    assert.ok(sweepKeys.has(`${PREFIX}seed-meta:intelligence:risk-scores`), 'risk-scores stamp must be prefixed');
    assert.ok(sweepKeys.has(`${PREFIX}seed-meta:cable-health`), 'cable-health stamp must be prefixed');
    // Seeder-owned fleet keys: raw, or every preview would classify nothing.
    assert.ok(sweepKeys.has('seed-meta:market:crypto'), 'seeder seed-meta must stay raw');
    assert.ok(sweepKeys.has('seed-activated:prediction:markets-country-index'), 'activation markers must stay raw');
    assert.ok(sweepKeys.has('market:stocks-bootstrap:v1'), 'bootstrap data keys must stay raw');
  });
});

describe('seed-health classifies mixed producer keys for preview (#7674)', () => {
  it('prefixes route-owned metadata while seeder probes and activation markers stay raw', async () => {
    const { handleSeedHealth } = await import('../api/seed-health.js');
    process.env.WORLDMONITOR_VALID_KEYS = 'prefix-seed-health-test-key';

    globalThis.fetch = (async (input, init = {}) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith(`${UPSTASH}/pipeline`)) {
        const commands = JSON.parse(init.body);
        pipelineBodies.push(commands);
        return Response.json(commands.map(([op]) => ({ result: op === 'EXISTS' ? 0 : null })));
      }
      throw new Error(`unexpected global fetch: ${url}`);
    }) as typeof fetch;

    await handleSeedHealth(new Request('https://api.worldmonitor.app/api/seed-health', {
      headers: { 'x-worldmonitor-key': 'prefix-seed-health-test-key' },
    }), { now: Date.parse('2026-09-05T00:00:00Z') });

    const batch = pipelineBodies.find((commands) => commands[0]?.[0] === 'GET');
    assert.ok(batch, 'the seed-health batch must have run');
    const requestedKeys = new Set(batch.map((command) => command[1]));

    assert.ok(requestedKeys.has(`${PREFIX}seed-meta:intelligence:risk-scores`),
      'route-owned risk metadata must use the preview namespace');
    assert.ok(requestedKeys.has(`${PREFIX}seed-meta:supply_chain:chokepoints`),
      'route-owned chokepoint metadata must use the preview namespace');
    assert.ok(requestedKeys.has(`${PREFIX}seed-meta:cable-health`),
      'route-owned cable metadata must use the preview namespace');
    assert.ok(requestedKeys.has('resilience:education-attainment:v1'),
      'Railway-owned data probes must stay raw');
    assert.ok(requestedKeys.has('seed-activated:news:feed-health'),
      'Railway-owned activation markers must stay raw');
    assert.ok(!requestedKeys.has('seed-meta:intelligence:risk-scores'),
      'preview must not read production risk metadata');
  });
});

describe('getRiskScores reads the app-owned temporal snapshot prefixed (#7674)', () => {
  it('temporal:anomalies:v1 is namespaced; seeder-owned sources stay raw', async () => {
    const { getRiskScores } = await import(
      '../packages/server/worldmonitor/intelligence/v1/get-risk-scores'
    );

    globalThis.fetch = (async (input, _init = {}) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith(`${UPSTASH}/get/`)) {
        getPaths.push(decodeURIComponent(url.slice(`${UPSTASH}/get/`.length)));
        return Response.json({ result: null });
      }
      if (url.startsWith(UPSTASH)) return Response.json([]);
      throw new Error(`unexpected global fetch: ${url}`);
    }) as typeof fetch;

    await getRiskScores({} as never, {} as never);

    const requested = new Set(getPaths);
    assert.ok(requested.has(`${PREFIX}temporal:anomalies:v1`), 'app-owned snapshot must be prefixed');
    assert.ok(requested.has('news:insights:v1'), 'seeder count sources must stay raw');
    assert.ok(!requested.has('temporal:anomalies:v1'), 'no bare app-owned snapshot read may remain');
  });
});
