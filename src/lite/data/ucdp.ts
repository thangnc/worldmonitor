import type { UcdpViolenceEvent, UcdpViolenceType } from '@/generated/client/worldmonitor/conflict/v1/service_client';
import type { UcdpMarker } from '../map/LiteMap';
import { regionOfPoint, type GeoRegion } from './transforms';

/**
 * UCDP events as conflict-map markers, one per exact event location, as the
 * dashboard's UCDP layer draws them. Events UCDP geocodes to the same point
 * share one marker, whose popup lists each of them. The map clusters nearby
 * locations by zoom (src/lite/map/LiteMap.tsx), so only visible ones become
 * DOM elements and no location is dropped.
 */

/** Sources named in a shared-location card before "and N more". */
const LISTED_SOURCES = 2;

const VIOLENCE_LABEL: Record<UcdpViolenceType, string> = {
  UCDP_VIOLENCE_TYPE_STATE_BASED: 'State-based',
  UCDP_VIOLENCE_TYPE_NON_STATE: 'Non-state',
  UCDP_VIOLENCE_TYPE_ONE_SIDED: 'One-sided',
  UCDP_VIOLENCE_TYPE_UNSPECIFIED: 'Unspecified',
};

export function violenceLabel(type: UcdpViolenceType): string {
  return VIOLENCE_LABEL[type] ?? VIOLENCE_LABEL.UCDP_VIOLENCE_TYPE_UNSPECIFIED;
}

