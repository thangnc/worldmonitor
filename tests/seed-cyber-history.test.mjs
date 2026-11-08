// Daily attack-infrastructure counts kept by seed-cyber-threats for the Lite
// "attack infrastructure spike" indicator (spec: lite.md › Baselines).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CYBER_HISTORY_KEY,
  CYBER_HISTORY_TTL_SECONDS,
  HISTORY_DAYS,
  TOP_FAMILIES,
  countThreats,
  isThreatHistory,
  mergeThreatHistory,
} from '../scripts/_cyber-threat-history.mjs';
import { publishThreatHistory } from '../scripts/seed-cyber-threats.mjs';

const NOW = Date.UTC(2026, 10, 8, 12);
const DAY = 86_400_000;

const threat = (source, malwareFamily = '') => ({ source, malwareFamily });

describe('countThreats', () => {
  it('counts every indicator per feed and families only from feeds that name one', () => {
    const counts = countThreats([
      threat('feodo', 'QakBot'),
      threat('feodo', 'qakbot '),
      threat('urlhaus', 'Mozi'),
      threat('c2intel', 'CobaltStrike'),
      threat('otx', 'Pulse: campaign against banks'),
      threat('abuseipdb', ''),
      null,
    ]);
    assert.equal(counts.total, 6);
    assert.deepEqual(counts.bySource, { feodo: 2, urlhaus: 1, c2intel: 1, otx: 1, abuseipdb: 1 });
    assert.deepEqual(counts.byFamily, { qakbot: 2, cobaltstrike: 1, mozi: 1 });
  });

  it(`keeps the top ${TOP_FAMILIES} families`, () => {
    const threats = [];
    for (let i = 0; i < 15; i += 1) for (let n = 0; n <= i; n += 1) threats.push(threat('feodo', `family-${String(i).padStart(2, '0')}`));
    const families = Object.keys(countThreats(threats).byFamily);
    assert.equal(families.length, TOP_FAMILIES);
    assert.equal(families[0], 'family-14');
    assert.ok(!families.includes('family-00'));
  });
});

describe('mergeThreatHistory', () => {
  const counts = (total, extra = {}) => ({ total, bySource: { feodo: total }, byFamily: { qakbot: total }, ...extra });

  it('starts a history from nothing and records the latest run', () => {
    const history = mergeThreatHistory(null, counts(100), NOW);
    assert.ok(isThreatHistory(history));
    assert.deepEqual(history.latest, { at: NOW, total: 100, bySource: { feodo: 100 }, byFamily: { qakbot: 100 } });
    assert.deepEqual(history.days.map((d) => [d.date, d.total]), [['2026-11-08', 100]]);
  });

  it('keeps the larger count of two runs on the same UTC day, per field, but reports the latest run as latest', () => {
    const first = mergeThreatHistory(null, { total: 300, bySource: { feodo: 200, otx: 100 }, byFamily: { qakbot: 50 } }, NOW - 2 * 3_600_000);
    const second = mergeThreatHistory(first, { total: 250, bySource: { feodo: 120, otx: 130 }, byFamily: { qakbot: 40, mozi: 9 } }, NOW);
    assert.deepEqual(second.days, [{ date: '2026-11-08', total: 300, bySource: { feodo: 200, otx: 130 }, byFamily: { qakbot: 50, mozi: 9 } }]);
    assert.equal(second.latest.total, 250);
  });

  it(`keeps ${HISTORY_DAYS} days, oldest first, and drops malformed or future days`, () => {
    const days = [];
    for (let i = 40; i >= 1; i -= 1) days.push({ date: new Date(NOW - i * DAY).toISOString().slice(0, 10), total: i, bySource: {}, byFamily: {} });
    days.push({ date: 'not-a-date', total: 5 }, { date: '2026-11-09', total: 7 }, { date: '2026-11-01', total: -1 });
    const history = mergeThreatHistory({ updatedAt: 1, latest: {}, days }, counts(10), NOW);
    assert.equal(history.days.length, HISTORY_DAYS);
    assert.equal(history.days[0].date, '2026-10-10');
    assert.equal(history.days.at(-1).date, '2026-11-08');
    assert.ok(!history.days.some((d) => d.date === 'not-a-date' || d.date === '2026-11-09'));
    assert.equal(history.days.find((d) => d.date === '2026-11-01').total, 7, 'the malformed 1 Nov duplicate is ignored, the valid one kept');
  });
});

describe('publishThreatHistory', () => {
  const counts = { total: 42, bySource: { c2intel: 42 }, byFamily: { cobaltstrike: 42 } };

  it('merges onto the previous history and publishes it with seed-meta', async () => {
    const writes = [];
    const previous = mergeThreatHistory(null, { total: 10, bySource: {}, byFamily: {} }, NOW - DAY);
    const history = await publishThreatHistory(counts, NOW, { read: async () => previous, write: async (args) => writes.push(args) });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].key, CYBER_HISTORY_KEY);
    assert.equal(writes[0].ttlSeconds, CYBER_HISTORY_TTL_SECONDS);
    assert.equal(writes[0].recordCount, 2);
    assert.equal(writes[0].fetchedAt, NOW);
    assert.deepEqual(history.days.map((d) => d.total), [10, 42]);
  });

  it('does not publish over the stored days when the previous read fails', async () => {
    const writes = [];
    const result = await publishThreatHistory(counts, NOW, {
      read: async () => { throw new Error('Redis snapshot read failed: HTTP 500'); },
      write: async (args) => writes.push(args),
    });
    assert.equal(result, null);
    assert.equal(writes.length, 0);
  });

  it('publishes nothing for a run with no indicators', async () => {
    const writes = [];
    assert.equal(await publishThreatHistory({ total: 0, bySource: {}, byFamily: {} }, NOW, { read: async () => null, write: async (a) => writes.push(a) }), null);
    assert.equal(await publishThreatHistory(null, NOW, { read: async () => null, write: async (a) => writes.push(a) }), null);
    assert.equal(writes.length, 0);
  });
});
