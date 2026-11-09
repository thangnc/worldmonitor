/**
 * GDELT reported violence for the Geopolitics map (spec: Early indicators ›
 * Catalogue, Baselines). The counts are distinct articles coded as material
 * conflict (QuadClass 4, CAMEO 18–20) per country, from
 * gdelt:bulk:conflict-counts:v1: 48 hourly and 30 daily buckets, each with the
 * number of 15-minute export cohorts it holds, so a partial bucket is never
 * read as calm. Every rule compares a country with its own recent normal,
 * which removes most of the media-volume bias between countries.
 */
import { HOTSPOT_COUNTRY_MAP } from '../../../shared/hotspot-country-map';
import type { Hotspot } from '@/types';
import type { FeedState, Indicator } from './indicators';
import { LINK_WINDOW_HOURS, linkNews } from './news-link';
import type { LiteItem, TimeRange, Tone } from './transforms';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export interface ConflictBucket {
  cohorts: number;
  byCountry: Readonly<Record<string, number>>;
}

export interface ConflictCounts {
  updatedAt: number;
  cursor: string;
  cohortsPerHour: number;
  cohortsPerDay: number;
  hours: ReadonlyArray<ConflictBucket & { hour: string }>;
  days: ReadonlyArray<ConflictBucket & { date: string }>;
}

/** A spike needs this many reports in its window. */
export const MIN_REPORTS = 5;
/** The violence rule: six hours at twice the 7-day average (spec catalogue). */
export const SPIKE_RATIO = 2;
export const SPIKE_HOURS = 6;
/** The 7-day normal needs this many complete days. */
export const MIN_BASELINE_DAYS = 5;
const BASELINE_DAYS = 7;
/** The publisher's cadence, for the stale check. */
export const CONFLICT_COUNTS_CADENCE_MIN = 15;
export const VIOLENCE_RULE = `≥ ${MIN_REPORTS} reports in ${SPIKE_HOURS} h and ×${SPIKE_RATIO} the 7-day average`;
export const SHADING_RULE =
  'GDELT articles coded as material conflict (CAMEO 18–20) per country, against the country’s own normal: 6h and 24h against the 7-day average, 7d the last 7 days against the 22 before. Never raw volume. Machine-coded news reports, not verified events.';

/** The shading steps' lower bounds: ratio against the country's normal. */
const RATIO_STEPS = [1.5, 2, 3, 5] as const;

export function isConflictCounts(value: unknown): value is ConflictCounts {
  const v = value as Partial<ConflictCounts> | null;
  return Boolean(v) && typeof v === 'object' && Array.isArray(v?.hours) && Array.isArray(v?.days) && typeof v?.updatedAt === 'number';
}

const hourStart = (hour: string): number => Date.parse(`${hour}:00:00Z`);
const dayStart = (date: string): number => Date.parse(`${date}T00:00:00Z`);

/** The `n` complete-clock hours before the current UTC hour, oldest first. */
function hoursBefore(counts: ConflictCounts, now: number, n: number) {
  const current = Math.floor(now / HOUR_MS) * HOUR_MS;
  const wanted = Array.from({ length: n }, (_, i) => current - (n - i) * HOUR_MS);
  const byStart = new Map(counts.hours.map((h) => [hourStart(h.hour), h]));
  return wanted.map((start) => ({ start, bucket: byStart.get(start) ?? null }));
}

/** The `n` UTC days through today, oldest first. Today is partial by nature. */
function daysThrough(counts: ConflictCounts, now: number, n: number) {
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  const byStart = new Map(counts.days.map((d) => [dayStart(d.date), d]));
  return Array.from({ length: n }, (_, i) => {
    const start = today - (n - 1 - i) * DAY_MS;
    return { start, bucket: byStart.get(start) ?? null };
  });
}

