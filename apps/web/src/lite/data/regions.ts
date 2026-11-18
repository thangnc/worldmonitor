import type { Bounds } from '../map/view';
import type { GeoRegion } from './transforms';

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
