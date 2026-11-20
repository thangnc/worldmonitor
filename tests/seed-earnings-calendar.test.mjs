import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  EARNINGS_CALENDAR_CAP,
  WATCHLIST_EARNINGS_SYMBOLS,
  boundEarningsCalendar,
  declareRecords,
  fetchEarningsCalendar,
  normalizeEarning,
  validate,
} from '../scripts/seed-earnings-calendar.mjs';

const NOW = Date.UTC(2026, 10, 20, 12);
const row = (symbol, date, o = {}) => ({ symbol, name: symbol, date, hour: 'amc', epsEstimate: 1, epsActual: null, revenueEstimate: 50_000_000, revenueActual: null, ...o });
const day = (offset) => new Date(NOW + offset * 86_400_000).toISOString().slice(0, 10);

const router = (body, status = 200) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init?.headers]);
    return { ok: status === 200, status, headers: new Headers(), text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
  return { fetchImpl, calls };
};

describe('Earnings calendar seeder (#138)', () => {
  it('watches the default stock list\'s US companies, without indices or listings Finnhub does not cover', () => {
    const stocks = JSON.parse(readFileSync(new URL('../packages/shared/stocks.json', import.meta.url), 'utf8'));
    assert.deepEqual([...WATCHLIST_EARNINGS_SYMBOLS], stocks.defaultSymbols.filter((s) => !s.startsWith('^') && !/\.[A-Z]{1,2}$/.test(s)));
    assert.ok(WATCHLIST_EARNINGS_SYMBOLS.includes('COST') && WATCHLIST_EARNINGS_SYMBOLS.includes('BRK-B'));
    assert.ok(!WATCHLIST_EARNINGS_SYMBOLS.includes('0700.HK') && !WATCHLIST_EARNINGS_SYMBOLS.includes('000001.SS'));
  });

  it('keeps every watchlist report past the cap, including the next two weeks', () => {
    // 150 large general reports in the past week would fill the cap and push the window's later dates out.
    const general = Array.from({ length: 150 }, (_, i) => normalizeEarning(row(`G${i}`, day(-6), { revenueEstimate: 9e9 })));
    const watch = [normalizeEarning(row('COST', day(10))), normalizeEarning(row('ORCL', day(13))), normalizeEarning(row('NVDA', day(-3))), normalizeEarning(row('BRK.B', day(12)))];
    const kept = boundEarningsCalendar([...general, ...watch]);
    assert.equal(kept.length, EARNINGS_CALENDAR_CAP);
    // Berkshire's class B shares are "BRK-B" on the list and "BRK.B" at Finnhub: reserved in both forms.
    assert.deepEqual(kept.filter((e) => ['COST', 'ORCL', 'NVDA', 'BRK.B'].includes(e.symbol)).map((e) => e.symbol), ['NVDA', 'COST', 'BRK.B', 'ORCL']);
  });

  it('normalizes Finnhub rows: beat, miss and unknown figures', () => {
    assert.deepEqual(normalizeEarning(row('WMT', '2026-11-19', { hour: 'bmo', epsEstimate: 0.6421, epsActual: 0.65, revenueEstimate: 189143823120 })), {
      symbol: 'WMT', company: 'WMT', date: '2026-11-19', hour: 'bmo', epsEstimate: 0.6421, revenueEstimate: 189143823120,
      epsActual: 0.65, revenueActual: null, hasActuals: true, surpriseDirection: 'beat',
    });
    assert.equal(normalizeEarning(row('HD', '2026-11-17', { epsEstimate: 3.95, epsActual: 3.86 })).surpriseDirection, 'miss');
    assert.equal(normalizeEarning(row('X', '2026-11-30', { epsEstimate: 'n/a' })).epsEstimate, null);
  });

  it('reads Finnhub with its key in a header, a WorldMonitor User-Agent, and keeps a small watchlist company', async () => {
    const rows = [row('AAPL', day(1)), row('MSFT', day(2)), row('TINY', day(3), { revenueEstimate: 1_000_000 }), row('V', day(4), { revenueEstimate: 1_000_000 })];
    const { fetchImpl, calls } = router({ earningsCalendar: rows });
    const data = await fetchEarningsCalendar({ fetchImpl, apiKey: 'test-key', nowMs: NOW });
    assert.equal(calls[0][0], `https://finnhub.io/api/v1/calendar/earnings?from=${day(-7)}&to=${day(14)}`);
    assert.equal(calls[0][1]['X-Finnhub-Token'], 'test-key');
    assert.match(calls[0][1]['User-Agent'], /^WorldMonitor /);
    // A micro-cap is dropped; a watchlist company is always kept.
    assert.deepEqual(data.earnings.map((e) => e.symbol), ['AAPL', 'MSFT', 'V']);
    assert.equal(validate(data), true);
    assert.equal(declareRecords(data), 3);
  });

  it('fails on an HTTP error or a non-JSON answer, and publishes nothing without a key', async () => {
    await assert.rejects(fetchEarningsCalendar({ fetchImpl: router('', 429).fetchImpl, apiKey: 'k', nowMs: NOW }), /HTTP 429/);
    await assert.rejects(fetchEarningsCalendar({ fetchImpl: router('<html>').fetchImpl, apiKey: 'k', nowMs: NOW }), /other than JSON/);
    const none = await fetchEarningsCalendar({ fetchImpl: router({}).fetchImpl, apiKey: '', nowMs: NOW });
    assert.equal(none.unavailable, true);
    assert.equal(validate(none), false, 'an empty answer fails validation, so the last good data stays');
  });
});
