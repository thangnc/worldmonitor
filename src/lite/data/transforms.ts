/**
 * Pure transforms behind the Lite widgets. No DOM, no fetch: node:test covers
 * them in tests/lite-ui-transforms.test.mts.
 *
 * Every rule here is a labelled heuristic shown as "Derived" in the UI, never
 * presented as a confirmed fact (docs/engineering/architecture/lite.md, "Lite UI").
 */
import type { ListFeedDigestResponse, NewsItem } from '@/generated/client/worldmonitor/news/v1/service_client';
import { getSourceType } from '../../../shared/source-provenance';
import { MIN_CORROBORATING_PUBLISHERS } from '../../../shared/publisher-families.js';
import { getSourceTier } from '../../../server/_shared/source-tiers';
import { assessCorroboration, evidenceFromItem, type Corroboration } from '../../../server/_shared/corroboration';
import { SIMILARITY_THRESHOLD, jaccardSimilarity, tokenize } from '../../../shared/text-analysis-core.js';

export type Tone = 'crit' | 'high' | 'elev' | 'ok' | 'muted' | 'dim';

export interface LiteItem extends NewsItem {
  category: string;
}

/** Flattens digest buckets, keeps the bucket name, and drops repeated titles. */
export function digestItems(digest: ListFeedDigestResponse | null | undefined, categories?: readonly string[]): LiteItem[] {
  if (!digest?.categories) return [];
  const seen = new Set<string>();
  const out: LiteItem[] = [];
  const names = categories ?? Object.keys(digest.categories);
  for (const category of names) {
    for (const item of digest.categories[category]?.items ?? []) {
      const key = item.title.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ ...item, category });
    }
  }
  return out;
}

/**
 * Drops near-duplicate headlines: one story filed under several buckets, or
 * rewritten by several outlets. Uses the dashboard's own title similarity
 * (Jaccard over tokens, shared/text-analysis-core.js). Input order decides
 * which copy survives, so sort first.
 */
export function dropNearDuplicates<T extends { title: string }>(items: readonly T[]): T[] {
  const kept: Array<{ item: T; tokens: Set<string> }> = [];
  for (const item of items) {
    const tokens = tokenize(item.title);
    if (kept.some((k) => jaccardSimilarity(tokens, k.tokens) >= SIMILARITY_THRESHOLD)) continue;
    kept.push({ item, tokens });
  }
  return kept.map((k) => k.item);
}

export function byImportance(a: NewsItem, b: NewsItem): number {
  return (b.importanceScore || 0) - (a.importanceScore || 0) || (b.publishedAt || 0) - (a.publishedAt || 0);
}

/**
 * Reports on the story: the larger of the two counts the digest carries. A
 * volume figure; the corroboration verdict counts publishers (corroborationOf).
 */
export function sourceCount(item: NewsItem): number {
  return Math.max(1, item.storyMeta?.sourceCount ?? 0, item.corroborationCount ?? 0);
}

/** Tier 1 in shared/source-tiers.json: wires, official bodies, and some major outlets and public broadcasters. */
export function isPrimarySource(sourceName: string): boolean {
  return getSourceTier(sourceName) === 1;
}

export type CorroborationState = Corroboration['state'];

/**
 * The dashboard's corroboration verdict for one digest item
 * (server/_shared/corroboration.ts), so Lite and the full dashboard never
 * disagree. It counts publisher families from the digest's origin-aware
 * corroborationCount and describes coverage, not accuracy. Tier 1 is not part
 * of it: isPrimarySource is shown beside it.
 */
export function corroborationOf(item: NewsItem): Corroboration {
  return assessCorroboration(evidenceFromItem(item));
}

/** Publishers behind the verdict; null when the digest carried no count. */
export function publisherCount(c: Corroboration): number | null {
  return c.state === 'unknown' ? null : c.publishers;
}

