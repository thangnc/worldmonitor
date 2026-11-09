/**
 * The Geopolitics live layers beside the GDELT violence feed (spec
 * "Catalogue", geopolitics rows; step 2b): military aircraft near curated
 * hotspots, incidents at sea (UKMTO) and GPS interference (gpsjam.org).
 * Pure rules: the screen passes the loaded data and the curated hotspots.
 */
import { HOTSPOT_COUNTRY_MAP } from '../../../shared/hotspot-country-map';
import { haversineKm } from '../../../shared/geo-distance';
import type { Hotspot } from '@/types';
import type { MilitaryAircraftType, MilitaryFlight } from '@/generated/client/worldmonitor/military/v1/service_client';
import type { ListUkmtoIncidentsResponse, UkmtoIncident } from '@/generated/client/worldmonitor/maritime/v1/service_client';
import { countryName, shadingBasis } from './conflict';
import { feedState, type FeedState, type Indicator } from './indicators';
import { LINK_WINDOW_HOURS, linkNews, type LinkSubject } from './news-link';
import type { ResourceState } from './store';
import { GEO_REGION_LABEL, regionOfPoint, type LiteItem, type TimeRange } from './transforms';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export type Place = Pick<Hotspot, 'id' | 'name' | 'lat' | 'lon'>;

export function hotspotSubject(hotspot: Place): LinkSubject {
  const mapped = HOTSPOT_COUNTRY_MAP[hotspot.id];
  const codes = mapped == null ? [] : typeof mapped === 'string' ? [mapped] : [...mapped];
  return { countries: codes.map((code) => ({ code, name: countryName(code) })), drivers: [hotspot.name] };
}

/** Fired indicators, or the feed's one state row whose quiet line says what was checked. */
export function feeds(base: FeedState, fired: readonly Indicator[], quietDetail: string): FeedState[] {
  if (base.kind !== 'quiet') return [base];
  if (fired.length) return fired.map((indicator) => ({ kind: 'fired' as const, id: indicator.id, name: indicator.name, indicator }));
  return [{ ...base, detail: quietDetail }];
}

// ---- Military aircraft ------------------------------------------------------

export const AIRCRAFT_MIN = 5;
export const AIRCRAFT_RADIUS_KM = 200;
export const MILITARY_FLIGHTS_CADENCE_MIN = 10;

export type AircraftKind = 'fighter' | 'bomber' | 'tanker' | 'ISR' | 'transport' | 'helicopter' | 'drone' | 'other';

const KIND: Partial<Record<MilitaryAircraftType, AircraftKind>> = {
  MILITARY_AIRCRAFT_TYPE_FIGHTER: 'fighter',
  MILITARY_AIRCRAFT_TYPE_BOMBER: 'bomber',
  MILITARY_AIRCRAFT_TYPE_TANKER: 'tanker',
  MILITARY_AIRCRAFT_TYPE_RECONNAISSANCE: 'ISR',
  MILITARY_AIRCRAFT_TYPE_AWACS: 'ISR',
  MILITARY_AIRCRAFT_TYPE_PATROL: 'ISR',
  MILITARY_AIRCRAFT_TYPE_TRANSPORT: 'transport',
  MILITARY_AIRCRAFT_TYPE_HELICOPTER: 'helicopter',
  MILITARY_AIRCRAFT_TYPE_DRONE: 'drone',
};

/** The card's type split: the known types by name, everything else (VIP, special ops, unknown) as other. */
export function aircraftKind(type: MilitaryAircraftType): AircraftKind {
  return KIND[type] ?? 'other';
}

export interface AircraftCluster {
  hotspot: Place;
  flights: MilitaryFlight[];
  byKind: Partial<Record<AircraftKind, number>>;
}

const placed = (f: MilitaryFlight): f is MilitaryFlight & { location: { latitude: number; longitude: number } } =>
  Number.isFinite(f.location?.latitude) && Number.isFinite(f.location?.longitude);

/**
 * Airborne military aircraft within 200 km of each hotspot, most first. An
 * aircraft near two hotspots counts at both, but once at each: the loader
 * queries overlapping regions, so the same aircraft can arrive twice.
 */
