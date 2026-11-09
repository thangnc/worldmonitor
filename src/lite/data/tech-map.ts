/**
 * The Technology screen's "Infrastructure & cyber map" (spec: Screen design ›
 * Technology & AI). Pure rules from the feeds to map layers:
 *
 * Marks follow the one map grammar (src/lite/map/marks.tsx):
 *
 * - DDoS targets: country shading on the shared blue ramp by share of attack
 *   traffic over the selected range (who is attacked), with the top few labelled.
 * - Attack servers: threat indicators seen in the selected range, binned into
 *   8° cells (where attackers' servers sit), each a grey aggregate with its count.
 * - Outages: Cloudflare outages active in the selected range at the country
 *   centroid, an event with the cause's glyph.
 * - Cloud regions: one asset per city. A provider's partial or major outage
 *   turns its cities amber; a city turns red only when the incident text
 *   names its region.
 * - AI data centres: an asset, amber when an internet outage is in the same
 *   country (its card names the outage's type and cause).
 *
 * The 6h/24h/7d range (owner's decision, 2026-11-10) filters the three time
 * layers; cloud regions, AI data centres and cables show their status now,
 * grey and underneath until a signal turns them amber or red.
 * - Undersea cables: lines coloured by cable health (ok, degraded, fault),
 *   with an event at the middle of a degraded or faulted one.
 */
import type {
  CableHealthRecord,
  GetCableHealthResponse,
  InternetOutage,
  ListInternetDdosAttacksResponse,
  ServiceStatus,
} from '@/generated/client/worldmonitor/infrastructure/v1/service_client';
import type { CyberThreat } from '@/generated/client/worldmonitor/cyber/v1/service_client';
import type { CloudRegion } from '@/config/tech-geo';
import type { AIDataCenter, UnderseaCable } from '@/types';
import { resolveCountryCode } from '../../../shared/country-code-resolve';
import type { AggregateMarker, AssetMarker, EventMarker, LabelMarker } from '../map/LiteMap';
import type { MarkGlyph, MarkState } from '../map/marks';
import type { CountryShapes } from './sources';
import { featureIso2, type FeatureCollectionOf } from './markets-map';
import { compactCount } from '../map/view';
import { THREAT_FEED_LABEL, isOutageLive } from './tech-indicators';
import { TIME_RANGE_HOURS, type TimeRange } from './transforms';

const HOUR_MS = 3_600_000;
const RANGE_WORDS: Readonly<Record<TimeRange, string>> = { '6h': 'last 6 h', '24h': 'last 24 h', '7d': 'last 7 days' };
/** "last 6 h", "last 24 h", "last 7 days". */
export const rangeWords = (range: TimeRange): string => RANGE_WORDS[range];

/** Attack-server cells, in degrees. */
export const HEX_CELL_DEG = 8;
/**
 * A cell this close (in degrees) to a busier one joins it, so aggregates
 * rarely overlap at world zoom, where 8° is about 20 px.
 */
export const HEX_MIN_SEPARATION_DEG = 14;
/** AI data centres shown: existing sites with at least this many chips. */
export const DATACENTER_MIN_CHIPS = 20_000;
/** DDoS targets labelled with their share. */
export const DDOS_LABELS = 5;

export type TechLayer = 'ddos' | 'attackers' | 'outages' | 'cloud' | 'datacenters' | 'cables';

/** Red for a major fault or outage, amber for a partial one (spec grammar: no orange on the map). */
export const SEVERITY_STATE: Readonly<Record<string, MarkState>> = {
  OUTAGE_SEVERITY_TOTAL: 'crit',
  OUTAGE_SEVERITY_MAJOR: 'crit',
  OUTAGE_SEVERITY_PARTIAL: 'elev',
};

/** The outage's cause as its glyph; a cause with none of its own is a plain internet outage. */
export function outageGlyph(cause: string): MarkGlyph {
  const c = cause.replace(/_/g, ' ').toUpperCase();
  if (c.includes('POWER')) return 'zap';
  if (c.includes('CABLE')) return 'cable';
  if (c.includes('GOVERNMENT')) return 'ban';
  if (c.includes('MILITARY')) return 'flame';
  if (c.includes('CYBER')) return 'shield-alert';
  return 'wifi-off';
}
const SEVERITY_WORD: Readonly<Record<string, string>> = {
  OUTAGE_SEVERITY_TOTAL: 'Nationwide',
  OUTAGE_SEVERITY_MAJOR: 'Regional',
  OUTAGE_SEVERITY_PARTIAL: 'Network',
};

