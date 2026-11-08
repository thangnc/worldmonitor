/**
 * The Technology screen's "Infrastructure & cyber map" (spec: Screen design ›
 * Technology & AI). Pure rules from the feeds to map layers:
 *
 * - DDoS targets: country shading by share of attack traffic (who is attacked).
 * - Attack servers: threat indicators binned into 8° cells (where attackers'
 *   servers sit), each a hexagon with its count and main malware family.
 * - Outages: Cloudflare outages of the last 7 days at the country centroid.
 * - Cloud regions: a provider's partial or major outage turns all its regions
 *   amber; a region turns red only when the incident text names it.
 * - AI data centres: amber when an internet outage is in the same country.
 * - Undersea cables: coloured by cable health (ok, degraded, fault).
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
import type { GlyphMarker, MapArea, MapLine } from '../map/LiteMap';
import { compactCount } from '../map/view';
import { THREAT_FEED_LABEL, isOutageLive } from './tech-indicators';

const DAY_MS = 86_400_000;

/** Outages on the map: detected in this many days, or still ongoing. */
export const MAP_OUTAGE_DAYS = 7;
/** Attack-server cells, in degrees. */
export const HEX_CELL_DEG = 8;
/** AI data centres shown: existing sites with at least this many chips. */
export const DATACENTER_MIN_CHIPS = 20_000;
/** DDoS targets labelled with their share. */
export const DDOS_LABELS = 5;

export type TechLayer = 'ddos' | 'attackers' | 'outages' | 'cloud' | 'datacenters' | 'cables';

const SEVERITY_TONE: Readonly<Record<string, GlyphMarker['tone']>> = {
  OUTAGE_SEVERITY_TOTAL: 'crit',
  OUTAGE_SEVERITY_MAJOR: 'high',
  OUTAGE_SEVERITY_PARTIAL: 'elev',
};
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

export function ddosLayer(resp: ListInternetDdosAttacksResponse): { areas: MapArea[]; tags: GlyphMarker[] } {
  const hits = resp.topTargetLocations.filter((h) => h.countryCode && h.percentage > 0);
  const max = hits.reduce((m, h) => Math.max(m, h.percentage), 0) || 1;
  const areas = hits.map((h) => ({ code: h.countryCode.toUpperCase(), tone: 'tech' as const, opacity: 0.18 + 0.5 * (h.percentage / max) }));
  const range = resp.dateRangeStart && resp.dateRangeEnd ? `${resp.dateRangeStart.slice(0, 10)} to ${resp.dateRangeEnd.slice(0, 10)}` : 'last 7 days';
  const tags = [...hits]
    .sort((a, b) => b.percentage - a.percentage)
    .slice(0, DDOS_LABELS)
    .filter((h) => Number.isFinite(h.latitude) && Number.isFinite(h.longitude))
    .map((h): GlyphMarker => ({
      kind: 'glyph', shape: 'tag', tone: 'tech', id: `ddos:${h.countryCode}`, lat: h.latitude, lon: h.longitude,
      text: `${h.countryCode.toUpperCase()} ${pct(h.percentage)}`,
      title: `${h.countryName}: ${pct(h.percentage)} of layer 3 DDoS attack traffic targets it (Cloudflare Radar)`,
      popup: {
        kind: 'DDoS target · Cloudflare Radar', name: h.countryName, value: pct(h.percentage),
        lines: [{ text: 'Share of layer 3 DDoS attack traffic Cloudflare saw aimed at this country. It shows who is attacked, not where attacks come from.' }, { text: range, style: 'dim' }],
      },
    }));
  return { areas, tags };
}

// ---- Attack servers -------------------------------------------------------------

const FAMILY_SOURCES = new Set(['CYBER_THREAT_SOURCE_FEODO', 'CYBER_THREAT_SOURCE_URLHAUS', 'CYBER_THREAT_SOURCE_C2INTEL']);

function feedLabel(source: string): string {
  return THREAT_FEED_LABEL[source.replace('CYBER_THREAT_SOURCE_', '').toLowerCase()] ?? source;
}