/** Complete days among the 7 through yesterday: the normal every rule reads. */
function baselineDays(counts: ConflictCounts, now: number) {
  return daysThrough(counts, now - DAY_MS, BASELINE_DAYS)
    .map((d) => d.bucket)
    .filter((b): b is ConflictBucket & { date: string } => Boolean(b) && (b?.cohorts ?? 0) >= counts.cohortsPerDay);
}

function sumCountries(buckets: ReadonlyArray<ConflictBucket | null>, codes: readonly string[]): number {
  let total = 0;
  for (const b of buckets) for (const code of codes) total += b?.byCountry[code] ?? 0;
  return total;
}

/** Reports per day in the country's 7-day normal, or null under MIN_BASELINE_DAYS complete days. */
export function dailyNormal(counts: ConflictCounts, codes: readonly string[], now: number): number | null {
  const days = baselineDays(counts, now);
  return days.length >= MIN_BASELINE_DAYS ? sumCountries(days, codes) / days.length : null;
}

export interface Spike {
  code: string;
  reports: number;
  /** Reports the 7-day average gives a 6-hour window. */
  expected: number;
  ratio: number;
  /** End of the six complete hours read. */
  at: number;
}

/**
 * The last six complete hours against the 7-day average per six hours. Null
 * when any of those hours is short of its cohorts or the normal is too thin:
 * unknown, never calm.
 */
export function violenceSpike(counts: ConflictCounts, code: string, now: number): Spike | null {
  const window = hoursBefore(counts, now, SPIKE_HOURS);
  if (window.some((h) => (h.bucket?.cohorts ?? 0) < counts.cohortsPerHour)) return null;
  const normal = dailyNormal(counts, [code], now);
  if (normal == null) return null;
  const reports = sumCountries(window.map((h) => h.bucket), [code]);
  const expected = (normal * SPIKE_HOURS) / 24;
  // A country with no reports in its normal reads against half a report, not zero.
  const ratio = reports / Math.max(expected, 0.5);
  return { code, reports, expected, ratio, at: (window[window.length - 1]?.start ?? now) + HOUR_MS };
}

/** Whether the hourly and daily history can judge the rule at all. */
export function historyReady(counts: ConflictCounts, now: number): { ready: boolean; detail: string } {
  const hoursOk = hoursBefore(counts, now, SPIKE_HOURS).every((h) => (h.bucket?.cohorts ?? 0) >= counts.cohortsPerHour);
  const days = baselineDays(counts, now).length;
  if (hoursOk && days >= MIN_BASELINE_DAYS) return { ready: true, detail: '' };
  const missing = [
    hoursOk ? '' : `${SPIKE_HOURS} complete hours`,
    days >= MIN_BASELINE_DAYS ? '' : `${MIN_BASELINE_DAYS} complete days (has ${days})`,
  ].filter(Boolean);
  return { ready: false, detail: `Building history · needs ${missing.join(' and ')}` };
}

export interface CountryShade {
  reports: number;
  /** Reports against the country's own normal for the same length; null without a normal. */
  ratio: number | null;
  /** 0 (unshaded) to 4. */
  step: number;
}

export interface Shading {
  byCountry: ReadonlyMap<string, CountryShade>;
  /** What the ratio compares, for the legend and the country card. */
  basis: string;
  /** Some bucket in the compared window holds fewer cohorts than it should. */
  partial: boolean;
}

/** What each range compares, as the map and the layers popover say it. */
export function shadingBasis(range: TimeRange): string {
  return range === '7d' ? 'last 7 days against the 22 before' : `last ${range} against the 7-day average`;
}

/**
 * Country shading: a country is shaded only above its own normal, never by
 * raw volume (GDELT codes so much US crime as conflict that volume would rank
 * the US first). 6h and 24h read the last complete hours against the 7 days
 * through yesterday; 7d reads the 7 complete days through yesterday against
 * the 22 before them.
 */
