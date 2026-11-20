import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BACKFILL_PER_RUN,
  CANONICAL_KEY,
  FILING_GRACE_MS,
  MIN_COMPANIES,
  TWSE_REVENUE_URL,
  declareRecords,
  fetchChipRevenue,
  filingDue,
  fromApi,
  fromMops,
  mopsMonthUrl,
  nextMonth,
  prevMonth,
  validateFn,
} from '../scripts/seed-chip-revenue.mjs';

const NOW = Date.UTC(2026, 10, 20, 12);

// The TWSE API's row for TSMC, as live on 2026-11-20.
const tsmc = {
  出表日期: '1151117', 資料年月: '11510', 公司代號: '2330', 公司名稱: '台積電', 產業別: '半導體業',
  '營業收入-當月營收': '586890319', '營業收入-上月營收': '511857399', '營業收入-去年當月營收': '367473051',
  '營業收入-上月比較增減(%)': '14.658949962741477', '營業收入-去年同月增減(%)': '59.709757600700904',
  '累計營業收入-當月累計營收': '4485617293', '累計營業收入-去年累計營收': '3130436902', '累計營業收入-前期比較增減(%)': '43.29045540365918', 備註: '',
};
const others = Array.from({ length: MIN_COMPANIES }, (_, i) => ({ ...tsmc, 公司代號: String(3000 + i) }));
// A MOPS monthly table row, as live (the year-on-year cell's tag is spelled <Td>; amounts with commas). ASCII only, so
// it reads the same in cp950.
const mopsPage = (cur, prev, lastYear, mom, yoy) => `<html><body><table>
<tr align=right><td align=center>2303</td><td align=left>UMC</td><td nowrap> 1 </td><td nowrap> 1 </td><td nowrap> 1 </td><td nowrap> 0 </td><Td nowrap> 0 </td><td nowrap> 1 </td><td nowrap> 1 </td><td nowrap> 0 </td><td align=left>-</td></tr>
<tr align=right><td align=center>2330</td><td align=left>TSMC</td><td nowrap>   ${cur}</td><td nowrap>   ${prev}</td><td nowrap>   ${lastYear}</td><td nowrap>   ${mom}</td><Td nowrap>   ${yoy}</Td><td nowrap> 3,898,726,974</td><td nowrap> 2,762,963,851</td><td nowrap> 41.10</td><td align=left>-</td></tr>
</table></body></html>`;
const SEP = mopsPage('511,857,399', '514,805,337', '330,980,920', '-0.57', '54.64');
// A chain of months whose amounts agree: each month's revenue is the next month's "previous month" figure.
const REV = { '2026-10': 586890319, '2026-09': 511857399, '2026-08': 514805337, '2026-07': 500000000, '2026-06': 442700000, '2026-05': 417000000, '2026-04': 400000000 };
const LAST = (m) => (m === '2026-09' ? 330980920 : Math.round(REV[m] / 1.4));
const pct = (a, b) => ((a / b - 1) * 100).toFixed(2);
const fmt = (n) => n.toLocaleString('en-US');
const pageFor = (m, o = {}) => mopsPage(fmt(REV[m]), fmt(REV[prevMonth(m)]), fmt(LAST(m)), o.mom ?? pct(REV[m], REV[prevMonth(m)]), o.yoy ?? pct(REV[m], LAST(m)));
const urlFor = (m) => mopsMonthUrl(Number(m.slice(0, 4)), Number(m.slice(5)));
const PAGES = Object.fromEntries(['2026-09', '2026-08', '2026-07', '2026-06', '2026-05'].map((m) => [urlFor(m), pageFor(m)]));

const router = (table) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init?.headers?.['User-Agent']]);
    const hit = table[url];
    const status = typeof hit === 'number' ? hit : hit == null ? 404 : 200;
    if (hit instanceof Response) return hit;
    const body = typeof hit === 'string' ? hit : JSON.stringify(hit ?? '');
    return { ok: status === 200, status, headers: new Headers(), text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer };
  };
  return { fetchImpl, calls };
};

