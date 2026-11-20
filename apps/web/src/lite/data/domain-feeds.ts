/**
 * Each domain's indicator feeds as hooks, shared by its screen and by the
 * Briefing's fired-indicators block (spec: Screen design, Briefing; #121).
 * The rules live in the *-indicators modules; these hooks only load their
 * sources and call them.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { INTEL_HOTSPOTS } from '@wm/client/config/geo';
import { safeStorageGet, safeStorageSet } from '@wm/client/utils/safe-storage';
import { regionStrip, violenceFeeds, type RegionTile } from './conflict';
import { escalationLevel, scoreHotspots } from './escalation';
import { financeFeeds, riskGaugeFeeds } from './finance-indicators';
import { centralBankFeeds, financeMacroFeeds, rateOddsFeed } from './finance-macro-indicators';
import { aircraftFeeds, gpsFeeds, seaIncidentFeeds } from './geo-layers';
import { chokepointFeeds, embassyAlertFeeds, euSanctionsFeeds, exportControlFeeds, newSanctionsFeeds, restrictedPartyFeeds, taiwanStraitFeeds, travelAdvisoryFeeds } from './geo-watch';
import {
  useChokepoints,
  useCommodityQuotes,
  useConflictCounts,
  useAiModels,
  useAiRegulation,
  useBreaches,
  useAiLabNews,
  useChipRevenue,
  useHyperscalerCapex,
  useCreditSpreads,
  useCrossStraitActivity,
  useCryptoQuotes,
  useDigest,
  useEarthquakes,
  useEmbassyAlerts,
  useEtfFlows,
  useCslAdditions,
  useEuSanctions,
  useFederalRegister,
  useFearGreed,
  useGoldIntelligence,
  useGpsHighCells,
  useHyperliquid,
  useInternetOutages,
  useMacroCalendar,
  useMaterialEvents,
  useMilitaryFlights,
  useOtherBonds,
  useRateOdds,
  useCbDecisions,
  useMacroForecasts,
  useRecentKev,
  useRiskScores,
  useSanctions,
  useSeaIncidents,
  useServiceStatuses,
  useShippingRates,
  useStablecoins,
  useThreatHistory,
  useTravelLevels,
  useTreasuryCurves,
  useUnrestEvents,
  useVixDaily,
} from './hooks';
import { sortFeeds, type FeedState } from './indicators';
import { REGION_HISTORY_KEY, decodeRegionHistory, recordReadings, regionEscalationFeeds, regionReadings, type RegionHistory } from './region-escalation';
import { ESCALATION_REGIONS } from './regions';
import type { ResourceState } from './store';
import { techFeeds } from './tech-indicators';
import { digestItems } from './transforms';

export type Escalation = ReturnType<typeof scoreHotspots>;

/**
 * The live hotspot scores and the region strip's tiles, from whichever inputs
 * have loaded. The map draws both; the indicator panel orders its region
 * groups by the tiles' levels.
 */
export function useEscalation(): { escalation: Escalation; tiles: RegionTile[]; source: ResourceState<unknown> } {
  const digest = useDigest('full');
  const risk = useRiskScores();
  const unrest = useUnrestEvents();
  const earthquakes = useEarthquakes();
  const flights = useMilitaryFlights();
  const conflict = useConflictCounts();
  const escalation = useMemo(
    () =>
      scoreHotspots(
        INTEL_HOTSPOTS,
        {
          news: digest.status === 'ready' ? digestItems(digest.data) : null,
          ciiScores: risk.status === 'ready' ? risk.data.ciiScores : null,
          unrest: unrest.status === 'ready' ? unrest.data : null,
          earthquakes: earthquakes.status === 'ready' ? earthquakes.data : null,
          flights: flights.status === 'ready' ? flights.data : null,
        },
        Date.now(),
      ),
    [digest, risk, unrest, earthquakes, flights],
  );
  const counts = conflict.status === 'ready' ? conflict.data : null;
  const tiles = useMemo(
    () =>
      regionStrip(
        ESCALATION_REGIONS,
        escalation.map(({ hotspot, score }) => ({ hotspot, score: score.combinedScore, level: escalationLevel(score.combinedScore), components: score.components })),
        counts,
        Date.now(),
      ),
    [escalation, counts],
  );
  // The region-escalation feed's state: ready once both main score inputs (risk scores and news) loaded,
  // so a first reading is never taken from a partial score.
  const source: ResourceState<unknown> = risk.status === 'ready' && digest.status === 'ready' ? risk
    : risk.status !== 'ready' && risk.status !== 'loading' ? risk
    : digest.status !== 'ready' && digest.status !== 'loading' ? digest
    : { status: 'loading', data: null, at: 0 };
  return { escalation, tiles, source };
}

/**
 * Every Geopolitics feed, sorted: fired newest first, then quiet, stale and
 * unavailable. Keeps this browser's region-level readings (#117) up to date.
 */