export function countryShading(counts: ConflictCounts, range: TimeRange, now: number): Shading {
  let window: Array<ConflictBucket | null>;
  let normalDays: ConflictBucket[];
  let days: number;
  let partial: boolean;
  let basis: string;
  if (range === '6h' || range === '24h') {
    const hours = hoursBefore(counts, now, range === '6h' ? 6 : 24);
    window = hours.map((h) => h.bucket);
    partial = hours.some((h) => (h.bucket?.cohorts ?? 0) < counts.cohortsPerHour);
    normalDays = baselineDays(counts, now);
    days = hours.length / 24;
    basis = shadingBasis(range);
  } else {
    const week = daysThrough(counts, now - DAY_MS, 7);
    window = week.map((d) => d.bucket);
    partial = week.some((d) => (d.bucket?.cohorts ?? 0) < counts.cohortsPerDay);
    normalDays = daysThrough(counts, now - 8 * DAY_MS, 22)
      .map((d) => d.bucket)
      .filter((b): b is ConflictBucket & { date: string } => Boolean(b) && (b?.cohorts ?? 0) >= counts.cohortsPerDay);
    days = 7;
    basis = shadingBasis(range);
  }
  const totals = new Map<string, number>();
  for (const b of window) for (const [code, n] of Object.entries(b?.byCountry ?? {})) totals.set(code, (totals.get(code) ?? 0) + n);
  const enough = normalDays.length >= MIN_BASELINE_DAYS;
  const byCountry = new Map<string, CountryShade>();
  for (const [code, reports] of totals) {
    const normal = enough ? sumCountries(normalDays, [code]) / normalDays.length : null;
    const ratio = normal != null ? reports / Math.max(normal * days, 0.5) : null;
    const step = reports >= MIN_REPORTS && ratio != null ? RATIO_STEPS.filter((bound) => ratio >= bound).length : 0;
    byCountry.set(code, { reports, ratio, step });
  }
  return { byCountry, basis, partial };
}

export interface HistogramBar {
  value: number;
  /** Fewer cohorts than the bucket should hold. */
  partial: boolean;
}

/** Reports per hour (6h, 24h) or per day (7d), all countries, oldest first. */
export function conflictHistogram(counts: ConflictCounts, range: TimeRange, now: number): { bars: HistogramBar[]; unit: 'hr' | 'day' } {
  if (range === '6h' || range === '24h') {
    const hours = hoursBefore(counts, now, range === '6h' ? 6 : 24);
    return {
      unit: 'hr',
      bars: hours.map((h) => ({ value: Object.values(h.bucket?.byCountry ?? {}).reduce((a, b) => a + b, 0), partial: (h.bucket?.cohorts ?? 0) < counts.cohortsPerHour })),
    };
  }
  const days = daysThrough(counts, now, 7);
  return {
    unit: 'day',
    bars: days.map((d, i) => ({
      value: Object.values(d.bucket?.byCountry ?? {}).reduce((a, b) => a + b, 0),
      partial: i === days.length - 1 || (d.bucket?.cohorts ?? 0) < counts.cohortsPerDay,
    })),
  };
}

const regionNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;

/** "Yemen" for YE, the code itself when the browser has no name for it. */
export function countryName(code: string): string {
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** The spiking countries, highest ratio first, as indicators with their linked news. */
export function violenceIndicators(counts: ConflictCounts, news: readonly LiteItem[], now: number, max = 5): Indicator[] {
  const codes = new Set<string>();
  for (const h of counts.hours) for (const code of Object.keys(h.byCountry)) codes.add(code);
  const spikes = [...codes]
    .map((code) => violenceSpike(counts, code, now))
    .filter((s): s is Spike => Boolean(s) && (s?.reports ?? 0) >= MIN_REPORTS && (s?.ratio ?? 0) >= SPIKE_RATIO)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, max);
  return spikes.map((s) => {
    const name = countryName(s.code);
    return {
      id: `violence:${s.code}`,
      domain: 'geo' as const,
      name: `Violence spike · ${name}`,
      value: `${s.reports} reports`,
      change: `×${s.ratio.toFixed(1)} vs 7-day avg`,
      rule: `×${SPIKE_RATIO} & ≥ ${MIN_REPORTS} / ${SPIKE_HOURS} h`,
      trust: { level: 'reported' as const, source: 'GDELT (machine-coded)' },
      at: s.at,
      updatedAt: counts.updatedAt,
      links: linkNews({ countries: [{ name, code: s.code }] }, news, s.at, LINK_WINDOW_HOURS.geo),
    };
  });
}

