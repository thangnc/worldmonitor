// gpsjam.org restore (2026-07): the GPS-interference layer's source reverted
// from the quota-limited Wingbits API back to the free gpsjam.org daily CSV.
//
// The fetcher emits a SUPERSET hex so BOTH consumer paths keep working with no
// breaking change:
//   - web UI  (api/gpsjam.js → gps-interference.ts → map): the honest gpsjam.org
//     metric — pct + affected/total aircraft.
//   - public API (list-gps-interference.ts + gps_jamming.proto): the stable
//     np_avg/sample_count/aircraft_count contract (no proto regen).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toWebHex } from '../api/gpsjam.js';
import { processHexes } from '../scripts/_gpsjam-parse.mjs';
import {
  GPS_HIGH_CELLS_KEY,
  GPS_HIGH_CELLS_META_KEY,
  GPS_HIGH_CELLS_META_TTL,
  GPS_HIGH_CELLS_TTL,
  gpsHighCellsProjection,
  publishGpsHighCells,
} from '../scripts/_gpsjam-high-cells.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(repoRoot, p), 'utf8');

const CSV_HEADER = 'hex,count_good_aircraft,count_bad_aircraft';
const VALID_H3 = '841f41dffffffff'; // res-4 cell (from live gpsjam.org data)

describe('api/gpsjam.js toWebHex — normalizes every stored shape to the web-UI shape', () => {
  test('new gpsjam.org v2 hex passes pct/affected/total through', () => {
    const h = toWebHex({ h3: 'a', lat: 1, lon: 2, level: 'high', region: 'levant', pct: 15.3, affectedAircraft: 5, totalAircraft: 30, npAvg: 0.3, sampleCount: 5, aircraftCount: 30 });
    assert.deepEqual(h, { h3: 'a', lat: 1, lon: 2, level: 'high', region: 'levant', pct: 15.3, affectedAircraft: 5, totalAircraft: 30 });
  });

  test('legacy Wingbits v2 hex (npAvg, no pct) is converted during the transition window', () => {
    const h = toWebHex({ h3: 'b', lat: 1, lon: 2, level: 'high', region: 'other', npAvg: 0.3, sampleCount: 7, aircraftCount: 40 });
    assert.equal(h.pct, 15, 'npAvg<=0.5 → high bucket pct');
    assert.equal(h.affectedAircraft, 7, 'sampleCount → affectedAircraft');
    assert.equal(h.totalAircraft, 40, 'aircraftCount → totalAircraft');
  });

  test('v1 dual-write hex (good/bad/total) maps bad→affected, total→total', () => {
    const h = toWebHex({ h3: 'c', lat: 1, lon: 2, level: 'medium', region: 'ukraine-russia', pct: 8, good: 20, bad: 4, total: 24 });
    assert.equal(h.pct, 8);
    assert.equal(h.affectedAircraft, 4);
    assert.equal(h.totalAircraft, 24);
  });
});

