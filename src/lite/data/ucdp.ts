import type { UcdpViolenceEvent, UcdpViolenceType } from '@/generated/client/worldmonitor/conflict/v1/service_client';
import type { MapMarker } from '../map/LiteMap';
import { regionOfPoint, severityFromDeaths, type GeoRegion } from './transforms';

/**
 * UCDP events as conflict-map markers, one per exact event location, as the
 * dashboard's UCDP layer draws them. Events UCDP geocodes to the same point
 * share one marker, whose popup lists each of them.
 */

/** Marker ceiling. Each marker is a DOM element, so a full-year fallback payload is trimmed to the deadliest locations. */
export const UCDP_MARKER_LIMIT = 400;
/** Events listed one per line in a shared-location popup. */
const LISTED_EVENTS = 4;

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

const actors = (e: UcdpViolenceEvent): string => [e.sideA, e.sideB].filter(Boolean).join(' vs ') || 'Actors not recorded';

/** UCDP's low–high range beside the best estimate, when it differs. */
function estimate(e: UcdpViolenceEvent): string {
  return e.deathsLow !== e.deathsHigh ? `best estimate ${e.deathsBest}, range ${e.deathsLow}–${e.deathsHigh}` : '';
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
): { markers: MapMarker[]; locations: number } {
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

  const ranked = [...byPoint.entries()]
    .sort((a, b) => b[1].deaths - a[1].deaths || b[1].latest - a[1].latest)
    .slice(0, UCDP_MARKER_LIMIT);

  const markers = ranked.map(([key, loc]): MapMarker => {
    const where = formatCoordinates(loc.lat, loc.lon);
    const sorted = [...loc.events].sort((a, b) => (b.dateStart || 0) - (a.dateStart || 0));
    const base = {
      id: `ucdp:${key}`,
      lat: loc.lat,
      lon: loc.lon,
      tone: severityFromDeaths(loc.deaths),
      radius: 4 + Math.min(8, Math.sqrt(loc.deaths)),
    };
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
            actors(only),
            [eventDates(only), estimate(only)].filter(Boolean).join(' · '),
            where,
            only.sourceOriginal ? `Source: ${only.sourceOriginal}` : '',
          ].filter(Boolean),
        },
      };
    }
    const country = sorted[0]?.country ?? '';
    const more = sorted.length - LISTED_EVENTS;
    return {
      ...base,
      title: `${country}: ${sorted.length} UCDP events, ${deathsText(loc.deaths)} at ${where}`,
      popup: {
        kind: `UCDP · ${sorted.length} events at this point`,
        name: country,
        value: deathsText(loc.deaths),
        lines: [
          where,
          ...sorted
            .slice(0, LISTED_EVENTS)
            .map((e) => `${eventDates(e)} · ${violenceLabel(e.violenceType)} · ${actors(e)} · ${deathsText(e.deathsBest)}`),
          more > 0 ? `${more} more ${more === 1 ? 'event' : 'events'} at this point` : '',
        ].filter(Boolean),
      },
    };
  });

  return { markers, locations: byPoint.size };
}
