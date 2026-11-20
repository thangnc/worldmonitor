#!/usr/bin/env node
// @ts-check
//
// TSMC's monthly revenue for the Lite "TSMC monthly revenue" indicator (#134;
// spec docs/engineering/architecture/lite.md, Early indicators › Catalogue):
// chip demand a month ahead of earnings.
//
// Sources (no key; official company filings, published by the exchange):
// - The Taiwan Stock Exchange open data API, `t187ap05_L`: every listed
//   company's latest monthly revenue, with the month before and the same
//   month a year earlier (amounts in thousand NT$; dates in the ROC calendar,
//   year + 1911).
// - The same filings' monthly tables on mopsov.twse.com.tw (static HTML, cp950),
//   read only for months the stored log lacks: the trigger compares this
//   month's year-on-year growth with last month's, which the API does not carry.
//
// The log (`months`, newest first, MONTHS_KEPT) is merged run to run from the
// previous canonical value; a month is added once and never re-read, so a
// MOPS row (read by column position) is stored only when its growth figures
// match its amounts and its revenue matches the following month's "previous
// month" figure. Each month carries `seenAt`: when it could first have been
// read from the API (the later of the previous run and its due date; the
// card's time), or, on the first run and for backfilled months, the 10th of
// the next month, the filing deadline TSMC reports by. The API's own date is
// when the exchange generated the table, not when TSMC filed.

import { loadEnvFile, readCanonicalValue, runSeed } from './_seed-utils.mjs';
import { readBoundedFeedText } from './seed-security-advisories.mjs';
import { getOptionalUpstashCreds, upstashCommand } from './_upstash-rest.mjs';
import { isMainModule } from './lib/main-module.mjs';

export const CANONICAL_KEY = 'tech:chip-revenue:v1';
export const ACTIVATION_KEY = 'seed-activated:tech:chip-revenue';
export const TWSE_REVENUE_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap05_L';
export const mopsMonthUrl = (year, month) => `https://mopsov.twse.com.tw/nas/t21/sii/t21sc03_${year - 1911}_${month}_0.html`;
export const COMPANY = Object.freeze({ code: '2330', name: 'TSMC' });
/** The API lists about 1,090 companies; far fewer means a broken answer. */
export const MIN_COMPANIES = 500;
export const MONTHS_KEPT = 13;
/** Months backfilled from MOPS per run, newest first: the month before (all the trigger needs) comes first, and the log fills over a few runs. */
export const BACKFILL_PER_RUN = 4;
export const CHIP_REVENUE_TTL_SECONDS = 7 * 24 * 3600;
export const CHIP_REVENUE_MAX_STALE_MIN = 1080; // a 6 h cadence
/** How far a stated growth percentage may sit from the one its amounts give: MOPS rounds to two decimals. */
export const PCT_TOLERANCE = 0.05;
/** After the exchange's table moves to a new month, how long past TSMC's due date the run keeps the log while TSMC's row is missing. */
export const FILING_GRACE_MS = 2 * 24 * 3600 * 1000;
const MAX_API_BYTES = 8 * 1024 * 1024;
const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const USER_AGENT = 'WorldMonitor chip-revenue seeder (+https://worldmonitor.app)';

const num = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, '').trim());
  return String(v ?? '').trim() !== '' && Number.isFinite(n) ? n : null;
};
const ym = (year, month) => `${year}-${String(month).padStart(2, '0')}`;
/** The 10th of the month after "2026-10", 00:00 Taipei (UTC+8): when that month's revenue is due. */
export function filingDue(month) {
  const [y, m] = month.split('-').map(Number);
  return Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 10) - 8 * 3600 * 1000;
}
/** The month before "2026-10": "2026-09". */
export function prevMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? ym(y - 1, 12) : ym(y, m - 1);
}
/** The month after "2026-10": "2026-11". */
export function nextMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? ym(y + 1, 1) : ym(y, m + 1);
}

/** True when a stated growth percentage matches the amounts it is computed from; a missing figure passes. */
export function agrees(pct, value, base) {
  if (pct == null || value == null || base == null) return true;
  return base > 0 && Math.abs((value / base - 1) * 100 - pct) <= PCT_TOLERANCE;
}

/**
 * A row read by column position is trusted only when its growth figures match
 * its own amounts and, when the month after is known, its revenue equals that
 * month's "previous month" figure: a moved column or another month's table fails.
 */
export function consistent(row, laterPrevRevenue = null) {
  return agrees(row.yoy, row.revenue, row.lastYearRevenue) && agrees(row.mom, row.revenue, row.prevMonthRevenue)
    && (laterPrevRevenue == null || row.revenue === laterPrevRevenue);
}

/** The newest 資料年月 in the API answer, as "2026-10", or null. */
function listMonth(list) {
  let best = null;
  for (const r of list) {
    const p = /^(\d{3})(\d{2})$/.exec(String(r?.['資料年月'] ?? '').trim());
    const m = p ? ym(Number(p[1]) + 1911, Number(p[2])) : null;
    if (m && (!best || m > best)) best = m;
  }
  return best;
}

