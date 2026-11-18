/**
 * Regression tests for Tech Readiness Index "No data available" bug.
 *
 * Root cause: a single shared `wbBreaker` was used for all 4 World Bank
 * indicator RPC calls, so cache poisoning and cascading failures in one
 * indicator silenced all 4. The fix gave each indicator its own breaker.
 *
 * These cases pin the CircuitBreaker property that fix relies on: breakers
 * with different names are independent in failure state and cache.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

describe('CircuitBreaker isolation — independent per-indicator instances', () => {
  const CIRCUIT_BREAKER_URL = pathToFileURL(
    resolve(root, 'packages/client/utils/circuit-breaker.ts'),
  ).href;

  it('two breakers with different names are independent (failure in one does not trip the other)', async () => {
    const { createCircuitBreaker, clearAllCircuitBreakers } = await import(
      `${CIRCUIT_BREAKER_URL}?t=${Date.now()}`
    );

    clearAllCircuitBreakers();

    const breakerA = createCircuitBreaker({ name: 'WB:IT.NET.USER.ZS', cacheTtlMs: 30 * 60 * 1000 });
    const breakerB = createCircuitBreaker({ name: 'WB:IT.CEL.SETS.P2', cacheTtlMs: 30 * 60 * 1000 });

    const fallback = { data: [], pagination: undefined };
    let callCount = 0;

    // Force breakerA into cooldown (2 failures = maxFailures)
    const alwaysFail = () => { callCount++; throw new Error('World Bank unavailable'); };
    await breakerA.execute(alwaysFail, fallback); // failure 1
    await breakerA.execute(alwaysFail, fallback); // failure 2 → cooldown
    assert.equal(breakerA.isOnCooldown(), true, 'breakerA should be on cooldown after 2 failures');

    // breakerB must NOT be affected
    assert.equal(breakerB.isOnCooldown(), false, 'breakerB must not be on cooldown when breakerA fails');

    // breakerB should still call through successfully
    const goodData = { data: [{ countryCode: 'USA', countryName: 'United States', indicatorCode: 'IT.CEL.SETS.P2', indicatorName: 'Mobile', year: 2023, value: 120 }], pagination: undefined };
    const result = await breakerB.execute(async () => goodData, fallback);
    assert.deepEqual(result, goodData, 'breakerB should return live data unaffected by breakerA cooldown');

    clearAllCircuitBreakers();
  });

  it('two breakers with different names cache independently (no cross-indicator cache poisoning)', async () => {
    const { createCircuitBreaker, clearAllCircuitBreakers } = await import(
      `${CIRCUIT_BREAKER_URL}?t=${Date.now()}`
    );

    clearAllCircuitBreakers();

    const breakerA = createCircuitBreaker({ name: 'WB:IT.NET.USER.ZS', cacheTtlMs: 30 * 60 * 1000 });
    const breakerB = createCircuitBreaker({ name: 'WB:IT.CEL.SETS.P2', cacheTtlMs: 30 * 60 * 1000 });

    const fallback = { data: [], pagination: undefined };
    const internetData = { data: [{ countryCode: 'USA', indicatorCode: 'IT.NET.USER.ZS', year: 2023, value: 90 }], pagination: undefined };
    const mobileData = { data: [{ countryCode: 'USA', indicatorCode: 'IT.CEL.SETS.P2', year: 2023, value: 120 }], pagination: undefined };

    // Populate both caches with different data
    await breakerA.execute(async () => internetData, fallback);
    await breakerB.execute(async () => mobileData, fallback);

    // Each must return its own cached value, not the other's
    const cachedA = await breakerA.execute(async () => fallback, fallback);
    const cachedB = await breakerB.execute(async () => fallback, fallback);

    assert.equal(cachedA.data[0]?.indicatorCode, 'IT.NET.USER.ZS',
      'breakerA cache must return internet data, not mobile data');
    assert.equal(cachedB.data[0]?.indicatorCode, 'IT.CEL.SETS.P2',
      'breakerB cache must return mobile data, not internet data');
    assert.notEqual(cachedA.data[0]?.value, cachedB.data[0]?.value,
      'Cached values must be independent per indicator');

    clearAllCircuitBreakers();
  });

  it('empty server response does not poison the cache for other indicators', async () => {
    const { createCircuitBreaker, clearAllCircuitBreakers } = await import(
      `${CIRCUIT_BREAKER_URL}?t=${Date.now()}`
    );

    clearAllCircuitBreakers();

    const breakerA = createCircuitBreaker({ name: 'WB:IT.NET.USER.ZS', cacheTtlMs: 30 * 60 * 1000 });
    const breakerB = createCircuitBreaker({ name: 'WB:IT.CEL.SETS.P2', cacheTtlMs: 30 * 60 * 1000 });

    const fallback = { data: [], pagination: undefined };
    const emptyResponse = { data: [], pagination: undefined }; // what server returns on WB API hiccup
    const goodData = { data: [{ countryCode: 'DEU', indicatorCode: 'IT.CEL.SETS.P2', year: 2023, value: 130 }], pagination: undefined };

    // breakerA caches empty data (the bug scenario: server had a hiccup)
    await breakerA.execute(async () => emptyResponse, fallback);
    const cachedA = breakerA.getCached();
    assert.deepEqual(cachedA?.data, [], 'breakerA caches empty array from server hiccup');

    // breakerB must not be affected — should fetch fresh data
    const resultB = await breakerB.execute(async () => goodData, fallback);
    assert.equal(resultB.data.length, 1, 'breakerB returns real data unaffected by breakerA empty cache');
    assert.equal(resultB.data[0]?.indicatorCode, 'IT.CEL.SETS.P2');

    clearAllCircuitBreakers();
  });
});
