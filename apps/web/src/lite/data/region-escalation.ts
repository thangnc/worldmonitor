/**
 * Region escalation (spec: Early indicators › Catalogue, "Region escalation";
 * #117): fires when a region strip tile's level rises a step or more against
 * an earlier reading and reaches Elevated or higher. The level is the strip's:
 * the region's highest live hotspot score, rounded (`escalationLevel`).
 *
 * No server keeps past levels yet, so the earlier readings live in this
 * browser (the issue allows client state for a first version; the card says
 * so). Pure functions here; Geopolitics.tsx reads and writes the storage.
 */
import type { EscalationComponents } from '@wm/shared/analysis-hotspot-escalation';
import type { RegionTile } from './conflict';
import { countryName } from './conflict';
import { feedState, type FeedState, type Indicator } from './indicators';
import { LINK_WINDOW_HOURS, linkNews } from './news-link';
import type { EscalationRegion } from './regions';
import type { ResourceState } from './store';
import type { LiteItem } from './transforms';

const MIN_MS = 60_000;
const HOUR_MS = 60 * MIN_MS;

/** Level names by rank (1–5), as the strip and the map name them. */
export const REGION_LEVELS = ['Stable', 'Watch', 'Elevated', 'High', 'Critical'] as const;
/** The lowest level that fires: Elevated. */
export const REGION_FIRE_RANK = 3;
/** Readings kept per region, and the window a rise is measured over. */
export const REGION_HISTORY_HOURS = 24;
/** A new reading is kept at most this often, unless the level changed. */
export const REGION_SAMPLE_MIN = 15;
/** The earlier reading must be at least this old, so a page load never compares with itself. */
export const REGION_BASELINE_MIN = 30;
/** A score component that moved this much (of 100) is named on the card. */
export const COMPONENT_MOVE = 5;
/** Browser storage key for the readings. */
export const REGION_HISTORY_KEY = 'wm-lite:region-levels:v1';

export const REGION_ESCALATION_RULE =
  `A region's level rises a step or more and reaches ${REGION_LEVELS[REGION_FIRE_RANK - 1]} or higher, against the earliest reading ` +
  `this browser kept in the last ${REGION_HISTORY_HOURS} h that is at least ${REGION_BASELINE_MIN} min old.`;

export interface RegionSample {
  at: number;
  rank: number;
  /** Score inputs that were unavailable ("" when none): readings compare only with readings missing the same inputs. */
  inputs?: string;
  /** The hotspot that set the level. */
  lead?: string;
  parts?: EscalationComponents;
}

export type RegionHistory = Readonly<Record<string, readonly RegionSample[]>>;

export interface RegionReading {
  id: string;
  rank: number;
  inputs: string;
  lead: { id?: string; name: string; score: number; components?: EscalationComponents };
}

export const rankOfScore = (score: number) => Math.min(5, Math.max(1, Math.round(score)));
const levelName = (rank: number) => REGION_LEVELS[Math.min(5, Math.max(1, rank)) - 1]!;

/**
 * The strip's tiles as readings; a region with no scored hotspot has none.
 * `missing` names the score inputs that were unavailable: a score without
 * them is lower, so a reading only compares with one missing the same inputs.
 */
export function regionReadings(tiles: ReadonlyArray<Pick<RegionTile, 'id' | 'lead'>>, missing: readonly string[] = []): RegionReading[] {
  const inputs = [...missing].sort().join(',');
  return tiles.flatMap((t) => (t.lead && Number.isFinite(t.lead.score) ? [{ id: t.id, rank: rankOfScore(t.lead.score), inputs, lead: t.lead }] : []));
}

const isSample = (v: unknown): v is RegionSample =>
  typeof v === 'object' && v != null && Number.isFinite((v as RegionSample).at) && Number.isInteger((v as RegionSample).rank)
  && (v as RegionSample).rank >= 1 && (v as RegionSample).rank <= 5
  && ((v as RegionSample).inputs === undefined || typeof (v as RegionSample).inputs === 'string');

/** Stored readings, dropping anything malformed. Empty on bad or missing input. */
export function decodeRegionHistory(raw: string | null): Record<string, RegionSample[]> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed == null || Array.isArray(parsed)) return {};
    const out: Record<string, RegionSample[]> = {};
    for (const [id, list] of Object.entries(parsed)) {
      if (Array.isArray(list)) out[id] = list.filter(isSample);
    }
    return out;
  } catch {
    return {};
  }
}

/** Adds the current readings (at most one per REGION_SAMPLE_MIN unless the level changed) and drops readings past the window. */
export function recordReadings(history: RegionHistory, readings: readonly RegionReading[], now: number): Record<string, RegionSample[]> {
  const cutoff = now - REGION_HISTORY_HOURS * HOUR_MS;
  const out: Record<string, RegionSample[]> = {};
  for (const [id, list] of Object.entries(history)) {
    const kept = list.filter((s) => s.at >= cutoff && s.at <= now);
    if (kept.length) out[id] = kept;
  }
  for (const r of readings) {
    const list = out[r.id] ?? [];
    const last = list[list.length - 1];
    if (last && last.rank === r.rank && (last.inputs ?? '') === r.inputs && now - last.at < REGION_SAMPLE_MIN * MIN_MS) continue;
    out[r.id] = [...list, { at: now, rank: r.rank, inputs: r.inputs, lead: r.lead.id, parts: r.lead.components }];
  }
  return out;
}