const PROVIDER_STATUS_ID: Readonly<Record<CloudRegion['provider'], string>> = { aws: 'aws', azure: 'azure', gcp: 'gcp', cloudflare: 'cloudflare' };
const PROVIDER_NAME: Readonly<Record<CloudRegion['provider'], string>> = { aws: 'AWS', azure: 'Azure', gcp: 'Google Cloud', cloudflare: 'Cloudflare' };

const day = (ts: number) => new Date(ts).toISOString().slice(0, 10);
const hhmm = (ts: number) => new Date(ts).toISOString().slice(11, 16);
const pct = (n: number) => `${n.toFixed(1)}%`;

// ---- DDoS targets -------------------------------------------------------------

export type RampTone = 'ramp-1' | 'ramp-2' | 'ramp-3' | 'ramp-4';

/** A share of the busiest target as a step of the shared blue ramp, 1 to 4. */
export function rampTone(share: number, max: number): RampTone {
  const step = Math.min(4, Math.max(1, Math.ceil((4 * share) / (max || 1))));
  return `ramp-${step}` as RampTone;
}

/** A shaded country for the map's `overlays.fills`: the blue ramp step by share of attack traffic. */
export interface DdosFill {
  type: 'Feature';
  geometry: CountryShapes['features'][number]['geometry'];
  properties: { tone: RampTone; id: string; name: string; opacity: number };
}

/** One window of DDoS target shares: Cloudflare's 7-day aggregate or a 6h/24h window from `cf:radar:ddos-windows:v1`. */
export type DdosShares = Pick<ListInternetDdosAttacksResponse, 'topTargetLocations' | 'dateRangeStart' | 'dateRangeEnd'>;

/** The 6 h and 24 h windows the seeder publishes beside the 7-day aggregate; a failed window is absent. */
export interface DdosWindows {
  windows: Partial<Record<'6h' | '24h', DdosShares>>;
}

const isShares = (v: unknown): v is DdosShares =>
  typeof v === 'object' && v !== null && Array.isArray((v as DdosShares).topTargetLocations)
  && typeof (v as DdosShares).dateRangeStart === 'string' && typeof (v as DdosShares).dateRangeEnd === 'string';

export function isDdosWindows(value: unknown): value is DdosWindows {
  const w = (value as DdosWindows | null)?.windows;
  return typeof w === 'object' && w !== null && Object.entries(w).every(([k, v]) => (k === '6h' || k === '24h') && isShares(v));
}

/**
 * The shares for `range`: 7d is Cloudflare's 7-day aggregate; 6h and 24h come
 * only from their own window. Null when that window is not available: the map
 * then names the source instead of shading another window's data.
 */
export function ddosForRange(range: TimeRange, sevenDay: DdosShares | null, windows: DdosWindows | null): DdosShares | null {
  if (range === '7d') return sevenDay;
  return windows?.windows[range] ?? null;
}

export function ddosLayer(resp: DdosShares, shapes: CountryShapes | null, range: TimeRange = '7d'): { fills: FeatureCollectionOf<DdosFill>; tags: LabelMarker[] } {
  const hits = resp.topTargetLocations.filter((h) => h.countryCode && h.percentage > 0);
  const max = hits.reduce((m, h) => Math.max(m, h.percentage), 0) || 1;
  const share = new Map(hits.map((h) => [h.countryCode.toUpperCase(), h]));
  const features: DdosFill[] = [];
  for (const f of shapes?.features ?? []) {
    const iso = featureIso2(f.properties);
    const hit = iso ? share.get(iso) : undefined;
    if (!iso || !hit) continue;
    features.push({ type: 'Feature', geometry: f.geometry, properties: { tone: rampTone(hit.percentage, max), id: iso, name: hit.countryName, opacity: 0.85 } });
  }
  const span = resp.dateRangeStart && resp.dateRangeEnd
    ? `${resp.dateRangeStart.slice(0, 16).replace('T', ' ')} to ${resp.dateRangeEnd.slice(0, 16).replace('T', ' ')} UTC`
    : RANGE_WORDS[range];
  const tags = [...hits]
    .sort((a, b) => b.percentage - a.percentage)
    .slice(0, DDOS_LABELS)
    .filter((h) => Number.isFinite(h.latitude) && Number.isFinite(h.longitude))
    .map((h): LabelMarker => ({
      kind: 'label', id: `ddos:${h.countryCode}`, lat: h.latitude, lon: h.longitude,
      text: `${h.countryCode.toUpperCase()} ${pct(h.percentage)}`,
      title: `${h.countryName}: ${pct(h.percentage)} of layer 3 DDoS attack traffic targets it (Cloudflare Radar)`,
      popup: {
        kind: 'DDoS target · Cloudflare Radar', name: h.countryName, value: pct(h.percentage),
        lines: [{ text: 'Share of layer 3 DDoS attack traffic Cloudflare saw aimed at this country. It shows who is attacked, not where attacks come from.' }, { text: span, style: 'dim' }],
      },
    }));
  return { fills: { type: 'FeatureCollection', features }, tags };
}

