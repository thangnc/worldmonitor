/**
 * Loaders for the Lite UI. Each returns real data or null; none returns samples.
 *
 * Read path, same as the dashboard's (App.ts startup):
 * 1. The bootstrap tiers (`fetchBootstrapData`) hydrate shared keys once.
 *    `getHydratedData` deletes a key on read, so the first load takes it here.
 * 2. Later refreshes, and keys the tiers did not carry (local dev serves no
 *    /api/bootstrap), go to the generated RPC clients with plain fetch.
 * 3. The news digest goes through its public CDN shape (`publicRpcFetch`).
 *
 * No premium path is used (src/shared/premium-paths.ts).
 */
import type { ListFeedDigestResponse } from '@/generated/client/worldmonitor/news/v1/service_client';
import type {
  CryptoQuote,
  GetFearGreedIndexResponse,
  GetGoldIntelligenceResponse,
  GetHyperliquidFlowResponse,
  ListEtfFlowsResponse,
  ListStablecoinMarketsResponse,
  MarketQuote,
  CommodityQuote,
} from '@/generated/client/worldmonitor/market/v1/service_client';
import type { GetRiskScoresResponse, GetCountryHistoryResponse } from '@/generated/client/worldmonitor/intelligence/v1/service_client';
import type { UcdpViolenceEvent } from '@/generated/client/worldmonitor/conflict/v1/service_client';
import type { EconomicEvent } from '@/generated/client/worldmonitor/economic/v1/service_client';
import type { ArxivPaper, HackernewsItem } from '@/generated/client/worldmonitor/research/v1/service_client';
import {
  ConflictServiceClient,
  EconomicServiceClient,
  IntelligenceServiceClient,
  MarketServiceClient,
  ResearchServiceClient,
} from '@/services/generated-rpc-clients';
import { getRpcBaseUrl, rpcFetch } from '@/services/rpc-client';
import { publicRpcFetch } from '@/services/public-rpc-fetch';
import { toApiUrl } from '@/services/runtime';
import { ensureHydrated, fetchBootstrapData, getHydratedData, waitForBootstrapSlowTier } from '@/services/bootstrap';
import { isMarketCorrelationPayload } from '@/services/news-market-correlation';

const options = { fetch: rpcFetch };
const market = new MarketServiceClient(getRpcBaseUrl(), options);
const intelligence = new IntelligenceServiceClient(getRpcBaseUrl(), options);
const conflict = new ConflictServiceClient(getRpcBaseUrl(), options);
const economic = new EconomicServiceClient(getRpcBaseUrl(), options);
const research = new ResearchServiceClient(getRpcBaseUrl(), options);

let bootstrapReady: Promise<void> | null = null;

/** Starts the bootstrap tiers once. Failures are fine: loaders fall back to RPCs. */
export function startBootstrap(): Promise<void> {
  bootstrapReady ??= fetchBootstrapData()
    .then(() => waitForBootstrapSlowTier(4_000))
    .then(() => undefined)
    .catch(() => undefined);
  return bootstrapReady;
}

const consumed = new Set<string>();

/** The bootstrap value for `key`, at most once per page load. */
async function hydrated<T>(key: string, accept: (value: unknown) => value is T): Promise<T | null> {
  if (consumed.has(key)) return null;
  consumed.add(key);
  await startBootstrap();
  const value = getHydratedData(key);
  return accept(value) ? value : null;
}

const hasArray = <K extends string>(key: K) =>
  (value: unknown): value is Record<K, unknown[]> =>
    typeof value === 'object' && value !== null && Array.isArray((value as Record<string, unknown>)[key]);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

// ---- News digests -----------------------------------------------------------

export type DigestEdition = 'full' | 'finance' | 'tech';

export async function loadDigest(edition: DigestEdition): Promise<ListFeedDigestResponse | null> {
  const resp = await publicRpcFetch(
    toApiUrl(`/api/news/v1/list-feed-digest?variant=${edition}&lang=en`),
    { signal: AbortSignal.timeout(15_000) },
  );
  if (!resp.ok) throw new Error(`digest ${edition}: HTTP ${resp.status}`);
  const data = (await resp.json()) as ListFeedDigestResponse;
  return data.categories && Object.keys(data.categories).length > 0 ? data : null;
}

// ---- Geopolitics ------------------------------------------------------------

export async function loadRiskScores(): Promise<GetRiskScoresResponse | null> {
  const boot = await hydrated('riskScores', hasArray('ciiScores'));
  const resp = boot ? (boot as unknown as GetRiskScoresResponse) : await intelligence.getRiskScores({ region: '' });
  return resp.ciiScores.length ? resp : null;
}

export async function loadCountryHistory(country: string): Promise<GetCountryHistoryResponse | null> {
  const resp = await intelligence.getCountryHistory({ country, days: 7 });
  return resp.points.length ? resp : null;
}

export async function loadUcdpEvents(): Promise<UcdpViolenceEvent[] | null> {
  const boot = await hydrated('ucdpEvents', hasArray('events'));
  const events = boot
    ? (boot.events as UcdpViolenceEvent[])
    : (await conflict.listUcdpEvents({ start: 0, end: 0, pageSize: 0, cursor: '', country: '' })).events;
  return events.filter((e) => e.location && Number.isFinite(e.location.latitude));
}

