/**
 * The Sources screen's connector catalogue and its status rules
 * (docs/engineering/architecture/lite.md "Sources").
 *
 * A connector is one upstream feed that a Lite widget reads. Its status comes
 * from data the Lite UI already loads, with no new endpoint:
 * - a seeded connector reads the compact health check (`/api/health?compact=1`),
 *   which lists only problem and pending checks, so a check that is not listed
 *   passed its `maxStaleMin` gate;
 * - a news digest connector reads the digest the screens load.
 *
 * `tests/lite-ui.test.mts` keeps `healthKeys` and `maxStaleMin` equal to
 * `SEED_META` in api/health.js, and each host's `licence` equal to its row in
 * shared/source-attribution-manifest.json.
 */
import type { ListFeedDigestResponse } from '@/generated/client/worldmonitor/news/v1/service_client';
import { SOURCE_TIERS, TIER_MEANING, type DeclaredTier } from '../../../server/_shared/source-tiers';
import type { CompactHealth, CompactHealthCheck, DigestEdition } from './sources';
import type { ResourceState } from './store';

export type ConnectorDomain = 'geo' | 'fin' | 'tech' | 'all';
export type ConnectorMethod = 'API' | 'RSS' | 'LLM' | 'Derived';
/** `status` of the host's row in shared/source-attribution-manifest.json. */
export type Licence = 'reviewed' | 'terms-review' | 'excluded';

export interface ConnectorHost {
  host: string;
  licence: Licence;
}

export interface Connector {
  id: string;
  name: string;
  domain: ConnectorDomain;
  /** What kind of source it is, shown under the name. */
  kind: string;
  method: ConnectorMethod;
  /** The seeder, relay or handler that writes it. */
  producer: string;
  /** The check names in api/health.js SEED_META; the worst one sets the status. */
  healthKeys?: readonly string[];
  /** The checks' longest `maxStaleMin`: older data fails the health gate. */
  maxStaleMin?: number;
  /** A news digest connector reads the digest itself instead of a health check. */
  digest?: DigestEdition;
  /** Upstream hosts, as the attribution manifest records them for the producer. */
  hosts: readonly ConnectorHost[];
  /** The Lite widgets that read it. */
  usedBy: readonly string[];
}

const yahoo: ConnectorHost = { host: 'query1.finance.yahoo.com', licence: 'terms-review' };
const coingecko: ConnectorHost = { host: 'api.coingecko.com', licence: 'terms-review' };
const coinpaprika: ConnectorHost = { host: 'api.coinpaprika.com', licence: 'terms-review' };

