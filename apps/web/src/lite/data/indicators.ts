/**
 * The indicator model shared by every Lite screen (spec: Early indicators ›
 * Screen design). A feed is fired (an Indicator with its linked news), quiet,
 * stale or unavailable.
 */
import type { Domain } from './briefing';
import type { NewsLinks } from './news-link';
import type { ResourceState } from './store';

/** Evidence labels (spec: Catalogue, owner's label rule). */
export type Trust = 'official' | 'verified' | 'reported' | 'estimated' | 'market';

export const TRUST_LABEL: Readonly<Record<Trust, string>> = {
  official: 'OFFICIAL',
  verified: 'VERIFIED',
  reported: 'REPORTED',
  estimated: 'ESTIMATED',
  market: 'MARKET DATA',
};

export const TRUST_MEANING: Readonly<Record<Trust, string>> = {
  official: 'Published by a government, regulator, central bank, exchange operator or the issuer itself.',
  verified: 'An independently verified dataset.',
  reported: 'Third-party telemetry or machine-coded reports.',
  estimated: 'Derived from proxies.',
  market: 'Prices and market-derived values from a quote provider.',
};

/**
 * Decision tier (spec: Decision tiers, owner's view 2026-11-19; #121). Check
 * daily: can need action the same day; check weekly: shapes plans. Analyst
 * inputs (military aircraft, GPS interference, attack infrastructure, and the
 * violence and sea-incident layers that feed the region view) have none.
 */
export type DecisionTier = 'daily' | 'weekly';

const TIER_BY_FEED: Readonly<Record<string, DecisionTier>> = {
  // Geopolitics
  chokepoint: 'daily', chokepoints: 'daily', region: 'daily', 'region-escalation': 'daily', sanctions: 'daily',
  taiwan: 'daily', embassy: 'daily', 'export-controls': 'daily', 'restricted-parties': 'daily', 'travel-advisory': 'daily', 'eu-sanctions': 'daily', 'uk-sanctions': 'daily',
  elections: 'weekly',
  // Finance: yields, credit, risk gauges, macro and price moves daily; crypto health, freight and filings weekly
  treasury: 'daily', 'other-bonds': 'daily', 'credit-spreads': 'daily', 'fed-odds': 'daily', 'cb-decision': 'daily', vix: 'daily', 'dollar-index': 'daily',
  'macro-print': 'daily', 'btc-move': 'daily',
  'etf-flows': 'weekly', 'stablecoin-depeg': 'weekly', 'perp-positioning': 'weekly', 'btc-funding': 'weekly',
  'fear-greed': 'weekly', 'freight-scfi': 'weekly', 'freight-bdi': 'weekly', 'sec-8k': 'weekly',
  'fed-balance-sheet': 'weekly', 'reverse-repo': 'weekly', 'stablecoin-supply': 'weekly', 'oil-inventories': 'weekly',
  // Technology
  'service-outage': 'daily', 'kev-new': 'daily', 'cyber-8k': 'daily', 'internet-outage': 'daily', breach: 'daily',
  'ai-models': 'weekly', 'open-models': 'weekly', 'lab-news': 'weekly', 'chip-revenue': 'weekly', 'hyperscaler-capex': 'weekly', 'ai-regulation': 'weekly', 'ai-funding': 'weekly',
};

/** A feed's tier by its id ("sanctions:RU" reads as "sanctions"); null for analyst inputs. */
export function feedTier(id: string): DecisionTier | null {
  return TIER_BY_FEED[id] ?? TIER_BY_FEED[id.split(':')[0] ?? ''] ?? null;
}

/**
 * Indicator topics and families (owner's decision, 2026-11-22; #184). Each
 * domain's Indicators panel shows topic sections from general to specific
 * (policy and macro before a single sector such as crypto), and one card per
 * family: repeats of one rule (nine price changes, one alert per embassy)
 * and feeds that answer the same question (the OFAC, EU and UK sanctions
 * lists) share it. A feed matches its family by its id's longest prefix
 * ("ai-models:price:google/x" reads as "ai-models:price").
 */
interface FamilyDef {
  family: string;
  label: string;
  prefixes: readonly string[];
}
interface TopicDef {
  id: string;
  name: string;
  families: readonly FamilyDef[];
}

