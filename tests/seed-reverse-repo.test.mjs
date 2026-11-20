import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CANONICAL_KEY,
  DAYS_KEPT,
  dailyTakeUp,
  newYorkClock,
  declareRecords,
  fetchReverseRepo,
  rrpUrl,
  validateFn,
} from '../scripts/seed-reverse-repo.mjs';

const NOW = Date.UTC(2026, 10, 20, 12);
const op = (operationDate, totalAmtAccepted, o = {}) => ({ operationId: `RP ${operationDate}`, operationDate, operationType: 'Reverse Repo', note: '', totalAmtAccepted, ...o });
// The NY Fed answer, newest first, as live on 2026-11-20 (amounts in US$).
const answer = (ops) => ({ repo: { operations: ops } });
const live = [op('2026-11-19', 405_000_000), op('2026-11-18', 331_000_000), op('2026-11-17', 351_000_000), op('2026-11-16', 182_000_000)];

const router = (body, status = 200) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init?.headers?.['User-Agent']]);
    return { ok: status === 200, status, headers: new Headers(), text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
  return { fetchImpl, calls };
};

describe('Reverse repo take-up (#136)', () => {
  it('sums each date, leaves out Small Value Exercises and operations without an amount', () => {
    assert.deepEqual(dailyTakeUp(answer([
      ...live.slice(0, 2),
      // A test operation next to the real one on the same day.
      op('2026-11-18', 110_000_000, { note: 'This operation is a Small Value Exercise (SVE), the daily ON RRP operation will still take place at its regularly scheduled time (12:45pm)' }),
      // Not yet settled: no amount, not a drain to zero.
      op('2026-11-20', null),
      op('2026-11-17', 351_000_000, { operationType: 'Repo' }),
      op('not a date', 1),
    ]), NOW), [
      { date: '2026-11-19', accepted: 405_000_000, operations: 1 },
      { date: '2026-11-18', accepted: 331_000_000, operations: 1 },
    ]);
    assert.throws(() => dailyTakeUp({ repo: {} }), /without repo\.operations/);
  });

  it('leaves out today\'s operation until its results are due at 13:15 New York time', () => {
    const today = [op('2026-11-20', 0), ...live];
    assert.deepEqual(newYorkClock(Date.UTC(2026, 10, 20, 18, 0)), { date: '2026-11-20', minutes: 13 * 60 });
    // 13:00 New York: a pending operation listed at zero is not a drain.
    assert.equal(dailyTakeUp(answer(today), Date.UTC(2026, 10, 20, 18, 0))[0].date, '2026-11-19');
    // 13:30 New York: the result counts.
    assert.deepEqual(dailyTakeUp(answer(today), Date.UTC(2026, 10, 20, 18, 30))[0], { date: '2026-11-20', accepted: 0, operations: 1 });
  });

  it('reads the last 45 days with a User-Agent and keeps the newest days', async () => {
    const { fetchImpl, calls } = router(answer(live));
    const data = await fetchReverseRepo({ fetchImpl, nowMs: NOW });
    assert.equal(calls[0][0], rrpUrl('2026-10-06', '2026-11-20'));
    assert.equal(calls[0][0], 'https://markets.newyorkfed.org/api/rp/reverserepo/propositions/search.json?startDate=2026-10-06&endDate=2026-11-20');
    assert.match(calls[0][1], /^WorldMonitor /);
    assert.deepEqual(data.days.map((d) => d.date), ['2026-11-19', '2026-11-18', '2026-11-17', '2026-11-16']);
    assert.equal(validateFn(data), true);
    assert.equal(declareRecords(data), 4);
    assert.equal(CANONICAL_KEY, 'economic:reverse-repo:v1');
    const many = Array.from({ length: 40 }, (_, i) => op(new Date(NOW - (i + 1) * 86_400_000).toISOString().slice(0, 10), 1e9));
    assert.equal((await fetchReverseRepo({ fetchImpl: router(answer(many)).fetchImpl, nowMs: NOW })).days.length, DAYS_KEPT);
  });

  it('fails on an HTTP error, a non-JSON answer, fewer than two days, or a latest operation over 5 days old', async () => {
    await assert.rejects(fetchReverseRepo({ fetchImpl: router('', 503).fetchImpl, nowMs: NOW }), /HTTP 503/);
    await assert.rejects(fetchReverseRepo({ fetchImpl: router('<html>').fetchImpl, nowMs: NOW }), /other than JSON/);
    await assert.rejects(fetchReverseRepo({ fetchImpl: router(answer(live.slice(0, 1))).fetchImpl, nowMs: NOW }), /1 operation day/);
    await assert.rejects(fetchReverseRepo({ fetchImpl: router(answer([op('2026-11-10', 1), op('2026-11-09', 1)])).fetchImpl, nowMs: NOW }), /latest operation 2026-11-10, 10 days ago/);
    await assert.rejects(fetchReverseRepo({ fetchImpl: router(answer([op('2026-11-14', 1), op('2026-11-13', 1)])).fetchImpl, nowMs: NOW }), /6 days ago/);
  });
});