export function aircraftNearHotspots(flights: readonly MilitaryFlight[], hotspots: readonly Place[]): AircraftCluster[] {
  const airborne = [...new Map(flights.filter((f) => placed(f) && !f.onGround).map((f) => [f.id || f.hexCode, f])).values()];
  return hotspots
    .map((hotspot) => {
      const near = airborne.filter((f) => haversineKm(hotspot.lat, hotspot.lon, f.location!.latitude, f.location!.longitude) <= AIRCRAFT_RADIUS_KM);
      const byKind: Partial<Record<AircraftKind, number>> = {};
      for (const f of near) {
        const kind = aircraftKind(f.aircraftType);
        byKind[kind] = (byKind[kind] ?? 0) + 1;
      }
      return { hotspot, flights: near, byKind };
    })
    .filter((c) => c.flights.length > 0)
    .sort((a, b) => b.flights.length - a.flights.length);
}

/** "14 fighter · 3 ISR · 6 other": named types by count, other last. */
export function kindSplit(byKind: Partial<Record<AircraftKind, number>>, max = Infinity): string {
  const named = (Object.entries(byKind) as Array<[AircraftKind, number]>)
    .filter(([kind]) => kind !== 'other')
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([kind, n]) => `${n} ${kind}`);
  const other = byKind.other ?? 0;
  return [...named, ...(other && max === Infinity ? [`${other} other`] : [])].join(' · ');
}

export function aircraftIndicators(clusters: readonly AircraftCluster[], news: readonly LiteItem[], now: number, max = 5): Indicator[] {
  return clusters
    .filter((c) => c.flights.length >= AIRCRAFT_MIN)
    .slice(0, max)
    .map((c) => {
      const at = Math.min(now, Math.max(...c.flights.map((f) => f.lastSeenAt || 0)) || now);
      return {
        id: `aircraft:${c.hotspot.id}`,
        domain: 'geo' as const,
        name: `Military aircraft · ${c.hotspot.name}`,
        value: `${c.flights.length} aircraft`,
        change: kindSplit(c.byKind, 2) || undefined,
        rule: `≥ ${AIRCRAFT_MIN} within ${AIRCRAFT_RADIUS_KM} km`,
        detail: kindSplit(c.byKind),
        trust: { level: 'reported' as const, source: 'transponders (adsb.lol)' },
        at,
        updatedAt: at,
        links: linkNews(hotspotSubject(c.hotspot), news, at, LINK_WINDOW_HOURS.geo),
      };
    });
}

export function aircraftFeeds(
  source: ResourceState<MilitaryFlight[]>,
  hotspots: readonly Place[],
  news: readonly LiteItem[],
  now: number,
): FeedState[] {
  const flights = source.data ?? [];
  const newest = flights.reduce((t, f) => Math.max(t, f.lastSeenAt || 0), 0) || null;
  const base = feedState({
    id: 'aircraft', name: 'Military aircraft · transponders', source, seeder: 'seed-military-flights',
    cadenceMin: MILITARY_FLIGHTS_CADENCE_MIN, dataAt: newest, fired: null, now,
  });
  const clusters = aircraftNearHotspots(flights, hotspots);
  const top = clusters[0];
  const quiet = top
    ? `Live · most near a hotspot: ${top.flights.length} at ${top.hotspot.name} (fires at ${AIRCRAFT_MIN})`
    : `Live · no military aircraft within ${AIRCRAFT_RADIUS_KM} km of a hotspot`;
  return feeds(base, aircraftIndicators(clusters, news, now), quiet);
}

// ---- Incidents at sea (UKMTO) -----------------------------------------------

export const SEA_WINDOW_HOURS = 24;
export const UKMTO_CADENCE_MIN = 30;

/** Sea areas named in UKMTO notices, matched in the place line and in headlines. */
const SEA_AREAS = [
  'Bab el-Mandeb', 'Red Sea', 'Gulf of Aden', 'Aden', 'Hodeidah', 'Mokha', 'Strait of Hormuz', 'Hormuz',
  'Gulf of Oman', 'Fujairah', 'Persian Gulf', 'Arabian Sea', 'Somalia', 'Yemen', 'Eritrea', 'Djibouti', 'Oman',
] as const;

export function seaAreas(text: string): string[] {
  const lower = text.toLowerCase();
  return SEA_AREAS.filter((area) => lower.includes(area.toLowerCase()));
}

const incidentTime = (i: UkmtoIncident): number => i.reportedAt || i.occurredAt;