export const CONNECTORS: readonly Connector[] = [
  // ---- Geopolitics ----
  {
    id: 'digest-world', name: 'News digest · world', domain: 'geo', kind: 'News aggregate', method: 'RSS',
    producer: 'list-feed-digest', digest: 'full', hosts: [],
    usedBy: ['Priority incidents', 'Briefing priority events', 'Hotspot escalation score', 'Indicator news links'],
  },
  {
    id: 'gdelt-conflict', name: 'GDELT conflict counts', domain: 'geo', kind: 'Reported events', method: 'API',
    producer: 'seed-gdelt-bulk-materializer', healthKeys: ['gdeltConflictCounts'], maxStaleMin: 45,
    hosts: [{ host: 'storage.googleapis.com', licence: 'terms-review' }],
    usedBy: ['Conflict map violence shading', 'Reported violence indicator', 'Report histogram', 'Hotspot strip'],
  },
  {
    id: 'ucdp', name: 'UCDP georeferenced events', domain: 'geo', kind: 'Verified dataset', method: 'API',
    producer: 'seed-ucdp-events', healthKeys: ['ucdpEvents'], maxStaleMin: 420,
    hosts: [{ host: 'ucdpapi.pcr.uu.se', licence: 'terms-review' }],
    usedBy: ['Conflict map (verified background)'],
  },
  {
    id: 'unrest', name: 'Protests and unrest', domain: 'geo', kind: 'Event dataset', method: 'API',
    producer: 'seed-unrest-events', healthKeys: ['unrestEvents'], maxStaleMin: 120,
    hosts: [{ host: 'acleddata.com', licence: 'terms-review' }, { host: 'api.gdeltproject.org', licence: 'terms-review' }],
    usedBy: ['Hotspot escalation score'],
  },
  {
    id: 'military-flights', name: 'Military aircraft', domain: 'geo', kind: 'ADS-B tracking', method: 'API',
    producer: 'seed-military-flights', healthKeys: ['militaryFlights'], maxStaleMin: 30,
    hosts: [
      { host: 'api.adsb.lol', licence: 'reviewed' },
      { host: 'api.airplanes.live', licence: 'terms-review' },
      { host: 'opendata.adsb.fi', licence: 'terms-review' },
      { host: 'opensky-network.org', licence: 'terms-review' },
      { host: 'customer-api.wingbits.com', licence: 'terms-review' },
    ],
    usedBy: ['Hotspot escalation score'],
  },
  {
    id: 'earthquakes', name: 'USGS earthquakes', domain: 'geo', kind: 'Official dataset', method: 'API',
    producer: 'seed-earthquakes', healthKeys: ['earthquakes'], maxStaleMin: 30,
    hosts: [{ host: 'earthquake.usgs.gov', licence: 'terms-review' }],
    usedBy: ['Hotspot escalation score'],
  },
  {
    id: 'cii', name: 'Country instability index', domain: 'geo', kind: 'Derived score', method: 'Derived',
    producer: 'get-risk-scores (warm ping)', healthKeys: ['riskScores'], maxStaleMin: 30, hosts: [],
    usedBy: ['Hotspot escalation score', 'Escalation tracker'],
  },
  // ---- Finance & Crypto ----
  {
    id: 'digest-finance', name: 'News digest · finance', domain: 'fin', kind: 'News aggregate', method: 'RSS',
    producer: 'list-feed-digest', digest: 'finance', hosts: [],
    usedBy: ['Market-moving events', 'Indicator news links'],
  },
  {
    id: 'crypto', name: 'Crypto spot quotes', domain: 'fin', kind: 'Market data', method: 'API',
    producer: 'seed-crypto-quotes', healthKeys: ['cryptoQuotes'], maxStaleMin: 30, hosts: [coingecko, coinpaprika],
    usedBy: ['Tickers', 'Price move · BTC 24h indicator', 'Market pulse', 'Market event price links'],
  },
  {
    id: 'stocks', name: 'Stocks and indices', domain: 'fin', kind: 'Market data', method: 'API',
    producer: 'seed-market-quotes', healthKeys: ['marketQuotes'], maxStaleMin: 30, hosts: [yahoo],
    usedBy: ['Tickers', 'Market pulse', 'Market event price links'],
  },
  {
    id: 'commodities', name: 'Commodities and FX', domain: 'fin', kind: 'Market data', method: 'API',
    producer: 'seed-commodity-quotes', healthKeys: ['commodityQuotes'], maxStaleMin: 30, hosts: [yahoo],
    usedBy: ['Tickers', 'Market pulse', 'Market event price links'],
  },
  {
    id: 'gold', name: 'Gold and dollar drivers', domain: 'fin', kind: 'Market data', method: 'API',
    producer: 'seed-commodity-quotes', healthKeys: ['goldExtended'], maxStaleMin: 30, hosts: [yahoo],
    usedBy: ['Market pulse', 'Market event price links'],
  },
  {
    id: 'treasury', name: 'US Treasury par yields', domain: 'fin', kind: 'Official rates', method: 'API',
    producer: 'seed-us-treasury-par-yield', healthKeys: ['usTreasuryParYield'], maxStaleMin: 4320,
    hosts: [{ host: 'home.treasury.gov', licence: 'terms-review' }],
    usedBy: ['US Treasury curve', 'Treasury yields · 2Y / 10Y indicator'],
  },
  {
    id: 'other-bonds', name: 'Bond curves · DE GB JP', domain: 'fin', kind: 'Official rates', method: 'API',
    producer: 'seed-bundle-yield-curves', healthKeys: ['yieldCurveDe', 'yieldCurveGb', 'yieldCurveJp'], maxStaleMin: 4460,
    hosts: [
      { host: 'api.statistiken.bundesbank.de', licence: 'terms-review' },
      { host: 'www.bankofengland.co.uk', licence: 'terms-review' },
      { host: 'www.mof.go.jp', licence: 'terms-review' },
    ],
    usedBy: ['Other 10y bonds indicator'],
  },
  {
    id: 'macro-calendar', name: 'Central-bank and macro calendar', domain: 'fin', kind: 'Official releases', method: 'API',
    producer: 'seed-economic-calendar', healthKeys: ['econCalendar'], maxStaleMin: 1440,
    hosts: [
      { host: 'api.stlouisfed.org', licence: 'terms-review' },
      { host: 'www.federalreserve.gov', licence: 'terms-review' },
      { host: 'www.ecb.europa.eu', licence: 'terms-review' },
      { host: 'ec.europa.eu', licence: 'terms-review' },
    ],
    usedBy: ['Macro calendar', 'Macro prints · US indicator', 'Upcoming catalysts'],
  },
  {
    id: 'hyperliquid', name: 'Hyperliquid perps', domain: 'fin', kind: 'Market data · one venue', method: 'API',
    producer: 'seed-hyperliquid-flow', healthKeys: ['hyperliquidFlow'], maxStaleMin: 30,
    hosts: [{ host: 'api.hyperliquid.xyz', licence: 'terms-review' }],
    usedBy: ['Perp funding · BTC indicator', 'Perp positioning · Hyperliquid indicator'],
  },
  {
    id: 'stablecoins', name: 'Stablecoin pegs', domain: 'fin', kind: 'Market data', method: 'API',
    producer: 'seed-stablecoin-markets', healthKeys: ['stablecoinMarkets'], maxStaleMin: 60, hosts: [coingecko, coinpaprika],
    usedBy: ['Stablecoin peg indicator', 'Market pulse'],
  },
  {
    id: 'etf-flows', name: 'Spot bitcoin ETF flows', domain: 'fin', kind: 'Market data · estimate', method: 'API',
    producer: 'seed-etf-flows', healthKeys: ['etfFlows'], maxStaleMin: 60, hosts: [yahoo],
    usedBy: ['Bitcoin ETF flows indicator'],
  },
  {
    id: 'fear-greed', name: 'Fear & greed index', domain: 'fin', kind: 'Composite sentiment', method: 'API',
    producer: 'seed-fear-greed', healthKeys: ['fearGreedIndex'], maxStaleMin: 720,
    hosts: [
      { host: 'production.dataviz.cnn.io', licence: 'terms-review' },
      yahoo,
      { host: 'www.aaii.com', licence: 'terms-review' },
      { host: 'www.barchart.com', licence: 'terms-review' },
    ],
    usedBy: ['Sentiment · fear & greed indicator'],
  },
  {
    id: 'freight', name: 'Freight indices · SCFI, Baltic Dry', domain: 'fin', kind: 'Market data', method: 'API',
    producer: 'seed-supply-chain-trade', healthKeys: ['shippingRates'], maxStaleMin: 1140,
    hosts: [{ host: 'en.sse.net.cn', licence: 'terms-review' }, { host: 'www.handybulk.com', licence: 'terms-review' }],
    usedBy: ['Container freight · SCFI indicator', 'Dry bulk · Baltic Dry indicator'],
  },
  {
    id: 'sec-8k', name: 'SEC 8-K filings', domain: 'fin', kind: 'Official filings', method: 'API',
    producer: 'seed-sec-8k-stream', healthKeys: ['sec8kStream'], maxStaleMin: 120,
    hosts: [{ host: 'www.sec.gov', licence: 'reviewed' }],
    usedBy: ['Company filings · 8-K indicator'],
  },
  {
    id: 'chokepoints', name: 'Chokepoint status', domain: 'fin', kind: 'Derived status', method: 'Derived',
    producer: 'get-chokepoint-status', healthKeys: ['chokepoints'], maxStaleMin: 60, hosts: [],
    usedBy: ['Where markets are moving map'],
  },
  {
    id: 'sanctions', name: 'OFAC sanctions pressure', domain: 'fin', kind: 'Official list', method: 'API',
    producer: 'seed-sanctions-pressure', healthKeys: ['sanctionsPressure'], maxStaleMin: 720,
    hosts: [{ host: 'sanctionslistservice.ofac.treas.gov', licence: 'terms-review' }],
    usedBy: ['Where markets are moving map'],
  },
  // ---- Technology & AI ----
  {
    id: 'digest-tech', name: 'News digest · tech', domain: 'tech', kind: 'News aggregate', method: 'RSS',
    producer: 'list-feed-digest', digest: 'tech', hosts: [],
    usedBy: ['Material developments', 'Watched topics'],
  },
  {
    id: 'research', name: 'arXiv and Hacker News', domain: 'tech', kind: 'Research', method: 'API',
    producer: 'seed-research', healthKeys: ['researchArxivHnTrending'], maxStaleMin: 150,
    hosts: [{ host: 'export.arxiv.org', licence: 'terms-review' }, { host: 'hacker-news.firebaseio.com', licence: 'terms-review' }],
    usedBy: ['Research radar'],
  },
  // ---- Cross-domain ----
  {
    id: 'insights', name: 'AI world brief', domain: 'all', kind: 'LLM summary of the digest', method: 'LLM',
    producer: 'seed-insights', healthKeys: ['newsInsights'], maxStaleMin: 30,
    hosts: [{ host: 'openrouter.ai', licence: 'excluded' }],
    usedBy: ['Hourly brief'],
  },
];