// ---- Attack servers -------------------------------------------------------------

const FAMILY_SOURCES = new Set(['CYBER_THREAT_SOURCE_FEODO', 'CYBER_THREAT_SOURCE_URLHAUS', 'CYBER_THREAT_SOURCE_C2INTEL']);

function feedLabel(source: string): string {
  return THREAT_FEED_LABEL[source.replace('CYBER_THREAT_SOURCE_', '').toLowerCase()] ?? source;
}

/**
 * Indicators last seen inside `range` (first seen when no last-seen time).
 * One with no time at all stays at every range, as digest items without a time do.
 */
export function threatsInRange(threats: readonly CyberThreat[], range: TimeRange, now: number): CyberThreat[] {
  const from = now - TIME_RANGE_HOURS[range] * HOUR_MS;
  return threats.filter((t) => {
    const seen = t.lastSeenAt || t.firstSeenAt;
    return !seen || seen >= from;
  });
}

/** Indicators with a location, binned into HEX_CELL_DEG cells; the aggregate sits at the cell's mean point and reaches full size at the busiest cell. */
export function attackHexes(threats: readonly CyberThreat[]): AggregateMarker[] {
  const cells = new Map<string, { lat: number; lon: number; n: number; bySource: Map<string, number>; families: Map<string, number>; countries: Map<string, number> }>();
  for (const t of threats) {
    const loc = t.location;
    if (!loc || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) continue;
    const key = `${Math.floor(loc.latitude / HEX_CELL_DEG)}:${Math.floor(loc.longitude / HEX_CELL_DEG)}`;
    let c = cells.get(key);
    if (!c) {
      c = { lat: 0, lon: 0, n: 0, bySource: new Map(), families: new Map(), countries: new Map() };
      cells.set(key, c);
    }
    c.lat += loc.latitude;
    c.lon += loc.longitude;
    c.n += 1;
    c.bySource.set(t.source, (c.bySource.get(t.source) ?? 0) + 1);
    const family = (t.malwareFamily ?? '').trim();
    if (family && FAMILY_SOURCES.has(t.source)) c.families.set(family, (c.families.get(family) ?? 0) + 1);
    if (t.country) c.countries.set(t.country, (c.countries.get(t.country) ?? 0) + 1);
  }
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
  // Busiest first; a cell near an already kept one folds into it.
  const kept: Array<[string, NonNullable<ReturnType<typeof cells.get>>]> = [];
  const mergeInto = (into: Map<string, number>, from: Map<string, number>) => {
    for (const [k, n] of from) into.set(k, (into.get(k) ?? 0) + n);
  };
  for (const [key, c] of [...cells.entries()].sort((a, b) => b[1].n - a[1].n)) {
    const near = kept.find(([, k]) => Math.hypot(k.lat / k.n - c.lat / c.n, k.lon / k.n - c.lon / c.n) < HEX_MIN_SEPARATION_DEG);
    if (!near) {
      kept.push([key, c]);
      continue;
    }
    // The kept cell stays where it is; only its counts grow.
    const k = near[1];
    const scale = (k.n + c.n) / k.n;
    k.lat *= scale;
    k.lon *= scale;
    k.n += c.n;
    mergeInto(k.bySource, c.bySource);
    mergeInto(k.families, c.families);
    mergeInto(k.countries, c.countries);
  }
  const busiest = kept.reduce((m, [, c]) => Math.max(m, c.n), 0);
  return kept
    .sort((a, b) => b[1].n - a[1].n)
    .map(([key, c]): AggregateMarker => {
      const families = top(c.families);
      const family = families[0]?.[0];
      const lat = c.lat / c.n;
      const lon = c.lon / c.n;
      return {
        kind: 'aggregate', state: 'normal', fill: 'reported', count: c.n, fullAt: busiest, id: `attack:${key}`, lat, lon,
        title: `${c.n} attack-infrastructure indicators located here${family ? `, mostly ${family}` : ''}`,
        popup: {
          kind: 'Attack servers · threat feeds', name: top(c.countries).slice(0, 3).map(([country]) => country).join(', ') || 'Unknown country', value: c.n.toLocaleString('en-US'),
          lines: [
            { text: top(c.bySource).map(([s, n]) => `${feedLabel(s)} ${n}`).join(' · ') },
            { text: families.length ? `Families: ${families.slice(0, 3).map(([f, n]) => `${f} ${n}`).join(', ')}` : 'No family named (OTX and AbuseIPDB carry none)' },
            { text: 'Where attackers’ servers are hosted, located by GeoIP or the country centroid. Not who they hit.', style: 'dim' },
          ],
        },
      };
    });
}

