import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  THERMAL_DASHBOARD_CLUSTER_LIMIT,
  compactThermalDashboardPayload,
} from '../scripts/_thermal-dashboard.mjs';
import { __testing__ as healthTesting } from '../api/health.js';
import { BOOTSTRAP_CACHE_KEYS } from '../shared/bootstrap-tier-keys.js';

function makeWatch(clusterCount) {
  return {
    fetchedAt: '2026-07-14T00:00:00.000Z',
    observationWindowHours: 24,
    sourceVersion: 'thermal-escalation-v1',
    clusters: Array.from({ length: clusterCount }, (_, i) => ({ id: `c${i}`, totalFrp: 1000 - i })),
    summary: { clusterCount },
  };
}

test('caps the published cluster array while preserving rank order', () => {
  const compact = compactThermalDashboardPayload(makeWatch(117));

  assert.equal(compact.clusters.length, THERMAL_DASHBOARD_CLUSTER_LIMIT);
  // computeThermalEscalationWatch ranks clusters before publish and the client
  // takes slice(0, maxItems), so the cap must be the ranked PREFIX — otherwise
  // the dashboard would silently render a different top-12 than it does today.
  assert.deepEqual(compact.clusters.map(c => c.id), makeWatch(117).clusters.slice(0, THERMAL_DASHBOARD_CLUSTER_LIMIT).map(c => c.id));
});

test('records the pre-cap total so a capped array is never mistaken for the whole picture', () => {
  const compact = compactThermalDashboardPayload(makeWatch(117));
  assert.equal(compact.totalClusters, 117);
  // summary describes the world, not the page — the hydrated client recomputes
  // its own summary from the slice it renders.
  assert.equal(compact.summary.clusterCount, 117);
});

test('passes through payloads at or under the cap untouched', () => {
  const small = makeWatch(5);
  const compact = compactThermalDashboardPayload(small);
  assert.deepEqual(compact, small);
  assert.equal(compact.totalClusters, undefined, 'no cap applied ⇒ no totalClusters marker');
});

test('tolerates malformed payloads rather than publishing garbage', () => {
  for (const bad of [null, undefined, 'nope', 42, {}, { clusters: 'not-an-array' }]) {
    assert.equal(compactThermalDashboardPayload(bad), bad);
  }
});

test('health monitors the compact key the bootstrap tier actually serves', () => {
  const { STANDALONE_KEYS, SEED_META } = healthTesting;

  // health sweeps BOOTSTRAP_KEYS ∪ STANDALONE_KEYS identically; thermal has
  // always lived in the latter. What matters is that the key the dashboard now
  // hydrates from is monitored on its own, so a transform/write failure can't
  // hide behind a healthy canonical key.
  assert.equal(STANDALONE_KEYS.thermalEscalationBootstrap, 'thermal:escalation-bootstrap:v1');
  assert.equal(SEED_META.thermalEscalationBootstrap.key, 'seed-meta:thermal:escalation-bootstrap');
  // The canonical key stays monitored too: it still feeds the RPC.
  assert.equal(STANDALONE_KEYS.thermalEscalation, 'thermal:escalation:v1');
});

test('a not-yet-published compact key warns, it does not CRIT', () => {
  // Deploy-ordering: the web change lands before the seeder's next tick, so the
  // key is legitimately absent for one cron interval. EMPTY scores as crit and
  // would flip /api/health to DEGRADED on a false alarm — the trap #5263 hit on
  // its second round. Warn instead; seed-meta staleness still catches a writer
  // that actually stops.
  const { classifyKey, STANDALONE_KEYS } = healthTesting;
  const NOW = 1_700_000_000_000;
  const verdict = classifyKey(
    'thermalEscalationBootstrap',
    STANDALONE_KEYS.thermalEscalationBootstrap,
    { allowOnDemand: false },
    {
      keyStrens: new Map([[STANDALONE_KEYS.thermalEscalationBootstrap, 0]]),
      keyErrors: new Map(),
      keyMetaValues: new Map(),
      keyMetaErrors: new Map(),
      now: NOW,
    },
  );
  assert.equal(verdict.status, 'STALE_SEED');
});

test('bootstrap hydrates thermalEscalation from the compact key', () => {
  assert.equal(BOOTSTRAP_CACHE_KEYS.thermalEscalation, 'thermal:escalation-bootstrap:v1');
});
