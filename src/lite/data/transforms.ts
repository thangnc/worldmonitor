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

export function byImportance(a: NewsItem, b: NewsItem): number {
  return (b.importanceScore || 0) - (a.importanceScore || 0) || (b.publishedAt || 0) - (a.publishedAt || 0);
}

/** Independent sources reporting the story: the larger of the two counts the digest carries. */
export function sourceCount(item: NewsItem): number {
  return Math.max(1, item.storyMeta?.sourceCount ?? 0, item.corroborationCount ?? 0);
}

/** Tier 1 in shared/source-tiers.json: wire services and official bodies. */
export function isPrimarySource(sourceName: string): boolean {
  return getSourceTier(sourceName) === 1;
}

export type ClaimStatus = 'confirmed' | 'attributed' | 'unverified';

/**
 * The rule behind CONFIRMED / ATTRIBUTED CLAIM / UNVERIFIED. It measures
 * corroboration, not truth: confirmed = at least MIN_CORROBORATING_PUBLISHERS
 * sources with a tier-1 one among them; attributed = several sources, none
 * tier 1; unverified = a single source.
 */
export function claimStatus(item: NewsItem): ClaimStatus {
  const count = sourceCount(item);
  if (count >= MIN_CORROBORATING_PUBLISHERS && isPrimarySource(item.source)) return 'confirmed';
  if (count >= 2) return 'attributed';
  return 'unverified';
}

export const CLAIM_LABEL: Record<ClaimStatus, string> = {
  confirmed: 'CONFIRMED',
  attributed: 'ATTRIBUTED CLAIM',
  unverified: 'UNVERIFIED',
};

export const CLAIM_TONE: Record<ClaimStatus, Tone> = { confirmed: 'ok', attributed: 'high', unverified: 'dim' };

/** The incidents table's status column, from the same rule. */
export const INCIDENT_STATUS: Record<ClaimStatus, { label: string; tone: Tone }> = {
  confirmed: { label: 'Confirmed', tone: 'ok' },
  attributed: { label: 'Developing', tone: 'high' },
  unverified: { label: 'Claimed', tone: 'muted' },
};

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

function logReturns(series: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1];
    const b = series[i];
    if (a && b && a > 0 && b > 0) out.push(Math.log(b / a));
  }
  return out;
}

function stdev(values: readonly number[]): number {
  if (values.length < 2) return Number.NaN;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1));
}

/** Annualized realized volatility (%) from evenly spaced closes `periodHours` apart. */
export function realizedVolatility(closes: readonly number[], periodHours = 1): number | null {
  const sd = stdev(logReturns(closes));
  if (!Number.isFinite(sd)) return null;
  return sd * Math.sqrt((24 * 365) / periodHours) * 100;
}

/** Pearson correlation of the log returns of two aligned series. */
export function returnCorrelation(a: readonly number[], b: readonly number[]): number | null {
  const n = Math.min(a.length, b.length);
  const ra = logReturns(a.slice(-n));
  const rb = logReturns(b.slice(-n));
  const m = Math.min(ra.length, rb.length);
  if (m < 3) return null;
  const xa = ra.slice(-m);
  const xb = rb.slice(-m);
  const ma = xa.reduce((s, v) => s + v, 0) / m;
  const mb = xb.reduce((s, v) => s + v, 0) / m;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < m; i++) {
    const ea = (xa[i] ?? 0) - ma;
    const eb = (xb[i] ?? 0) - mb;
    num += ea * eb;
    da += ea * ea;
    db += eb * eb;
  }
  if (da === 0 || db === 0) return null;
  return num / Math.sqrt(da * db);
}

export interface CloseBar {
  open: number;
  close: number;
  up: boolean;
}

/** Close-to-close bars: each bar opens at the previous close. No invented highs or lows. */
export function closeToCloseBars(closes: readonly number[]): CloseBar[] {
  const out: CloseBar[] = [];
  for (let i = 1; i < closes.length; i++) {
    const open = closes[i - 1] ?? 0;
    const close = closes[i] ?? 0;
    out.push({ open, close, up: close >= open });
  }
  return out;
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
    default: return { label: 'MARKETS', tone: 'dim' };
  }
}

export const MARKET_CATEGORIES = ['markets', 'commodities', 'crypto', 'centralbanks', 'economic', 'bonds', 'forex', 'derivatives', 'fin-regulation'] as const;

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