/** Wording for each verdict: `label` in tables and pills, `tag` in the timeline. */
export const CORROBORATION_VIEW: Record<CorroborationState, { label: string; tag: string; tone: Tone }> = {
  corroborated: { label: 'Corroborated', tag: 'CORROBORATED', tone: 'ok' },
  'single-publisher': { label: 'Single publisher', tag: 'SINGLE PUBLISHER', tone: 'high' },
  'tier4-only': { label: 'Low-tier only', tag: 'LOW-TIER ONLY', tone: 'high' },
  unknown: { label: 'No count', tag: 'NO COUNT', tone: 'dim' },
};

/** The rule as one sentence, for footers and DerivedTag tooltips. */
export const CORROBORATION_RULE =
  `Corroborated = ${MIN_CORROBORATING_PUBLISHERS}+ publishers (one newsroom's feeds and reprints count once); Single publisher = one; Low-tier only = every publisher is an aggregator or blog; No count = the digest carried none. Coverage, not accuracy.`;

/** Digest credibilityScore (0–100) as a word. */
export function confidenceLabel(credibility: number): { label: string; tone: Tone } {
  if (credibility >= 70) return { label: 'High', tone: 'ok' };
  if (credibility >= 45) return { label: 'Medium', tone: 'high' };
  return { label: 'Low', tone: 'muted' };
}

export function threatTone(level: string | undefined): Tone {
  switch (level) {
    case 'THREAT_LEVEL_CRITICAL': return 'crit';
    case 'THREAT_LEVEL_HIGH': return 'high';
    case 'THREAT_LEVEL_MEDIUM': return 'elev';
    default: return 'dim';
  }
}

export function threatRank(level: string | undefined): number {
  return ['THREAT_LEVEL_LOW', 'THREAT_LEVEL_MEDIUM', 'THREAT_LEVEL_HIGH', 'THREAT_LEVEL_CRITICAL'].indexOf(level ?? '') + 1;
}

export function phaseLabel(phase: string | undefined): string {
  switch (phase) {
    case 'STORY_PHASE_BREAKING': return 'breaking';
    case 'STORY_PHASE_DEVELOPING': return 'developing';
    case 'STORY_PHASE_SUSTAINED': return 'sustained';
    case 'STORY_PHASE_FADING': return 'fading';
    default: return '';
  }
}

export type GeoRegion = 'all' | 'middleeast' | 'europe' | 'africa' | 'asia';

export const GEO_REGION_LABEL: Record<Exclude<GeoRegion, 'all'>, string> = {
  middleeast: 'Middle East',
  europe: 'Europe',
  africa: 'Africa',
  asia: 'Asia-Pacific',
};

/** Digest buckets that feed the Geopolitics screen. Regional buckets carry their region. */
export const GEO_CATEGORIES = ['middleeast', 'europe', 'africa', 'asia', 'crisis', 'intel', 'politics', 'gov'] as const;

export function regionOfCategory(category: string): Exclude<GeoRegion, 'all'> | null {
  return category === 'middleeast' || category === 'europe' || category === 'africa' || category === 'asia' ? category : null;
}

/** Coarse region for a map point, Middle East first so the Levant and Gulf land there. */
export function regionOfPoint(lat: number, lon: number): GeoRegion | null {
  if (lat >= 12 && lat <= 42 && lon >= 25 && lon <= 63) return 'middleeast';
  if (lat >= 35 && lat <= 72 && lon >= -25 && lon <= 45) return 'europe';
  if (lat >= -36 && lat <= 37 && lon >= -20 && lon <= 52) return 'africa';
  if (lon >= 60 && lon <= 180 && lat >= -50) return 'asia';
  return null;
}

export interface EvidenceClass {
  key: string;
  label: string;
  color: string;
  share: number;
  count: number;
}

const EVIDENCE_CLASSES = [
  { key: 'primary', label: 'Primary / official', color: 'var(--color-ok)' },
  { key: 'wire', label: 'Wire services', color: 'var(--color-grey)' },
  { key: 'specialist', label: 'Specialist & think tanks', color: 'var(--color-dim)' },
  { key: 'major', label: 'Major outlets', color: 'var(--color-high)' },
  { key: 'other', label: 'Aggregators & unrated', color: 'var(--color-faint)' },
] as const;

