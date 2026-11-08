// Daily attack-infrastructure counts for the Lite "attack infrastructure
// spike" indicator (docs/engineering/architecture/lite.md › Baselines).
// seed-cyber-threats keeps only the latest snapshot; this keeps one count per
// UTC day, per source and per malware family, for HISTORY_DAYS days.

export const CYBER_HISTORY_KEY = 'cyber:threats:history:v1';
export const CYBER_HISTORY_ACTIVATION_KEY = 'seed-activated:cyber:threats-history';
export const HISTORY_DAYS = 30;
/** Outlives the retention window, so a few missed runs do not drop the history. */
export const CYBER_HISTORY_TTL_SECONDS = 35 * 86_400;
export const TOP_FAMILIES = 10;

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Sources whose `malwareFamily` names a family. OTX carries the pulse title
 * there and AbuseIPDB leaves it empty, so neither counts towards families.
 */
const FAMILY_SOURCES = new Set(['feodo', 'urlhaus', 'c2intel']);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCount = (value) => Number.isInteger(value) && value >= 0;

export function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function topEntries(counts, limit) {
  return Object.fromEntries(
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit),
  );
}

/**
 * One run's counts over the deduplicated threats (raw seeder records, before
 * the snapshot cap): total, per source, and the top malware families.
 */
export function countThreats(threats) {
  const bySource = {};
  const families = {};
  let total = 0;
  for (const t of threats) {
    if (!t || typeof t.source !== 'string') continue;
    total += 1;
    bySource[t.source] = (bySource[t.source] ?? 0) + 1;
    const family = typeof t.malwareFamily === 'string' ? t.malwareFamily.trim().toLowerCase() : '';
    if (family && FAMILY_SOURCES.has(t.source)) families[family] = (families[family] ?? 0) + 1;
  }
  return { total, bySource, byFamily: topEntries(families, TOP_FAMILIES) };
}

function cleanCounts(value) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, n]) => isCount(n)));
}

function cleanDay(day) {
  if (!isRecord(day) || !DATE_RE.test(day.date) || !isCount(day.total)) return null;
  return { date: day.date, total: day.total, bySource: cleanCounts(day.bySource), byFamily: cleanCounts(day.byFamily) };
}

/** Two runs on the same UTC day: the larger count wins, per field. */
function mergeDay(stored, next) {
  const maxOf = (a, b) => {
    const out = { ...a };
    for (const [k, n] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, n);
    return out;
  };
  return {
    date: stored.date,
    total: Math.max(stored.total, next.total),
    bySource: maxOf(stored.bySource, next.bySource),
    byFamily: topEntries(maxOf(stored.byFamily, next.byFamily), TOP_FAMILIES),
  };
}

/**
 * Fold this run's counts into the stored history. Keeps the last HISTORY_DAYS
 * UTC days, oldest first, and drops malformed days. Idempotent for one run.
 */
export function mergeThreatHistory(previous, counts, nowMs) {
  const today = utcDay(nowMs);
  const oldest = utcDay(nowMs - (HISTORY_DAYS - 1) * DAY_MS);
  const byDate = new Map();
  for (const raw of isRecord(previous) && Array.isArray(previous.days) ? previous.days : []) {
    const day = cleanDay(raw);
    if (day && day.date >= oldest && day.date <= today) byDate.set(day.date, day);
  }
  const run = { date: today, total: counts.total, bySource: counts.bySource, byFamily: counts.byFamily };
  const stored = byDate.get(today);
  byDate.set(today, stored ? mergeDay(stored, run) : run);
  return {
    updatedAt: nowMs,
    latest: { at: nowMs, total: counts.total, bySource: counts.bySource, byFamily: counts.byFamily },
    days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export function isThreatHistory(payload) {
  return isRecord(payload) && Number.isFinite(payload.updatedAt) && isRecord(payload.latest) && Array.isArray(payload.days);
}