export function seaIncidentIndicators(resp: ListUkmtoIncidentsResponse, news: readonly LiteItem[], now: number): Indicator[] {
  return resp.incidents
    .filter((i) => now - incidentTime(i) <= SEA_WINDOW_HOURS * HOUR_MS)
    .sort((a, b) => incidentTime(b) - incidentTime(a))
    .map((i) => {
      const areas = seaAreas(`${i.place} ${i.description}`);
      const at = i.occurredAt;
      return {
        id: `sea:${i.id}`,
        domain: 'geo' as const,
        name: `Sea incident · ${areas[0] ?? i.place}`,
        value: 'UKMTO',
        change: i.incidentType.toLowerCase(),
        rule: 'any new incident',
        detail: i.place,
        trust: { level: 'official' as const, source: `UKMTO notice ${String(i.incidentNumber).padStart(3, '0')}` },
        at,
        updatedAt: resp.fetchedAt,
        links: linkNews({ drivers: ['UKMTO', ...areas] }, news, at, LINK_WINDOW_HOURS.geo),
      };
    });
}

export function seaIncidentFeeds(source: ResourceState<ListUkmtoIncidentsResponse>, news: readonly LiteItem[], now: number): FeedState[] {
  const base = feedState({
    id: 'sea', name: 'Incidents at sea · UKMTO', source, seeder: 'seed-ukmto-incidents',
    cadenceMin: UKMTO_CADENCE_MIN, dataAt: source.data?.fetchedAt ?? null, fired: null, now,
  });
  return feeds(base, source.data ? seaIncidentIndicators(source.data, news, now) : [], `Live · no incident in the last ${SEA_WINDOW_HOURS} h`);
}

// ---- GPS interference -------------------------------------------------------

export const GPS_RADIUS_KM = 200;
export const GPS_REGION_RISE = 1.5;
export const GPS_REGION_MIN = 5;
export const GPSJAM_CADENCE_MIN = 24 * 60;

export interface GpsCell {
  h3: string;
  lat: number;
  lon: number;
}

