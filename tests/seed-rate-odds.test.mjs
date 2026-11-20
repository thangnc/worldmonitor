import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CANONICAL_KEY,
  KALSHI_BASE,
  buildMeetings,
  contentMeta,
  declareRecords,
  fetchRateOdds,
  fetchTargetUpper,
  meetingDistribution,
  validateFn,
} from '../scripts/seed-rate-odds.mjs';

const NOW = Date.UTC(2026, 10, 20, 8);
const rung = (event, strike, last, prev, close = '2026-12-09T18:55:00Z', o = {}) => ({
  event_ticker: event, ticker: `${event}-T${strike.toFixed(2)}`, strike_type: 'greater', floor_strike: strike,
  last_price_dollars: String(last), previous_price_dollars: String(prev), volume_fp: '1000.00', close_time: close, ...o,
});
// Upper bound now 4.00%: the market prices a hold at 4.00% at 70%, a cut to 3.75% at 20%, a hike to 4.25% at 10%.
const DEC = [rung('KXFED-26DEC', 3.5, 0.99, 0.99), rung('KXFED-26DEC', 3.75, 0.8, 0.95), rung('KXFED-26DEC', 4.0, 0.1, 0.1), rung('KXFED-26DEC', 4.25, 0.0, 0.0)];

describe('Fed decision odds distribution (#125)', () => {
  it('turns an "Above X%" ladder into outcome odds, now and a day earlier', () => {
    const buckets = meetingDistribution(DEC);
    assert.deepEqual(buckets.map((b) => [b.upper, b.below ?? false, b.above ?? null, b.p, b.pPrev]), [
      [3.5, true, null, 0.01, 0.01],
      [3.75, false, null, 0.19, 0.04],
      [4, false, null, 0.7, 0.85],
      [4.25, false, null, 0.1, 0.1],
      [null, false, 4.25, 0, 0],
    ]);
    assert.ok(Math.abs(buckets.reduce((s, b) => s + b.p, 0) - 1) < 1e-9);
  });

  it('forces the ladder non-increasing, drops unpriced and non-ladder rungs, and needs three rungs', () => {
    const out = meetingDistribution([rung('E', 4.0, 0.3, 0.3), rung('E', 3.75, 0.9, 0.9), rung('E', 4.25, 0.5, 0.2), rung('E', 4.5, 'x', 0.1), { strike_type: 'between', floor_strike: 4 }]);
    // 4.25 traded above 4.00 (0.5 > 0.3): it is capped at 0.3.
    assert.deepEqual(out.map((b) => b.p), [0.1, 0.6, 0, 0.3]);
    assert.equal(meetingDistribution([rung('E', 4, 0.5, 0.5), rung('E', 4.25, 0.1, 0.1)]), null);
  });

  it('keeps the soonest open meetings in order and skips past or thin ones', () => {
    const markets = [
      ...DEC,
      rung('KXFED-27JAN', 3.75, 0.9, 0.9, '2027-01-27T18:55:00Z'), rung('KXFED-27JAN', 4.0, 0.5, 0.5, '2027-01-27T18:55:00Z'), rung('KXFED-27JAN', 4.25, 0.1, 0.1, '2027-01-27T18:55:00Z'),
      rung('KXFED-26OCT', 3.75, 1, 1, '2026-10-28T18:55:00Z'), rung('KXFED-26OCT', 4.0, 0, 0, '2026-10-28T18:55:00Z'), rung('KXFED-26OCT', 4.25, 0, 0, '2026-10-28T18:55:00Z'),
      rung('KXFED-27MAR', 4.0, 0.5, 0.5, '2027-03-17T17:55:00Z'),
    ];
    const meetings = buildMeetings(markets, NOW);
    assert.deepEqual(meetings.map((m) => m.event), ['KXFED-26DEC', 'KXFED-27JAN']);
    assert.equal(meetings[0].decisionAt, Date.UTC(2026, 11, 9, 18, 55));
    assert.equal(meetings[0].volume, 4000);
  });
});

describe('Fed decision odds fetch (#125)', () => {
  const kalshi = (markets) => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push([url, init?.headers?.['User-Agent']]);
      return { ok: true, status: 200, json: async () => ({ markets, cursor: '' }) };
    };
    return { fetchImpl, calls };
  };

  it('reads the KXFED series with a User-Agent and carries the current target', async () => {
    const { fetchImpl, calls } = kalshi(DEC);
    const data = await fetchRateOdds({ fetchImpl, nowMs: NOW, loadTarget: async () => ({ value: 4, date: '2026-11-19' }), loadPrevious: async () => null });
    const url = new URL(calls[0][0]);
    assert.equal(`${url.origin}${url.pathname}`, `${KALSHI_BASE}/markets`);
    assert.equal(url.searchParams.get('series_ticker'), 'KXFED');
    assert.equal(url.searchParams.get('status'), 'open');
    assert.match(calls[0][1], /WorldMonitor/);
    assert.deepEqual(data.target, { value: 4, date: '2026-11-19' });
    assert.equal(validateFn(data), true);
    assert.equal(declareRecords(data), 1);
    assert.equal(CANONICAL_KEY, 'economic:rate-odds:v1');
    assert.deepEqual(contentMeta(data), { newestItemAt: Date.UTC(2026, 10, 19), oldestItemAt: Date.UTC(2026, 10, 19) });
    assert.equal(contentMeta({ target: null }), null, 'no target at all reads as stale content');
  });

  it('keeps the last known target when FRED fails, and fails when Kalshi gives no usable meeting', async () => {
    const { fetchImpl } = kalshi(DEC);
    const data = await fetchRateOdds({ fetchImpl, nowMs: NOW, loadTarget: async () => null, loadPrevious: async () => ({ target: { value: 4, date: '2026-11-18' } }) });
    assert.deepEqual(data.target, { value: 4, date: '2026-11-18' });
    await assert.rejects(fetchRateOdds({ fetchImpl: kalshi([]).fetchImpl, nowMs: NOW, loadTarget: async () => null, loadPrevious: async () => null }), /no open meeting/);
    assert.equal(validateFn({ fetchedAt: NOW, meetings: [{ decisionAt: NOW, buckets: [{ p: 0.5 }, { p: 0.2 }, { p: 0.1 }] }] }), false, 'odds must sum to 1');
  });

  it('reads the newest DFEDTARU observation, and gives null without a key or on failure', async () => {
    const seen = [];
    const fredFetch = async (url) => { seen.push(url); return { observations: [{ date: '2026-11-19', value: '.' }, { date: '2026-11-18', value: '4.00' }] }; };
    assert.deepEqual(await fetchTargetUpper({ fredFetch, apiKey: 'k' }), { value: 4, date: '2026-11-18' });
    assert.match(seen[0], /series_id=DFEDTARU/);
    assert.equal(await fetchTargetUpper({ fredFetch, apiKey: '' }), null);
    assert.equal(await fetchTargetUpper({ fredFetch: async () => { throw new Error('down'); }, apiKey: 'k' }), null);
  });
});
