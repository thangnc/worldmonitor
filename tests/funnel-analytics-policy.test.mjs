/**
 * Conversion-funnel instrumentation policy (#4931).
 *
 * Source-extraction guards (same pattern as other policy tests): these
 * invariants are cheap to delete silently in a refactor and expensive to
 * notice — each one going missing blinds a segment of the funnel without
 * breaking any runtime behavior.
 *
 *  1. UMAMI_DOMAINS must list www.worldmonitor.app — the apex 301s to www in
 *     production and the Umami tracker's data-domains check is an EXACT
 *     hostname match; dropping www silently disables ALL dashboard analytics
 *     on the canonical host (the pre-#4931 state).
 *  2. The typed event catalog must contain the funnel events.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const { trackApiAction } = await import('../src/services/analytics.ts');

test('UMAMI_DOMAINS covers the canonical www host', () => {
  const src = read('src/services/analytics.ts');
  const m = src.match(/const UMAMI_DOMAINS = '([^']+)'/);
  assert.ok(m, 'UMAMI_DOMAINS constant not found');
  const domains = m[1].split(',');
  assert.ok(domains.includes('www.worldmonitor.app'),
    'www.worldmonitor.app missing from UMAMI_DOMAINS — analytics dead on the canonical host');
  assert.ok(domains.includes('worldmonitor.app'),
    'apex worldmonitor.app missing from UMAMI_DOMAINS');
});

test('funnel events exist in the typed catalog', () => {
  const src = read('src/services/analytics.ts');
  for (const ev of ['checkout-start', 'checkout-success', 'checkout-failed', 'api-action']) {
    assert.ok(src.includes(`'${ev}': true`), `event '${ev}' missing from EVENTS catalog`);
  }
});

test('API outcome telemetry is bounded to successful key lifecycle actions', () => {
  const analytics = read('src/services/analytics.ts');
  assert.ok(analytics.includes("['key-created', 'key-revoked'] as const"),
    'API action vocabulary must stay closed to key lifecycle outcomes');
  assert.ok(analytics.includes("track('api-action', { action })"),
    'API action helper must emit only the normalized action bucket');
});

test('API outcome telemetry emits only the closed key lifecycle buckets at runtime', () => {
  const calls = [];
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      umami: {
        track: (event, data) => calls.push({ event, data }),
      },
    },
  });

  try {
    trackApiAction('key-created');
    trackApiAction('key-revoked');
    // The TypeScript signature protects typed callers; this exercises the
    // runtime boundary where an untyped or stale caller can still arrive.
    trackApiAction('key-exported');

    assert.deepEqual(calls, [
      { event: 'api-action', data: { action: 'key-created' } },
      { event: 'api-action', data: { action: 'key-revoked' } },
    ]);
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      delete globalThis.window;
    }
  }
});

test('checkout-success is durable across the entitlement reload', () => {
  const analytics = read('src/services/analytics.ts');
  assert.ok(analytics.includes('sessionStorage.setItem(CHECKOUT_SUCCESS_PENDING_KEY'),
    'trackCheckoutSuccess no longer writes the durable marker');
  assert.ok(analytics.includes('clearPendingCheckoutSuccessMarker()'),
    'delivery-time marker clear missing from sendUmamiCall');
});

test('checkout-failed status is bucketed to a closed vocabulary', () => {
  const analytics = read('src/services/analytics.ts');
  assert.ok(analytics.includes('CHECKOUT_FAILED_STATUSES.has(rawStatus)'),
    'trackCheckoutFailed no longer normalizes the URL-derived status — unbounded cardinality');
});

test('checkout-start product ids are bucketed (round-4 F2)', () => {
  const analytics = read('src/services/analytics.ts');
  assert.ok(analytics.includes('bucketProductIdForAnalytics(productId)'),
    'dashboard trackCheckoutStart no longer buckets the (resume-path URL-derived) productId');
  assert.ok(analytics.includes("from '@/config/product-ids.generated'") && analytics.includes('DODO_PRODUCT_IDS'),
    'dashboard product allowlist must keep deriving from the generated catalog');
});

test('dashboard replays the checkout-start handoff key (round-5)', () => {
  const analytics = read('src/services/analytics.ts');
  assert.ok(analytics.includes("'wm-pro-funnel-pending'"),
    'dashboard replay no longer reads the /pro handoff key (keys must match across builds)');
});

test('/pro replay marker clears on DELIVERY, not on read (round-6)', () => {
  const analytics = read('src/services/analytics.ts');
  assert.ok(analytics.includes("call.data?.replayed === true"),
    'sendUmamiCall no longer clears the pro-funnel marker on confirmed replay delivery');
  assert.ok(analytics.includes('clearPendingProFunnelMarker()'),
    'delivery-time pro-funnel marker clear is missing');
  assert.ok(analytics.includes('JSON.stringify(sanitized.map'),
    'replay no longer rewrites the marker with sanitized survivors — a pre-delivery reload would retry raw junk or nothing');
});