/** `13.580°N, 44.021°E` */
export function formatCoordinates(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(3)}°${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(3)}°${lon < 0 ? 'W' : 'E'}`;
}

const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The event's UTC date, or its date range when it spans several days. */
export function eventDates(e: Pick<UcdpViolenceEvent, 'dateStart' | 'dateEnd'>): string {
  if (!e.dateStart) return 'Date unknown';
  return e.dateEnd && day(e.dateEnd) !== day(e.dateStart) ? `${day(e.dateStart)} to ${day(e.dateEnd)}` : day(e.dateStart);
}

const deathsText = (n: number): string => `${n.toLocaleString('en-US')} ${n === 1 ? 'death' : 'deaths'}`;

/**
 * UCDP codes an actor it has no credible identity for as "XXX" plus the
 * country's Gleditsch–Ward number (UCDP Candidate codebook), e.g. XXX100 in
 * Colombia. Say what the code means and keep it for reference.
 */
export function actorName(name: string): string {
  const code = name.trim();
  return /^XXX\d*$/.test(code) ? `Unidentified group (UCDP ${code})` : name;
}

const actors = (e: UcdpViolenceEvent): string => [e.sideA, e.sideB].filter(Boolean).map(actorName).join(' vs ') || 'Actors not recorded';

/** Each distinct value with its count, most frequent first. */
function tally(values: readonly string[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/** First to last day of the events at one point. */
export function eventSpan(events: readonly Pick<UcdpViolenceEvent, 'dateStart' | 'dateEnd'>[]): string {
  const starts = events.map((e) => e.dateStart).filter((t) => t > 0);
  if (!starts.length) return 'Dates unknown';
  const first = Math.min(...starts);
  const last = Math.max(...events.map((e) => Math.max(e.dateStart || 0, e.dateEnd || 0)));
  return day(first) === day(last) ? day(first) : `${day(first)} to ${day(last)}`;
}

/** UCDP's low–high range beside the best estimate, when it differs. */
function estimate(e: UcdpViolenceEvent): string {
  return e.deathsLow !== e.deathsHigh ? `Best estimate ${e.deathsBest}, range ${e.deathsLow}–${e.deathsHigh}` : '';
}

interface Location {
  lat: number;
  lon: number;
  events: UcdpViolenceEvent[];
  deaths: number;
  latest: number;
}

export function ucdpMarkers(
  events: readonly UcdpViolenceEvent[],
  region: GeoRegion,
): { markers: UcdpMarker[]; locations: number } {
  const byPoint = new Map<string, Location>();
  for (const e of events) {
    const lat = e.location?.latitude;
    const lon = e.location?.longitude;
    if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (region !== 'all' && regionOfPoint(lat, lon) !== region) continue;
    const key = `${lat},${lon}`;
    const loc = byPoint.get(key) ?? { lat, lon, events: [], deaths: 0, latest: 0 };
    loc.events.push(e);
    loc.deaths += e.deathsBest || 0;
    loc.latest = Math.max(loc.latest, e.dateStart || 0);
    byPoint.set(key, loc);
  }

  const ranked = [...byPoint.entries()].sort((a, b) => b[1].deaths - a[1].deaths || b[1].latest - a[1].latest);

  const markers = ranked.map(([key, loc]): UcdpMarker => {
    const where = formatCoordinates(loc.lat, loc.lon);
    const sorted = [...loc.events].sort((a, b) => (b.dateStart || 0) - (a.dateStart || 0));
    const base = { kind: 'ucdp' as const, id: `ucdp:${key}`, lat: loc.lat, lon: loc.lon, deaths: loc.deaths };
    const [only] = sorted;
    if (only && sorted.length === 1) {
      return {
        ...base,
        title: `${only.country}, ${eventDates(only)}: ${deathsText(only.deathsBest)}, ${actors(only)}`,
        popup: {
          kind: `UCDP · ${violenceLabel(only.violenceType)} violence`,
          name: only.country,
          value: deathsText(only.deathsBest),
          lines: [
            { text: actors(only) },
            { text: `${eventDates(only)} · ${where}`, style: 'mono' as const },
            { text: estimate(only), style: 'dim' as const },
            { text: only.sourceOriginal ? `Source: ${only.sourceOriginal}` : '', style: 'dim' as const },
          ].filter((line) => line.text),
        },
      };
    }
    // Two or more events at one point: a summary that fits the card without scrolling.
    const country = sorted[0]?.country ?? '';
    const types = tally(sorted.map((e) => violenceLabel(e.violenceType)));
    const pairs = tally(sorted.map(actors));
    const sources = tally(sorted.map((e) => e.sourceOriginal).filter(Boolean)).map(([source]) => source);
    const [topPair] = pairs;
    const extraSources = sources.length - LISTED_SOURCES;
    return {
      ...base,
      title: `${country}: ${sorted.length} UCDP events, ${deathsText(loc.deaths)}, ${eventSpan(sorted)} at ${where}`,
      popup: {
        kind: `UCDP · ${sorted.length} events at this point`,
        name: country,
        value: deathsText(loc.deaths),
        lines: [
          { text: `${eventSpan(sorted)} · ${where}`, style: 'mono' as const },
          { text: types.length === 1 ? `${types[0]?.[0]} violence` : types.map(([t, n]) => `${t} ×${n}`).join(' · ') },
          {
            text: !topPair
              ? ''
              : pairs.length === 1
                ? topPair[0]
                : `${topPair[0]} ×${topPair[1]}, and ${pairs.length - 1} other actor ${pairs.length === 2 ? 'pair' : 'pairs'}`,
          },
          {
            text: sources.length
              ? `Sources: ${sources.slice(0, LISTED_SOURCES).join('; ')}${extraSources > 0 ? ` and ${extraSources} more` : ''}`
              : '',
            style: 'dim' as const,
          },
        ].filter((line) => line.text),
      },
    };
  });

  return { markers, locations: byPoint.size };
}

/** UCDP's newest event start, or 0 when there is none. */
export function ucdpNewest(events: readonly UcdpViolenceEvent[]): number {
  return events.reduce((max, e) => Math.max(max, e.dateStart || 0), 0);
}

/**
 * UCDP is the map's verified background (owner's design, 2026-11-08): a
 * delayed release, weeks behind, shown whatever the time range, so the label
 * names how far it reaches.
 */
export function ucdpBackgroundLabel(newest: number): string {
  return newest > 0 ? `UCDP to ${day(newest)} · verified background` : 'UCDP · verified background';
}