describe('TSMC monthly revenue parsing (#134)', () => {
  it('reads the API row in the ROC calendar and a MOPS table row', () => {
    assert.deepEqual(fromApi([tsmc]), {
      month: '2026-10', revenue: 586890319, prevMonthRevenue: 511857399, lastYearRevenue: 367473051,
      mom: 14.658949962741477, yoy: 59.709757600700904, ytdYoy: 43.29045540365918, issuedOn: '2026-11-17', source: 'twse',
    });
    assert.equal(fromApi([{ ...tsmc, 公司代號: '2303' }]), null);
    assert.deepEqual(fromMops(SEP, '2026-09'), { month: '2026-09', revenue: 511857399, prevMonthRevenue: 514805337, lastYearRevenue: 330980920, mom: -0.57, yoy: 54.64, ytdYoy: 41.1, issuedOn: '', source: 'mops' });
    assert.equal(fromMops('<table><tr><td>2303</td></tr></table>', '2026-09'), null);
    assert.equal(mopsMonthUrl(2026, 9), 'https://mopsov.twse.com.tw/nas/t21/sii/t21sc03_115_9_0.html');
    assert.deepEqual([prevMonth('2026-01'), prevMonth('2026-10'), nextMonth('2026-12'), nextMonth('2026-09')], ['2025-12', '2026-09', '2027-01', '2026-10']);
    assert.equal(new Date(filingDue('2026-12')).toISOString(), '2027-01-09T16:00:00.000Z');
  });
});

describe('TSMC monthly revenue fetch (#134)', () => {
  it('backfills the month before first, dates months by filing, and keeps the log across runs', async () => {
    const pages = PAGES;
    const { fetchImpl, calls } = router({ [TWSE_REVENUE_URL]: [...others, tsmc], ...pages });
    const first = await fetchChipRevenue({ fetchImpl, nowMs: NOW, loadPrevious: async () => null });
    assert.match(calls[0][1], /WorldMonitor/);
    assert.equal(calls.filter(([u]) => u.startsWith('https://mopsov.')).length, BACKFILL_PER_RUN, 'at most BACKFILL_PER_RUN pages a run');
    assert.deepEqual(first.months.map((m) => [m.month, m.source]), [['2026-10', 'twse'], ['2026-09', 'mops'], ['2026-08', 'mops'], ['2026-07', 'mops'], ['2026-06', 'mops']]);
    // The first run dates the latest month by its filing deadline, not by the run.
    assert.equal(first.months[0].seenAt, filingDue('2026-10'));
    assert.equal(first.months[1].yoy, 54.65);
    assert.equal(validateFn(first), true);
    assert.equal(declareRecords(first), 5);
    assert.equal(CANONICAL_KEY, 'tech:chip-revenue:v1');
    // The next run reads the next missing month only. A month new to the log is dated by when it could first have been
    // read: a run soon after filing gets its own time, a run after an outage gets the due date, not the late read.
    const nov = { ...tsmc, 資料年月: '11511', '營業收入-當月營收': '600000000', '營業收入-上月營收': '586890319', '營業收入-去年當月營收': '400000000', '營業收入-上月比較增減(%)': pct(600000000, 586890319), '營業收入-去年同月增減(%)': '50' };
    const next = router({ [TWSE_REVENUE_URL]: [...others, nov], ...pages });
    const late = NOW + 20 * 86_400_000; // Dec 10, a day after November's due date
    const second = await fetchChipRevenue({ fetchImpl: next.fetchImpl, nowMs: late, loadPrevious: async () => first });
    assert.deepEqual([second.months[0].month, second.months[0].seenAt, second.months[1].seenAt], ['2026-11', filingDue('2026-11'), first.months[0].seenAt]);
    const early = filingDue('2026-11') - 3 * 86_400_000; // filed before the due date, read by the next run
    const prompt = await fetchChipRevenue({ fetchImpl: next.fetchImpl, nowMs: early, loadPrevious: async () => ({ ...first, fetchedAt: early - 6 * 3_600_000 }) });
    assert.equal(prompt.months[0].seenAt, early);
  });

  it('fails on an HTTP error, a short list, a list without TSMC or a failed log read; a MOPS page failing is only a warning', async () => {
    await assert.rejects(fetchChipRevenue({ fetchImpl: router({ [TWSE_REVENUE_URL]: 503 }).fetchImpl, nowMs: NOW, loadPrevious: async () => null }), /HTTP 503/);
    await assert.rejects(fetchChipRevenue({ fetchImpl: router({ [TWSE_REVENUE_URL]: [tsmc] }).fetchImpl, nowMs: NOW, loadPrevious: async () => null }), /expected at least/);
    await assert.rejects(fetchChipRevenue({ fetchImpl: router({ [TWSE_REVENUE_URL]: others }).fetchImpl, nowMs: NOW, loadPrevious: async () => null }), (e) => /no usable row for 2330/.test(e.message) && e.nonRetryable === true);
    await assert.rejects(fetchChipRevenue({ fetchImpl: router({ [TWSE_REVENUE_URL]: [...others, tsmc] }).fetchImpl, nowMs: NOW, loadPrevious: async () => { throw new Error('canonical read failed'); } }), /canonical read failed/);
    // The API's growth figures must match its amounts.
    await assert.rejects(fetchChipRevenue({ fetchImpl: router({ [TWSE_REVENUE_URL]: [...others, { ...tsmc, '營業收入-去年同月增減(%)': '41.0' }] }).fetchImpl, nowMs: NOW, loadPrevious: async () => null }), (e) => /do not match/.test(e.message) && e.nonRetryable === true);
    const noMops = await fetchChipRevenue({ fetchImpl: router({ [TWSE_REVENUE_URL]: [...others, tsmc] }).fetchImpl, nowMs: NOW, loadPrevious: async () => null });
    assert.deepEqual(noMops.months.map((m) => m.month), ['2026-10']);
  });
});