/** Today's and the previous day's high cells (`intelligence:gpsjam:high-cells:v1`). */
export interface GpsHighCells {
  date: string;
  high: GpsCell[];
  prevDate: string | null;
  prevHigh: GpsCell[];
  updatedAt: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isCell = (c: unknown): c is GpsCell =>
  typeof c === 'object' && c !== null && typeof (c as GpsCell).h3 === 'string'
  && Number.isFinite((c as GpsCell).lat) && Number.isFinite((c as GpsCell).lon);

export function isGpsHighCells(value: unknown): value is GpsHighCells {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as GpsHighCells;
  return typeof v.date === 'string' && DATE.test(v.date) && Array.isArray(v.high) && v.high.every(isCell)
    && (v.prevDate === null || (typeof v.prevDate === 'string' && DATE.test(v.prevDate)))
    && Array.isArray(v.prevHigh) && v.prevHigh.every(isCell) && Number.isFinite(v.updatedAt);
}

const dayBefore = (date: string): string => new Date(Date.parse(`${date}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);

/** Ready when the previous day is the calendar day before; otherwise says what is missing. */
export function gpsHistoryReady(cells: GpsHighCells): { ready: boolean; detail: string } {
  if (cells.prevDate === dayBefore(cells.date)) return { ready: true, detail: '' };
  return {
    ready: false,
    detail: cells.prevDate
      ? `Building history · needs ${dayBefore(cells.date)}, has ${cells.prevDate}`
      : 'Building history · needs the previous day',
  };
}

const near = (cells: readonly GpsCell[], p: Place) => cells.filter((c) => haversineKm(p.lat, p.lon, c.lat, c.lon) <= GPS_RADIUS_KM);

function regionCounts(cells: readonly GpsCell[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of cells) {
    const region = regionOfPoint(c.lat, c.lon);
    if (region && region !== 'all') out.set(region, (out.get(region) ?? 0) + 1);
  }
  return out;
}

/**
 * Two rules on the day's high cells against the day before: a hotspot with a
 * high cell within 200 km that had none, and a region whose high cells rose
 * 50% or more (with at least 5 today).
 */
export function gpsIndicators(cells: GpsHighCells, hotspots: readonly Place[], news: readonly LiteItem[], now: number): Indicator[] {
  if (!gpsHistoryReady(cells).ready) return [];
  // The data covers a UTC day; its news window ends with that day.
  const at = Math.min(now, Date.parse(`${cells.date}T00:00:00Z`) + DAY_MS - 1);
  const common = {
    domain: 'geo' as const,
    trust: { level: 'reported' as const, source: 'gpsjam.org (aircraft transponders)' },
    at,
    dataDate: `day ${cells.date}`,
    updatedAt: cells.updatedAt,
  };
  const out: Indicator[] = [];
  for (const hotspot of hotspots) {
    const today = near(cells.high, hotspot);
    if (today.length === 0 || near(cells.prevHigh, hotspot).length > 0) continue;
    out.push({
      ...common,
      id: `gps:${hotspot.id}`,
      name: `GPS interference · ${hotspot.name}`,
      value: `${today.length} high cell${today.length === 1 ? '' : 's'}`,
      change: 'none the day before',
      rule: `new high cell ≤ ${GPS_RADIUS_KM} km`,
      links: linkNews({ ...hotspotSubject(hotspot), drivers: [hotspot.name, 'GPS', 'jamming', 'spoofing'] }, news, at, LINK_WINDOW_HOURS.geo),
    });
  }
  const before = regionCounts(cells.prevHigh);
  for (const [region, n] of regionCounts(cells.high)) {
    const prev = before.get(region) ?? 0;
    if (n < GPS_REGION_MIN || n < prev * GPS_REGION_RISE) continue;
    const label = GEO_REGION_LABEL[region as keyof typeof GEO_REGION_LABEL];
    out.push({
      ...common,
      id: `gps-region:${region}`,
      name: `GPS interference · ${label}`,
      value: `${n} high cells`,
      change: prev ? `+${Math.round((n / prev - 1) * 100)}% on the day` : 'none the day before',
      rule: `+${Math.round((GPS_REGION_RISE - 1) * 100)}% on the day, ≥ ${GPS_REGION_MIN}`,
      links: linkNews({ drivers: [label, 'GPS', 'jamming', 'spoofing'] }, news, at, LINK_WINDOW_HOURS.geo),
    });
  }
  return out;
}

export function gpsFeeds(source: ResourceState<GpsHighCells>, hotspots: readonly Place[], news: readonly LiteItem[], now: number): FeedState[] {
  const base = feedState({
    id: 'gps', name: 'GPS interference · gpsjam.org', source, seeder: 'fetch-gpsjam',
    cadenceMin: GPSJAM_CADENCE_MIN, dataAt: source.data?.updatedAt ?? null, fired: null, now,
  });
  if (base.kind !== 'quiet' || !source.data) return [base];
  const ready = gpsHistoryReady(source.data);
  if (!ready.ready) return [{ kind: 'unavailable', id: base.id, name: base.name, detail: ready.detail }];
  return feeds(base, gpsIndicators(source.data, hotspots, news, now), `Live · day ${source.data.date}: ${source.data.high.length} high cells, none new near a hotspot`);
}

/** A GPS hexagon as an overlay fill: red when high, amber when medium. */
export interface HexFill {
  type: 'Feature';
  geometry: { type: 'Polygon'; coordinates: number[][][] };
  properties: { id: string; tone: 'crit' | 'elev' };
}

/**
 * The day's medium and high hexagons as overlay fills. `boundary` is h3-js
 * `cellToBoundary(cell, true)` (lng/lat pairs), passed in so h3-js loads only
 * with the map. Cells across the antimeridian are left out rather than drawn
 * around the world.
 */
export function gpsHexFills(
  hexes: ReadonlyArray<{ h3: string; level: 'medium' | 'high' }>,
  boundary: (h3: string) => number[][],
): { type: 'FeatureCollection'; features: HexFill[] } {
  const features: HexFill[] = [];
  for (const hex of hexes) {
    const ring = boundary(hex.h3);
    if (ring.length < 3) continue;
    const lons = ring.map((p) => p[0]!);
    if (Math.max(...lons) - Math.min(...lons) > 180) continue;
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    const closed = first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [closed] },
      properties: { id: hex.h3, tone: hex.level === 'high' ? 'crit' : 'elev' },
    });
  }
  return { type: 'FeatureCollection', features };
}

// ---- What each layer shows at the selected range ----------------------------

const RANGE_WORDS: Record<TimeRange, string> = { '6h': 'last 6 h', '24h': 'last 24 h', '7d': 'last 7 days' };

/**
 * One line per Geopolitics layer saying what it shows at `range`. Only
 * reported violence and incidents at sea change with it; the others say they
 * do not (owner's decision, 2026-11-10). Undefined for layers with no data yet
 * and for optional context.
 */
export function layerRangeNote(id: string, range: TimeRange): string | undefined {
  switch (id) {
    case 'violence':
      return range === '7d' ? `${shadingBasis(range)}: slow build-ups` : `${shadingBasis(range)}: sudden spikes`;
    case 'sea':
      return `notices from the ${RANGE_WORDS[range]}`;
    case 'aircraft':
      return 'positions now; the range does not apply';
    case 'gps':
      return 'latest gpsjam day; the range does not apply';
    case 'conflicts':
      return 'every event, whatever the range';
    case 'hotspots':
      return 'score now; the range does not apply';
    default:
      return undefined;
  }
}