export const INDICATOR_TOPICS: Readonly<Record<Domain, readonly TopicDef[]>> = {
  geo: [
    { id: 'conflict', name: 'Escalation and conflict', families: [
      { family: 'region-escalation', label: 'Region escalation', prefixes: ['region', 'region-escalation'] },
      { family: 'violence', label: 'Violence spikes', prefixes: ['violence'] },
    ] },
    { id: 'military', name: 'Military', families: [
      { family: 'aircraft', label: 'Military aircraft', prefixes: ['aircraft'] },
      { family: 'sea', label: 'Incidents at sea', prefixes: ['sea'] },
      { family: 'gps', label: 'GPS interference', prefixes: ['gps', 'gps-region'] },
      { family: 'taiwan', label: 'Taiwan Strait', prefixes: ['taiwan'] },
      { family: 'airspace', label: 'Airspace closures', prefixes: ['airspace'] },
    ] },
    { id: 'political', name: 'Political and travel', families: [
      { family: 'elections', label: 'Elections', prefixes: ['elections'] },
      { family: 'embassy', label: 'Embassy alerts', prefixes: ['embassy'] },
      { family: 'travel-advisory', label: 'Travel advisories', prefixes: ['travel-advisory'] },
    ] },
    { id: 'sanctions', name: 'Sanctions and trade controls', families: [
      { family: 'sanctions', label: 'New sanctions', prefixes: ['sanctions', 'eu-sanctions', 'uk-sanctions'] },
      { family: 'export-controls', label: 'Export controls', prefixes: ['export-controls', 'restricted-parties'] },
    ] },
    { id: 'shipping', name: 'Shipping', families: [
      { family: 'chokepoints', label: 'Chokepoint transits', prefixes: ['chokepoint', 'chokepoints'] },
    ] },
  ],
  fin: [
    { id: 'central-banks', name: 'Central banks and liquidity', families: [
      { family: 'fed-odds', label: 'Fed decision odds', prefixes: ['fed-odds'] },
      { family: 'cb-decision', label: 'Central bank decisions', prefixes: ['cb-decision'] },
      { family: 'fed-liquidity', label: 'Fed liquidity', prefixes: ['fed-balance-sheet', 'reverse-repo'] },
    ] },
    { id: 'macro', name: 'Macro data', families: [
      { family: 'macro-print', label: 'Macro prints', prefixes: ['macro-print'] },
    ] },
    { id: 'rates', name: 'Rates and credit', families: [
      { family: 'bond-yields', label: 'Bond yields', prefixes: ['treasury', 'other-bonds'] },
      { family: 'credit-spreads', label: 'Credit spreads', prefixes: ['credit-spreads'] },
    ] },
    { id: 'risk', name: 'Market risk', families: [
      { family: 'vix', label: 'Volatility', prefixes: ['vix'] },
      { family: 'dollar-index', label: 'Dollar index', prefixes: ['dollar-index'] },
      { family: 'fear-greed', label: 'Sentiment', prefixes: ['fear-greed'] },
    ] },
    { id: 'commodities', name: 'Commodities and trade', families: [
      { family: 'oil-inventories', label: 'US crude stocks', prefixes: ['oil-inventories'] },
      { family: 'freight', label: 'Freight', prefixes: ['freight-scfi', 'freight-bdi'] },
    ] },
    { id: 'companies', name: 'Companies', families: [
      { family: 'sec-8k', label: 'Company filings', prefixes: ['sec-8k'] },
    ] },
    { id: 'crypto', name: 'Crypto', families: [
      { family: 'btc-move', label: 'BTC price move', prefixes: ['btc-move'] },
      { family: 'etf-flows', label: 'Bitcoin ETF flows', prefixes: ['etf-flows'] },
      { family: 'perps', label: 'Perps', prefixes: ['btc-funding', 'perp-positioning'] },
      { family: 'stablecoins', label: 'Stablecoins', prefixes: ['stablecoin-depeg', 'stablecoin-supply'] },
    ] },
  ],
  tech: [
    { id: 'ai-policy', name: 'AI policy', families: [
      { family: 'ai-regulation', label: 'AI and data rules', prefixes: ['ai-regulation'] },
    ] },
    { id: 'infrastructure', name: 'Infrastructure', families: [
      { family: 'internet-outage', label: 'Internet outages', prefixes: ['internet-outage'] },
      { family: 'service-outage', label: 'Cloud and AI services', prefixes: ['service-outage'] },
    ] },
    { id: 'security', name: 'Security', families: [
      { family: 'kev-new', label: 'Exploited vulnerabilities', prefixes: ['kev-new'] },
      { family: 'security-incidents', label: 'Security incidents', prefixes: ['cyber-8k', 'breach'] },
      { family: 'attack-spike', label: 'Attack infrastructure', prefixes: ['attack-spike'] },
    ] },
    { id: 'ai-investment', name: 'AI investment and supply', families: [
      { family: 'hyperscaler-capex', label: 'Hyperscaler capital spending', prefixes: ['hyperscaler-capex'] },
      { family: 'chip-revenue', label: 'TSMC monthly revenue', prefixes: ['chip-revenue'] },
      { family: 'ai-funding', label: 'AI funding', prefixes: ['ai-funding'] },
    ] },
    { id: 'ai-models', name: 'AI labs and models', families: [
      { family: 'lab-news', label: 'Lab announcements', prefixes: ['lab-news'] },
      // The quiet "ai-models" row reports new models (its line names the latest release).
      { family: 'new-models', label: 'New AI models', prefixes: ['ai-models', 'ai-models:new', 'open-models'] },
      { family: 'ai-prices', label: 'AI price changes', prefixes: ['ai-models:price'] },
    ] },
  ],
};

