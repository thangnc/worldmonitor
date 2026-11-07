import type { Hotspot } from '@/types';
import type { CiiScore } from '@/generated/client/worldmonitor/intelligence/v1/service_client';
import type { Earthquake } from '@/generated/client/worldmonitor/seismology/v1/service_client';
import type { MilitaryFlight } from '@/generated/client/worldmonitor/military/v1/service_client';
import type { UnrestEvent } from '@/generated/client/worldmonitor/unrest/v1/service_client';
import { matchesAnyKeyword, tokenizeForMatch } from '@/utils/keyword-match';
import {
  computeEscalationScore,
  countMilitaryNearHotspot,
  type DynamicEscalationScore,
} from '../../../shared/analysis-hotspot-escalation';
import { GEO_CONVERGENCE_WINDOW_MS, GeoConvergenceEngine, type GeoEventInput } from '../../../shared/analysis-geo-convergence';
import { earthquakesToGeoEvents, unrestEventsToGeoEvents } from '../../../shared/analysis-mcp-adapters';
import { getHotspotCountryScore } from '../../../shared/hotspot-country-map';
import type { Tone } from './transforms';

/**
 * Live escalation for the curated hotspots, as the dashboard scores them:
 * shared/analysis-hotspot-escalation.ts does the scoring; this module only
 * maps Lite's data onto its inputs. Constants follow the dashboard's wiring.
 */
/** News window: DeckGLMap.updateHotspotActivity counts the last 2 hours. */
export const HOTSPOT_NEWS_WINDOW_MS = 2 * 3_600_000;
/** Convergence radius: src/services/hotspot-escalation.ts getGeoAlertForHotspot. */
export const CONVERGENCE_RADIUS_KM = 150;
/** Military radius: the shared countMilitaryNearHotspot default. */
export const MILITARY_RADIUS_KM = 200;

/** A feed the score reads. A missing feed scores as the shared core scores an absent input. */
export type EscalationFeed = 'news' | 'countryRisk' | 'unrest' | 'earthquakes' | 'militaryFlights';

export const FEED_LABEL: Record<EscalationFeed, string> = {
  news: 'news',
  countryRisk: 'country risk',
  unrest: 'unrest events',
  earthquakes: 'earthquakes',
  militaryFlights: 'military flights',
};

export interface EscalationFeeds {
  news: ReadonlyArray<{ title: string; publishedAt: number }> | null;
  ciiScores: ReadonlyArray<Pick<CiiScore, 'region' | 'combinedScore'>> | null;
  unrest: readonly UnrestEvent[] | null;
  earthquakes: readonly Earthquake[] | null;
  flights: readonly MilitaryFlight[] | null;
}

export interface HotspotEscalation {
  hotspot: Hotspot;
  score: DynamicEscalationScore;
  /** Feeds that were unavailable for this score. */
  missing: EscalationFeed[];
}

function flightPoints(flights: readonly MilitaryFlight[], now: number): GeoEventInput[] {
  const cutoff = now - GEO_CONVERGENCE_WINDOW_MS;
  const out: GeoEventInput[] = [];
  for (const f of flights) {
    const lat = f.location?.latitude;
    const lon = f.location?.longitude;
    if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const time = f.lastSeenAt || now;
    if (time < cutoff) continue;
    out.push({ lat, lon, time });
  }
  return out;
}

export function scoreHotspots(hotspots: readonly Hotspot[], feeds: EscalationFeeds, now: number): HotspotEscalation[] {
  const missing: EscalationFeed[] = [];
  if (!feeds.news) missing.push('news');
  if (!feeds.ciiScores) missing.push('countryRisk');
  if (!feeds.unrest) missing.push('unrest');
  if (!feeds.earthquakes) missing.push('earthquakes');
  if (!feeds.flights) missing.push('militaryFlights');

  const recent = (feeds.news ?? [])
    .filter((n) => now - n.publishedAt >= 0 && now - n.publishedAt < HOTSPOT_NEWS_WINDOW_MS)
    .map((n) => tokenizeForMatch(n.title));

  const cii = new Map((feeds.ciiScores ?? []).map((s) => [s.region.toUpperCase(), s.combinedScore]));
  const ciiLookup = (code: string): number | null => cii.get(code.toUpperCase()) ?? null;

  const flights = flightPoints(feeds.flights ?? [], now);
  const engine = new GeoConvergenceEngine({ now: () => now });
  engine.ingestEvents(unrestEventsToGeoEvents({ events: feeds.unrest ?? [] }, { now }), 'protest');
  engine.ingestEvents(earthquakesToGeoEvents({ earthquakes: feeds.earthquakes ?? [] }, { now }), 'earthquake');
  engine.ingestEvents(flights, 'military_flight');

  return hotspots.map((hotspot) => {
    const newsMatches = recent.filter((tokens) => matchesAnyKeyword(tokens, hotspot.keywords)).length;
    const nearby = engine.alertsNear(hotspot.lat, hotspot.lon, CONVERGENCE_RADIUS_KM);
    const score = computeEscalationScore(
      hotspot,
      {
        newsMatches,
        hasBreaking: newsMatches > 0,
        // Matches per hour over the 2-hour window, as the dashboard computes it.
        newsVelocity: newsMatches / 2,
        ciiScore: getHotspotCountryScore(hotspot.id, ciiLookup),
        geoAlertScore: nearby?.score ?? 0,
        geoAlertTypes: nearby?.types ?? 0,
        flightsNearby: countMilitaryNearHotspot(hotspot, flights, [], MILITARY_RADIUS_KM).flights,
        // The dashboard's vessel feed is not loaded in Lite.
        vesselsNearby: 0,
      },
      { now },
    );
    return { hotspot, score, missing };
  });
}

/**
 * The dashboard's display levels (MapPopup.ts): the live score rounded, 5 critical,
 * 4 high, 3 elevated, 2 watch, 1 stable. Every hotspot is drawn, as on the
 * dashboard; `named` marks the levels that also show their name on the map.
 */
export function escalationLevel(score: number): { tone: Tone; label: string; named: boolean } {
  const level = Math.round(score);
  if (level >= 5) return { tone: 'crit', label: 'Critical', named: true };
  if (level === 4) return { tone: 'high', label: 'High', named: true };
  if (level === 3) return { tone: 'elev', label: 'Elevated', named: true };
  if (level === 2) return { tone: 'muted', label: 'Watch', named: false };
  return { tone: 'muted', label: 'Stable', named: false };
}