// ---- Status ------------------------------------------------------------------

export type ConnectorStatusKind = 'failing' | 'degraded' | 'unknown' | 'loading' | 'live';

export interface ConnectorStatus {
  kind: ConnectorStatusKind;
  /** One line: the health status or what the digest returned. */
  detail: string;
  /** When the data was written, if known. */
  updatedAt?: number;
  /** Minutes since the data was written, if known. */
  ageMin?: number;
  records?: number | null;
  /** Error code from the producer, when the health check carries one. */
  errorCode?: string;
  consecutiveFailures?: number;
  /** News feeds that answered, for a digest connector. */
  feeds?: { completed: number; total: number };
}

/** Health statuses that mean no usable data: the rest are degraded. */
const FAILING_STATUS = /ERROR|MISSING|REDIS|^EMPTY(?!_ON_DEMAND)/;

/** `STALE_SEED` → "Stale seed". */
export function healthStatusLabel(status: string): string {
  const words = status.toLowerCase().split('_').filter(Boolean);
  const text = words.join(' ');
  return text ? text[0]!.toUpperCase() + text.slice(1) : status;
}

function fromCheck(check: CompactHealthCheck, kind: ConnectorStatusKind, now: number): ConnectorStatus {
  const ageMin = Number.isFinite(check.seedAgeMin) ? (check.seedAgeMin as number) : undefined;
  return {
    kind,
    detail: healthStatusLabel(check.status),
    ageMin,
    updatedAt: ageMin != null ? now - ageMin * 60_000 : undefined,
    records: check.records,
    errorCode: check.errorCode ?? check.lastSourceFailureCode,
    consecutiveFailures: check.consecutiveSourceFailures,
  };
}

