import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CANONICAL_KEY,
  COINS_KEPT,
  MIN_ASSETS,
  STABLECOINS_URL,
  declareRecords,
  fetchStablecoinSupply,
  supplyFrom,
  validateFn,
} from '../scripts/seed-stablecoin-supply.mjs';

const NOW = Date.UTC(2026, 10, 20, 12);
const bn = (n) => n * 1e9;
const asset = (id, symbol, cur, week, month = week, o = {}) => ({
  id: String(id), name: symbol, symbol, pegType: 'peggedUSD',
  circulating: { peggedUSD: cur }, circulatingPrevDay: { peggedUSD: cur }, circulatingPrevWeek: week === null ? {} : { peggedUSD: week }, circulatingPrevMonth: month === null ? {} : { peggedUSD: month },
  ...o,
});
// As live on 2026-11-20 (rounded), plus filler coins to pass the size check.
const live = [
  asset(1, 'USDT', bn(174.82), bn(175.52)),
  asset(2, 'USDC', bn(68.69), bn(69.46)),
  asset(146, 'USDe', bn(4.88), bn(4.9)),
  asset(5, 'DAI', bn(4.6), bn(4.66)),
  asset(209, 'USDS', bn(3.15), bn(5.39)),
  ...Array.from({ length: MIN_ASSETS }, (_, i) => asset(1000 + i, `S${i}`, bn(0.1), bn(0.1))),
];

const router = (body, status = 200) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init?.headers?.['User-Agent']]);
    return { ok: status === 200, status, headers: new Headers(), text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
  return { fetchImpl, calls };
};

describe('Stablecoin supply (#137)', () => {
  it('sums US$ coins like for like, leaving out other pegs and coins without a figure a week ago from the 7-day change', () => {
    const { total, top } = supplyFrom({ peggedAssets: [
      asset(1, 'USDT', bn(100), bn(98)),
      asset(2, 'USDC', bn(50), bn(50)),
      // Started tracking this week: in the total, not in the change.
      asset(3, 'NEW', bn(10), null, null),
      asset(4, 'EURC', bn(5), bn(1), bn(1), { pegType: 'peggedEUR', circulating: { peggedEUR: bn(5) } }),
      asset(5, 'ZERO', 0, 0),
    ] });
    assert.deepEqual(total, { current: bn(160), coins: 3, weekNow: bn(150), weekAgo: bn(148), monthNow: bn(150), monthAgo: bn(148), newThisWeek: 1 });
    assert.deepEqual(top.map((c) => c.symbol), ['USDT', 'USDC', 'NEW']);
    assert.throws(() => supplyFrom({}), /without peggedAssets/);
    // A large coin without today's figure is a broken answer, not a coin that vanished.
    assert.throws(() => supplyFrom({ peggedAssets: [asset(1, 'USDT', bn(100), bn(98)), { ...asset(2, 'USDC', 0, bn(69)), circulating: {} }] }), /USDC has no current supply/);
    assert.equal(supplyFrom({ peggedAssets: [asset(1, 'USDT', bn(100), bn(98)), asset(9, 'TINY', 0, bn(0.2))] }).top.length, 1, 'a small coin redeemed to zero is dropped');
  });

  it('reads DefiLlama with a User-Agent and keeps the largest coins', async () => {
    const { fetchImpl, calls } = router({ peggedAssets: live });
    const data = await fetchStablecoinSupply({ fetchImpl, nowMs: NOW });
    assert.equal(calls[0][0], STABLECOINS_URL);
    assert.match(calls[0][1], /^WorldMonitor /);
    // Ranked by supply now or a week ago: USDS ($5.39bn a week ago) stays above USDe and DAI while it shrinks.
    assert.deepEqual(data.top.slice(0, 5).map((c) => c.symbol), ['USDT', 'USDC', 'USDS', 'USDe', 'DAI']);
    assert.equal(data.top.length, COINS_KEPT);
    assert.equal(validateFn(data), true);
    assert.equal(declareRecords(data), COINS_KEPT);
    assert.equal(CANONICAL_KEY, 'market:stablecoin-supply:v1');
  });

  it('fails on an HTTP error, a non-JSON answer, too few coins or a total too small to be real', async () => {
    await assert.rejects(fetchStablecoinSupply({ fetchImpl: router('', 502).fetchImpl, nowMs: NOW }), /HTTP 502/);
    await assert.rejects(fetchStablecoinSupply({ fetchImpl: router('<html>').fetchImpl, nowMs: NOW }), /other than JSON/);
    await assert.rejects(fetchStablecoinSupply({ fetchImpl: router({ peggedAssets: live.slice(0, 5) }).fetchImpl, nowMs: NOW }), /5 stablecoins, expected at least/);
    const tiny = live.map((a) => ({ ...a, circulating: { peggedUSD: 1 } }));
    await assert.rejects(fetchStablecoinSupply({ fetchImpl: router({ peggedAssets: tiny }).fetchImpl, nowMs: NOW }), /expected at least \$50bn/);
  });
});