/** Indicators with a location, binned into HEX_CELL_DEG cells; the hexagon sits at the cell's mean point. */
export function attackHexes(threats: readonly CyberThreat[]): GlyphMarker[] {
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
  return [...cells.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .map(([key, c], rank): GlyphMarker => {
      const families = top(c.families);
      const family = families[0]?.[0];
      const lat = c.lat / c.n;
      const lon = c.lon / c.n;
      return {
        kind: 'glyph', shape: 'hex', tone: 'muted', id: `attack:${key}`, lat, lon,
        text: compactCount(c.n),
        // Only the busiest cells carry a family name, so labels do not crowd the map.
        label: rank < 4 && family ? families.slice(0, 2).map(([f]) => f).join(' · ') : undefined,
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

export function outageMarkers(outages: readonly InternetOutage[], now: number): GlyphMarker[] {
  return outages
    .filter((o) => o.location && (!o.endedAt || o.detectedAt >= now - MAP_OUTAGE_DAYS * DAY_MS))
    .map((o): GlyphMarker => {
      const live = isOutageLive(o, now);
      const ongoing = !o.endedAt;
      const cause = o.cause ? o.cause.replace(/_/g, ' ').toLowerCase() : 'no stated cause';
      return {
        kind: 'glyph', shape: 'dot', tone: SEVERITY_TONE[o.severity] ?? 'elev', hollow: !live,
        id: `outage:${o.id}`, lat: o.location!.latitude, lon: o.location!.longitude,
        label: live ? o.country : undefined,
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
  const code = region.id.replace(/^(aws|gcp|azure|cloudflare)-/, '');
  const lower = text.toLowerCase();
  if (code.length >= 5 && lower.includes(code.toLowerCase())) return true;
  const inner = /\(([^)]+)\)/.exec(region.name)?.[1];
  return [inner, region.city].some((n) => n && n.length >= 4 && lower.includes(n.toLowerCase()));
}

export function cloudRegionMarkers(regions: readonly CloudRegion[], statuses: readonly ServiceStatus[]): GlyphMarker[] {
  const byId = new Map(statuses.map((s) => [s.id, s]));
  return regions.map((r): GlyphMarker => {
    const status = byId.get(PROVIDER_STATUS_ID[r.provider]);
    const out = status ? OUTAGE_STATUSES.has(status.status) : false;
    const named = out && status ? incidentNamesRegion(r, status.description) : false;
    const tone: GlyphMarker['tone'] = named ? 'crit' : out ? 'elev' : 'muted';
    const provider = PROVIDER_NAME[r.provider];
    const state = !status ? 'status unknown' : named ? 'incident names this region' : out ? `${provider} outage, no region named` : 'operational';
    return {
      kind: 'glyph', shape: 'square', tone, hollow: tone === 'muted', id: `cloud:${r.id}`, lat: r.lat, lon: r.lon,
      title: `${provider} ${r.name}: ${state}`,
      popup: {
        kind: `Cloud region · ${provider}`, name: r.name, value: named ? 'Named' : out ? 'Degraded' : status ? 'OK' : '—',
        lines: [
          { text: `${r.city}, ${r.country}${r.zones ? ` · ${r.zones} zones` : ''}` },
          { text: status ? `${provider} status page: ${status.description || 'no incident text'}` : 'No status for this provider', style: status ? 'mono' : 'dim' },
          { text: 'A region turns red only when the incident names it; otherwise a provider outage shows every region amber.', style: 'dim' },
        ],
      },
    };
  });
}

// ---- AI data centres -----------------------------------------------------------

export function datacenterMarkers(sites: readonly AIDataCenter[], outages: readonly InternetOutage[], now: number): GlyphMarker[] {
  const outageCountries = new Map<string, InternetOutage>();
  for (const o of outages) {
    if (!isOutageLive(o, now)) continue;
    const code = resolveCountryCode(o.country);
    if (code) outageCountries.set(code, o);
  }
  return sites
    .filter((d) => d.status === 'existing' && d.chipCount >= DATACENTER_MIN_CHIPS)
    .map((d): GlyphMarker => {
      const code = resolveCountryCode(d.country);
      const nearby = code ? outageCountries.get(code) : undefined;
      return {
        kind: 'glyph', shape: 'site', tone: nearby ? 'elev' : 'muted', id: `dc:${d.id}`, lat: d.lat, lon: d.lon,
        title: `${d.name}${nearby ? `: internet outage in ${nearby.country}` : ''}`,
        popup: {
          kind: 'AI data centre · Epoch AI', name: d.name, value: `${compactCount(d.chipCount)} chips`,
          lines: [
            { text: `${d.owner} · ${d.country}${d.chipType ? ` · ${d.chipType}` : ''}${d.powerMW ? ` · ${d.powerMW} MW` : ''}` },
            { text: nearby ? `Internet outage in the same country: ${(SEVERITY_WORD[nearby.severity] ?? 'outage').toLowerCase()}, started ${day(nearby.detectedAt)}` : 'No internet outage in the same country' },
            { text: 'Epoch AI GPU clusters dataset (CC BY), existing sites with 20,000 chips or more.', style: 'dim' },
          ],
        },
      };
    });
}

// ---- Undersea cables ------------------------------------------------------------

const CABLE_TONE: Readonly<Record<string, MapLine['tone']>> = {
  CABLE_HEALTH_STATUS_FAULT: 'crit',
  CABLE_HEALTH_STATUS_DEGRADED: 'elev',
};

export function cableLayer(cables: readonly UnderseaCable[], health: GetCableHealthResponse | null): { lines: MapLine[]; markers: GlyphMarker[] } {
  const records: Record<string, CableHealthRecord> = health?.cables ?? {};
  const lines: MapLine[] = [];
  const markers: GlyphMarker[] = [];
  for (const c of cables) {
    if (c.points.length < 2) continue;
    const rec = records[c.id];
    const tone = (rec && CABLE_TONE[rec.status]) ?? 'dim';
    lines.push({ id: c.id, coords: c.points, tone, width: tone === 'dim' ? 1 : 2 });
    if (rec && tone !== 'dim') {
      const [lon, lat] = c.points[Math.floor(c.points.length / 2)]!;
      const word = rec.status === 'CABLE_HEALTH_STATUS_FAULT' ? 'Fault' : 'Degraded';
      markers.push({
        kind: 'glyph', shape: 'dot', tone, id: `cable:${c.id}`, lat, lon,
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
  return { lines, markers };
}