function checkStatus(healthKey: string, health: CompactHealth, now: number): ConnectorStatus {
  const problem = health.problems?.[healthKey];
  if (problem) {
    if (problem.status === 'EMPTY_ON_DEMAND') return { ...fromCheck(problem, 'live', now), detail: 'Waiting for its first run' };
    return fromCheck(problem, FAILING_STATUS.test(problem.status) ? 'failing' : 'degraded', now);
  }
  const pending = health.pending?.[healthKey];
  if (pending) return fromCheck(pending, 'live', now);
  return { kind: 'live', detail: 'Passed its freshness gate' };
}

/**
 * A seeded connector's status from the compact health check. A problem check
 * is failing when it has no usable data (error, missing or empty) and degraded
 * otherwise; a pending warning or a check that is not listed is live. With
 * several checks the worst one sets the status, and its detail names it.
 */
export function healthConnectorStatus(healthKeys: string | readonly string[], health: ResourceState<CompactHealth>, now: number): ConnectorStatus {
  if (health.status === 'loading') return { kind: 'loading', detail: 'Checking…' };
  if (health.status !== 'ready') return { kind: 'unknown', detail: 'Health check unavailable' };
  const keys = typeof healthKeys === 'string' ? [healthKeys] : healthKeys;
  let worst: ConnectorStatus | null = null;
  for (const key of keys) {
    const status = checkStatus(key, health.data, now);
    const named = keys.length > 1 && status.kind !== 'live' ? { ...status, detail: `${status.detail} · ${key}` } : status;
    if (!worst || STATUS_ORDER[named.kind] < STATUS_ORDER[worst.kind]) worst = named;
  }
  return worst ?? { kind: 'unknown', detail: 'No health check named' };
}