/** The panels' how-it-works line for the order and the shared cards. */
export const TOPIC_NOTE = 'Indicators are shown by topic, general to specific (policy and macro before a single sector such as crypto); fired first inside a topic, newest first. Feeds of one type (repeats of a rule, or lists that answer the same question, such as the OFAC, EU and UK sanctions) share one card.';

export interface FeedFamily {
  family: string;
  label: string;
  topic: string;
  /** Position in the catalogue: topic order, then family order. */
  order: number;
}

const FAMILY_BY_PREFIX: ReadonlyMap<string, FeedFamily> = (() => {
  const map = new Map<string, FeedFamily>();
  let order = 0;
  for (const topics of Object.values(INDICATOR_TOPICS)) {
    for (const topic of topics) {
      for (const f of topic.families) {
        for (const prefix of f.prefixes) map.set(prefix, { family: f.family, label: f.label, topic: topic.id, order });
        order += 1;
      }
    }
  }
  return map;
})();

/** A feed's family by the longest prefix of its id; null for an id no topic lists. */
export function feedFamily(id: string): FeedFamily | null {
  const parts = id.split(':');
  for (let n = Math.min(parts.length, 3); n > 0; n -= 1) {
    const hit = FAMILY_BY_PREFIX.get(parts.slice(0, n).join(':'));
    if (hit) return hit;
  }
  return null;
}

export interface FeedFamilyGroup {
  family: string;
  label: string;
  feeds: FeedState[];
}

export interface FeedSection {
  /** A topic id, or `other`. */
  id: string;
  name: string;
  firedCount: number;
  families: FeedFamilyGroup[];
}

const newestFired = (g: FeedFamilyGroup) => Math.max(...g.feeds.map((f) => (f.kind === 'fired' ? f.indicator.at : Number.NEGATIVE_INFINITY)));

/**
 * A domain's feeds as its Indicators panel shows them: topic sections in
 * catalogue order (general to specific), only those with a feed; inside a
 * section, families with a fired feed first (newest first), then the rest in
 * catalogue order; inside a family, fired newest first, then quiet, stale and
 * unavailable. A feed no topic lists goes to a last "Other" section, grouped
 * by its id's first part, so a new rule is never dropped.
 */
export function arrangeFeeds(feeds: readonly FeedState[], domain: Domain): FeedSection[] {
  const topics = INDICATOR_TOPICS[domain];
  const groups = new Map<string, { topic: string; order: number; group: FeedFamilyGroup }>();
  for (const feed of feeds) {
    const fam = feedFamily(feed.id);
    const key = fam ? fam.family : `other:${feed.id.split(':')[0]}`;
    const entry = groups.get(key) ?? {
      topic: fam && topics.some((t) => t.id === fam.topic) ? fam.topic : 'other',
      order: fam?.order ?? Number.MAX_SAFE_INTEGER,
      group: { family: key, label: fam?.label ?? (feed.name.split(' · ')[0] ?? feed.name), feeds: [] },
    };
    entry.group.feeds.push(feed);
    groups.set(key, entry);
  }
  const sectionDefs = [...topics.map((t) => ({ id: t.id, name: t.name })), { id: 'other', name: 'Other' }];
  return sectionDefs.flatMap(({ id, name }) => {
    const entries = [...groups.values()].filter((e) => e.topic === id);
    if (!entries.length) return [];
    for (const e of entries) e.group.feeds = sortFeeds(e.group.feeds);
    const fired = (e: (typeof entries)[number]) => e.group.feeds.some((f) => f.kind === 'fired');
    entries.sort((a, b) => {
      if (fired(a) !== fired(b)) return fired(a) ? -1 : 1;
      if (fired(a)) return newestFired(b.group) - newestFired(a.group) || a.order - b.order;
      return a.order - b.order;
    });
    const families = entries.map((e) => e.group);
    const firedCount = families.reduce((n, g) => n + g.feeds.filter((f) => f.kind === 'fired').length, 0);
    return [{ id, name, firedCount, families }];
  });
}

