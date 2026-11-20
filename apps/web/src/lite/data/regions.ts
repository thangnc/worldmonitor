import type { Bounds } from '../map/view';
import type { RegionTile } from './conflict';
import type { FeedState, IndicatorPlace } from './indicators';
import type { GeoRegion, Tone } from './transforms';

/**
 * Named conflict regions, shared by the Briefing's escalation tracker and the
 * Geopolitics region strip (owner's decision, 2026-11-10). Each sits inside one
 * area of the Geopolitics region selector; `bounds` is the map view a strip
 * tile zooms to. The tracker scores a region by its first candidate country
 * that has a CII score; the strip by its curated hotspots' live score.
 */
export interface EscalationRegion {
  id: string;
  name: string;
  countries: readonly string[];
  area: Exclude<GeoRegion, 'all'>;
  bounds: Bounds;
}

export const ESCALATION_REGIONS: readonly EscalationRegion[] = [
  { id: 'red-sea', name: 'Red Sea / Aden', countries: ['YE', 'SA', 'EG'], area: 'middleeast', bounds: [[32, 10], [52, 31]] },
  { id: 'eastern-europe', name: 'Eastern Europe', countries: ['UA', 'RU', 'PL'], area: 'europe', bounds: [[14, 43], [46, 60]] },
  { id: 'levant', name: 'Levant', countries: ['LB', 'SY', 'IL', 'PS'], area: 'middleeast', bounds: [[33, 29], [40, 38]] },
  { id: 'gulf-iran', name: 'Gulf / Iran', countries: ['IR', 'IQ', 'AE', 'QA', 'KW', 'BH', 'OM'], area: 'middleeast', bounds: [[38, 22], [64, 40]] },
  { id: 'sahel', name: 'Sahel', countries: ['ML', 'BF', 'NE', 'NG'], area: 'africa', bounds: [[-18, 8], [25, 22]] },
  { id: 'taiwan-strait', name: 'Taiwan Strait', countries: ['TW', 'CN'], area: 'asia', bounds: [[115, 20], [127, 28]] },
];

export type CiiList = ReadonlyArray<{ region: string; combinedScore: number }>;

/** The first candidate country with a CII score. */
export function leadCountry(countries: readonly string[], scores: CiiList): { country: string; score: number | null } {
  for (const country of countries) {
    const hit = scores.find((s) => s.region === country);
    if (hit) return { country, score: hit.combinedScore };
  }
  return { country: countries[0] ?? '', score: null };
}

const inside = ([[west, south], [east, north]]: Bounds, lat: number, lon: number) => lon >= west && lon <= east && lat >= south && lat <= north;
const area = ([[west, south], [east, north]]: Bounds) => (east - west) * (north - south);

/**
 * The named region a place belongs to: the first region listing one of its
 * countries, else the smallest region whose map view holds its point (the
 * views overlap round the Gulf). Null when it is outside every region.
 */
export function regionOfPlace(place: IndicatorPlace | undefined, regions: readonly EscalationRegion[] = ESCALATION_REGIONS): EscalationRegion | null {
  if (!place) return null;
  const byCountry = regions.find((r) => place.countries?.some((c) => r.countries.includes(c)));
  if (byCountry) return byCountry;
  const { lat, lon } = place;
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return [...regions].filter((r) => inside(r.bounds, lat, lon)).sort((a, b) => area(a.bounds) - area(b.bounds))[0] ?? null;
}

export interface FeedGroup {
  /** A region id, or `other`. */
  id: string;
  name: string;
  /** The region strip's level for the region; none for "Other". */
  level?: { label: string; tone: Tone };
  feeds: FeedState[];
}

/**
 * The Geopolitics indicator panel (owner's decision, 2026-11-19, #116): fired
 * indicators grouped by named region, the region with the highest live
 * hotspot score first (strip order breaks ties, an unscored region goes
 * last), newest first inside a region; fired indicators outside every region
 * under "Other". Quiet, stale, unavailable and loading feeds stay one block,
 * in the order given.
 */
export function groupFeedsByRegion(
  feeds: readonly FeedState[],
  tiles: ReadonlyArray<Pick<RegionTile, 'id' | 'name' | 'level' | 'tone' | 'lead'>>,
  regions: readonly EscalationRegion[] = ESCALATION_REGIONS,
): { groups: FeedGroup[]; rest: FeedState[] } {
  const byRegion = new Map<string, FeedState[]>();
  const rest: FeedState[] = [];
  for (const feed of feeds) {
    if (feed.kind !== 'fired') {
      rest.push(feed);
      continue;
    }
    const id = regionOfPlace(feed.indicator.place, regions)?.id ?? 'other';
    byRegion.set(id, [...(byRegion.get(id) ?? []), feed]);
  }
  const newestFirst = (list: FeedState[]) => list.sort((a, b) => (b.kind === 'fired' ? b.indicator.at : 0) - (a.kind === 'fired' ? a.indicator.at : 0));
  const order = new Map(regions.map((r, i) => [r.id, i]));
  const score = (id: string) => tiles.find((t) => t.id === id)?.lead?.score ?? -1;
  const groups: FeedGroup[] = regions
    .filter((r) => byRegion.has(r.id))
    .sort((a, b) => score(b.id) - score(a.id) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .map((r) => {
      const tile = tiles.find((t) => t.id === r.id);
      return { id: r.id, name: r.name, level: tile?.lead ? { label: tile.level, tone: tile.tone } : undefined, feeds: newestFirst(byRegion.get(r.id)!) };
    });
  const other = byRegion.get('other');
  if (other) groups.push({ id: 'other', name: 'Other', feeds: newestFirst(other) });
  return { groups, rest };
}