/** A news digest connector's status from the digest the screens load. */
export function digestConnectorStatus(digest: ResourceState<ListFeedDigestResponse>, now: number): ConnectorStatus {
  if (digest.status === 'loading') return { kind: 'loading', detail: 'Loading…' };
  if (digest.status === 'error') return { kind: 'failing', detail: 'Digest unavailable' };
  if (digest.status === 'empty') return { kind: 'degraded', detail: 'Digest returned no stories' };
  const coverage = digest.data.coverage;
  const generated = Date.parse(digest.data.generatedAt ?? '');
  const updatedAt = Number.isFinite(generated) ? generated : undefined;
  const feeds = coverage && coverage.feedTotal > 0 ? { completed: coverage.feedCompleted, total: coverage.feedTotal } : undefined;
  return {
    kind: 'live',
    detail: feeds ? `${feeds.completed} of ${feeds.total} feeds answered` : 'Digest loaded',
    updatedAt,
    ageMin: updatedAt != null ? Math.max(0, Math.round((now - updatedAt) / 60_000)) : undefined,
    feeds,
  };
}

export interface ConnectorRow {
  connector: Connector;
  status: ConnectorStatus;
}

const STATUS_ORDER: Readonly<Record<ConnectorStatusKind, number>> = { failing: 0, degraded: 1, unknown: 2, loading: 3, live: 4 };
const DOMAIN_ORDER: Readonly<Record<ConnectorDomain, number>> = { geo: 0, fin: 1, tech: 2, all: 3 };

/** Sorted by status (failing first), then domain, keeping catalogue order within each. */
export function sortConnectorRows(rows: readonly ConnectorRow[]): ConnectorRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) =>
      STATUS_ORDER[a.row.status.kind] - STATUS_ORDER[b.row.status.kind]
      || DOMAIN_ORDER[a.row.connector.domain] - DOMAIN_ORDER[b.row.connector.domain]
      || a.index - b.index)
    .map(({ row }) => row);
}

export function needsAttention(status: ConnectorStatus): boolean {
  return status.kind === 'failing' || status.kind === 'degraded';
}

// ---- Licensing and tiers -----------------------------------------------------

/** Distinct upstream hosts across the catalogue, per manifest licence status. */
export function licenceTally(connectors: readonly Connector[] = CONNECTORS): Record<Licence, string[]> {
  const byHost = new Map<string, Licence>();
  for (const c of connectors) for (const h of c.hosts) byHost.set(h.host, h.licence);
  const out: Record<Licence, string[]> = { reviewed: [], 'terms-review': [], excluded: [] };
  for (const [host, licence] of byHost) out[licence].push(host);
  for (const list of Object.values(out)) list.sort();
  return out;
}

export interface TierRow {
  tier: DeclaredTier;
  meaning: string;
  outlets: number;
  /** How the Lite UI uses the tier. */
  inLite: string;
}

const TIER_IN_LITE: Readonly<Record<DeclaredTier, string>> = {
  1: 'Marked Tier 1 beside the corroboration verdict. It never upgrades the verdict.',
  2: 'Counts as a publisher toward Corroborated.',
  3: 'Counts as a publisher toward Corroborated.',
  4: 'A story seen only from these outlets reads Low-tier only.',
};

/** The tier table: meaning and outlet count per declared tier (RSS, Telegram and X). */
export function tierRows(tiers: Readonly<Record<string, number>> = SOURCE_TIERS): TierRow[] {
  const counts: Record<DeclaredTier, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const tier of Object.values(tiers)) if (tier === 1 || tier === 2 || tier === 3 || tier === 4) counts[tier]++;
  return ([1, 2, 3, 4] as const).map((tier) => ({ tier, meaning: TIER_MEANING[tier], outlets: counts[tier], inLite: TIER_IN_LITE[tier] }));
}

/** 30 → "30 min", 420 → "7 h", 1440 → "24 h", 2880 → "2 d". */
export function minutesLabel(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  const hours = min / 60;
  if (hours < 48) return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
  return `${Math.round(hours / 24)} d`;
}