export function useGeoFeeds({ escalation, tiles, source: escalationSource }: { escalation: Escalation; tiles: readonly RegionTile[]; source: ResourceState<unknown> }): FeedState[] {
  // Region levels seen in this browser (#117): read once, then one reading added per strip update.
  const [levelHistory, setLevelHistory] = useState<RegionHistory>(() => decodeRegionHistory(safeStorageGet(REGION_HISTORY_KEY)));
  useEffect(() => {
    if (escalationSource.status !== 'ready') return;
    const readings = regionReadings(tiles, escalation[0]?.missing);
    if (!readings.length) return;
    const next = recordReadings(decodeRegionHistory(safeStorageGet(REGION_HISTORY_KEY)), readings, Date.now());
    safeStorageSet(REGION_HISTORY_KEY, JSON.stringify(next));
    setLevelHistory(next);
  }, [tiles, escalation, escalationSource]);
  const conflict = useConflictCounts();
  const digest = useDigest('full');
  const flights = useMilitaryFlights();
  const sea = useSeaIncidents();
  const gpsCells = useGpsHighCells();
  const chokepoints = useChokepoints();
  const strait = useCrossStraitActivity();
  const embassy = useEmbassyAlerts();
  const sanctions = useSanctions();
  const federalRegister = useFederalRegister();
  const cslAdditions = useCslAdditions();
  const euSanctions = useEuSanctions();
  const travelLevels = useTravelLevels();
  return useMemo(() => {
    const now = Date.now();
    const news = digest.status === 'ready' ? digestItems(digest.data) : [];
    return sortFeeds([
      ...violenceFeeds(conflict.status === 'ready' ? conflict.data : null, conflict.status, news, now),
      ...aircraftFeeds(flights, INTEL_HOTSPOTS, news, now),
      ...seaIncidentFeeds(sea, news, now),
      ...gpsFeeds(gpsCells, INTEL_HOTSPOTS, news, now),
      ...chokepointFeeds(chokepoints, news, now),
      ...taiwanStraitFeeds(strait, news, now),
      ...embassyAlertFeeds(embassy, INTEL_HOTSPOTS, news, now),
      ...newSanctionsFeeds(sanctions, news, now),
      ...euSanctionsFeeds(euSanctions, INTEL_HOTSPOTS, news, now),
      ...exportControlFeeds(federalRegister, news, now),
      ...restrictedPartyFeeds(cslAdditions, news, now),
      ...travelAdvisoryFeeds(travelLevels, INTEL_HOTSPOTS, news, now),
      ...regionEscalationFeeds({ regions: ESCALATION_REGIONS, tiles, source: escalationSource, missing: escalation[0]?.missing, history: levelHistory, news, now }),
      AIRSPACE_FEED,
    ]);
  }, [conflict, digest, flights, sea, gpsCells, chokepoints, strait, embassy, sanctions, euSanctions, federalRegister, cslAdditions, travelLevels, tiles, escalation, escalationSource, levelHistory]);
}

/** The airspace row stays unavailable until the FAA grants NOTAM access (spec: Owner decisions). */
const AIRSPACE_FEED: FeedState = { kind: 'unavailable', id: 'airspace', name: 'Airspace closures · NOTAM', detail: 'Awaiting FAA access' };

/** Every Finance feed, sorted: fired newest first, then quiet, stale and unavailable. */
export function useFinanceFeeds(): FeedState[] {
  const crypto = useCryptoQuotes();
  const flow = useHyperliquid();
  const stables = useStablecoins();
  const fearGreed = useFearGreed();
  const commodities = useCommodityQuotes();
  const gold = useGoldIntelligence();
  // FRED's VIX close only when the commodity quotes settled without ^VIX.
  const vixDaily = useVixDaily(commodities.status !== 'loading' && !(commodities.status === 'ready' && commodities.data.some((q) => q.symbol === '^VIX')));
  const calendar = useMacroCalendar();
  const curves = useTreasuryCurves();
  const spreads = useCreditSpreads();
  const odds = useRateOdds();
  const cbDecisions = useCbDecisions();
  const forecasts = useMacroForecasts();
  const bonds = useOtherBonds();
  const etf = useEtfFlows();
  const rates = useShippingRates();
  const filings = useMaterialEvents();
  const digest = useDigest('finance');
  return useMemo(() => {
    const news = digest.status === 'ready' ? digestItems(digest.data) : [];
    const now = Date.now();
    return sortFeeds([
      ...financeFeeds({ crypto, flow, stables, fearGreed, news, now }),
      ...riskGaugeFeeds({ commodities, vixDaily, gold, news, now }),
      ...financeMacroFeeds({ calendar, forecasts, curves, spreads, bonds, etf, flow, rates, filings, news, now }),
      rateOddsFeed({ odds, news, now }),
      ...centralBankFeeds({ decisions: cbDecisions, calendar, news, now }),
    ]);
  }, [crypto, flow, stables, fearGreed, commodities, vixDaily, gold, calendar, forecasts, curves, spreads, odds, cbDecisions, bonds, etf, rates, filings, digest]);
}


/** Every Technology feed, sorted. */
export function useTechFeeds(): FeedState[] {
  const outages = useInternetOutages();
  const services = useServiceStatuses();
  const kev = useRecentKev();
  const history = useThreatHistory();
  const filings = useMaterialEvents();
  const models = useAiModels();
  const regulation = useAiRegulation();
  const breaches = useBreaches();
  const labNews = useAiLabNews();
  const chipRevenue = useChipRevenue();
  const capex = useHyperscalerCapex();
  const digest = useDigest('tech');
  return useMemo(
    () => techFeeds({ outages, services, kev, history, filings, models, regulation, breaches, labNews, chipRevenue, capex, news: digest.status === 'ready' ? digestItems(digest.data) : [], now: Date.now() }),
    [outages, services, kev, history, filings, models, regulation, breaches, labNews, chipRevenue, capex, digest],
  );
}