export function evidenceClassOf(sourceName: string): (typeof EVIDENCE_CLASSES)[number]['key'] {
  const type = getSourceType(sourceName);
  if (type === 'gov') return 'primary';
  if (type === 'wire') return 'wire';
  const tier = getSourceTier(sourceName);
  if (type === 'intel' || tier === 3) return 'specialist';
  if (tier === 1 || tier === 2) return 'major';
  return 'other';
}

/** Share of reports per source class, from shared/source-provenance.ts types and source tiers. */
export function evidenceMix(items: readonly NewsItem[]): EvidenceClass[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = evidenceClassOf(item.source);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = items.length;
  return EVIDENCE_CLASSES.map((c) => {
    const count = counts.get(c.key) ?? 0;
    return { ...c, count, share: total ? count / total : 0 };
  });
}

/** Report counts in equal time buckets ending now (the map's time scrubber). */
export function timeBuckets(timestamps: readonly number[], now: number, hours: number, buckets: number): number[] {
  const span = hours * 3_600_000;
  const out = new Array<number>(buckets).fill(0);
  for (const t of timestamps) {
    const age = now - t;
    if (!(age >= 0 && age < span)) continue;
    const index = buckets - 1 - Math.floor((age / span) * buckets);
    out[index] = (out[index] ?? 0) + 1;
  }
  return out;
}