// ---- Outages ----------------------------------------------------------------

/** Ongoing, or ended inside the range: an outage active at any point in it. */
export function outageMarkers(outages: readonly InternetOutage[], now: number, range: TimeRange = '7d'): EventMarker[] {
  const from = now - TIME_RANGE_HOURS[range] * HOUR_MS;
  return outages
    .filter((o) => o.location && (!o.endedAt || o.endedAt >= from))
    .map((o): EventMarker => {
      const live = isOutageLive(o, now);
      const ongoing = !o.endedAt;
      const cause = o.cause ? o.cause.replace(/_/g, ' ').toLowerCase() : 'no stated cause';
      return {
        // Verified by Cloudflare: solid while live, background once it ended over 24 h ago.
        kind: 'event', glyph: outageGlyph(o.cause ?? ''), state: SEVERITY_STATE[o.severity] ?? 'elev', fill: live ? 'solid' : 'background',
        id: `outage:${o.id}`, lat: o.location!.latitude, lon: o.location!.longitude,
        title: `${SEVERITY_WORD[o.severity] ?? 'Internet'} outage in ${o.country}, ${ongoing ? 'ongoing' : 'ended'} (Cloudflare Radar)`,
        popup: {
          kind: 'Internet outage · Cloudflare Radar', name: o.country || 'Unknown country', value: SEVERITY_WORD[o.severity] ?? 'Outage',
          lines: [
            { text: `Stated cause: ${cause}${o.categories.length > 3 ? ` · ${o.categories.slice(3).join(', ')}` : ''}` },
            { text: `Started ${day(o.detectedAt)} ${hhmm(o.detectedAt)} UTC · ${ongoing ? 'ongoing' : `ended ${day(o.endedAt)} ${hhmm(o.endedAt)} UTC`}`, style: 'mono' },
            { text: 'Placed at the country centroid: Cloudflare names the country, not a location.', style: 'dim' },
          ],
        },
      };
    });
}

// ---- Cloud regions ------------------------------------------------------------

const OUTAGE_STATUSES = new Set(['SERVICE_OPERATIONAL_STATUS_PARTIAL_OUTAGE', 'SERVICE_OPERATIONAL_STATUS_MAJOR_OUTAGE']);

/** The region code ("us-east-1") or its name ("N. Virginia") appears in the incident text. */
export function incidentNamesRegion(region: CloudRegion, text: string): boolean {
  if (!text) return false;
  const code = region.id.replace(/^[a-z]+-/, '');
  const lower = text.toLowerCase();
  if (code.length >= 5 && lower.includes(code.toLowerCase())) return true;
  const inner = /\(([^)]+)\)/.exec(region.name)?.[1];
  return [inner, region.city].some((n) => n && n.length >= 4 && lower.includes(n.toLowerCase()));
}

const STATE_RANK: Readonly<Record<MarkState, number>> = { normal: 0, elev: 1, crit: 2 };
const STATE_WORD: Readonly<Record<MarkState, string>> = { normal: 'OK', elev: 'Degraded', crit: 'Named' };