describe('gpsjam.org restore — source wiring guards', () => {
  test('fetcher pulls gpsjam.org (free, no key)', () => {
    const src = read('scripts/fetch-gpsjam.mjs');
    assert.match(src, /BASE_URL = 'https:\/\/gpsjam\.org\/data'/);
    assert.doesNotMatch(src, /WINGBITS_API_KEY|customer-api\.wingbits\.com|x-api-key/, 'Wingbits dependency must be gone');
  });

  test('fetcher preserves last-good on failure (extendExistingTtl + exit 0), no fetchedAt refresh', () => {
    const src = read('scripts/fetch-gpsjam.mjs');
    assert.match(src, /extendExistingTtl\(\[REDIS_KEY_V2, REDIS_KEY_V1, 'seed-meta:intelligence:gpsjam'\]/);
    assert.match(src, /process\.exit\(0\)/);
  });

  test('web UI reads the gpsjam.org metric (pct), not npAvg', () => {
    assert.match(read('src/services/gps-interference.ts'), /pct: number;[\s\S]*affectedAircraft: number;[\s\S]*totalAircraft: number;/);
    assert.doesNotMatch(read('src/services/gps-interference.ts'), /npAvg/);
    assert.match(read('src/components/MapPopup.ts'), /Number\(data\.pct\)\.toFixed\(1\)/);
  });

  test('public proto API contract is unchanged (still reads npAvg / np_avg)', () => {
    assert.match(read('server/worldmonitor/intelligence/v1/list-gps-interference.ts'), /npAvg: toNumber\(hex\.npAvg\)/);
    assert.match(read('proto/worldmonitor/intelligence/v1/gps_jamming.proto'), /double np_avg = 5/);
  });
});

describe('gpsjam.org CSV parser (_gpsjam-parse.mjs)', () => {
  test('parses a row into the superset hex shape + classifies level by pct', () => {
    const csv = [
      CSV_HEADER,
      `${VALID_H3},0,10`, // 100% bad → high
      `${VALID_H3},1,1`,  // total 2 < minAircraft(3) → skipped low-sample
    ].join('\n');
    const { results, skippedLowSample } = processHexes(csv, 3);
    assert.equal(results.length, 1);
    assert.equal(skippedLowSample, 1);
    const h = results[0];
    // web-UI fields + public-API proto fields on the same hex.
    assert.deepEqual(
      { pct: h.pct, affectedAircraft: h.affectedAircraft, totalAircraft: h.totalAircraft, npAvg: h.npAvg, sampleCount: h.sampleCount, aircraftCount: h.aircraftCount, level: h.level },
      { pct: 100, affectedAircraft: 10, totalAircraft: 10, npAvg: 0.3, sampleCount: 10, aircraftCount: 10, level: 'high' },
    );
    assert.equal(typeof h.lat, 'number');
    assert.equal(typeof h.region, 'string');
  });

  test('coalesces an invalid minAircraft (NaN) to the default so the low-sample filter stays active', () => {
    const csv = [
      CSV_HEADER,
      `${VALID_H3},0,10`, // total 10 → high, kept
      `${VALID_H3},1,1`,  // total 2 → would leak in if the threshold were NaN
    ].join('\n');
    const { results, skippedLowSample } = processHexes(csv, NaN);
    assert.equal(skippedLowSample, 1, 'total-2 row must still be dropped under the default-3 threshold');
    assert.equal(results.length, 1);
  });

  test('drops <2% interference rows and rows below minAircraft', () => {
    const csv = [
      CSV_HEADER,
      `${VALID_H3},99,1`,  // 1% → below 2% → skipped low-interference
      `${VALID_H3},95,5`,  // 5% → medium
    ].join('\n');
    const { results, skippedLow } = processHexes(csv, 3);
    assert.equal(skippedLow, 1);
    assert.equal(results.length, 1);
    assert.equal(results[0].level, 'medium');
  });

  // Regression for the ce-code-review #4987 P2 finding: the h3-conversion abort
  // guard must use ATTEMPTED conversions as the denominator, not all CSV rows.
  // Here every attempted hex has an invalid H3, padded by many rows that never
  // attempt conversion — the old `> (lines.length-1) * 0.5` guard would never
  // trip; the `> h3Attempts * 0.5` guard must.
  test('aborts when a majority of ATTEMPTED h3 conversions fail (not vs all rows)', () => {
    const rows = [CSV_HEADER];
    for (let i = 0; i < 3; i++) rows.push(`not-a-valid-h3-${i},0,10`); // high, attempts h3, fails
    for (let i = 0; i < 50; i++) rows.push(`${VALID_H3},99,1`);        // 1% → never attempts h3
    assert.throws(() => processHexes(rows.join('\n'), 3), /attempted hexes failed h3 conversion \(3\/3\)/);
  });

  test('does NOT abort when failures are a minority of attempts', () => {
    const rows = [CSV_HEADER, `bad-h3,0,10`]; // 1 attempt, fails
    for (let i = 0; i < 4; i++) rows.push(`${VALID_H3},0,10`); // 4 attempts succeed
    const { results } = processHexes(rows.join('\n'), 3);
    assert.equal(results.length, 4); // 1/5 failure < 50% → no abort
  });
});

describe('GPS high cells: the previous day kept for the Lite indicator (_gpsjam-high-cells.mjs)', () => {
  const hex = (h3, level, lat = 1, lon = 2) => ({ h3, level, lat, lon });
  const cell = (h3, lat = 1, lon = 2) => ({ h3, lat, lon });
  const NOW = Date.UTC(2026, 10, 8, 6);

  test('a new day moves the stored day to prev; high cells only, with centres, deduplicated and sorted', () => {
    const stored = { date: '2026-11-06', high: [cell('b'), cell('a')], prevDate: '2026-11-05', prevHigh: [cell('z')] };
    const out = gpsHighCellsProjection(stored, '2026-11-07', [hex('c', 'high', 30, 40), hex('a', 'high'), hex('a', 'high'), hex('m', 'medium'), { h3: 'x', level: 'high' }], NOW);
    assert.deepEqual(out, { date: '2026-11-07', high: [cell('a'), cell('c', 30, 40)], prevDate: '2026-11-06', prevHigh: [cell('b'), cell('a')], updatedAt: NOW });
  });

  test('a rerun of the same day keeps the stored previous day', () => {
    const stored = { date: '2026-11-07', high: [cell('a')], prevDate: '2026-11-06', prevHigh: [cell('b')] };
    const out = gpsHighCellsProjection(stored, '2026-11-07', [hex('a', 'high'), hex('d', 'high')], NOW);
    assert.equal(out.prevDate, '2026-11-06');
    assert.deepEqual(out.prevHigh, [cell('b')]);
    assert.deepEqual(out.high, [cell('a'), cell('d')]);
  });

  test('the first run has no previous day, and an older --date backfill never rewinds the history', () => {
    assert.deepEqual(gpsHighCellsProjection(null, '2026-11-07', [hex('a', 'high')], NOW), { date: '2026-11-07', high: [cell('a')], prevDate: null, prevHigh: [], updatedAt: NOW });
    assert.equal(gpsHighCellsProjection({ date: '2026-11-07', high: [] }, '2026-11-01', [], NOW), null);
    assert.throws(() => gpsHighCellsProjection(null, '07/11/2026', [], NOW));
  });

  test('publishes data, then seed-meta (one call), then the activation marker; a failed read or write never activates', async () => {
    const calls = [];
    const ok = await publishGpsHighCells({ date: '2026-11-07', hexes: [hex('a', 'high')] }, {
      read: async () => ({ date: '2026-11-06', high: [cell('b')] }),
      write: async (...args) => { calls.push(['write', ...args]); },
      activate: async () => { calls.push(['activate']); },
      nowMs: NOW,
    });
    assert.equal(ok.written, true);
    assert.deepEqual(calls.map((c) => c[0]), ['write', 'activate']);
    const [, key, data, ttl, recordCount, metaKey] = calls[0];
    assert.equal(key, GPS_HIGH_CELLS_KEY);
    assert.equal(metaKey, GPS_HIGH_CELLS_META_KEY);
    assert.equal(ttl, GPS_HIGH_CELLS_TTL);
    assert.ok(GPS_HIGH_CELLS_TTL >= 3 * 24 * 60 * 60, 'TTL covers at least three daily runs');
    assert.equal(recordCount, 1);
    assert.equal(data.prevDate, '2026-11-06');

    const activated = [];
    const readFail = await publishGpsHighCells({ date: '2026-11-07', hexes: [] }, {
      read: async () => { throw new Error('timeout'); },
      write: async () => { throw new Error('must not write'); },
      activate: async () => { activated.push('read'); },
    });
    assert.equal(readFail.written, false);
    assert.match(readFail.reason, /read failed/);
    await assert.rejects(publishGpsHighCells({ date: '2026-11-07', hexes: [] }, {
      read: async () => null,
      write: async () => { throw new Error('redis down'); },
      activate: async () => { activated.push('write'); },
    }), /redis down/);
    // A meta write that reports false (writeSeedMeta on a non-OK response) never activates.
    const metaFail = await publishGpsHighCells({ date: '2026-11-07', hexes: [] }, {
      read: async () => null,
      write: async () => false,
      activate: async () => { activated.push('meta'); },
    });
    assert.deepEqual(metaFail, { written: false, reason: 'seed-meta write failed' });
    assert.deepEqual(activated, []);
  });

  test('the default read is strict, so an HTTP failure is not read as a first run', () => {
    assert.match(read('scripts/_gpsjam-high-cells.mjs'), /readCanonicalValue\(key, \{ strict: true \}\)/);
  });

  test('the fetcher publishes the projection after v2 and extends its TTL on failure', () => {
    const src = read('scripts/fetch-gpsjam.mjs');
    assert.ok(src.indexOf('publishGpsHighCells(output') > src.indexOf("['SET', REDIS_KEY_V2"), 'after the v2 write');
    assert.match(src, /extendExistingTtl\(\[GPS_HIGH_CELLS_KEY\], GPS_HIGH_CELLS_TTL\)/);
    assert.match(src, /extendExistingTtl\(\[GPS_HIGH_CELLS_META_KEY\], GPS_HIGH_CELLS_META_TTL\)/);
    assert.ok(GPS_HIGH_CELLS_META_TTL > GPS_HIGH_CELLS_TTL, 'the meta outlives its data');
    assert.match(src, /loadEnvFile\(import\.meta\.url\)/);
  });
});