/** The violence feed's states: fired countries, or one row saying why nothing fired. */
export function violenceFeeds(
  counts: ConflictCounts | null,
  status: 'loading' | 'ready' | 'empty' | 'error',
  news: readonly LiteItem[],
  now: number,
): FeedState[] {
  const id = 'violence';
  const name = 'Reported violence · GDELT';
  if (status === 'loading') return [{ kind: 'loading', id, name, detail: 'Loading…' }];
  if (!counts) {
    return [{ kind: 'unavailable', id, name, detail: status === 'error' ? 'Source unavailable · seed-gdelt-bulk-materializer' : 'No data yet · seed-gdelt-bulk-materializer' }];
  }
  if (now - counts.updatedAt > 2 * CONFLICT_COUNTS_CADENCE_MIN * 60_000) {
    return [{ kind: 'stale', id, name, detail: `Late · last update ${Math.round((now - counts.updatedAt) / 60_000)} min ago (expected every ${CONFLICT_COUNTS_CADENCE_MIN} min)` }];
  }
  const ready = historyReady(counts, now);
  if (!ready.ready) return [{ kind: 'unavailable', id, name, detail: ready.detail }];
  const fired = violenceIndicators(counts, news, now);
  if (fired.length) return fired.map((indicator) => ({ kind: 'fired' as const, id: indicator.id, name: indicator.name, indicator }));
  return [{ kind: 'quiet', id, name, detail: `No country at ${VIOLENCE_RULE}` }];
}

export interface HotspotTile {
  id: string;
  name: string;
  level: string;
  tone: Tone;
  /** Reports in the last 24 complete hours against the 7-day daily average, in %; null when unknown. */
  change: number | null;
  /** Daily reports, 14 days through today (today partial). */
  bars: number[];
}

function hotspotCountries(id: string): string[] {
  const mapped = HOTSPOT_COUNTRY_MAP[id];
  return mapped == null ? [] : typeof mapped === 'string' ? [mapped] : [...mapped];
}

/**
 * The region strip: the five curated hotspots with the highest live score,
 * each with its level, the change in GDELT reports for its countries (last 24
 * complete hours against the 7-day daily average) and 14 daily bars. A
 * negative change reads "Easing" whatever the level.
 */
export function hotspotStrip(
  scored: ReadonlyArray<{ hotspot: Pick<Hotspot, 'id' | 'name'>; score: number; level: { tone: Tone; label: string } }>,
  counts: ConflictCounts | null,
  now: number,
  max = 5,
): HotspotTile[] {
  return [...scored]
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ hotspot, level }) => {
      const codes = hotspotCountries(hotspot.id);
      let change: number | null = null;
      let bars: number[] = [];
      if (counts && codes.length) {
        const hours = hoursBefore(counts, now, 24);
        const normal = dailyNormal(counts, codes, now);
        if (normal != null && normal > 0 && hours.every((h) => (h.bucket?.cohorts ?? 0) >= counts.cohortsPerHour)) {
          change = ((sumCountries(hours.map((h) => h.bucket), codes) - normal) / normal) * 100;
        }
        bars = daysThrough(counts, now, 14).map((d) => sumCountries([d.bucket], codes));
      }
      const easing = change != null && change < 0;
      return { id: hotspot.id, name: hotspot.name, level: easing ? 'Easing' : level.label, tone: easing ? 'muted' : level.tone, change, bars };
    });
}