// ---- Finance ----------------------------------------------------------------

export async function loadCryptoQuotes(): Promise<CryptoQuote[] | null> {
  const boot = await hydrated('cryptoQuotes', hasArray('quotes'));
  return boot ? (boot.quotes as CryptoQuote[]) : (await market.listCryptoQuotes({ ids: [] })).quotes;
}

export const EQUITY_SYMBOLS = ['^GSPC', '^TNX'] as const;

export async function loadMarketQuotes(): Promise<MarketQuote[] | null> {
  const boot = await hydrated('marketQuotes', hasArray('quotes'));
  const fromBoot = (boot?.quotes as MarketQuote[] | undefined)?.filter((q) => (EQUITY_SYMBOLS as readonly string[]).includes(q.symbol));
  if (fromBoot && fromBoot.length === EQUITY_SYMBOLS.length) return fromBoot;
  return (await market.listMarketQuotes({ symbols: [...EQUITY_SYMBOLS] })).quotes;
}

export async function loadCommodityQuotes(): Promise<CommodityQuote[] | null> {
  const boot = await hydrated('commodityQuotes', hasArray('quotes'));
  const brent = (boot?.quotes as CommodityQuote[] | undefined)?.filter((q) => q.symbol === 'BZ=F');
  if (brent?.length) return brent;
  return (await market.listCommodityQuotes({ symbols: ['BZ=F'] })).quotes;
}

export async function loadGoldIntelligence(): Promise<GetGoldIntelligenceResponse | null> {
  const resp = await market.getGoldIntelligence({});
  return resp.unavailable ? null : resp;
}

export async function loadHyperliquid(): Promise<GetHyperliquidFlowResponse | null> {
  const boot = await hydrated('hyperliquidFlow', hasArray('assets'));
  const resp = boot ? (boot as unknown as GetHyperliquidFlowResponse) : await market.getHyperliquidFlow({});
  return resp.unavailable || !resp.assets.length ? null : resp;
}

export async function loadEtfFlows(): Promise<ListEtfFlowsResponse | null> {
  const boot = await hydrated('etfFlows', isObject);
  const resp = boot && 'summary' in boot ? (boot as unknown as ListEtfFlowsResponse) : await market.listEtfFlows({});
  return resp.summary && resp.summary.etfCount > 0 ? resp : null;
}

export async function loadStablecoins(): Promise<ListStablecoinMarketsResponse | null> {
  const boot = await hydrated('stablecoinMarkets', hasArray('stablecoins'));
  const resp = boot ? (boot as unknown as ListStablecoinMarketsResponse) : await market.listStablecoinMarkets({ coins: [] });
  return resp.stablecoins.length ? resp : null;
}

export async function loadFearGreed(): Promise<GetFearGreedIndexResponse | null> {
  const boot = await hydrated('fearGreedIndex', isObject);
  const resp = boot && 'compositeScore' in boot ? (boot as unknown as GetFearGreedIndexResponse) : await market.getFearGreedIndex({});
  return resp.compositeScore > 0 ? resp : null;
}

export async function loadMacroCalendar(): Promise<EconomicEvent[] | null> {
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const resp = await economic.getEconomicCalendar({ fromDate: day(0), toDate: day(7) });
  return resp.unavailable ? null : resp.events;
}

/** Hourly closes per symbol, 14 days (on-demand bootstrap key `marketCorrelationSeries`). */
export async function loadCorrelationSeries(): Promise<Record<string, number[]> | null> {
  const payload = await ensureHydrated('marketCorrelationSeries');
  if (!isMarketCorrelationPayload(payload)) return null;
  const out: Record<string, number[]> = {};
  for (const series of payload.series) {
    const values = series.points.map((p) => p.value).filter((v) => Number.isFinite(v));
    if (values.length > 2) out[series.symbol] = values;
  }
  return Object.keys(out).length ? out : null;
}

// ---- Technology & AI --------------------------------------------------------

/** Page sizes match what the research seeder caches, so these stay cache hits. */
export async function loadArxiv(): Promise<ArxivPaper[] | null> {
  return (await research.listArxivPapers({ category: 'cs.AI', pageSize: 50, cursor: '', query: '' })).papers;
}

export async function loadHackerNews(): Promise<HackernewsItem[] | null> {
  return (await research.listHackernewsItems({ feedType: 'top', pageSize: 30, cursor: '' })).items;
}

// ---- Ingestion health -------------------------------------------------------

export interface CompactHealth {
  status: string;
  checkedAt?: string;
  summary?: { total?: number; ok?: number; warn?: number; stale?: number; empty?: number; error?: number };
}

export async function loadHealth(): Promise<CompactHealth | null> {
  const resp = await fetch(toApiUrl('/api/health?compact=1'), { cache: 'no-cache', signal: AbortSignal.timeout(10_000) });
  if (!resp.ok) throw new Error(`health: HTTP ${resp.status}`);
  if (!(resp.headers.get('content-type') ?? '').includes('json')) throw new Error('health: endpoint not served here');
  const data = (await resp.json()) as CompactHealth;
  return data.status ? data : null;
}
