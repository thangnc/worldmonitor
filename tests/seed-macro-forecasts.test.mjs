import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CANONICAL_KEY,
  KALSHI_BASE,
  MIN_EVENT_VOLUME,
  buildForecasts,
  declareRecords,
  fetchMacroForecasts,
  impliedMedian,
  mergeForecasts,
  rungPrice,
  validateFn,
} from '../scripts/seed-macro-forecasts.mjs';

const NOW = Date.UTC(2026, 10, 20, 8);
const DAY = 86_400_000;
const CLOSE = '2026-12-10T13:29:00Z';
const rung = (event, strike, bid, ask, o = {}) => ({
  event_ticker: event, ticker: `${event}-T${strike}`, strike_type: 'greater', floor_strike: strike,
  yes_bid_dollars: String(bid), yes_ask_dollars: String(ask), last_price_dollars: String(bid), volume_fp: '2000.00', close_time: CLOSE, ...o,
});
// November CPI: P(above −0.2) 0.82, P(above −0.1) 0.41: the median sits between, then half a 0.1 step up.
const CPI = [rung('KXCPI-26NOV', -0.3, 0.95, 0.96), rung('KXCPI-26NOV', -0.2, 0.82, 0.83), rung('KXCPI-26NOV', -0.1, 0.4, 0.41), rung('KXCPI-26NOV', 0, 0.13, 0.14)];
const JOBS = [rung('KXPAYROLLS-26NOV', 50000, 0.76, 0.79, { close_time: '2026-12-04T13:29:00Z' }), rung('KXPAYROLLS-26NOV', 80000, 0.59, 0.6, { close_time: '2026-12-04T13:29:00Z' }),
  rung('KXPAYROLLS-26NOV', 90000, 0.5, 0.51, { close_time: '2026-12-04T13:29:00Z' }), rung('KXPAYROLLS-26NOV', 100000, 0.39, 0.43, { close_time: '2026-12-04T13:29:00Z' })];

describe('Kalshi implied median (#128)', () => {
  it('prices a rung at the bid-ask midpoint, or the last trade when the spread is wide or empty', () => {
    assert.ok(Math.abs(rungPrice({ yes_bid_dollars: '0.40', yes_ask_dollars: '0.42' }) - 0.41) < 1e-12);
    assert.equal(rungPrice({ yes_bid_dollars: '0.10', yes_ask_dollars: '0.60', last_price_dollars: '0.3', volume_fp: '5' }), 0.3);
    assert.equal(rungPrice({ yes_bid_dollars: '0.10', yes_ask_dollars: '0.60', last_price_dollars: '0.3', volume_fp: '0' }), null, 'a last price nobody traded is no price');
  });

  it('interpolates across 50% and reads each strike half a print step higher', () => {
    const median = impliedMedian(CPI, 0.1);
    // −0.2 + (0.825 − 0.5) / (0.825 − 0.405) × 0.1 + 0.05
    assert.ok(Math.abs(median - (-0.2 + (0.325 / 0.42) * 0.1 + 0.05)) < 1e-9, String(median));
    assert.equal(impliedMedian(CPI.slice(0, 3), 0.1), null, 'fewer than four priced rungs');
    assert.equal(impliedMedian(CPI.map((m) => ({ ...m, yes_bid_dollars: '0.9', yes_ask_dollars: '0.92' })), 0.1), null, 'the median lies above the ladder');
    // A rung priced above a lower one is capped to it, so the ladder never rises.
    const outOfOrder = [...CPI.slice(0, 2), rung('KXCPI-26NOV', -0.1, 0.9, 0.9), CPI[3]];
    assert.ok(Math.abs(impliedMedian(outOfOrder, 0) - (-0.1 + (0.325 / 0.69) * 0.1)) < 1e-9);
  });

  it('keeps open, liquid releases in the calendar\'s unit, and skips thin or closed ones', () => {
    const thin = [rung('KXPAYROLLS-26DEC', 0, 0.8, 0.85), rung('KXPAYROLLS-26DEC', 50000, 0.6, 0.65), rung('KXPAYROLLS-26DEC', 100000, 0.4, 0.45), rung('KXPAYROLLS-26DEC', 150000, 0.2, 0.25)]
      .map((m) => ({ ...m, volume_fp: '10', close_time: '2027-01-08T13:29:00Z' }));
    const closed = CPI.map((m) => ({ ...m, event_ticker: 'KXCPI-26OCT', close_time: '2026-11-10T13:29:00Z' }));
    const out = buildForecasts([...CPI, ...JOBS, ...thin, ...closed], NOW);
    assert.deepEqual(out.map((f) => [f.event, f.release]), [['KXCPI-26NOV', 'CPI'], ['KXPAYROLLS-26NOV', 'Nonfarm Payrolls']]);
    assert.equal(out[0].releaseAt, Date.parse(CLOSE) + 60_000);
    assert.ok(Math.abs(out[1].median - 91.026) < 0.001, `payrolls in thousands: ${out[1].median}`);
    assert.ok(4 * 10 < MIN_EVENT_VOLUME);
  });
});

