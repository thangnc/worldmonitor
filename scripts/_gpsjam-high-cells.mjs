// The GPS-interference history the Lite indicator needs (spec "Baselines"):
// today's high-interference H3 cells beside the previous day's, so the rule
// can see a cell or a region that went high on the day. gpsjam.org publishes
// one day at a time and `intelligence:gpsjam:v2` keeps only the latest, so
// this compact projection carries the day before forward itself. Each cell
// keeps its centre, so the browser can place both days without h3-js.

import { readCanonicalValue, resolveSeedMetaTtl, writeExtraKeyWithMeta } from './_seed-utils.mjs';

export const GPS_HIGH_CELLS_KEY = 'intelligence:gpsjam:high-cells:v1';
export const GPS_HIGH_CELLS_META_KEY = 'seed-meta:intelligence:gpsjam-high-cells';
export const GPS_HIGH_CELLS_ACTIVATION_KEY = 'seed-activated:intelligence:gpsjam-high-cells';
// gpsjam.org is daily: four days keeps the pair through three missed runs.
export const GPS_HIGH_CELLS_TTL = 4 * 24 * 60 * 60;
// The seed-meta outlives its data (the 7-day floor), so an outage longer than
// the data TTL still reads as stale, not as missing.
export const GPS_HIGH_CELLS_META_TTL = resolveSeedMetaTtl(undefined, GPS_HIGH_CELLS_TTL);

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isProjection(value) {
  return Boolean(value) && typeof value === 'object'
    && typeof value.date === 'string' && DATE.test(value.date) && Array.isArray(value.high);
}

/** Today's high cells as `{ h3, lat, lon }`, one per cell, sorted by id. */
function highCells(hexes) {
  const byId = new Map();
  for (const h of hexes ?? []) {
    if (h?.level !== 'high' || typeof h.h3 !== 'string' || !Number.isFinite(h.lat) || !Number.isFinite(h.lon)) continue;
    if (!byId.has(h.h3)) byId.set(h.h3, { h3: h.h3, lat: h.lat, lon: h.lon });
  }
  return [...byId.values()].sort((a, b) => (a.h3 < b.h3 ? -1 : a.h3 > b.h3 ? 1 : 0));
}

/**
 * Today's high cells beside the previous day's. A new date moves the stored
 * day to `prev*`; a rerun of the same date keeps the stored `prev*`, so the
 * pair never collapses to one day. Returns null when the stored day is newer
 * (a `--date` backfill): that run must not rewind the history.
 */
export function gpsHighCellsProjection(previous, date, hexes, nowMs = Date.now()) {
  if (!DATE.test(date)) throw new Error(`gpsjam date must be YYYY-MM-DD, got ${date}`);
  const high = highCells(hexes);
  let prevDate = null;
  let prevHigh = [];
  if (isProjection(previous)) {
    if (previous.date > date) return null;
    if (previous.date < date) {
      prevDate = previous.date;
      prevHigh = previous.high;
    } else if (typeof previous.prevDate === 'string' && DATE.test(previous.prevDate) && Array.isArray(previous.prevHigh)) {
      prevDate = previous.prevDate;
      prevHigh = previous.prevHigh;
    }
  }
  return { date, high, prevDate, prevHigh, updatedAt: nowMs };
}

/**
 * Publish the projection after the v2 key is written. The seed-meta follows
 * the data write (writeExtraKeyWithMeta), and the activation marker follows
 * both, so a failed write never reads as fresh. A failed read of the stored
 * projection skips the run rather than overwrite the previous day with none:
 * the read is strict, because the default read turns an HTTP failure into
 * null, which would look like a first run.
 */
export async function publishGpsHighCells(output, deps = {}) {
  const {
    read = (key) => readCanonicalValue(key, { strict: true }),
    write = writeExtraKeyWithMeta,
    activate = async () => undefined,
    nowMs = Date.now(),
  } = deps;
  let previous;
  try {
    previous = await read(GPS_HIGH_CELLS_KEY);
  } catch (error) {
    return { written: false, reason: `read failed: ${error?.message || error}` };
  }
  const projection = gpsHighCellsProjection(previous, output.date, output.hexes, nowMs);
  if (!projection) return { written: false, reason: `stored day ${previous.date} is newer than ${output.date}` };
  // writeSeedMeta reports a failed meta write as false rather than throwing;
  // the marker must not land without the meta behind it.
  const metaOk = await write(GPS_HIGH_CELLS_KEY, projection, GPS_HIGH_CELLS_TTL, projection.high.length, GPS_HIGH_CELLS_META_KEY);
  if (metaOk === false) return { written: false, reason: 'seed-meta write failed' };
  await activate();
  return { written: true, projection };
}
