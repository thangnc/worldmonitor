/**
 * Escalation regions shared by the Briefing tracker and the Geopolitics strip.
 * Each region's score is its first candidate country that has a CII score.
 */
export const ESCALATION_REGIONS = [
  { name: 'Red Sea / Aden', countries: ['YE', 'SA', 'EG'] },
  { name: 'Eastern Europe', countries: ['UA', 'RU', 'PL'] },
  { name: 'Levant', countries: ['LB', 'SY', 'IL', 'PS'] },
  { name: 'Sahel', countries: ['ML', 'BF', 'NE', 'NG'] },
  { name: 'Taiwan Strait', countries: ['TW', 'CN'] },
] as const;

export type CiiList = ReadonlyArray<{ region: string; combinedScore: number }>;

/** The first candidate country with a CII score. */
export function leadCountry(countries: readonly string[], scores: CiiList): { country: string; score: number | null } {
  for (const country of countries) {
    const hit = scores.find((s) => s.region === country);
    if (hit) return { country, score: hit.combinedScore };
  }
  return { country: countries[0] ?? '', score: null };
}
