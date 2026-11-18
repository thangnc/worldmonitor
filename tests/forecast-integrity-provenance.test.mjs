import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { GPS_ZONE_MAX_UNCERTAIN_HEXES, GPS_ZONE_MIN_HEXES, GPS_ZONE_PERSISTENCE_PROBABILITY } from '../scripts/_gps-maritime-regions.mjs';

import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (rel) => readFileSync(resolve(root, rel), 'utf8').replace(/\r\n/g, '\n');

function parseNumericConst(source, name) {
  const match = source.match(new RegExp(`const ${name} = ([0-9.]+);`));
  assert.ok(match, `${name} declaration not found`);
  return Number(match[1]);
}

function formatProbability(value) {
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function formatProbabilityFixed(value) {
  return value.toFixed(2);
}

function formatSignedProbability(value) {
  return `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(2)}`;
}

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

describe('forecast integrity and provenance surfaces', () => {
  it('keeps forecast extra keys from clobbering last-good snapshots on empty transformed payloads', async () => {
    const { FORECAST_EXTRA_KEYS, PRIOR_KEY, declareRecords } = await import('../scripts/seed-forecasts.mjs');
    const { shouldSkipEmptyExtraKey } = await import('../scripts/_seed-utils.mjs');

    assert.ok(FORECAST_EXTRA_KEYS.length > 0, 'forecast seeder must expose extraKeys through FORECAST_EXTRA_KEYS');
    for (const ek of FORECAST_EXTRA_KEYS) {
      assert.equal(
        ek.skipWhenEmpty,
        true,
        `${ek.key} must opt into skipWhenEmpty so future forecast extraKeys do not overwrite last-good data with empty transforms`,
      );
    }

    const priorExtraKey = FORECAST_EXTRA_KEYS.find((ek) => ek.key === PRIOR_KEY);
    assert.ok(priorExtraKey, `FORECAST_EXTRA_KEYS must include ${PRIOR_KEY}`);

    const emptyPriorPayload = priorExtraKey.transform({ predictions: [] });
    const recordCount = declareRecords(emptyPriorPayload);

    assert.equal(recordCount, 0, 'empty prior snapshot transforms must resolve to recordCount=0');
    assert.equal(
      shouldSkipEmptyExtraKey(priorExtraKey, recordCount),
      true,
      `${PRIOR_KEY} must skip empty writes instead of clobbering the last-good prior snapshot`,
    );
  });
});