/** The city's asset id: one marker per city, whatever its providers. */
export function cloudCityId(region: Pick<CloudRegion, 'city' | 'country'>): string {
  return `cloud:${`${region.city}-${region.country}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

/**
 * One asset per city (spec grammar: provider clusters become one asset; the
 * providers are in the card). Its state is the worst of its regions: red when
 * an incident names a region there, amber on a provider outage.
 */
export function cloudRegionMarkers(regions: readonly CloudRegion[], statuses: readonly ServiceStatus[]): AssetMarker[] {
  const byId = new Map(statuses.map((s) => [s.id, s]));
  const cities = new Map<string, { lat: number; lon: number; city: string; country: string; rows: Array<{ r: CloudRegion; state: MarkState; status: ServiceStatus | undefined }> }>();
  for (const r of regions) {
    const status = byId.get(PROVIDER_STATUS_ID[r.provider]);
    const out = status ? OUTAGE_STATUSES.has(status.status) : false;
    const named = out && status ? incidentNamesRegion(r, status.description) : false;
    const state: MarkState = named ? 'crit' : out ? 'elev' : 'normal';
    const id = cloudCityId(r);
    const city = cities.get(id) ?? { lat: r.lat, lon: r.lon, city: r.city, country: r.country, rows: [] };
    city.rows.push({ r, state, status });
    cities.set(id, city);
  }
  return [...cities.entries()].map(([id, c]): AssetMarker => {
    const rows = [...c.rows].sort((a, b) => STATE_RANK[b.state] - STATE_RANK[a.state] || a.r.provider.localeCompare(b.r.provider));
    const state = rows[0]!.state;
    const providers = [...new Set(rows.map((row) => row.r.provider))];
    const known = rows.some((row) => row.status);
    const worst = rows[0]!;
    const why = !known ? 'status unknown' : state === 'crit' ? `${PROVIDER_NAME[worst.r.provider]} incident names ${worst.r.name}` : state === 'elev' ? `${PROVIDER_NAME[worst.r.provider]} outage, no region named` : 'operational';
    return {
      // Each provider is a focus key, so a provider's indicator finds its cities (Cloudflare's ids are cf-*).
      kind: 'asset', glyph: 'cloud', state, id, lat: c.lat, lon: c.lon, keys: providers.map((p) => `provider:${p}`),
      title: `${c.city}: ${providers.map((p) => PROVIDER_NAME[p]).join(', ')} · ${why}`,
      popup: {
        kind: 'Cloud region', name: `${c.city}, ${c.country}`, value: known ? STATE_WORD[state] : '—',
        lines: [
          ...rows.map((row) => ({
            text: `${PROVIDER_NAME[row.r.provider]} ${row.r.name}${row.r.zones ? ` · ${row.r.zones} zones` : ''}: ${!row.status ? 'no status' : row.state === 'crit' ? 'incident names this region' : row.state === 'elev' ? 'provider outage' : 'operational'}`,
            style: 'mono' as const,
          })),
          ...(worst.status && worst.state !== 'normal' ? [{ text: `${PROVIDER_NAME[worst.r.provider]} status page: ${worst.status.description || 'no incident text'}` }] : []),
          { text: 'A city turns red only when the incident names its region; otherwise a provider outage shows its cities amber.', style: 'dim' as const },
        ],
      },
    };
  });
}

// ---- AI data centres -----------------------------------------------------------

const SEVERITY_RANK: Readonly<Record<string, number>> = { OUTAGE_SEVERITY_TOTAL: 3, OUTAGE_SEVERITY_MAJOR: 2, OUTAGE_SEVERITY_PARTIAL: 1 };

/** "nationwide, power outage": the outage's type and stated cause, as a data centre's card names them. */
export function outageSummary(o: InternetOutage): string {
  const cause = o.cause ? o.cause.replace(/_/g, ' ').toLowerCase() : 'no stated cause';
  return `${(SEVERITY_WORD[o.severity] ?? 'internet').toLowerCase()}, ${cause}`;
}

/**
 * A background asset (owner's decision, 2026-11-10): grey and underneath,
 * amber when a live internet outage is in the same country. Never red: no
 * source names the site itself, only its country.
 */
export function datacenterMarkers(sites: readonly AIDataCenter[], outages: readonly InternetOutage[], now: number): AssetMarker[] {
  const outageCountries = new Map<string, InternetOutage>();
  for (const o of outages) {
    if (!isOutageLive(o, now)) continue;
    const code = resolveCountryCode(o.country);
    if (!code) continue;
    const held = outageCountries.get(code);
    if (!held || (SEVERITY_RANK[o.severity] ?? 0) > (SEVERITY_RANK[held.severity] ?? 0)) outageCountries.set(code, o);
  }
  return sites
    .filter((d) => d.status === 'existing' && d.chipCount >= DATACENTER_MIN_CHIPS)
    .map((d): AssetMarker => {
      const code = resolveCountryCode(d.country);
      const nearby = code ? outageCountries.get(code) : undefined;
      return {
        kind: 'asset', glyph: 'cpu', state: nearby ? 'elev' : 'normal', id: `dc:${d.id}`, lat: d.lat, lon: d.lon,
        title: `${d.name}${nearby ? `: internet outage in ${nearby.country} (${outageSummary(nearby)})` : ''}`,
        popup: {
          kind: 'AI data centre · Epoch AI', name: d.name, value: `${compactCount(d.chipCount)} chips`,
          lines: [
            { text: `${d.owner} · ${d.country}${d.chipType ? ` · ${d.chipType}` : ''}${d.powerMW ? ` · ${d.powerMW} MW` : ''}` },
            { text: nearby ? `Internet outage in the same country: ${outageSummary(nearby)}, started ${day(nearby.detectedAt)} ${hhmm(nearby.detectedAt)} UTC` : 'No internet outage in the same country' },
            { text: 'Amber means an outage in its country (Cloudflare Radar), not at the site itself.', style: 'dim' },
            { text: 'Epoch AI GPU clusters dataset (CC BY), existing sites with 20,000 chips or more.', style: 'dim' },
          ],
        },
      };
    });
}

// ---- Undersea cables ------------------------------------------------------------

/** A cable for the map's `overlays.lines`: grey when healthy or unknown, amber degraded, red fault. */
export interface CableLine {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: Array<[number, number]> };
  properties: { tone: 'dim' | 'elev' | 'crit'; id: string };
}