export interface IndicatorPlace {
  countries?: readonly string[];
  lat?: number;
  lon?: number;
}

export interface Indicator {
  id: string;
  domain: Domain;
  name: string;
  /** "4.62%", "$0.9940". */
  value: string;
  /** "+14 bp today", "−0.60% from $1". */
  change?: string;
  /** "±10 bp", "> 0.5% from $1". */
  rule: string;
  /** One supporting line: "2s10s +41 bp · no sign flip", "Others normal: …". */
  detail?: string;
  /** `url`: the source's page for this item, linked from the full card when the licence asks for a link (https only). */
  trust: { level: Trust; source: string; url?: string };
  /** When the rule fired: the time of the data it read. */
  at: number;
  /** Slow feeds name the period their data covers instead of a clock time. */
  dataDate?: string;
  /** When the feed last refreshed, if it says. */
  updatedAt?: number;
  links: NewsLinks;
  /** The map marker this indicator points at, when its screen has a map ("outage:cf-1", "provider:aws"). */
  focusId?: string;
  /** Where it happened: ISO2 countries and/or a point. Geopolitics groups its panel by region with it. */
  place?: IndicatorPlace;
  /** A grounded one-line "why", labelled model inference. Not produced yet. */
  why?: string;
}

export type FeedState =
  | { kind: 'fired'; id: string; name: string; indicator: Indicator; reading?: string }
  | { kind: 'quiet' | 'stale' | 'unavailable' | 'loading'; id: string; name: string; detail: string; reading?: string };

export type FeedKind = FeedState['kind'];

/** Attaches a short reading ("UST 10Y 4.86% +2 bp") for map labels. */
export function withReading(feed: FeedState, reading: string | null | undefined): FeedState {
  return reading ? { ...feed, reading } : feed;
}

/** Late means older than this many cadences. */
export const STALE_FACTOR = 2;

function agoLabel(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

export function updatedLabel(updatedAt: number | undefined, now: number): string | null {
  return updatedAt ? `updated ${agoLabel(now - updatedAt)}` : null;
}

/**
 * One feed's state. A source that failed or returned nothing is unavailable
 * (naming its seeder); one whose data is older than STALE_FACTOR × cadence is
 * stale; otherwise it is fired when its rule produced an indicator, else quiet.
 * A feed without a data timestamp never claims to be stale.
 */
export function feedState(input: {
  id: string;
  name: string;
  source: ResourceState<unknown>;
  seeder: string;
  cadenceMin: number;
  dataAt?: number | null;
  fired: Indicator | null;
  now: number;
}): FeedState {
  const { id, name, source, now } = input;
  if (source.status === 'loading') return { kind: 'loading', id, name, detail: 'Loading…' };
  if (source.status !== 'ready') {
    return { kind: 'unavailable', id, name, detail: source.status === 'error' ? `Source unavailable · ${input.seeder}` : `No data yet · ${input.seeder}` };
  }
  const age = input.dataAt ? now - input.dataAt : null;
  if (age != null && age > STALE_FACTOR * input.cadenceMin * 60_000) {
    return { kind: 'stale', id, name, detail: `Late · last update ${agoLabel(age)} (expected every ${input.cadenceMin} min)` };
  }
  if (input.fired) return { kind: 'fired', id, name, indicator: input.fired };
  const updated = age != null ? ` · ${updatedLabel(input.dataAt ?? undefined, now)}` : '';
  return { kind: 'quiet', id, name, detail: `Live · no trigger${updated}` };
}

/** A layer's feeds are all late: its map markers draw at 45% opacity. */
export function feedsStale(feeds: readonly FeedState[]): boolean {
  return feeds.length > 0 && feeds.every((f) => f.kind === 'stale');
}

const ORDER: Readonly<Record<FeedKind, number>> = { fired: 0, quiet: 1, stale: 2, unavailable: 3, loading: 4 };

/** Fired first (newest first), then quiet, stale and unavailable. */
export function sortFeeds(feeds: readonly FeedState[]): FeedState[] {
  return [...feeds].sort((a, b) => {
    if (ORDER[a.kind] !== ORDER[b.kind]) return ORDER[a.kind] - ORDER[b.kind];
    return a.kind === 'fired' && b.kind === 'fired' ? b.indicator.at - a.indicator.at : 0;
  });
}

export function feedCounts(feeds: readonly FeedState[]): Record<FeedKind, number> {
  const out: Record<FeedKind, number> = { fired: 0, quiet: 0, stale: 0, unavailable: 0, loading: 0 };
  for (const f of feeds) out[f.kind] += 1;
  return out;
}