export function pctChange(from: number, to: number): number | null {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

/** CII combined score (0–100) to the region strip's status words. */
export function escalationStatus(score: number | null | undefined): { label: string; tone: Tone } {
  if (score == null || !Number.isFinite(score)) return { label: 'Not in CII', tone: 'dim' };
  if (score >= 70) return { label: 'Critical', tone: 'crit' };
  if (score >= 55) return { label: 'High', tone: 'high' };
  if (score >= 40) return { label: 'Elevated', tone: 'elev' };
  return { label: 'Low', tone: 'dim' };
}

/** UCDP best-estimate deaths to a marker severity. */
export function severityFromDeaths(deaths: number): Tone {
  if (deaths >= 25) return 'crit';
  if (deaths >= 5) return 'high';
  if (deaths >= 1) return 'elev';
  return 'dim';
}

export type AlertState = 'triggered' | 'watching' | 'normal';

/** One threshold rule: |value| at or past `trigger` fires, past `watch` is watched. */
export function thresholdState(value: number | null | undefined, watch: number, trigger: number): AlertState | null {
  if (value == null || !Number.isFinite(value)) return null;
  const v = Math.abs(value);
  if (v >= trigger) return 'triggered';
  if (v >= watch) return 'watching';
  return 'normal';
}

/** Fear & greed extremes: ≤20 or ≥80 fires, ≤30 or ≥70 is watched. */
export function fearGreedState(score: number | null | undefined): AlertState | null {
  if (score == null || !Number.isFinite(score) || score <= 0) return null;
  if (score <= 20 || score >= 80) return 'triggered';
  if (score <= 30 || score >= 70) return 'watching';
  return 'normal';
}

/** Market-moving event tag from the finance digest bucket. */
export function marketTag(category: string): { label: string; tone: 'geo' | 'fin' | 'dim' } {
  switch (category) {
    case 'commodities': return { label: 'OIL & COMMOD.', tone: 'geo' };
    case 'crypto': return { label: 'CRYPTO', tone: 'fin' };
    case 'centralbanks':
    case 'bonds':
    case 'economic': return { label: 'RATES', tone: 'fin' };
    case 'forex': return { label: 'FX', tone: 'fin' };
    case 'ipo': return { label: 'CORPORATE', tone: 'fin' };
    default: return { label: 'MARKETS', tone: 'dim' };
  }
}

/**
 * Takes the asset classes in turns (rates, commodities, crypto, FX,
 * corporate, markets), so the importance score, which rates geopolitical
 * impact, cannot fill the list with one class. Classes keep input order
 * among themselves and start in the order their first item appears.
 */
export function interleaveByMarketTag(items: readonly LiteItem[]): LiteItem[] {
  const groups = new Map<string, LiteItem[]>();
  for (const item of items) {
    const label = marketTag(item.category).label;
    const group = groups.get(label);
    if (group) group.push(item);
    else groups.set(label, [item]);
  }
  const queues = [...groups.values()];
  const rounds = Math.max(0, ...queues.map((queue) => queue.length));
  const out: LiteItem[] = [];
  for (let round = 0; round < rounds; round++) {
    for (const queue of queues) {
      const next = queue[round];
      if (next) out.push(next);
    }
  }
  return out;
}

/**
 * War, strike and attack stories that feeds file under market buckets. The
 * Geopolitics screen carries them; the finance list leaves them out. Sanctions
 * and trade stories are classed `economic` and stay.
 */
export function isWarStory(item: NewsItem): boolean {
  const category = item.threat?.category;
  return category === 'conflict' || category === 'military' || category === 'terrorism';
}

export const MARKET_CATEGORIES = ['markets', 'commodities', 'crypto', 'centralbanks', 'economic', 'bonds', 'forex', 'derivatives', 'fin-regulation', 'ipo'] as const;

export type TechFilter = 'all' | 'models' | 'policy' | 'research' | 'infra';

/** Tech digest buckets per topbar filter. Research has no digest bucket; think tanks stand in. */
export const TECH_FILTER_CATEGORIES: Record<Exclude<TechFilter, 'all'>, readonly string[]> = {
  models: ['ai', 'github'],
  policy: ['policy'],
  research: ['thinktanks'],
  infra: ['hardware', 'cloud', 'outages'],
};

export const TECH_CATEGORIES = ['ai', 'policy', 'security', 'outages', 'hardware', 'cloud', 'github', 'funding', 'thinktanks'] as const;

export function techType(category: string): string {
  switch (category) {
    case 'policy': return 'REGULATION';
    case 'github': return 'RELEASE';
    case 'hardware':
    case 'cloud': return 'INFRA';
    case 'security': return 'SECURITY';
    case 'outages': return 'OUTAGE';
    case 'funding': return 'FUNDING';
    case 'thinktanks': return 'RESEARCH';
    default: return 'AI';
  }
}

/** Relative age: "38m", "3h", "Thu". */
export function relativeTime(ts: number, now: number): string {
  if (!ts) return '—';
  const minutes = Math.max(0, Math.round((now - ts) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  if (hours < 24 * 6) return new Date(ts).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** Decodes the few HTML entities feed snippets carry. Text only; never rendered as HTML. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    const lower = code.toLowerCase();
    if (lower in ENTITIES) return ENTITIES[lower] ?? match;
    if (lower.startsWith('#x')) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    return match;
  });
}

/** Counts watched topics in titles. Case-insensitive whole-phrase match. */
export function topicCounts(topics: readonly { label: string; pattern: RegExp }[], titles: readonly string[]): number[] {
  return topics.map((t) => titles.reduce((n, title) => n + (t.pattern.test(title) ? 1 : 0), 0));
}

/** The feed snippet as plain text, or '' when it only repeats the headline. */
export function cleanSnippet(item: Pick<NewsItem, 'snippet' | 'title'>): string {
  const text = decodeEntities(item.snippet ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const title = item.title.trim().toLowerCase();
  return !text || text.toLowerCase().startsWith(title.slice(0, Math.min(40, title.length))) ? '' : text;
}

/** The dashboard's map time ranges (`TimeRange` in src/components/DeckGLMap.ts), without "all", plus 30 days. */
export type TimeRange = '1h' | '6h' | '24h' | '48h' | '7d' | '30d';

export const TIME_RANGE_HOURS: Record<TimeRange, number> = { '1h': 1, '6h': 6, '24h': 24, '48h': 48, '7d': 168, '30d': 720 };

/** True when `ts` falls in the last `range` before `now`; an item without a timestamp stays, as on the dashboard. */
export function inTimeRange(ts: number | null | undefined, now: number, range: TimeRange): boolean {
  if (!ts) return true;
  return now - ts < TIME_RANGE_HOURS[range] * 3_600_000;
}