const CABLE_TONE: Readonly<Record<string, CableLine['properties']['tone']>> = {
  CABLE_HEALTH_STATUS_FAULT: 'crit',
  CABLE_HEALTH_STATUS_DEGRADED: 'elev',
};

export function cableLayer(cables: readonly UnderseaCable[], health: GetCableHealthResponse | null): { lines: FeatureCollectionOf<CableLine>; markers: EventMarker[] } {
  const records: Record<string, CableHealthRecord> = health?.cables ?? {};
  const lines: CableLine[] = [];
  const markers: EventMarker[] = [];
  for (const c of cables) {
    if (c.points.length < 2) continue;
    const rec = records[c.id];
    const tone = (rec && CABLE_TONE[rec.status]) ?? 'dim';
    lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: c.points.map(([lon, lat]) => [lon, lat] as [number, number]) }, properties: { tone, id: c.id } });
    if (rec && tone !== 'dim') {
      const [lon, lat] = c.points[Math.floor(c.points.length / 2)]!;
      const word = rec.status === 'CABLE_HEALTH_STATUS_FAULT' ? 'Fault' : 'Degraded';
      markers.push({
        kind: 'event', glyph: 'cable', state: tone === 'crit' ? 'crit' : 'elev', fill: 'solid', id: `cable:${c.id}`, lat, lon,
        title: `${c.name}: ${word.toLowerCase()} (NGA navigational warnings)`,
        popup: {
          kind: 'Undersea cable · NGA warnings', name: c.name, value: word,
          lines: [
            ...rec.evidence.slice(0, 2).map((e) => ({ text: `${e.source}: ${e.summary}` })),
            { text: `Confidence ${Math.round(rec.confidence * 100)}% · updated ${day(rec.lastUpdated)}`, style: 'mono' as const },
          ],
        },
      });
    }
  }
  return { lines: { type: 'FeatureCollection', features: lines }, markers };
}

// ---- What each layer shows at the selected range ---------------------------------

/**
 * One line per Tech map layer saying what it shows at `range`: the three time
 * layers change with it, the background assets and cables say they do not
 * (owner's decision, 2026-11-10).
 */
export function techLayerRangeNote(id: TechLayer, range: TimeRange): string {
  switch (id) {
    case 'ddos':
      return `share of attack traffic, ${RANGE_WORDS[range]}`;
    case 'attackers':
      return `indicators seen in the ${RANGE_WORDS[range]}`;
    case 'outages':
      return `outages active in the ${RANGE_WORDS[range]}`;
    case 'cloud':
    case 'datacenters':
      return 'status now; the range does not apply';
    case 'cables':
      return 'warnings in force now; the range does not apply';
  }
}