/** TSMC's row in the API answer, in the stored shape, or null. "11510" is ROC 115, month 10: 2026-10. */
export function fromApi(list) {
  const row = Array.isArray(list) ? list.find((r) => String(r?.['公司代號'] ?? '').trim() === COMPANY.code) : null;
  if (!row) return null;
  const period = /^(\d{3})(\d{2})$/.exec(String(row['資料年月'] ?? '').trim());
  const issued = /^(\d{3})(\d{2})(\d{2})$/.exec(String(row['出表日期'] ?? '').trim());
  const revenue = num(row['營業收入-當月營收']);
  const lastYear = num(row['營業收入-去年當月營收']);
  if (!period || revenue === null || lastYear === null) return null;
  return {
    month: ym(Number(period[1]) + 1911, Number(period[2])),
    revenue, // thousand NT$
    prevMonthRevenue: num(row['營業收入-上月營收']),
    lastYearRevenue: lastYear,
    mom: num(row['營業收入-上月比較增減(%)']),
    yoy: num(row['營業收入-去年同月增減(%)']),
    ytdYoy: num(row['累計營業收入-前期比較增減(%)']),
    issuedOn: issued ? `${Number(issued[1]) + 1911}-${issued[2]}-${issued[3]}` : '',
    source: 'twse',
  };
}

/** TSMC's row in a MOPS monthly table (tags in either case), or null. */
export function fromMops(html, month) {
  const rows = [...String(html ?? '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  const row = rows.find((r) => new RegExp(`>\\s*${COMPANY.code}\\s*<`).test(r));
  if (!row) return null;
  const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1].replace(/<[^>]+>|&nbsp;/g, '').trim());
  const k = cells.indexOf(COMPANY.code);
  const revenue = num(cells[k + 2]);
  const lastYear = num(cells[k + 4]);
  if (k < 0 || revenue === null || lastYear === null) return null;
  return {
    month, revenue, prevMonthRevenue: num(cells[k + 3]), lastYearRevenue: lastYear,
    mom: num(cells[k + 5]), yoy: num(cells[k + 6]), ytdYoy: num(cells[k + 9]), issuedOn: '', source: 'mops',
  };
}

async function getOk(fetchImpl, url, accept) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res;
}

