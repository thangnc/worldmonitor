import { useMemo } from 'preact/hooks';
import { useResource } from './store';
import * as src from './sources';
import {
  GEO_CATEGORIES,
  MARKET_CATEGORIES,
  TECH_CATEGORIES,
  byImportance,
  digestItems,
  dropNearDuplicates,
  interleaveByMarketTag,
  isWarStory,
  threatRank,
  type LiteItem,
} from './transforms';
import type { ListFeedDigestResponse } from '@/generated/client/worldmonitor/news/v1/service_client';
import { rankPriorityEvents, type PriorityEvent } from './briefing';

export const useDigest = (edition: src.DigestEdition) => useResource(`digest:${edition}`, () => src.loadDigest(edition));
export const useRiskScores = () => useResource('riskScores', src.loadRiskScores);
export const useCountryHistory = (code: string) => useResource(`history:${code}`, () => src.loadCountryHistory(code));
export const useUcdpEvents = () => useResource('ucdpEvents', src.loadUcdpEvents);
export const useCryptoQuotes = () => useResource('cryptoQuotes', src.loadCryptoQuotes);
export const useMarketQuotes = () => useResource('marketQuotes', src.loadMarketQuotes);
export const useCommodityQuotes = () => useResource('commodityQuotes', src.loadCommodityQuotes);
export const useGoldIntelligence = () => useResource('goldIntelligence', src.loadGoldIntelligence);
export const useHyperliquid = () => useResource('hyperliquid', src.loadHyperliquid);
export const useEtfFlows = () => useResource('etfFlows', src.loadEtfFlows);
export const useStablecoins = () => useResource('stablecoins', src.loadStablecoins);
export const useFearGreed = () => useResource('fearGreed', src.loadFearGreed);
export const useMacroCalendar = () => useResource('macroCalendar', src.loadMacroCalendar);
export const useCorrelationSeries = () => useResource('correlationSeries', src.loadCorrelationSeries);
export const useArxiv = () => useResource('arxiv', src.loadArxiv);
export const useHackerNews = () => useResource('hackerNews', src.loadHackerNews);
export const useHealth = () => useResource('health', src.loadHealth);
export const useInsights = () => useResource('insights', src.loadInsights);

/** Geopolitics incidents: medium threat or above from the geo buckets, most important first. */
export function selectIncidents(digest: ListFeedDigestResponse | null): LiteItem[] {
  return digestItems(digest, GEO_CATEGORIES)
    .filter((item) => threatRank(item.threat?.level) >= 2)
    .sort(byImportance);
}

/**
 * Market-moving items from the finance edition: no war stories (Geopolitics
 * has them), one copy per story (the most important), taken in turns across
 * asset classes.
 */
export function selectMarketEvents(digest: ListFeedDigestResponse | null): LiteItem[] {
  const ranked = digestItems(digest, MARKET_CATEGORIES)
    .filter((item) => (item.importanceScore || 0) > 0 && !isWarStory(item))
    .sort(byImportance);
  return interleaveByMarketTag(dropNearDuplicates(ranked));
}

/** Material AI and tech developments from the tech edition. */
export function selectTechDevelopments(digest: ListFeedDigestResponse | null): LiteItem[] {
  return digestItems(digest, TECH_CATEGORIES)
    .filter((item) => item.category !== 'funding')
    .sort(byImportance);
}

/** Sidebar domain counts: the row count each screen's main list would show. */
export function useDomainCounts(): { geopolitics?: number; finance?: number; tech?: number } {
  const full = useDigest('full');
  const finance = useDigest('finance');
  const tech = useDigest('tech');
  return {
    geopolitics: full.status === 'ready' ? selectIncidents(full.data).length : undefined,
    finance: finance.status === 'ready' ? selectMarketEvents(finance.data).length : undefined,
    tech: tech.status === 'ready' ? selectTechDevelopments(tech.data).length : undefined,
  };
}

/**
 * The Briefing's cross-domain events: each domain screen's main list, merged
 * and ranked by impact × confidence. `ready` is false until all three digests
 * have settled.
 */
export function usePriorityEvents(): { ready: boolean; failed: boolean; ranked: PriorityEvent[]; below: PriorityEvent[] } {
  const full = useDigest('full');
  const finance = useDigest('finance');
  const tech = useDigest('tech');
  const states = [full, finance, tech];
  const ready = states.every((s) => s.status !== 'loading');
  const failed = states.every((s) => s.status === 'error' || s.status === 'empty');
  const { ranked, below } = useMemo(
    () =>
      rankPriorityEvents([
        { domain: 'geo', items: full.status === 'ready' ? selectIncidents(full.data) : [] },
        { domain: 'fin', items: finance.status === 'ready' ? selectMarketEvents(finance.data) : [] },
        { domain: 'tech', items: tech.status === 'ready' ? selectTechDevelopments(tech.data) : [] },
      ]),
    [full, finance, tech],
  );
  return { ready, failed, ranked, below };
}