describe('Kalshi macro forecasts fetch (#128)', () => {
  const kalshi = (bySeries) => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push([url, init?.headers?.['User-Agent']]);
      const series = new URL(url).searchParams.get('series_ticker');
      return { ok: true, status: 200, json: async () => ({ markets: bySeries[series] ?? [], cursor: '' }) };
    };
    return { fetchImpl, calls };
  };

  it('reads KXCPI and KXPAYROLLS with a User-Agent and keeps a closed release\'s last snapshot', async () => {
    const { fetchImpl, calls } = kalshi({ KXCPI: CPI, KXPAYROLLS: JOBS });
    const previous = { forecasts: [{ series: 'KXCPI', release: 'CPI', event: 'KXCPI-26OCT', releaseAt: Date.UTC(2026, 10, 10, 13, 30), median: 0.26, volume: 589615, at: Date.UTC(2026, 10, 10, 12), url: '' }] };
    const data = await fetchMacroForecasts({ fetchImpl, nowMs: NOW, loadPrevious: async () => previous });
    assert.deepEqual(calls.map(([url]) => new URL(url).searchParams.get('series_ticker')), ['KXCPI', 'KXPAYROLLS']);
    assert.ok(calls.every(([url, ua]) => url.startsWith(`${KALSHI_BASE}/markets`) && /WorldMonitor/.test(ua)));
    assert.deepEqual(data.forecasts.map((f) => f.event), ['KXCPI-26OCT', 'KXPAYROLLS-26NOV', 'KXCPI-26NOV']);
    assert.equal(validateFn(data), true);
    assert.equal(declareRecords(data), 3);
    assert.equal(CANONICAL_KEY, 'economic:macro-forecasts:v1');
    assert.deepEqual(mergeForecasts([], [{ ...previous.forecasts[0], releaseAt: NOW - 46 * DAY }], NOW), [], 'a release older than 45 days leaves the log');
  });

  it('fails on a failed previous read, and on an empty log, so the last good payload stays', async () => {
    await assert.rejects(fetchMacroForecasts({ fetchImpl: kalshi({ KXCPI: CPI }).fetchImpl, nowMs: NOW, loadPrevious: async () => { throw new Error('Redis GET failed: HTTP 503'); } }), /HTTP 503/);
    // Kalshi answers a withdrawn series with an empty list: the run fails, so health turns stale.
    await assert.rejects(fetchMacroForecasts({ fetchImpl: kalshi({ KXCPI: CPI }).fetchImpl, nowMs: NOW, loadPrevious: async () => null }), (e) => /no open markets for KXPAYROLLS/.test(e.message) && e.nonRetryable === true);
    const thinOnly = (list) => list.map((m) => ({ ...m, volume_fp: '1' }));
    const empty = await fetchMacroForecasts({ fetchImpl: kalshi({ KXCPI: thinOnly(CPI), KXPAYROLLS: thinOnly(JOBS) }).fetchImpl, nowMs: NOW, loadPrevious: async () => null });
    assert.equal(validateFn(empty), false, 'listed but too thin everywhere: an empty log never publishes');
  });
});