describe('TSMC monthly revenue guards (#134)', () => {
  it('does not store a MOPS row whose growth disagrees with its amounts or with the month after', async () => {
    // September's y/y is off (a moved column): not stored. With no September stored, August is checked on its own figures.
    const bad = { ...PAGES, [urlFor('2026-09')]: pageFor('2026-09', { yoy: '40.00' }) };
    const run = await fetchChipRevenue({ fetchImpl: router({ [TWSE_REVENUE_URL]: [...others, tsmc], ...bad }).fetchImpl, nowMs: NOW, loadPrevious: async () => null });
    assert.deepEqual(run.months.map((m) => m.month), ['2026-10', '2026-08', '2026-07', '2026-06']);
    // Another month's table served at September's address: its revenue is not October's "previous month".
    const wrongMonth = { ...PAGES, [urlFor('2026-09')]: pageFor('2026-07') };
    const run2 = await fetchChipRevenue({ fetchImpl: router({ [TWSE_REVENUE_URL]: [...others, tsmc], ...wrongMonth }).fetchImpl, nowMs: NOW, loadPrevious: async () => null });
    assert.equal(run2.months.some((m) => m.month === '2026-09'), false);
  });

  it('keeps the log while the table has moved to a new month that TSMC has not filed yet, until its due date has passed', async () => {
    const first = await fetchChipRevenue({ fetchImpl: router({ [TWSE_REVENUE_URL]: [...others, tsmc], ...PAGES }).fetchImpl, nowMs: NOW, loadPrevious: async () => null });
    const novTable = others.map((r) => ({ ...r, 資料年月: '11511' }));
    const fetchImpl = router({ [TWSE_REVENUE_URL]: novTable, ...PAGES }).fetchImpl;
    const dec3 = Date.UTC(2026, 11, 3);
    const kept = await fetchChipRevenue({ fetchImpl, nowMs: dec3, loadPrevious: async () => first });
    assert.deepEqual([kept.fetchedAt, kept.months.map((m) => m.month)], [dec3, first.months.map((m) => m.month)]);
    await assert.rejects(fetchChipRevenue({ fetchImpl, nowMs: filingDue('2026-11') + FILING_GRACE_MS + 1, loadPrevious: async () => first }), /no usable row for 2330/);
    // With no log there is nothing to keep.
    await assert.rejects(fetchChipRevenue({ fetchImpl, nowMs: dec3, loadPrevious: async () => null }), /no usable row for 2330/);
  });

  it('refuses a MOPS page past the size cap even without a Content-Length', async () => {
    const huge = new Response(new ReadableStream({ start(c) { for (let i = 0; i < 5; i++) c.enqueue(new Uint8Array(1024 * 1024)); c.close(); } }), { status: 200 });
    assert.equal(huge.headers.get('content-length'), null);
    const run = await fetchChipRevenue({ fetchImpl: router({ [TWSE_REVENUE_URL]: [...others, tsmc], [urlFor('2026-09')]: huge }).fetchImpl, nowMs: NOW, loadPrevious: async () => null });
    assert.deepEqual(run.months.map((m) => m.month), ['2026-10']);
  });
});