/** A MOPS page decoded from cp950 (Big5), streamed and refused past MAX_PAGE_BYTES whether or not the server says its length. */
async function readMopsPage(fetchImpl, url) {
  const res = await getOk(fetchImpl, url, 'text/html');
  const tooLarge = (n) => new Error(`MOPS page of ${n} bytes, over ${MAX_PAGE_BYTES}`);
  const advertised = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(advertised) && advertised > MAX_PAGE_BYTES) {
    try { await res.body?.cancel?.(); } catch { /* refuse even if cancelling fails */ }
    throw tooLarge(advertised);
  }
  const reader = res.body?.getReader?.();
  if (!reader) {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_PAGE_BYTES) throw tooLarge(buf.byteLength);
    return new TextDecoder('big5').decode(buf);
  }
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PAGE_BYTES) {
        await reader.cancel().catch(() => {});
        throw tooLarge(`more than ${MAX_PAGE_BYTES}`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  return new TextDecoder('big5').decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
}

async function readPrevious() {
  // Strict: a failed read must fail the run rather than rebuild the log from scratch.
  return readCanonicalValue(CANONICAL_KEY, { strict: true });
}

/**
 * runSeed fetch function: TSMC's months, newest first, with year-on-year
 * growth; the latest from the API, missing earlier ones from MOPS.
 * @param {{ fetchImpl?: typeof fetch, nowMs?: number, loadPrevious?: () => Promise<any> }} [opts]
 */
export async function fetchChipRevenue({
  fetchImpl = (...args) => globalThis.fetch(...args),
  nowMs = Date.now(),
  loadPrevious = readPrevious,
} = {}) {
  const previous = await loadPrevious();
  const res = await getOk(fetchImpl, TWSE_REVENUE_URL, 'application/json');
  const body = await readBoundedFeedText(res, MAX_API_BYTES);
  let list;
  try {
    list = JSON.parse(body);
  } catch {
    throw new Error('openapi.twse.com.tw answered with something other than JSON');
  }
  if (!Array.isArray(list) || list.length < MIN_COMPANIES) throw new Error(`TWSE monthly revenue: ${Array.isArray(list) ? list.length : 'no'} companies, expected at least ${MIN_COMPANIES}`);

  const byMonth = new Map();
  for (const m of Array.isArray(previous?.months) ? previous.months : []) if (m && typeof m.month === 'string' && Number.isFinite(m.revenue)) byMonth.set(m.month, m);
  const logLatest = [...byMonth.keys()].sort().at(-1) ?? null;

  const latest = fromApi(list);
  if (!latest) {
    // Early in a month the table may move to the new month before TSMC files: keep the log until TSMC's due date has passed.
    const tableMonth = listMonth(list);
    if (logLatest && tableMonth && tableMonth > logLatest && nowMs <= filingDue(tableMonth) + FILING_GRACE_MS) {
      console.log(`  TWSE: ${list.length} companies for ${tableMonth}; ${COMPANY.name} has not filed yet (due ${new Date(filingDue(tableMonth)).toISOString().slice(0, 10)}); ${byMonth.size} month(s) kept`);
      return { fetchedAt: nowMs, company: COMPANY.name, code: COMPANY.code, unit: 'thousand TWD', months: [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month)).slice(0, MONTHS_KEPT) };
    }
    throw Object.assign(new Error(`TWSE monthly revenue: no usable row for ${COMPANY.code}`), { nonRetryable: true });
  }
  if (!consistent(latest)) throw Object.assign(new Error(`TWSE monthly revenue: ${COMPANY.code} ${latest.month} growth figures do not match its amounts`), { nonRetryable: true });

  const known = byMonth.get(latest.month);
  // A month new to an existing log is dated by when it could first have been read: the last run or its due date, whichever is later.
  // On the first run, its due date.
  const lastRun = Number.isFinite(previous?.fetchedAt) ? previous.fetchedAt : nowMs;
  const seenAt = Number.isFinite(known?.seenAt) ? known.seenAt
    : Math.min(nowMs, byMonth.size ? Math.max(lastRun, filingDue(latest.month)) : filingDue(latest.month));
  byMonth.set(latest.month, { ...known, ...latest, seenAt });
  // Backfill the months before the latest that the log lacks, newest first.
  const wanted = [];
  for (let m = prevMonth(latest.month); wanted.length < MONTHS_KEPT - 1; m = prevMonth(m)) wanted.push(m);
  let read = 0;
  for (const month of wanted.filter((m) => !byMonth.has(m)).slice(0, BACKFILL_PER_RUN)) {
    const [y, mo] = month.split('-').map(Number);
    try {
      const html = await readMopsPage(fetchImpl, mopsMonthUrl(y, mo));
      const row = fromMops(html, month);
      if (!row) console.warn(`  WARN: MOPS ${month}: no row for ${COMPANY.code}`);
      else if (!consistent(row, byMonth.get(nextMonth(month))?.prevMonthRevenue)) console.warn(`  WARN: MOPS ${month}: ${COMPANY.code}'s row does not match its own growth or the month after; not stored`);
      else { byMonth.set(month, { ...row, seenAt: Math.min(nowMs, filingDue(month)) }); read++; }
    } catch (err) {
      console.warn(`  WARN: MOPS ${month} unread (${err?.message || err})`);
    }
  }
  const months = [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month)).slice(0, MONTHS_KEPT);
  const prev = byMonth.get(prevMonth(latest.month));
  console.log(`  TWSE: ${list.length} companies; ${COMPANY.name} ${latest.month} ${(latest.revenue / 1e6).toFixed(1)}bn NT$, ${latest.yoy?.toFixed(1)}% y/y${prev?.yoy != null ? ` (${prev.month} ${prev.yoy.toFixed(1)}%)` : ' (previous month not read)'}; ${read} month(s) backfilled; ${months.length} in the log`);
  return { fetchedAt: nowMs, company: COMPANY.name, code: COMPANY.code, unit: 'thousand TWD', months };
}

export function validateFn(data) {
  return Boolean(data && Number.isFinite(data.fetchedAt) && Array.isArray(data.months) && data.months.length > 0
    && data.months.every((m) => /^\d{4}-\d{2}$/.test(m?.month) && Number.isFinite(m?.revenue) && Number.isFinite(m?.seenAt)));
}

export function declareRecords(data) {
  return Array.isArray(data?.months) ? data.months.length : 0;
}

export async function markChipRevenueActivated() {
  try {
    const creds = getOptionalUpstashCreds();
    if (creds) await upstashCommand(creds, ['SET', ACTIVATION_KEY, '1']);
  } catch (error) {
    console.warn(`  WARN: activation marker write failed: ${error?.message || error}`);
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadEnvFile(import.meta.url);
  runSeed('tech', 'chip-revenue', CANONICAL_KEY, () => fetchChipRevenue(), {
    validateFn,
    declareRecords,
    ttlSeconds: CHIP_REVENUE_TTL_SECONDS,
    maxStaleMin: CHIP_REVENUE_MAX_STALE_MIN,
    schemaVersion: 1,
    sourceVersion: 'twse-t187ap05-mops-t21sc03-v1',
    afterPublish: markChipRevenueActivated,
  }).catch((err) => {
    console.error('FATAL:', err?.message || err);
    process.exit(1);
  });
}