/** The earliest reading in the window that is old enough to compare with and was missing the same inputs. */
export function baselineOf(samples: readonly RegionSample[] | undefined, now: number, inputs = ''): RegionSample | null {
  const from = now - REGION_HISTORY_HOURS * HOUR_MS;
  const to = now - REGION_BASELINE_MIN * MIN_MS;
  return [...(samples ?? [])].filter((s) => s.at >= from && s.at <= to && (s.inputs ?? '') === inputs).sort((a, b) => a.at - b.at)[0] ?? null;
}

const PART_LABEL: Readonly<Record<keyof EscalationComponents, string>> = {
  newsActivity: 'news',
  ciiContribution: 'country risk',
  geoConvergence: 'event convergence',
  militaryActivity: 'military activity',
};

/** Score components that moved at least COMPONENT_MOVE points, largest first: "military activity +18". */
export function changedParts(now: EscalationComponents | undefined, before: EscalationComponents | undefined): string[] {
  if (!now || !before) return [];
  return (Object.keys(PART_LABEL) as (keyof EscalationComponents)[])
    .map((k) => ({ k, d: (now[k] ?? 0) - (before[k] ?? 0) }))
    .filter(({ d }) => Number.isFinite(d) && Math.abs(d) >= COMPONENT_MOVE)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .map(({ k, d }) => `${PART_LABEL[k]} ${d > 0 ? '+' : '−'}${Math.abs(Math.round(d))}`);
}

const clock = (t: number) => `${new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`;

export function regionEscalationFeeds(input: {
  regions: readonly EscalationRegion[];
  tiles: ReadonlyArray<Pick<RegionTile, 'id' | 'lead'>>;
  /** The score's inputs: ready once the risk scores and the news have loaded. */
  source: ResourceState<unknown>;
  /** Score inputs that were unavailable (`HotspotEscalation.missing`). */
  missing?: readonly string[];
  history: RegionHistory;
  news: readonly LiteItem[];
  now: number;
}): FeedState[] {
  const { regions, tiles, source, history, news, now } = input;
  const readings = regionReadings(tiles, input.missing);
  const fired: Indicator[] = [];
  const quiet: string[] = [];
  let compared = 0;
  for (const region of regions) {
    const reading = readings.find((r) => r.id === region.id);
    if (!reading) continue;
    const samples = history[region.id];
    const base = baselineOf(samples, now, reading.inputs);
    if (!base) continue;
    compared++;
    if (reading.rank >= REGION_FIRE_RANK && reading.rank > base.rank) {
      // When the rise first qualified: the first later reading at Elevated or higher and above the baseline.
      const floor = Math.max(REGION_FIRE_RANK, base.rank + 1);
      const at = (samples ?? []).find((s) => s.at > base.at && (s.inputs ?? '') === reading.inputs && s.rank >= floor)?.at ?? now;
      const parts = changedParts(reading.lead.components, base.lead === reading.lead.id ? base.parts : undefined);
      fired.push({
        id: `region:${region.id}`,
        domain: 'geo',
        name: `Region escalation · ${region.name}`,
        value: levelName(reading.rank),
        change: `up from ${levelName(base.rank)} (${clock(base.at)})`,
        rule: `≥ ${levelName(REGION_FIRE_RANK)}, up a step`,
        detail: [
          `Led by ${reading.lead.name} ${reading.lead.score.toFixed(1)}/5`,
          parts.length ? parts.join(', ') : base.lead && base.lead !== reading.lead.id ? 'a different hotspot now leads' : null,
          'compared with a reading kept in this browser',
        ].filter(Boolean).join(' · '),
        trust: { level: 'estimated', source: 'World Monitor live hotspot score' },
        at,
        updatedAt: now,
        place: { countries: region.countries },
        links: linkNews(
          { countries: region.countries.map((code) => ({ code, name: countryName(code) })), drivers: [region.name, reading.lead.name] },
          news, at, LINK_WINDOW_HOURS.geo,
        ),
      });
    } else {
      quiet.push(`${region.name} ${levelName(reading.rank)}`);
    }
  }
  const base = feedState({ id: 'region-escalation', name: 'Region escalation · strip levels', source, seeder: 'get-risk-scores', cadenceMin: 30, fired: null, now });
  if (base.kind !== 'quiet') return [base];
  if (fired.length) return fired.map((indicator) => ({ kind: 'fired' as const, id: indicator.id, name: indicator.name, indicator }));
  const detail = compared
    ? `No region up a step to ${levelName(REGION_FIRE_RANK)}+ · ${quiet.join(' · ')} · against this browser's readings`
    : `First readings kept in this browser; a rise shows after ${REGION_BASELINE_MIN} min`;
  return [{ ...base, detail }];
}
