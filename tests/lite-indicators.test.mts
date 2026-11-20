// Lite early indicators: the news link rule, feed states and the Finance
// rules (spec: docs/engineering/architecture/lite.md › Early indicators).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { NewsItem } from '../packages/contracts/generated/client/worldmonitor/news/v1/service_client.ts';
import type {
  CryptoQuote,
  GetFearGreedIndexResponse,
  GetGoldIntelligenceResponse,
  GetHyperliquidFlowResponse,
  ListStablecoinMarketsResponse,
} from '../packages/contracts/generated/client/worldmonitor/market/v1/service_client.ts';
import { DRIVERS, LINK_WINDOW_HOURS, MAX_LINKED_STORIES, linkNews, matchReason, offsetLabel } from '../apps/web/src/lite/data/news-link.ts';
import { STALE_FACTOR, feedCounts, feedState, feedTier, sortFeeds, type FeedState, type Indicator } from '../apps/web/src/lite/data/indicators.ts';
import { centreCard, chokepointPins, featureIso2, newSanctionCountries, pinIdForFeed, sanctionFills, shippingLanes, signalCard, signalPins } from '../apps/web/src/lite/data/markets-map.ts';
import { buildPriceBoard } from '../apps/web/src/lite/data/prices.ts';
import { CENTRAL_BANKS } from '../packages/client/config/finance-geo.ts';
import { STRATEGIC_WATERWAYS } from '../packages/client/config/geo.ts';
import { TRADE_ROUTES } from '../packages/client/config/trade-routes.ts';
import type { ChokepointInfo } from '../packages/contracts/generated/client/worldmonitor/supply_chain/v1/service_client.ts';
import { DXY_MOVE_PCT, STABLECOIN_DEPEG_PCT, SUPPLY_COIN_WEEK_PCT, SUPPLY_TOP_COINS, SUPPLY_TOTAL_WEEK_PCT, VIX_JUMP_PCT, VIX_LEVEL, decodeStablecoinSupply, dollarIndex, financeFeeds, riskGaugeFeeds, stablecoinSupplyFeeds, vixReading } from '../apps/web/src/lite/data/finance-indicators.ts';
import type { InternetOutage, ListInternetOutagesResponse, ListServiceStatusesResponse, ServiceStatus } from '../packages/contracts/generated/client/worldmonitor/infrastructure/v1/service_client.ts';
import {
  KEV_NEW_DAYS,
  SPIKE_RATIO,
  decodeRecentKev,
  decodeThreatHistory,
  kevSubject,
  kevWeekCounts,
  watchedVendor,
  CYBER_8K_ITEM,
  cyberFilings,
  techFeeds,
  threatBaseline,
  AI_NEW_DAYS,
  aiModelFeeds,
  OPEN_MODEL_NEW_DAYS,
  LAB_NEWS_NEW_DAYS,
  decodeAiLabNews,
  CHIP_YOY_SHIFT_PTS,
  chipRevenueFeeds,
  decodeChipRevenue,
  CAPEX_YOY_SHIFT_PTS,
  capexTotal,
  decodeHyperscalerCapex,
  hyperscalerCapexFeeds,
  labNewsFeeds,
  fitNames,
  openModelFeeds,
  decodeAiModels,
  AI_REG_NEW_DAYS,
  aiRegulationFeeds,
  decodeAiRegulation,
  BREACH_MIN_ACCOUNTS,
  BREACH_NEW_DAYS,
  accountsText,
  breachFeeds,
  breachVendor,
  decodeBreaches,
  modelPriceText,
  type ExploitedVulnerability,
  type RecentKev,
  type ThreatHistory,
} from '../apps/web/src/lite/data/tech-indicators.ts';
import type { LiteItem } from '../apps/web/src/lite/data/transforms.ts';
import { ESCALATION_REGIONS, groupFeedsByRegion, regionOfPlace } from '../apps/web/src/lite/data/regions.ts';
import {
  REGION_FIRE_RANK,
  REGION_LEVELS,
  baselineOf,
  changedParts,
  decodeRegionHistory,
  rankOfScore,
  recordReadings,
  regionEscalationFeeds,
  regionReadings,
} from '../apps/web/src/lite/data/region-escalation.ts';
import type { MilitaryFlight } from '../packages/contracts/generated/client/worldmonitor/military/v1/service_client.ts';
import type { ListUkmtoIncidentsResponse } from '../packages/contracts/generated/client/worldmonitor/maritime/v1/service_client.ts';
import {
  AIRCRAFT_MIN,
  AIRCRAFT_RADIUS_KM,
  GPS_REGION_MIN,
  GPS_REGION_RISE,
  aircraftFeeds,
  gpsFeeds,
  gpsHexFills,
  gpsIndicators,
  isGpsHighCells,
  layerRangeNote,
  seaAreas,
  seaIncidentFeeds,
  type GpsHighCells,
} from '../apps/web/src/lite/data/geo-layers.ts';
import {
  MIN_REPORTS,
  conflictHistogram,
  countryShading,
  shadingBasis,
  historyReady,
  regionStrip,
  violenceFeeds,
  violenceIndicators,
  violenceSpike,
  type ConflictCounts,
} from '../apps/web/src/lite/data/conflict.ts';
import type {
  EconomicEvent,
  GetEconomicCalendarResponse,
  GetGovernmentYieldCurveResponse,
  UsTreasuryParYieldCurve,
} from '../packages/contracts/generated/client/worldmonitor/economic/v1/service_client.ts';
import type { ListEtfFlowsResponse } from '../packages/contracts/generated/client/worldmonitor/market/v1/service_client.ts';
import type { GetShippingRatesResponse, ShippingIndex } from '../packages/contracts/generated/client/worldmonitor/supply_chain/v1/service_client.ts';
import type { ListMaterialEventsResponse, MaterialEvent } from '../packages/contracts/generated/client/worldmonitor/intelligence/v1/service_client.ts';
import {
  ETF_SAME_WAY,
  FILING_WINDOW_HOURS,
  FREIGHT_MOVE_PCT,
  HY_DAY_BP,
  HY_WEEK_BP,
  IG_DAY_BP,
  KEY_8K_ITEMS,
  MACRO_FORECAST_PAYROLLS_K,
  MACRO_FORECAST_PCT_PT,
  MACRO_PAYROLLS_K,
  MACRO_PCT_PT,
  MACRO_RECENT_DAYS,
  PERP_STRESS,
  YIELD_MOVE_BP,
  CREDIT_SERIES,
  bdiFeed,
  creditSpreadFeed,
  decodeCreditSpreads,
  BALANCE_SHEET_SERIES,
  BALANCE_SHEET_WEEK_BN,
  RRP_DAY_BN,
  balanceSheetFeed,
  decodeFedBalanceSheet,
  decodeReverseRepo,
  reverseRepoFeed,
  decodeMacroForecasts,
  etfFlowFeed,
  filingsFeed,
  financeMacroFeeds,
  macroFeed,
  matchFilings,
  newYorkTime,
  normalizeCompany,
  otherBondsFeed,
  perpPositioningFeed,
  recentMacroPrints,
  scfiFeed,
  spreadBp,
  spreadMove,
  treasuryFeed,
  treasuryWindow,
  watchCompany,
  RATE_ODDS_MOVE_PTS,
  CB_DECISION_WINDOW_HOURS,
  cbDecisionForEvent,
  cbDecisionValue,
  centralBankFeeds,
  decodeCbDecisions,
  decodeRateOdds,
  rateOddsFeed,
  rateOutcomeLabel,
} from '../apps/web/src/lite/data/finance-macro-indicators.ts';
import type { ResourceState } from '../apps/web/src/lite/data/store.ts';
import type { ListSanctionsPressureResponse } from '../packages/contracts/generated/client/worldmonitor/sanctions/v1/service_client.ts';
import {
  CHOKEPOINT_TRANSIT_SHARE,
  TAIWAN_RATIO,
  chokepointFeeds,
  chokepointIndicators,
  embassyAlertFeeds,
  embassyAlertIndicators,
  embassyCoverage,
  isCrossStraitSnapshot,
  SANCTIONS_ENTRY_LIMIT,
  FED_REG_NEW_DAYS,
  RESTRICTED_COUNTRY_MIN,
  cslComparisonNote,
  decodeCslAdditions,
  decodeFederalRegister,
  newRestrictedParties,
  restrictedPartyFeeds,
  decodeTravelLevels,
  EU_SANCTIONS_DAY_MIN,
  decodeEuSanctions,
  euSanctionsFeeds,
  newEuListings,
  travelAdvisoryFeeds,
  travelChangeFires,
  travelCoverageNote,
  exportControlFeeds,
  tradeCountries,
  newOfacDesignations,
  newSanctionsFeeds,
  taiwanStraitFeeds,
  taiwanStraitIndicators,
  type EmbassyAlerts,
} from '../apps/web/src/lite/data/geo-watch.ts';
import type { GetChokepointStatusResponse } from '../packages/contracts/generated/client/worldmonitor/supply_chain/v1/service_client.ts';
import type { SecurityAdvisoryItem } from '../packages/contracts/generated/client/worldmonitor/intelligence/v1/service_client.ts';
import type { CrossStraitActivitySnapshot } from '../packages/client/types/cross-strait-activity.ts';

const H = 3_600_000;
const AT = Date.UTC(2026, 10, 8, 12);

function story(title: string, publishedAt: number, overrides: Partial<NewsItem> = {}): LiteItem {
  return {
    source: 'Reuters',
    title,
    link: `https://example.com/${encodeURIComponent(title)}`,
    publishedAt,
    isAlert: false,
    locationName: '',
    importanceScore: 50,
    corroborationCount: 1,
    snippet: '',
    tickers: [],
    credibilityScore: 50,
    category: 'markets',
    ...overrides,
  };
}

function ready<T>(data: T, at = AT): ResourceState<T> {
  return { status: 'ready', data, at };
}

describe('news link rule', () => {
  it('searches from the window before the trigger to one hour after it', () => {
    const items = [
      story('Bitcoin slides as ETF outflows grow', AT - 6 * H),
      story('Bitcoin rebounds after the slide', AT + H),
      story('Bitcoin traders brace for the Fed', AT - 6 * H - 60_000),
      story('Bitcoin late follow-up', AT + H + 60_000),
    ];
    const links = linkNews({ instruments: ['BTC'] }, items, AT, LINK_WINDOW_HOURS.fin);
    assert.deepEqual(links.stories.map((s) => s.item.title).sort(), ['Bitcoin rebounds after the slide', 'Bitcoin slides as ETF outflows grow']);
    assert.equal(links.searched, 2);
    assert.equal(links.windowHours, 6);
  });

  it('names why each story matched: ticker, country, entity or driver', () => {
    assert.deepEqual(matchReason({ instruments: ['^TNX'] }, story('Treasury yields jump after payrolls', AT)), { kind: 'ticker', label: 'ticker: US10Y' });
    // A savings-account "yield" is not the 10-year: no link at all.
    assert.equal(matchReason({ instruments: ['^TNX'], drivers: DRIVERS['^TNX'] }, story('Best High-Yield Savings Accounts of November 2026: Up to 5%', AT)), null);
    assert.deepEqual(matchReason({ instruments: ['NVDA'] }, story('Chipmaker beats estimates', AT, { tickers: ['nvda'] })), { kind: 'ticker', label: 'ticker: NVDA' });
    assert.deepEqual(matchReason({ countries: [{ name: 'Yemen', code: 'YE' }] }, story('Yemen port struck overnight', AT)), { kind: 'country', label: 'country: Yemen' });
    assert.deepEqual(matchReason({ entities: ['bitcoin'] }, story('Spot BTC funds see outflows', AT, { title: 'Spot funds see outflows', snippet: 'Bitcoin products lost $200M' })), { kind: 'entity', label: 'entity: Bitcoin' });
    assert.deepEqual(matchReason({ drivers: ['Fed'] }, story('Fed’s Waller says cuts may wait', AT)), { kind: 'driver', label: 'driver: Fed' });
    // Whole words only: "Fed" is not in "Federal Express" or "fedora".
    assert.equal(matchReason({ drivers: ['Fed'] }, story('FedEx earnings and a fedora sale', AT)), null);
    // The other country named first owns the headline.
    assert.equal(matchReason({ countries: [{ name: 'Iran', code: 'IR' }] }, story('Israel strikes Iran', AT)), null);
  });

  it('ranks by match strength, then closeness in time, then publishers', () => {
    const items = [
      story('Fed comments weigh on markets', AT - 10 * 60_000),
      story('Bitcoin falls 5% in two hours', AT - 3 * H),
      story('Bitcoin selling spreads to miners', AT - H, { corroborationCount: 1 }),
      story('Crypto lenders pause withdrawals as bitcoin drops', AT - H, { corroborationCount: 4 }),
    ];
    const links = linkNews({ instruments: ['BTC'], drivers: ['Fed'] }, items, AT, 6);
    assert.deepEqual(links.stories.map((s) => s.item.title), [
      'Crypto lenders pause withdrawals as bitcoin drops',
      'Bitcoin selling spreads to miners',
      'Bitcoin falls 5% in two hours',
    ]);
    assert.equal(links.stories.length, MAX_LINKED_STORIES);
    assert.equal(links.searched, 4);
  });

  it('counts a near-duplicate headline once', () => {
    const items = [story('Bitcoin falls 5% in two hours', AT - H), story('Bitcoin falls 5% in two hours', AT - 2 * H, { source: 'AP' })];
    const links = linkNews({ instruments: ['BTC'] }, items, AT, 6);
    assert.equal(links.stories.length, 1);
    assert.equal(links.searched, 1);
  });

  it('returns no story, never a guess, when nothing matches', () => {
    const links = linkNews({ instruments: ['BTC'] }, [story('Wheat harvest beats forecasts', AT - H)], AT, 6);
    assert.deepEqual(links.stories, []);
    assert.equal(links.searched, 1);
  });

  it('labels offsets from the trigger', () => {
    assert.equal(offsetLabel(-H), '−1h');
    assert.equal(offsetLabel(20 * 60_000), '+20m');
    assert.equal(offsetLabel(-3 * H - 10 * 60_000), '−3h');
    assert.equal(offsetLabel(10_000), 'now');
  });
});

describe('feed states', () => {
  const fired: Indicator = {
    id: 'x', domain: 'fin', name: 'X', value: '1', rule: 'r', trust: { level: 'market', source: 'S' }, at: AT, links: { stories: [], searched: 0, windowHours: 6 },
  };
  const base = { id: 'x', name: 'X', seeder: 'seed-x', cadenceMin: 10, now: AT };

  it('is unavailable when the source failed or is empty, naming the seeder', () => {
    const failed = feedState({ ...base, source: { status: 'error', data: null, at: AT, error: 'HTTP 500' }, fired: null });
    assert.equal(failed.kind, 'unavailable');
    assert.match(failed.kind === 'unavailable' ? failed.detail : '', /seed-x/);
    assert.equal(feedState({ ...base, source: { status: 'empty', data: null, at: AT }, fired: null }).kind, 'unavailable');
  });

  it('is stale past STALE_FACTOR cadences, even when its rule fired', () => {
    const late = AT - (STALE_FACTOR * 10 + 1) * 60_000;
    assert.equal(feedState({ ...base, source: ready({}), dataAt: late, fired }).kind, 'stale');
    assert.equal(feedState({ ...base, source: ready({}), dataAt: AT - 15 * 60_000, fired }).kind, 'fired');
  });

  it('never claims stale without a data timestamp', () => {
    assert.equal(feedState({ ...base, source: ready({}), fired: null }).kind, 'quiet');
  });

  it('sorts fired newest first, then quiet, stale, unavailable', () => {
    const feeds = sortFeeds([
      { kind: 'unavailable', id: 'u', name: 'U', detail: '' },
      { kind: 'fired', id: 'old', name: 'O', indicator: { ...fired, id: 'old', at: AT - H } },
      { kind: 'quiet', id: 'q', name: 'Q', detail: '' },
      { kind: 'stale', id: 's', name: 'S', detail: '' },
      { kind: 'fired', id: 'new', name: 'N', indicator: { ...fired, id: 'new', at: AT } },
    ]);
    assert.deepEqual(feeds.map((f) => f.id), ['new', 'old', 'q', 's', 'u']);
    assert.deepEqual(feedCounts(feeds), { fired: 2, quiet: 1, stale: 1, unavailable: 1, loading: 0 });
  });
});

describe('Finance indicator rules', () => {
  const btc = (change: number): CryptoQuote => ({ symbol: 'BTC', name: 'Bitcoin', price: 71240, change, sparkline: [] } as unknown as CryptoQuote);
  const stables = (deviation: number, price: number): ListStablecoinMarketsResponse => ({
    timestamp: new Date(AT - 5 * 60_000).toISOString(),
    stablecoins: [
      { id: 'tether', symbol: 'usdt', name: 'Tether', price: 1.0003, deviation: 0.03, pegStatus: 'ON PEG' },
      { id: 'ethena-usde', symbol: 'usde', name: 'Ethena USDe', price, deviation, pegStatus: deviation > 1 ? 'DEPEGGED' : deviation > 0.5 ? 'SLIGHT DEPEG' : 'ON PEG' },
    ],
  } as unknown as ListStablecoinMarketsResponse);
  const flow = { ts: '', fetchedAt: new Date(AT - 60_000).toISOString(), warmup: false, assetCount: 1, assets: [{ symbol: 'BTC', funding: '0.00002' }], unavailable: false } as unknown as GetHyperliquidFlowResponse;
  const fg = { compositeScore: 55, compositeLabel: 'Neutral', seededAt: new Date(AT - H).toISOString() } as unknown as GetFearGreedIndexResponse;

  function feeds(opts: { change?: number; deviation?: number; price?: number; news?: LiteItem[] }) {
    return financeFeeds({
      crypto: ready([btc(opts.change ?? -1)]),
      flow: ready(flow),
      stables: ready(stables(opts.deviation ?? 0.1, opts.price ?? 0.999)),
      fearGreed: ready(fg),
      news: opts.news ?? [],
      now: AT,
    });
  }

  it(`fires a stablecoin depeg above ${STABLECOIN_DEPEG_PCT}% from $1, not below`, () => {
    assert.equal(feeds({ deviation: 0.4, price: 0.996 }).find((f) => f.id === 'stablecoin-depeg')?.kind, 'quiet');
    const fired = feeds({ deviation: 0.6, price: 0.994 }).find((f) => f.id === 'stablecoin-depeg');
    assert.equal(fired?.kind, 'fired');
    if (fired?.kind !== 'fired') return;
    assert.equal(fired.indicator.name, 'Stablecoin depeg · USDe');
    assert.equal(fired.indicator.value, '$0.9940');
    assert.equal(fired.indicator.change, '−0.60% from $1');
    assert.equal(fired.indicator.trust.level, 'market');
  });

  it('links a fired rule to stories naming its subject, and says when none does', () => {
    const news = [story('Ethena’s USDe slips below its peg', AT - 2 * H), story('Wheat harvest beats forecasts', AT - H)];
    const linked = feeds({ deviation: 0.6, price: 0.994, news }).find((f) => f.id === 'stablecoin-depeg');
    assert.equal(linked?.kind === 'fired' && linked.indicator.links.stories[0]?.reason.label, 'driver: USDe');
    const btcMove = feeds({ change: -5, news }).find((f) => f.id === 'btc-move');
    assert.equal(btcMove?.kind, 'fired');
    assert.equal(btcMove?.kind === 'fired' && btcMove.indicator.links.stories.length, 0);
    assert.equal(btcMove?.kind === 'fired' && btcMove.indicator.links.searched, 2);
  });

  it('puts fired rules first and keeps the quiet ones with their reading', () => {
    const list = feeds({ change: -5 });
    assert.equal(list[0]?.id, 'btc-move');
    const quiet = list.find((f) => f.id === 'fear-greed');
    assert.equal(quiet?.kind, 'quiet');
    assert.match(quiet?.kind === 'quiet' ? quiet.detail : '', /Score 55 \(Neutral\)/);
  });
});

describe('Finance indicator rules: VIX and the dollar index', () => {
  const vixQuote = (price: number, change: number) => ({ symbol: '^VIX', name: 'VIX', display: 'VIX', price, change, sparkline: [] });
  const brent = { symbol: 'BZ=F', name: 'Brent', display: 'BRENT', price: 80, change: 0.5, sparkline: [] };
  const gold = (value: number, changePct: number) => ({
    updatedAt: new Date(AT - 5 * 60_000).toISOString(), unavailable: false,
    drivers: [{ symbol: 'DX-Y.NYB', label: 'DXY', value, changePct, correlation30d: -0.4 }, { symbol: '^TNX', label: 'US10Y', value: 4.4, changePct: 2, correlation30d: -0.2 }],
  }) as unknown as GetGoldIntelligenceResponse;
  const loading = { status: 'loading', data: null, at: 0 } as const;
  const failed = { status: 'error', data: null, at: AT, error: 'x' } as const;
  const gauges = (opts: { quotes?: ReturnType<typeof vixQuote>[]; fred?: { date: string; value: number }[]; dxy?: [number, number]; news?: LiteItem[] }) => {
    const list = riskGaugeFeeds({
      commodities: ready([brent, ...(opts.quotes ?? [vixQuote(16.2, 1.5)])]),
      vixDaily: opts.fred ? ready(opts.fred) : loading,
      gold: ready(gold(...(opts.dxy ?? [99.8, 0.2]))),
      news: opts.news ?? [],
      now: AT,
    });
    return { vix: list.find((f) => f.id === 'vix')!, dxy: list.find((f) => f.id === 'dollar-index')! };
  };

  it(`fires the VIX at ${VIX_LEVEL} or above, or up ${VIX_JUMP_PCT}% in a day, and stays quiet otherwise`, () => {
    const quiet = gauges({}).vix;
    assert.equal(quiet.kind, 'quiet');
    assert.equal(quiet.kind === 'quiet' && quiet.detail, `VIX 16.20 +1.5% · fires at ≥ ${VIX_LEVEL} or +${VIX_JUMP_PCT}%`);
    const level = gauges({ quotes: [vixQuote(26.4, 4)] }).vix;
    assert.equal(level.kind, 'fired');
    if (level.kind === 'fired') {
      assert.equal(level.indicator.value, '26.40');
      assert.equal(level.indicator.change, '+4.0% today');
      assert.equal(level.indicator.detail, `at or above ${VIX_LEVEL}`);
      assert.deepEqual(level.indicator.trust, { level: 'market', source: 'Cboe via Yahoo' });
    }
    const jump = gauges({ quotes: [vixQuote(19, 21)] }).vix;
    assert.equal(jump.kind === 'fired' && jump.indicator.detail, 'up 21.0% in a day');
    // A fall, however large, does not fire.
    assert.equal(gauges({ quotes: [vixQuote(18, -25)] }).vix.kind, 'quiet');
    // Near the trigger: 20 or more, or up 10% or more.
    const near = gauges({ quotes: [vixQuote(21, 2)] }).vix;
    assert.equal(near.kind === 'quiet' && near.detail.endsWith('near the trigger'), true);
  });

  it('falls back to the FRED VIX close when the quote is missing, and names its date', () => {
    const fred = [{ date: '2026-11-05', value: 20 }, { date: '2026-11-06', value: 25.5 }];
    const reading = vixReading([brent], fred);
    assert.equal(reading?.source, 'fred');
    assert.equal(reading?.level, 25.5);
    assert.equal(reading?.date, '2026-11-06');
    assert.ok(Math.abs((reading?.changePct ?? 0) - 27.5) < 1e-9);
    const feed = gauges({ quotes: [], fred }).vix;
    assert.equal(feed.kind, 'fired');
    if (feed.kind === 'fired') {
      assert.equal(feed.indicator.trust.source, 'Cboe via FRED (VIXCLS)');
      assert.equal(feed.indicator.dataDate, 'close 6 Nov');
      assert.equal(feed.indicator.change, '+27.5% on the prior close');
      assert.equal(feed.indicator.detail, `at or above ${VIX_LEVEL} · up 27.5% in a day`);
    }
    // No quote and the fallback still loading: loading, not a confident quiet.
    assert.equal(gauges({ quotes: [] }).vix.kind, 'loading');
    // No quote and an empty fallback: unavailable, naming the seeder.
    const none = riskGaugeFeeds({ commodities: ready([brent]), vixDaily: { status: 'empty', data: null, at: AT }, gold: ready(gold(99, 0)), news: [], now: AT })[0]!;
    assert.equal(none.kind, 'unavailable');
    assert.match(none.kind === 'unavailable' ? none.detail : '', /seed-commodity-quotes/);
    assert.equal(riskGaugeFeeds({ commodities: failed, vixDaily: loading, gold: failed, news: [], now: AT })[0]!.kind, 'unavailable');
  });

  it(`fires the dollar index on a ±${DXY_MOVE_PCT}% day and links dollar stories`, () => {
    assert.deepEqual(dollarIndex(gold(101.2, -0.3)), { value: 101.2, changePct: -0.3 });
    const quiet = gauges({ dxy: [99.8, 0.7] }).dxy;
    assert.equal(quiet.kind === 'quiet' && quiet.detail, `DXY 99.80 +0.70% · fires at ±${DXY_MOVE_PCT}% · near the trigger`);
    const news = [story('Dollar jumps as Fed signals no cut', AT - H), story('Wheat harvest beats forecasts', AT - H)];
    const up = gauges({ dxy: [101.4, 1.1], news }).dxy;
    assert.equal(up.kind, 'fired');
    if (up.kind === 'fired') {
      assert.equal(up.indicator.value, '101.40');
      assert.equal(up.indicator.change, '+1.10% today');
      assert.match(up.indicator.detail ?? '', /Dollar stronger/);
      assert.equal(up.indicator.links.stories.length, 1);
    }
    const down = gauges({ dxy: [97.9, -1.2] }).dxy;
    assert.equal(down.kind === 'fired' && down.indicator.detail, 'Dollar weaker');
    // No DXY driver in the gold data: unavailable, not quiet.
    const noDriver = riskGaugeFeeds({ commodities: ready([brent]), vixDaily: loading, gold: ready({ updatedAt: '', unavailable: false, drivers: [] } as unknown as GetGoldIntelligenceResponse), news: [], now: AT })[1]!;
    assert.equal(noDriver.kind, 'unavailable');
  });
});

describe('GDELT reported violence', () => {
  // 10:20 UTC: the last six complete hours are 04:00–09:59.
  const NOW = Date.UTC(2026, 10, 8, 10, 20);
  const HOUR = 3_600_000;
  const DAY = 86_400_000;
  const today = Date.UTC(2026, 10, 8);

  function build(opts: {
    hour?: (start: number) => Record<string, number>;
    day?: (start: number) => Record<string, number>;
    hourCohorts?: (start: number) => number;
    dayCohorts?: (start: number) => number;
    updatedAt?: number;
  } = {}): ConflictCounts {
    const currentHour = Math.floor(NOW / HOUR) * HOUR;
    const hours = Array.from({ length: 48 }, (_, i) => currentHour - (47 - i) * HOUR).map((start) => ({
      hour: new Date(start).toISOString().slice(0, 13),
      cohorts: start === currentHour ? 1 : opts.hourCohorts?.(start) ?? 4,
      byCountry: opts.hour?.(start) ?? {},
    }));
    const days = Array.from({ length: 30 }, (_, i) => today - (29 - i) * DAY).map((start) => ({
      date: new Date(start).toISOString().slice(0, 10),
      cohorts: start === today ? 41 : opts.dayCohorts?.(start) ?? 96,
      byCountry: opts.day?.(start) ?? {},
    }));
    return { updatedAt: opts.updatedAt ?? NOW - 5 * 60_000, cursor: '20261108101500', cohortsPerHour: 4, cohortsPerDay: 96, hours, days };
  }
  // Ukraine: 40 reports a day (10 per six hours); the last six complete hours hold `recent` per hour.
  const ukraine = (recent: number) => build({
    day: () => ({ UA: 40 }),
    hour: (start) => (start >= Math.floor(NOW / HOUR) * HOUR - 6 * HOUR ? { UA: recent } : { UA: 1 }),
  });

  it('fires at twice the 7-day average for six hours, and not below', () => {
    const spike = violenceSpike(ukraine(5), 'UA', NOW);
    assert.equal(spike?.reports, 30);
    assert.equal(spike?.expected, 10);
    assert.equal(spike?.ratio, 3);
    assert.equal(spike?.at, Math.floor(NOW / HOUR) * HOUR, 'the window ends at the current hour');
    assert.equal(violenceIndicators(ukraine(5), [], NOW).length, 1);
    // 19 reports: ×1.9, not a spike.
    const below = build({ day: () => ({ UA: 40 }), hour: (start) => (start >= Math.floor(NOW / HOUR) * HOUR - 6 * HOUR ? { UA: start === Math.floor(NOW / HOUR) * HOUR - HOUR ? 4 : 3 } : {}) });
    assert.equal(violenceSpike(below, 'UA', NOW)?.reports, 19);
    assert.equal(violenceIndicators(below, [], NOW).length, 0);
  });

  it(`needs at least ${MIN_REPORTS} reports even when the normal is near zero`, () => {
    const quiet = build({ day: () => ({}), hour: (start) => (start === Math.floor(NOW / HOUR) * HOUR - HOUR ? { ER: 4 } : {}) });
    assert.ok((violenceSpike(quiet, 'ER', NOW)?.ratio ?? 0) >= 2);
    assert.equal(violenceIndicators(quiet, [], NOW).length, 0);
  });

  it('reads a partial hour or a thin normal as unknown, never as calm', () => {
    const gap = build({ day: () => ({ UA: 40 }), hour: () => ({ UA: 9 }), hourCohorts: (start) => (start === Math.floor(NOW / HOUR) * HOUR - 3 * HOUR ? 2 : 4) });
    assert.equal(violenceSpike(gap, 'UA', NOW), null);
    assert.match(historyReady(gap, NOW).detail, /6 complete hours/);
    const thin = build({ day: () => ({ UA: 40 }), hour: () => ({ UA: 9 }), dayCohorts: (start) => (start < today - 3 * DAY ? 50 : 96) });
    assert.equal(violenceSpike(thin, 'UA', NOW), null);
    assert.match(historyReady(thin, NOW).detail, /5 complete days \(has 3\)/);
  });

  it('links a spike to digest stories naming the country', () => {
    const news = [story('Ukraine reports drone strikes on Kharkiv', NOW - 2 * HOUR), story('Wheat harvest beats forecasts', NOW - HOUR)];
    const [indicator] = violenceIndicators(ukraine(5), news, NOW);
    assert.equal(indicator?.name, 'Violence spike · Ukraine');
    assert.equal(indicator?.value, '30 reports');
    assert.equal(indicator?.change, '×3.0 vs 7-day avg');
    assert.equal(indicator?.trust.level, 'reported');
    assert.equal(indicator?.links.windowHours, 24);
    assert.deepEqual(indicator?.links.stories.map((s) => s.reason.label), ['country: Ukraine']);
  });

  it('says why nothing fired: no data, late, building history, or quiet', () => {
    assert.equal(violenceFeeds(null, 'error', [], NOW)[0]?.kind, 'unavailable');
    assert.equal(violenceFeeds(ukraine(5), 'ready', [], NOW)[0]?.kind, 'fired');
    // Its place groups it under its region on the panel (#116).
    const spike = violenceFeeds(ukraine(5), 'ready', [], NOW)[0];
    assert.deepEqual(spike?.kind === 'fired' && spike.indicator.place, { countries: ['UA'] });
    assert.equal(violenceFeeds(build({ day: () => ({ UA: 40 }), updatedAt: NOW - 45 * 60_000 }), 'ready', [], NOW)[0]?.kind, 'stale');
    const building = violenceFeeds(build({ dayCohorts: () => 10 }), 'ready', [], NOW)[0];
    assert.equal(building?.kind, 'unavailable');
    assert.match(building?.kind === 'unavailable' ? building.detail : '', /Building history/);
    const quiet = violenceFeeds(build({ day: () => ({ UA: 40 }), hour: () => ({ UA: 1 }) }), 'ready', [], NOW)[0];
    assert.equal(quiet?.kind, 'quiet');
  });

  it('shades a country only above its own normal, never by raw volume', () => {
    const c = build({
      day: () => ({ UA: 40, FR: 40, YE: 10 }),
      // Last 24 complete hours: Ukraine 4/h = 96 (×2.4), France 1.7/h ≈ 40 (×1), Yemen 2/h = 48 (×4.8).
      hour: () => ({ UA: 4, FR: 1.7, YE: 2 }),
    });
    const shade = countryShading(c, '24h', NOW);
    assert.equal(shade.basis, 'last 24h against the 7-day average');
    assert.equal(shade.partial, false);
    assert.equal(shade.byCountry.get('UA')?.step, 2);
    assert.equal(shade.byCountry.get('FR')?.step, 0);
    assert.equal(shade.byCountry.get('YE')?.step, 3);
    // The US files ten times Ukraine's volume at its normal: unshaded at 7d.
    const week = build({ day: (start) => ({ US: 400, UA: start >= today - 7 * DAY ? 120 : 40 }) });
    const s = countryShading(week, '7d', NOW);
    assert.equal(s.byCountry.get('US')?.step, 0, 'volume alone never shades');
    assert.equal(s.byCountry.get('UA')?.step, 3, "Ukraine's week at ×3 its normal");
    assert.equal(s.basis, 'last 7 days against the 22 before');
    assert.equal(countryShading(build({ hourCohorts: () => 3 }), '6h', NOW).partial, true);
  });

  it('draws hourly bars for 6h and 24h and daily bars for 7d, today partial', () => {
    const c = build({ hour: () => ({ UA: 2, FR: 1 }), day: () => ({ UA: 10 }) });
    const six = conflictHistogram(c, '6h', NOW);
    assert.equal(six.unit, 'hr');
    assert.deepEqual(six.bars.map((b) => b.value), [3, 3, 3, 3, 3, 3]);
    const week = conflictHistogram(c, '7d', NOW);
    assert.equal(week.unit, 'day');
    assert.equal(week.bars.length, 7);
    assert.equal(week.bars.at(-1)?.partial, true);
    assert.equal(week.bars[0]?.partial, false);
  });

  it('builds the region strip: level from the region\'s top hotspot, change over its countries, easing on a fall', () => {
    const regions = [
      { id: 'eastern-europe', name: 'Eastern Europe', countries: ['UA', 'RU', 'PL'], area: 'europe' as const },
      { id: 'red-sea', name: 'Red Sea / Aden', countries: ['YE', 'SA', 'EG'], area: 'middleeast' as const },
      { id: 'nowhere', name: 'Nowhere', countries: ['AQ'], area: 'asia' as const },
    ];
    const scored = [
      { hotspot: { id: 'moscow', name: 'Moscow' }, score: 3.1, level: { tone: 'elev' as const, label: 'Elevated' } },
      { hotspot: { id: 'kyiv', name: 'Kyiv' }, score: 4.2, level: { tone: 'high' as const, label: 'High' } },
      { hotspot: { id: 'sanaa', name: "Sana'a" }, score: 3.4, level: { tone: 'elev' as const, label: 'Elevated' } },
      { hotspot: { id: 'dc', name: 'DC' }, score: 4.9, level: { tone: 'crit' as const, label: 'Critical' } },
    ];
    // Eastern Europe: 24 h at 4/h (UA 3, RU 1) = 96 against 40 a day (+140%); Red Sea: 24 h at 0 against 10 a day (−100%).
    const c = build({ day: () => ({ UA: 30, RU: 10, YE: 10 }), hour: () => ({ UA: 3, RU: 1 }) });
    const tiles = regionStrip(regions, scored, c, NOW);
    assert.deepEqual(tiles.map((t) => t.id), ['eastern-europe', 'red-sea', 'nowhere'], 'list order, every region');
    assert.equal(tiles[0]?.level, 'High', "Kyiv's 4.2 beats Moscow's 3.1");
    assert.deepEqual(tiles[0]?.lead, { id: 'kyiv', name: 'Kyiv', score: 4.2 });
    assert.equal(tiles[0]?.area, 'europe');
    assert.equal(Math.round(tiles[0]?.change ?? 0), 140);
    assert.equal(tiles[0]?.bars.length, 14);
    assert.equal(tiles[0]?.bars.at(-2), 40, 'bars sum the region\'s countries');
    assert.equal(tiles[1]?.level, 'Easing');
    assert.equal(tiles[1]?.tone, 'muted');
    assert.equal(tiles[1]?.lead?.name, "Sana'a", 'a hotspot outside the region (DC) never sets its level');
    assert.equal(tiles[2]?.lead, null);
    assert.equal(tiles[2]?.level, 'No score');
    assert.equal(regionStrip(regions, scored, null, NOW)[0]?.change, null, 'no counts: change unknown');
    // One incomplete hour in the 24 leaves the change unknown, never calm.
    const gap = build({ day: () => ({ UA: 40 }), hour: () => ({ UA: 4 }), hourCohorts: (start) => (start === Math.floor(NOW / HOUR) * HOUR - 5 * HOUR ? 1 : 4) });
    assert.equal(regionStrip(regions, scored, gap, NOW)[0]?.change, null);
  });
});

describe('Finance indicator rules, step 3', () => {
  const ctx = { news: [] as LiteItem[], now: AT };
  const DAY = 24 * H;
  const ymd = (ts: number) => new Date(ts).toISOString().slice(0, 10);
  const event = (overrides: Partial<EconomicEvent>): EconomicEvent => ({
    event: 'CPI', country: 'US', date: ymd(AT - DAY), impact: 'high', actual: '', estimate: '', previous: '', unit: '%', ...overrides,
  });
  const calendar = (events: EconomicEvent[]) => ready<GetEconomicCalendarResponse>({ events, fromDate: '', toDate: '', total: events.length, unavailable: false, asOf: new Date(AT - H).toISOString() });

  it('reads release times in New York time across daylight saving', () => {
    assert.equal(new Date(newYorkTime('2026-11-06', 8, 30)).toISOString(), '2026-11-06T13:30:00.000Z');
    assert.equal(new Date(newYorkTime('2026-07-02', 8, 30)).toISOString(), '2026-07-02T12:30:00.000Z');
  });

  it(`fires a macro print ${MACRO_PCT_PT} pt or ${MACRO_PAYROLLS_K}k from the prior print, and labels the stand-in`, () => {
    const payrolls = event({ event: 'Nonfarm Payrolls', actual: '+165', previous: '+60', unit: 'K', date: '2026-11-06' });
    const feed = macroFeed({ calendar: calendar([payrolls]), ...ctx });
    assert.equal(feed.kind, 'fired');
    if (feed.kind !== 'fired') return;
    assert.equal(feed.indicator.name, 'Macro print · US payrolls');
    assert.equal(feed.indicator.value, '+165k');
    assert.equal(feed.indicator.change, '+105k vs prior');
    assert.match(feed.indicator.detail ?? '', /no Kalshi forecast for this release, so the prior print stands in/);
    assert.equal(feed.indicator.trust.level, 'official');
    // 0.3 after 0.1 is exactly 0.2 pt: it fires. 0.2 after 0.1 does not.
    assert.equal(macroFeed({ calendar: calendar([event({ actual: '+0.3', previous: '+0.1' })]), ...ctx }).kind, 'fired');
    assert.equal(macroFeed({ calendar: calendar([event({ actual: '+0.2', previous: '+0.1' })]), ...ctx }).kind, 'quiet');
  });

  describe('against the Kalshi forecast (#128)', () => {
    const released = newYorkTime(ymd(AT - DAY), 8, 30);
    const forecast = (o: Record<string, unknown> = {}) => ({ series: 'KXCPI', release: 'CPI', event: 'KXCPI-26OCT', releaseAt: released, median: 0.17, volume: 400_000, at: released - H, url: 'https://kalshi.com/markets/kxcpi', ...o });
    const forecasts = (list: Array<Record<string, unknown>>) => ready(decodeMacroForecasts({ fetchedAt: AT - H, forecasts: list })!);

    it(`fires CPI ${MACRO_FORECAST_PCT_PT} pt from the forecast and says the forecast rule fired`, () => {
      const feed = macroFeed({ calendar: calendar([event({ actual: '+0.3', previous: '+0.2' })]), forecasts: forecasts([forecast()]), ...ctx });
      assert.equal(feed.kind, 'fired');
      if (feed.kind !== 'fired') return;
      assert.equal(feed.indicator.change, '+0.13 pt vs forecast');
      assert.equal(feed.indicator.rule, `±${MACRO_FORECAST_PCT_PT} pt vs Kalshi forecast`);
      assert.match(feed.indicator.detail ?? '', /^Forecast \+0\.17% m\/m: market data \(Kalshi KXCPI, implied median, 400,000 contracts, read 60 min before release\) · prior print \+0\.2% m\/m$/);
    });

    it('stays quiet near the forecast even when the prior-print rule would fire', () => {
      const calendarWithJump = calendar([event({ actual: '+0.2', previous: '+0.0' })]);
      assert.equal(macroFeed({ calendar: calendarWithJump, ...ctx }).kind, 'fired', 'without a forecast the prior print fires');
      const quiet = macroFeed({ calendar: calendarWithJump, forecasts: forecasts([forecast({ median: 0.18 })]), ...ctx });
      assert.equal(quiet.kind, 'quiet');
      assert.match(quiet.kind === 'quiet' ? quiet.detail : '', /US CPI \+0\.2% m\/m, forecast \+0\.18% m\/m/);
    });

    it(`fires payrolls ${MACRO_FORECAST_PAYROLLS_K}k from the forecast, in thousands`, () => {
      const jobs = event({ event: 'Nonfarm Payrolls', actual: '+165', previous: '+120', unit: 'K' });
      const feed = macroFeed({ calendar: calendar([jobs]), forecasts: forecasts([forecast({ series: 'KXPAYROLLS', release: 'Nonfarm Payrolls', event: 'KXPAYROLLS-26OCT', median: 74.25 })]), ...ctx });
      assert.equal(feed.kind === 'fired' && feed.indicator.change, '+91k vs forecast');
    });

    it('falls back to the prior print for a forecast read too early, or for PCE, and says why', () => {
      const stale = macroFeed({ calendar: calendar([event({ actual: '+0.4', previous: '+0.1' })]), forecasts: forecasts([forecast({ at: released - 3 * DAY })]), ...ctx });
      assert.equal(stale.kind === 'fired' && stale.indicator.change, '+0.3 pt vs prior');
      const pce = macroFeed({ calendar: calendar([event({ event: 'PCE', actual: '+0.4', previous: '+0.1' })]), forecasts: forecasts([forecast({ release: 'PCE' })]), ...ctx });
      assert.match(pce.kind === 'fired' ? pce.indicator.detail ?? '' : '', /no market forecast for PCE, so the prior print stands in/);
    });

    it('names the next release\'s forecast while quiet, and notes when the forecasts are down', () => {
      const next = event({ date: ymd(AT + 3 * DAY) });
      const nextAt = newYorkTime(ymd(AT + 3 * DAY), 8, 30);
      const quiet = macroFeed({ calendar: calendar([next]), forecasts: forecasts([forecast({ releaseAt: nextAt, median: -0.123, at: AT - H })]), ...ctx });
      assert.match(quiet.kind === 'quiet' ? quiet.detail : '', /next US CPI 11 Nov, market expects −0\.12% m\/m/);
      const down = macroFeed({ calendar: calendar([next]), forecasts: { status: 'error', data: null, at: AT, error: 'x' }, ...ctx });
      assert.match(down.kind === 'quiet' ? down.detail : '', /Kalshi forecasts unavailable/);
      // A snapshot older than 3 h means the seeder stopped covering the release: no expectation shown.
      const old = macroFeed({ calendar: calendar([next]), forecasts: forecasts([forecast({ releaseAt: nextAt, median: -0.123, at: AT - 4 * H })]), ...ctx });
      assert.doesNotMatch(old.kind === 'quiet' ? old.detail : '', /market expects/);
    });

    it('waits for the forecasts before judging CPI or payrolls, but not PCE', () => {
      const loading = { status: 'loading' as const, data: null, at: AT };
      assert.equal(macroFeed({ calendar: calendar([event({ actual: '+0.4', previous: '+0.1' })]), forecasts: loading, ...ctx }).kind, 'quiet');
      assert.equal(macroFeed({ calendar: calendar([event({ event: 'PCE', actual: '+0.4', previous: '+0.1' })]), forecasts: loading, ...ctx }).kind, 'fired');
    });

    it('reads what the seeder writes (producer → reader)', async () => {
      const { buildForecasts } = await import('../scripts/seed-macro-forecasts.mjs');
      const ladder = [-0.1, 0, 0.1, 0.2].map((strike, i) => ({ event_ticker: 'KXCPI-26NOV', strike_type: 'greater', floor_strike: strike, yes_bid_dollars: String([0.9, 0.7, 0.3, 0.1][i]), yes_ask_dollars: String([0.92, 0.72, 0.32, 0.12][i]), volume_fp: '3000', close_time: new Date(AT + 2 * DAY).toISOString() }));
      const read = decodeMacroForecasts(JSON.parse(JSON.stringify({ fetchedAt: AT, forecasts: buildForecasts(ladder, AT) })));
      assert.equal(read?.forecasts.length, 1);
      assert.equal(read?.forecasts[0]?.release, 'CPI');
      assert.equal(read?.forecasts[0]?.median, 0.103, "0 + 0.21 / 0.40 × 0.1, plus half a step, to 3 decimals");
    });
  });

  it('ignores macro prints without an actual or older than the recent window', () => {
    assert.equal(macroFeed({ calendar: calendar([event({ actual: '', previous: '+0.1' })]), ...ctx }).kind, 'quiet');
    const old = event({ actual: '+0.9', previous: '+0.1', date: ymd(AT - (MACRO_RECENT_DAYS + 1) * DAY) });
    assert.equal(macroFeed({ calendar: calendar([old]), ...ctx }).kind, 'quiet');
    assert.equal(recentMacroPrints([event({ actual: '+0.9', previous: '+0.1', country: 'EU' })], AT).length, 0);
  });

  const curve = (daysAgo: number, twoYear: number, tenYear: number): UsTreasuryParYieldCurve => ({
    date: Date.UTC(2026, 10, 6) - daysAgo * DAY, threeMonth: 4.2, twoYear, fiveYear: 4.6, tenYear, thirtyYear: 5.2,
  });

  it(`fires Treasury yields on a ${YIELD_MOVE_BP} bp day move or a 2s10s sign flip`, () => {
    const moved = treasuryFeed({ curves: ready([curve(8, 4.4, 4.8), curve(1, 4.4, 4.75), curve(0, 4.51, 4.86)]), ...ctx });
    assert.equal(moved.kind, 'fired');
    if (moved.kind === 'fired') {
      assert.equal(moved.indicator.value, '4.51 / 4.86%');
      assert.equal(moved.indicator.change, '+11 / +11 bp');
      assert.equal(moved.indicator.dataDate, 'data to 6 Nov');
      assert.match(moved.indicator.detail ?? '', /2s10s \+35 bp \(−5 bp w\/w\) · no sign flip/);
    }
    const flipped = treasuryFeed({ curves: ready([curve(1, 4.5, 4.48), curve(0, 4.5, 4.53)]), ...ctx });
    assert.equal(flipped.kind, 'fired');
    if (flipped.kind === 'fired') assert.match(flipped.indicator.detail ?? '', /sign flip/);
    assert.equal(treasuryFeed({ curves: ready([curve(1, 4.5, 4.8), curve(0, 4.55, 4.85)]), ...ctx }).kind, 'quiet');
  });

  it('takes the week-ago curve as the newest one at least 7 days older', () => {
    const win = treasuryWindow([curve(9, 4, 4.5), curve(7, 4.1, 4.6), curve(3, 4.2, 4.7), curve(0, 4.3, 4.8)]);
    assert.equal(win?.weekAgo?.twoYear, 4.1);
    assert.equal(win?.prior?.twoYear, 4.2);
    assert.equal(spreadBp(win?.latest)?.toFixed(0), '50');
  });

  it('fires other 10-year bonds on the biggest mover and lists the rest', () => {
    const market = (country: string, prev: number, last: number): GetGovernmentYieldCurveResponse => ({
      country, source: `${country} source`, measure: 'par', unavailable: false,
      curves: [{ date: Date.UTC(2026, 10, 5), tenors: { '10y': prev } }, { date: Date.UTC(2026, 10, 6), tenors: { '10y': last } }],
    });
    const feed = otherBondsFeed({ bonds: ready([market('DE', 2.65, 2.71), market('GB', 4.48, 4.6), market('JP', 1.6, 1.62)]), ...ctx });
    assert.equal(feed.kind, 'fired');
    if (feed.kind !== 'fired') return;
    assert.equal(feed.indicator.name, 'Other 10y bonds · GB');
    assert.equal(feed.indicator.change, '+12 bp');
    assert.equal(feed.indicator.detail, 'DE 2.71% +6 bp · JP 1.62% +2 bp');
    assert.equal(feed.indicator.trust.source, 'GB source');
    assert.equal(otherBondsFeed({ bonds: ready([market('DE', 2.65, 2.71)]), ...ctx }).kind, 'quiet');
  });

  it(`fires bitcoin ETF flows when ${ETF_SAME_WAY} or more go the same way, as an estimate`, () => {
    const etf = (inflowCount: number, outflowCount: number) => ready<ListEtfFlowsResponse>({
      timestamp: new Date(AT - 10 * 60_000).toISOString(), rateLimited: false, etfs: [],
      summary: { etfCount: 10, totalVolume: 1, totalEstFlow: -214e6, netDirection: 'NET OUTFLOW', inflowCount, outflowCount },
    });
    const fired = etfFlowFeed({ etf: etf(2, 8), ...ctx });
    assert.equal(fired.kind, 'fired');
    if (fired.kind === 'fired') {
      assert.equal(fired.indicator.value, '−$214M net');
      assert.equal(fired.indicator.trust.level, 'estimated');
    }
    assert.equal(etfFlowFeed({ etf: etf(3, 7), ...ctx }).kind, 'quiet');
  });

  it(`fires perp positioning at a stress score of ${PERP_STRESS}, ignoring assets still warming up`, () => {
    const asset = (symbol: string, composite: number, warmup = false) => ({
      symbol, display: symbol, assetClass: 'crypto', group: 'crypto', funding: '0', openInterest: '0', markPx: '0', oraclePx: '0', dayNotional: '0',
      fundingScore: 70, volumeScore: 50, oiScore: 60, basisScore: 10, composite, sparkFunding: [], sparkOi: [], sparkScore: [], warmup, stale: false, staleSince: '', missingPolls: 0, alerts: [],
    });
    const flow = (assets: ReturnType<typeof asset>[]) => ready({ ts: String(AT), fetchedAt: new Date(AT).toISOString(), warmup: false, assetCount: assets.length, assets, unavailable: false } as unknown as GetHyperliquidFlowResponse);
    const fired = perpPositioningFeed({ flow: flow([asset('BTC', 40), asset('ETH', 72), asset('SOL', 64), asset('PAXG', 95, true)]), ...ctx });
    assert.equal(fired.kind, 'fired');
    if (fired.kind === 'fired') {
      assert.equal(fired.indicator.name, 'Perp positioning · ETH');
      assert.equal(fired.indicator.value, '72/100');
      assert.match(fired.indicator.detail ?? '', /also SOL 64/);
    }
    const warming = perpPositioningFeed({ flow: flow([asset('BTC', 99, true)]), ...ctx });
    assert.equal(warming.kind, 'quiet');
    if (warming.kind === 'quiet') assert.match(warming.detail, /warming up/);
  });

  const rates = (indices: Partial<ShippingIndex>[]) => ready<GetShippingRatesResponse>({
    fetchedAt: new Date(AT - H).toISOString(), upstreamUnavailable: false,
    indices: indices.map((i) => ({ indexId: '', name: '', currentValue: 0, previousValue: 0, changePct: 0, unit: '', history: [], spikeAlert: false, ...i })),
  });

  it(`fires SCFI on a dated ${FREIGHT_MOVE_PCT}% week-on-week move only`, () => {
    const scfi = { indexId: 'SCFI', currentValue: 1412, previousValue: 1332, history: [{ date: '2026-11-06', value: 1412 }] };
    const fired = scfiFeed({ rates: rates([{ ...scfi, changePct: 6, periodChangePct: 6, priorPeriodValue: 1332, priorPeriodDate: '2026-10-30' }]), ...ctx });
    assert.equal(fired.kind, 'fired');
    if (fired.kind === 'fired') {
      assert.equal(fired.indicator.change, '+6.0% w/w');
      assert.equal(fired.indicator.dataDate, 'week to 6 Nov');
      assert.equal(fired.indicator.trust.level, 'official');
    }
    // A display-only changePct with no dated prior never fires.
    assert.equal(scfiFeed({ rates: rates([{ ...scfi, changePct: 9 }]), ...ctx }).kind, 'quiet');
    assert.equal(scfiFeed({ rates: rates([{ indexId: 'BDI' }]), ...ctx }).kind, 'unavailable');
  });

  it(`fires the Baltic Dry on a ${FREIGHT_MOVE_PCT}% day move against a reported prior`, () => {
    const bdi = { indexId: 'BDI', history: [{ date: '2026-11-05', value: 2740 }] };
    assert.equal(bdiFeed({ rates: rates([{ ...bdi, currentValue: 2740, previousValue: 2600 }]), ...ctx }).kind, 'fired');
    assert.equal(bdiFeed({ rates: rates([{ ...bdi, currentValue: 2740, previousValue: 2694 }]), ...ctx }).kind, 'quiet');
    // No change reported: the source repeats the current value.
    const none = bdiFeed({ rates: rates([{ ...bdi, currentValue: 2740, previousValue: 2740, changePct: 0 }]), ...ctx });
    assert.equal(none.kind, 'quiet');
    if (none.kind === 'quiet') assert.match(none.detail, /no prior day reported/);
  });

  it('matches 8-K filers to the default stock list by name', () => {
    assert.equal(normalizeCompany('DELTA AIR LINES, INC.'), 'delta air lines');
    assert.equal(normalizeCompany('Eli Lilly & Co'), 'eli lilly');
    assert.equal(watchCompany('APPLE INC')?.symbol, 'AAPL');
    assert.equal(watchCompany('Meta Platforms, Inc.')?.symbol, 'META');
    assert.equal(watchCompany('JPMORGAN CHASE & CO')?.symbol, 'JPM');
    assert.equal(watchCompany('PROCTER & GAMBLE Co')?.symbol, 'PG');
    assert.equal(watchCompany('Meta Materials Inc.'), null);
    assert.equal(watchCompany('Applied Digital Corp'), null);
  });

  it(`fires on an 8-K from the stock list or with a key item, within ${FILING_WINDOW_HOURS} h`, () => {
    const filing = (company: string, codes: string[], hoursAgo: number): MaterialEvent => ({
      company, cik: '1', form: '8-K', accession: company, filedAtMs: AT - hoursAgo * H, url: 'https://www.sec.gov/x',
      items: codes.map((code) => ({ code, description: `Item ${code}` })),
    });
    const filings = (events: MaterialEvent[]) => ready<ListMaterialEventsResponse>({ events, unavailable: false, fetchedAtMs: AT - 10 * 60_000 });
    const matches = matchFilings([filing('Tiny Corp', ['1.01'], 1), filing('Sidus Space Inc.', ['4.02'], 2), filing('APPLE INC', ['5.02'], 3), filing('NVIDIA CORP', ['2.02'], 30)], AT);
    assert.deepEqual(matches.map((m) => m.event.company), ['Sidus Space Inc.', 'APPLE INC']);
    const feed = filingsFeed({ filings: filings([filing('Sidus Space Inc.', ['4.02'], 2), filing('APPLE INC', ['5.02'], 3)]), ...ctx });
    assert.equal(feed.kind, 'fired');
    if (feed.kind === 'fired') {
      assert.equal(feed.indicator.name, '8-K filing · Sidus Space Inc.');
      assert.equal(feed.indicator.value, `Item 4.02`);
      assert.equal(feed.indicator.rule, 'key item');
      assert.match(feed.indicator.detail ?? '', /1 more matching filing in 24 h/);
    }
    assert.equal(filingsFeed({ filings: filings([filing('Tiny Corp', ['1.01'], 1)]), ...ctx }).kind, 'quiet');
    assert.ok(KEY_8K_ITEMS['1.05']);
  });

  it('fires on credit spreads widening: HY 20 bp a day or 50 bp in 5 days, IG 5 bp a day', () => {
    // FRED keeps the spreads in percent; the rule works in basis points.
    const series = (values: number[], last = '2026-11-06') => values.map((value, i) => ({
      date: new Date(Date.parse(`${last}T00:00:00Z`) - (values.length - 1 - i) * 86_400_000).toISOString().slice(0, 10), value,
    }));
    const spreads = (hy: number[], ig: number[]) => ready({ hy: series(hy), ig: series(ig) });
    const calm = [3.0, 3.02, 3.01, 3.03, 3.05, 3.06];
    const igCalm = [0.85, 0.85, 0.86, 0.86, 0.86, 0.87];

    assert.deepEqual(spreadMove(series(calm)), { level: 306, day: 1, week: 6, date: '2026-11-06' });
    assert.equal(spreadMove([]), null);

    const quiet = creditSpreadFeed({ spreads: spreads(calm, igCalm), ...ctx });
    assert.equal(quiet.kind, 'quiet');
    if (quiet.kind === 'quiet') assert.match(quiet.detail, /^HY 306 bp \+1 bp · IG 87 bp \+1 bp · HY \+6 bp over 5 days · data to 6 Nov$/);

    const hyDay = creditSpreadFeed({ spreads: spreads([3.0, 3.02, 3.01, 3.03, 3.05, 3.25], igCalm), ...ctx });
    assert.equal(hyDay.kind, 'fired');
    if (hyDay.kind === 'fired') {
      assert.equal(hyDay.indicator.id, 'credit-spreads');
      assert.equal(hyDay.indicator.value, '325 / 87 bp');
      assert.equal(hyDay.indicator.change, `+${HY_DAY_BP} / +1 bp`);
      assert.equal(hyDay.indicator.trust.level, 'market');
      assert.equal(hyDay.indicator.trust.source, 'ICE BofA via FRED');
      assert.match(hyDay.indicator.detail ?? '', /^HY \+20 bp in a day · HY \+25 bp over 5 days$/);
      assert.equal(hyDay.indicator.dataDate, 'data to 6 Nov');
    }

    // 50 bp over 5 trading days without a 20 bp day.
    const hyWeek = creditSpreadFeed({ spreads: spreads([3.0, 3.1, 3.2, 3.3, 3.4, 3.5], igCalm), ...ctx });
    assert.equal(hyWeek.kind, 'fired');
    if (hyWeek.kind === 'fired') assert.equal(hyWeek.indicator.detail, `HY +${HY_WEEK_BP} bp in 5 days`);

    const igDay = creditSpreadFeed({ spreads: spreads(calm, [0.85, 0.85, 0.86, 0.86, 0.86, 0.91]), ...ctx });
    assert.equal(igDay.kind, 'fired');
    if (igDay.kind === 'fired') assert.match(igDay.indicator.detail ?? '', new RegExp(`IG \\+${IG_DAY_BP} bp in a day`));

    // Tightening never fires.
    assert.equal(creditSpreadFeed({ spreads: spreads([3.6, 3.5, 3.4, 3.3, 3.2, 3.0], [0.95, 0.85, 0.85, 0.85, 0.85, 0.8]), ...ctx }).kind, 'quiet');

    // A story about junk bonds links; the card says so instead of guessing.
    const withNews = creditSpreadFeed({ spreads: spreads([3.0, 3.02, 3.01, 3.03, 3.05, 3.25], igCalm), ...ctx, news: [story('Junk bond selloff deepens as defaults rise', newYorkTime('2026-11-06', 17, 0) - H)] });
    assert.equal(withNews.kind, 'fired');
    if (withNews.kind === 'fired') assert.equal(withNews.indicator.links.stories.length, 1);
    // A savings-account story is not about the bond market.
    const savings = creditSpreadFeed({ spreads: spreads([3.0, 3.02, 3.01, 3.03, 3.05, 3.25], igCalm), ...ctx, news: [story('5 Questions To Ask Before Opening A High-Yield Savings Account', newYorkTime('2026-11-06', 17, 0) - H)] });
    if (savings.kind === 'fired') assert.equal(savings.indicator.links.stories.length, 0);

    // Only one series back still reads; neither series is empty, not quiet.
    assert.deepEqual(decodeCreditSpreads({ [CREDIT_SERIES.hy]: { seriesId: CREDIT_SERIES.hy, title: '', units: '', frequency: '', observations: series(calm) } })?.ig, []);
    assert.equal(decodeCreditSpreads({}), null);
    assert.equal(creditSpreadFeed({ spreads: { status: 'error', data: null, at: AT, error: 'x' }, ...ctx }).kind, 'unavailable');
  });

  it(`fires on the Fed balance sheet moving $${BALANCE_SHEET_WEEK_BN}bn in a week (#136)`, () => {
    // WALCL: Wednesday levels in millions of US$, oldest first.
    const weeks = (values: number[], last = '2026-11-04') => values.map((value, i) => ({
      date: new Date(Date.parse(`${last}T00:00:00Z`) - (values.length - 1 - i) * 7 * 86_400_000).toISOString().slice(0, 10), value,
    }));
    const fired = balanceSheetFeed({ balance: ready(weeks([6_800_000, 6_790_000, 6_780_000, 6_770_000, 6_700_000])), ...ctx });
    assert.equal(fired.kind, 'fired');
    if (fired.kind === 'fired') {
      assert.equal(fired.indicator.id, 'fed-balance-sheet');
      assert.equal(fired.indicator.value, '$6.70tn');
      assert.equal(fired.indicator.change, '−$70.0bn w/w');
      assert.equal(fired.indicator.rule, 'balance sheet ±$50bn in a week');
      assert.equal(fired.indicator.detail, 'shrank $70.0bn in the week to 4 Nov · −$100.0bn over 4 weeks');
      assert.equal(fired.indicator.dataDate, 'week to 4 Nov');
      assert.deepEqual(fired.indicator.trust, { level: 'official', source: 'Federal Reserve H.4.1 via FRED' });
      // Released the next day at 16:30 New York time.
      assert.equal(fired.indicator.at, newYorkTime('2026-11-05', 16, 30));
    }
    const quiet = balanceSheetFeed({ balance: ready(weeks([6_800_000, 6_790_000, 6_780_000, 6_770_000, 6_760_000])), ...ctx });
    assert.equal(quiet.kind === 'quiet' && quiet.detail, '$6.76tn, −$10.0bn in the week to 4 Nov (−$40.0bn over 4 weeks) · fires at ±$50bn a week');
    // A release more than two weeks old is stale; no series is unavailable, naming the seeder.
    assert.equal(balanceSheetFeed({ balance: ready(weeks([6_800_000, 6_700_000], '2026-10-14')), ...ctx }).kind, 'stale');
    assert.equal(decodeFedBalanceSheet({}), null);
    assert.deepEqual(decodeFedBalanceSheet({ [BALANCE_SHEET_SERIES]: { seriesId: BALANCE_SHEET_SERIES, title: '', units: '', frequency: '', observations: weeks([2, 1]).reverse() } })?.map((o) => o.value), [2, 1]);
    const err = balanceSheetFeed({ balance: { status: 'error', data: null, at: AT, error: 'x' }, ...ctx });
    assert.match(err.kind === 'unavailable' ? err.detail : '', /seed-fred-rates/);
  });

  it(`fires on reverse repo take-up moving $${RRP_DAY_BN}bn in a day, says when it is the month end, and reads what the seeder writes (#136)`, async () => {
    const rrp = (days: Array<[string, number]>, o: Record<string, unknown> = {}) => ready(decodeReverseRepo({ fetchedAt: AT - H, days: days.map(([date, bn]) => ({ date, accepted: bn * 1e9 })), ...o })!);
    const fired = reverseRepoFeed({ rrp: rrp([['2026-11-02', 230], ['2026-10-30', 400]]), ...ctx, news: [story('Reverse repo usage drops as month-end cash returns', newYorkTime('2026-11-02', 14, 0))] });
    assert.equal(fired.kind, 'fired');
    if (fired.kind === 'fired') {
      assert.equal(fired.indicator.id, 'reverse-repo');
      assert.equal(fired.indicator.value, '$230.0bn');
      assert.equal(fired.indicator.change, '−$170.0bn d/d');
      assert.equal(fired.indicator.rule, 'reverse repo ±$100bn in a day');
      assert.equal(fired.indicator.detail, '−$170.0bn from $400.0bn on 30 Oct · around the month end');
      assert.equal(fired.indicator.dataDate, 'operation 2 Nov');
      assert.equal(fired.indicator.links.stories.length, 1);
    }
    const quiet = reverseRepoFeed({ rrp: rrp([['2026-11-06', 0.405], ['2026-11-05', 0.331]]), ...ctx });
    assert.equal(quiet.kind === 'quiet' && quiet.detail, '$0.41bn on 6 Nov, +$0.07bn from 5 Nov · fires at ±$100bn a day');
    assert.equal(reverseRepoFeed({ rrp: rrp([['2026-11-06', 0.4], ['2026-11-05', 0.3]], { fetchedAt: AT - 7 * H }), ...ctx }).kind, 'stale');
    const err = reverseRepoFeed({ rrp: { status: 'error', data: null, at: AT, error: 'x' }, ...ctx });
    assert.match(err.kind === 'unavailable' ? err.detail : '', /seed-reverse-repo/);
    assert.equal(decodeReverseRepo({ fetchedAt: AT, days: [{ date: 'x', accepted: 1 }] }), null);
    // A month whose last business day is the 27th: its spike is labelled too.
    const feb = reverseRepoFeed({ rrp: rrp([['2026-02-27', 300], ['2026-02-26', 100]]), ...ctx, now: Date.UTC(2026, 1, 27, 20) });
    assert.match(feb.kind === 'fired' ? feb.indicator.detail ?? '' : '', /around the month end/);
    // A story about the Reserve Bank of India's repo rate, or crypto liquidity, is not about the Fed.
    const rbi = reverseRepoFeed({ rrp: rrp([['2026-11-02', 230], ['2026-10-30', 400]]), ...ctx, news: [story('RBI holds repo rate as liquidity tightens in crypto markets', newYorkTime('2026-11-02', 13, 0))] });
    assert.equal(rbi.kind === 'fired' && rbi.indicator.links.stories.length, 0);

    // Producer → reader: the seeder's daily sums, through JSON, fire the card.
    const { dailyTakeUp } = await import('../scripts/seed-reverse-repo.mjs');
    const days = dailyTakeUp({ repo: { operations: [
      { operationDate: '2026-10-01', operationType: 'Reverse Repo', note: '', totalAmtAccepted: 230_100_000_000 },
      { operationDate: '2026-09-30', operationType: 'Reverse Repo', note: '', totalAmtAccepted: 399_200_000_000 },
    ] } });
    const read = decodeReverseRepo(JSON.parse(JSON.stringify({ fetchedAt: AT - H, unit: 'USD', days })))!;
    const card = reverseRepoFeed({ rrp: ready(read), ...ctx });
    assert.equal(card.kind === 'fired' && card.indicator.change, '−$169.1bn d/d');
  });

  it('lists every step-3 feed, each naming its seeder when its source failed', () => {
    const failed = { status: 'error', data: null, at: AT, error: 'x' } as const;
    const feeds = financeMacroFeeds({ calendar: failed, curves: failed, spreads: failed, bonds: failed, etf: failed, flow: failed, rates: failed, filings: failed, ...ctx });
    assert.deepEqual(feeds.map((f) => f.id), ['macro-print', 'treasury', 'credit-spreads', 'other-bonds', 'etf-flows', 'perp-positioning', 'freight-scfi', 'freight-bdi', 'sec-8k']);
    assert.ok(feeds.every((f) => f.kind === 'unavailable' && /seed-/.test(f.detail)));
    // With the Fed liquidity sources (#136).
    const all = financeMacroFeeds({ calendar: failed, curves: failed, spreads: failed, bonds: failed, etf: failed, flow: failed, rates: failed, filings: failed, balance: failed, rrp: failed, ...ctx });
    assert.deepEqual(all.slice(-2).map((f) => [f.id, f.kind === 'unavailable' && f.detail.match(/seed-[a-z-]+/)?.[0]]), [['fed-balance-sheet', 'seed-fred-rates'], ['reverse-repo', 'seed-reverse-repo']]);
  });
});

describe('Finance markets map', () => {
  const fired = (id: string, name: string, reading: string): FeedState => ({
    kind: 'fired', id, name, reading,
    indicator: { id, domain: 'fin', name, value: '1', rule: 'r', trust: { level: 'official', source: 's' }, at: AT, links: { stories: [], searched: 0, windowHours: 6 } },
  });
  const quiet = (id: string, reading: string): FeedState => ({ kind: 'quiet', id, name: id, detail: 'Live', reading });

  it('pins Finance signals at their issuer and keeps crypto off the map', () => {
    const feeds = [
      fired('macro-print', 'Macro print · US payrolls', 'payrolls +105k vs prior'),
      quiet('treasury', 'UST 10Y 4.86% +2 bp'),
      quiet('sec-8k', '8-K · 62 filings, none matched'),
      fired('etf-flows', 'Bitcoin ETF flows', 'ETF'),
      quiet('btc-move', 'BTC'),
    ];
    const bonds = [{ country: 'GB', source: 'BoE', level: 4.6, moveBp: 12, date: AT }, { country: 'DE', source: 'Bundesbank', level: 2.7, moveBp: 3, date: AT }];
    const pins = signalPins(feeds, bonds, 10);
    assert.deepEqual(pins.map((p) => p.id).sort(), ['signal:boe', 'signal:ecb', 'signal:fed', 'signal:nyse']);
    const fed = pins.find((p) => p.id === 'signal:fed')!;
    assert.equal(fed.fired, true);
    assert.deepEqual(fed.signals.map((s) => s.text), ['payrolls +105k vs prior', 'UST 10Y 4.86% +2 bp']);
    assert.equal(pins.find((p) => p.id === 'signal:boe')?.fired, true);
    assert.equal(pins.find((p) => p.id === 'signal:ecb')?.fired, false);
    assert.equal(fed.issuer.lat, CENTRAL_BANKS.find((b) => b.id === 'fed')?.lat);
    assert.equal(pinIdForFeed(feeds[3]!), null);
    assert.equal(pinIdForFeed(fired('other-bonds', 'Other 10y bonds · JP', 'x')), 'signal:boj');

    // The map card is plain lines, fired first; the indicator card stays in the panel.
    const card = signalCard(fed);
    assert.equal(card.kind, fed.issuer.name);
    assert.equal(card.value, '1 fired');
    assert.deepEqual(card.lines.map((l) => [l.text, l.style]), [
      ['payrolls +105k vs prior', 'mono'],
      ['UST 10Y 4.86% +2 bp · quiet', 'dim'],
      ['Source and linked news: in the indicator card.', 'dim'],
    ]);
    const ecb = signalCard(pins.find((p) => p.id === 'signal:ecb')!);
    assert.equal(ecb.value, 'quiet');
    assert.equal(ecb.lines.some((l) => l.text.startsWith('Source and linked news')), false);
  });

  it('gives a financial centre a plain card from the curated entry, labelled context only', () => {
    const card = centreCard({ id: 'fc-x', name: 'Zurich', city: 'Zurich', country: 'CH', lat: 0, lon: 0, type: 'regional', gfciRank: 9, specialties: ['Private Banking', 'Insurance'], description: 'Wealth hub' });
    assert.equal(card.value, 'GFCI #9');
    assert.deepEqual(card.lines.map((l) => [l.text, l.style]), [
      ['Regional centre · Switzerland', undefined],
      ['Private Banking · Insurance', 'mono'],
      ['Wealth hub', undefined],
      ['Context only: curated reference list, no live signal.', 'dim'],
    ]);
    // An offshore centre named apart from its city, with no rank, specialties or description.
    const bare = centreCard({ id: 'fc-y', name: 'Cayman Islands', city: 'George Town', country: 'KY', lat: 0, lon: 0, type: 'offshore' });
    assert.equal(bare.value, '');
    assert.deepEqual(bare.lines.map((l) => l.text), ['Offshore centre · George Town, Cayman Islands', 'Context only: curated reference list, no live signal.']);
  });

  it('draws every strategic waterway, coloured only when a status was read', () => {
    const board = buildPriceBoard([[{ symbol: 'BZ=F', price: 84.1, change: 2.9 }]]);
    const info = (id: string, status: string) => ({ id, name: id.toUpperCase(), lat: 1, lon: 2, status, disruptionScore: 70 } as unknown as ChokepointInfo);
    const pins = chokepointPins([info('bab_el_mandeb', 'red'), info('malacca_strait', 'yellow'), info('suez', 'green')], board, 6);
    assert.equal(pins.length, STRATEGIC_WATERWAYS.length);
    const by = (id: string) => pins.find((p) => p.id === `chokepoint:${id}`)!;
    assert.equal(by('bab_el_mandeb').tone, 'crit');
    assert.equal(by('bab_el_mandeb').moved, 'Brent +2.9% 24h');
    assert.equal(by('malacca_strait').moved, 'SCFI +6.0% w/w');
    assert.equal(by('suez').moved, null);
    assert.equal(by('panama').tone, 'dim');
    assert.equal(by('panama').info, null);
  });

  it('turns a lane amber when it passes a red chokepoint', () => {
    const calm = shippingLanes(new Set());
    const red = shippingLanes(new Set(['bab_el_mandeb']));
    const amber = (fc: ReturnType<typeof shippingLanes>) => new Set(fc.features.filter((f) => f.properties.tone === 'elev').map((f) => f.properties.id.split(':')[0]));
    const viaRedSea = TRADE_ROUTES.filter((r) => r.waypoints.includes('bab_el_mandeb') && r.status === 'active').map((r) => r.id);
    assert.ok(viaRedSea.length > 0);
    for (const id of viaRedSea) {
      assert.ok(!amber(calm).has(id));
      assert.ok(amber(red).has(id));
    }
  });

  it('shades only countries with new designations', () => {
    const countries = newSanctionCountries([
      { countryCode: 'ir', countryName: 'Iran', entryCount: 900, newEntryCount: 9, vesselCount: 0, aircraftCount: 0 },
      { countryCode: 'RU', countryName: 'Russia', entryCount: 4000, newEntryCount: 0, vesselCount: 0, aircraftCount: 0 },
    ]);
    assert.deepEqual([...countries.keys()], ['IR']);
    const square = { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
    const fills = sanctionFills({ features: [
      { geometry: square, properties: { 'ISO3166-1-Alpha-2': 'IR', name: 'Iran' } },
      { geometry: square, properties: { ISO_A2: 'RU' } },
      { geometry: square, properties: { ISO_A2: '-99' } },
    ] }, countries);
    assert.deepEqual(fills.features.map((f) => f.properties.id), ['IR']);
    assert.equal(featureIso2({ iso_a2: 'gb' }), 'GB');
  });
});

describe('Geopolitics layers: aircraft, sea incidents, GPS interference', () => {
  it('says what each layer shows at 6h, 24h and 7d; only violence and sea change', () => {
    const ranges = ['6h', '24h', '7d'] as const;
    const notes = (id: string) => ranges.map((r) => layerRangeNote(id, r));
    assert.deepEqual(notes('violence'), [
      'last 6h against the 7-day average: sudden spikes',
      'last 24h against the 7-day average: sudden spikes',
      'last 7 days against the 22 before: slow build-ups',
    ]);
    // The violence note is the shading's own basis, so the label cannot drift from the computation.
    for (const r of ranges) assert.ok(layerRangeNote('violence', r)?.startsWith(shadingBasis(r)));
    assert.deepEqual(notes('sea'), ['notices from the last 6 h', 'notices from the last 24 h', 'notices from the last 7 days']);
    assert.match(layerRangeNote('conflicts', '7d') ?? '', /released monthly/);
    for (const id of ['aircraft', 'gps', 'conflicts', 'hotspots']) {
      const [first, ...rest] = notes(id);
      assert.ok(first, `${id} has a note`);
      assert.ok(rest.every((n) => n === first), `${id} is the same at every range`);
    }
    for (const id of ['airspace', 'lanes', 'osint']) assert.equal(layerRangeNote(id, '7d'), undefined);
  });

  const kyiv = { id: 'kyiv', name: 'Kyiv', lat: 50.45, lon: 30.52 };
  const taipei = { id: 'taipei', name: 'Taipei', lat: 25.03, lon: 121.56 };
  // About 0.009 degrees of latitude per km.
  const flight = (id: string, lat: number, lon: number, aircraftType: MilitaryFlight['aircraftType'], onGround = false) =>
    ({ id, location: { latitude: lat, longitude: lon }, aircraftType, onGround, lastSeenAt: AT - 5 * 60_000 }) as MilitaryFlight;
  const fighters = (n: number, lat = kyiv.lat) => Array.from({ length: n }, (_, i) => flight(`f${i}`, lat, kyiv.lon, 'MILITARY_AIRCRAFT_TYPE_FIGHTER'));

  it(`fires at ${AIRCRAFT_MIN} airborne aircraft within ${AIRCRAFT_RADIUS_KM} km of a hotspot, split by type`, () => {
    const flights = [...fighters(3), flight('r', kyiv.lat, kyiv.lon, 'MILITARY_AIRCRAFT_TYPE_RECONNAISSANCE'), flight('a', kyiv.lat, kyiv.lon, 'MILITARY_AIRCRAFT_TYPE_AWACS'), flight('v', kyiv.lat, kyiv.lon, 'MILITARY_AIRCRAFT_TYPE_VIP')];
    const feeds = aircraftFeeds(ready(flights), [kyiv, taipei], [story('Russian jets over Ukraine, says Kyiv', AT - 2 * H)], AT);
    assert.equal(feeds.length, 1);
    const fired = feeds[0];
    assert.equal(fired?.kind, 'fired');
    if (fired?.kind !== 'fired') return;
    assert.equal(fired.indicator.name, 'Military aircraft · Kyiv');
    assert.equal(fired.indicator.value, '6 aircraft');
    assert.equal(fired.indicator.change, '3 fighter · 2 ISR');
    assert.equal(fired.indicator.detail, '3 fighter · 2 ISR · 1 other');
    assert.equal(fired.indicator.trust.level, 'reported');
    assert.equal(fired.indicator.links.stories.length, 1);
  });

  it('does not fire at 4, beyond 200 km, on the ground, or on one aircraft listed twice', () => {
    assert.equal(aircraftFeeds(ready(fighters(4)), [kyiv], [], AT)[0]?.kind, 'quiet');
    assert.equal(aircraftFeeds(ready([...fighters(4), fighters(1)[0]!]), [kyiv], [], AT)[0]?.kind, 'quiet', 'a duplicate from overlapping query regions counts once');
    // 1.82 degrees north is about 202 km.
    assert.equal(aircraftFeeds(ready(fighters(5, kyiv.lat + 1.82)), [kyiv], [], AT)[0]?.kind, 'quiet');
    assert.equal(aircraftFeeds(ready(fighters(5, kyiv.lat + 1.75)), [kyiv], [], AT)[0]?.kind, 'fired');
    const grounded = Array.from({ length: 5 }, (_, i) => flight(`g${i}`, kyiv.lat, kyiv.lon, 'MILITARY_AIRCRAFT_TYPE_FIGHTER', true));
    assert.equal(aircraftFeeds(ready(grounded), [kyiv], [], AT)[0]?.kind, 'quiet');
    const quiet = aircraftFeeds(ready(fighters(4)), [kyiv], [], AT)[0];
    assert.match(quiet?.kind === 'quiet' ? quiet.detail : '', /4 at Kyiv \(fires at 5\)/);
    assert.equal(aircraftFeeds({ status: 'error', data: null, at: AT, error: 'x' }, [kyiv], [], AT)[0]?.kind, 'unavailable');
  });

  const incident = (id: string, hoursAgo: number, place = '45nm W of Hodeidah, Yemen') => ({
    id, incidentNumber: 41, incidentType: 'Explosion near vessel', place, description: 'Master reports an explosion in the vicinity of the vessel.',
    location: { latitude: 14.8, longitude: 42.3 }, occurredAt: AT - hoursAgo * H, reportedAt: 0,
  });
  const ukmto = (incidents: ReturnType<typeof incident>[]) => ready<ListUkmtoIncidentsResponse>({ incidents, fetchedAt: AT - 10 * 60_000, dataAvailable: true, stale: false });

  it('fires on a UKMTO incident in the last 24 h, as an official notice with its sea area', () => {
    const feeds = seaIncidentFeeds(ukmto([incident('a', 3)]), [story('Ship hit near Hodeidah, UKMTO says', AT - 2 * H)], AT);
    const fired = feeds[0];
    assert.equal(fired?.kind, 'fired');
    if (fired?.kind !== 'fired') return;
    assert.equal(fired.indicator.name, 'Sea incident · Hodeidah');
    assert.equal(fired.indicator.change, 'explosion near vessel');
    assert.equal(fired.indicator.trust.level, 'official');
    assert.equal(fired.indicator.trust.source, 'UKMTO notice 041');
    assert.equal(fired.indicator.links.stories.length, 1);
    assert.deepEqual(seaAreas('Bab el-Mandeb, 20nm off Mokha'), ['Bab el-Mandeb', 'Mokha']);
  });

  it('is quiet without an incident in 24 h, unavailable when the source is', () => {
    const quiet = seaIncidentFeeds(ukmto([incident('old', 25)]), [], AT)[0];
    assert.equal(quiet?.kind, 'quiet');
    assert.match(quiet?.kind === 'quiet' ? quiet.detail : '', /no incident in the last 24 h/);
    assert.equal(seaIncidentFeeds({ status: 'empty', data: null, at: AT }, [], AT)[0]?.kind, 'unavailable');
  });

  const cell = (h3: string, lat: number, lon: number) => ({ h3, lat, lon });
  const days = (high: GpsHighCells['high'], prevHigh: GpsHighCells['prevHigh'], prevDate: string | null = '2026-11-06') =>
    ready<GpsHighCells>({ date: '2026-11-07', high, prevDate, prevHigh, updatedAt: AT - 6 * H });

  it('fires on a new high GPS cell within 200 km of a hotspot that had none the day before', () => {
    const fired = gpsFeeds(days([cell('a', kyiv.lat + 0.5, kyiv.lon)], []), [kyiv], [], AT);
    assert.equal(fired[0]?.kind, 'fired');
    if (fired[0]?.kind === 'fired') {
      assert.equal(fired[0].indicator.name, 'GPS interference · Kyiv');
      assert.equal(fired[0].indicator.dataDate, 'day 2026-11-07');
    }
    // Already high the day before: no new interference.
    assert.equal(gpsFeeds(days([cell('a', kyiv.lat + 0.5, kyiv.lon)], [cell('b', kyiv.lat - 0.5, kyiv.lon)]), [kyiv], [], AT)[0]?.kind, 'quiet');
  });

  it(`fires when a region's high cells rise ${Math.round((GPS_REGION_RISE - 1) * 100)}% on the day, with at least ${GPS_REGION_MIN}`, () => {
    // Asia-Pacific, away from any hotspot passed.
    const asia = (n: number, tag: string) => Array.from({ length: n }, (_, i) => cell(`${tag}${i}`, 35 + i * 0.1, 140));
    const up = gpsIndicators(days(asia(9, 't'), asia(6, 'p')).data!, [], [], AT);
    assert.deepEqual(up.map((i) => [i.name, i.change]), [['GPS interference · Asia-Pacific', '+50% on the day']]);
    assert.equal(gpsIndicators(days(asia(8, 't'), asia(6, 'p')).data!, [], [], AT).length, 0, '+33% does not fire');
    assert.equal(gpsIndicators(days(asia(4, 't'), []).data!, [], [], AT).length, 0, 'fewer than 5 does not fire');
  });

  it('reads a missing or non-adjacent previous day as building history, never quiet', () => {
    const none = gpsFeeds(days([], [], null), [kyiv], [], AT)[0];
    assert.equal(none?.kind, 'unavailable');
    assert.match(none?.kind === 'unavailable' ? none.detail : '', /needs the previous day/);
    const gap = gpsFeeds(days([], [], '2026-11-04'), [kyiv], [], AT)[0];
    assert.match(gap?.kind === 'unavailable' ? gap.detail : '', /needs 2026-11-06, has 2026-11-04/);
    assert.equal(isGpsHighCells({ date: '2026-11-07', high: [], prevDate: null, prevHigh: [], updatedAt: 1 }), true);
    assert.equal(isGpsHighCells({ date: '2026-11-07', high: ['a'], prevDate: null, prevHigh: [], updatedAt: 1 }), false);
  });

  it('draws medium hexagons amber and high ones red, leaving out cells across the antimeridian', () => {
    const square = (lon: number) => [[lon, 0], [lon + 1, 0], [lon + 1, 1], [lon, 1]];
    const fills = gpsHexFills(
      [{ h3: 'h', level: 'high' }, { h3: 'm', level: 'medium' }, { h3: 'x', level: 'high' }],
      (h3) => (h3 === 'x' ? [[179.5, 0], [-179.5, 0], [-179.5, 1]] : square(h3 === 'h' ? 10 : 20)),
    );
    assert.deepEqual(fills.features.map((f) => [f.properties.id, f.properties.tone]), [['h', 'crit'], ['m', 'elev']]);
    assert.equal(fills.features[0]?.geometry.coordinates[0]?.length, 5, 'the ring is closed');
  });
});

describe('Technology & AI indicator rules', () => {
  const outage = (o: Partial<InternetOutage>): InternetOutage => ({
    id: 'cf-1', title: 'Internet disruption in Yemen', link: '', description: '', detectedAt: AT - 2 * H, country: 'Yemen', region: '',
    severity: 'OUTAGE_SEVERITY_TOTAL', categories: ['Cloudflare Radar', 'POWER OUTAGE', 'NATIONWIDE', 'YemenNet'], cause: 'POWER_OUTAGE',
    outageType: 'NATIONWIDE', endedAt: 0, ...o,
  });
  const outages = (list: InternetOutage[]): ListInternetOutagesResponse => ({ outages: list, fetchedAt: AT - 10 * 60_000 });
  const status = (id: string, name: string, s: ServiceStatus['status'], description = ''): ServiceStatus =>
    ({ id, name, status: s, description, url: '', checkedAt: AT - 5 * 60_000, latencyMs: 100 });
  const services = (list: ServiceStatus[]): ListServiceStatusesResponse => ({ statuses: list });
  const kevItem = (id: string, addedAt: string, extra: Partial<ExploitedVulnerability> = {}): ExploitedVulnerability => ({
    id, addedAt, dueAt: '2026-11-27', name: 'Ivanti Connect Secure Authentication Bypass Vulnerability', vendorProduct: '', vendor: '', product: '',
    cvssScore: 9.8, cvssSeverity: 'CRITICAL', description: 'Auth bypass.', ...extra,
  });
  const kev = (items: ExploitedVulnerability[]): RecentKev => ({ fetchedAt: AT - 3 * H, days: 30, items, attribution: '' });
  const history = (prior: number[], latest: number): ThreatHistory => ({
    updatedAt: AT - 30 * 60_000,
    latest: { at: AT - 30 * 60_000, total: latest, bySource: { c2intel: latest / 2, abuseipdb: latest / 2 }, byFamily: { cobaltstrike: latest / 2 } },
    days: [
      ...prior.map((total, i) => ({ date: new Date(AT - (prior.length - i) * 24 * H).toISOString().slice(0, 10), total, bySource: {}, byFamily: {} })),
      { date: new Date(AT).toISOString().slice(0, 10), total: latest, bySource: {}, byFamily: {} },
    ],
  });

  function feeds(opts: {
    outages?: InternetOutage[];
    services?: ServiceStatus[];
    kev?: ExploitedVulnerability[];
    history?: ThreatHistory;
    filings?: MaterialEvent[];
    news?: LiteItem[];
  } = {}) {
    return techFeeds({
      outages: ready(outages(opts.outages ?? [])),
      services: ready(services(opts.services ?? [status('aws', 'AWS', 'SERVICE_OPERATIONAL_STATUS_OPERATIONAL')])),
      kev: ready(kev(opts.kev ?? [])),
      history: ready(opts.history ?? history([100, 100, 100], 100)),
      filings: ready<ListMaterialEventsResponse>({ events: opts.filings ?? [], unavailable: false, fetchedAtMs: AT - 10 * 60_000 }),
      news: opts.news ?? [],
      now: AT,
    });
  }
  const find = (list: ReturnType<typeof feeds>, id: string) => list.find((f) => f.id === id);

  it('fires an internet outage that is ongoing or new in 24 h, with scope and stated cause, not a percentage', () => {
    assert.equal(find(feeds({ outages: [outage({ detectedAt: AT - 30 * H, endedAt: AT - 26 * H })] }), 'internet-outage')?.kind, 'quiet');
    const fired = find(feeds({ outages: [outage({ detectedAt: AT - 30 * H, endedAt: 0 })] }), 'internet-outage');
    assert.equal(fired?.kind, 'fired');
    if (fired?.kind !== 'fired') return;
    assert.equal(fired.indicator.name, 'Internet outage · Yemen');
    assert.equal(fired.indicator.value, 'Nationwide');
    assert.equal(fired.indicator.change, 'power outage');
    assert.match(fired.indicator.detail ?? '', /YemenNet · stated cause: power outage · started \d\d:\d\d UTC · ongoing/);
    assert.equal(fired.indicator.trust.level, 'reported');
  });

  it('links an outage to stories naming its country', () => {
    const news = [story('Yemen goes dark after grid failure', AT - 3 * H), story('New GPU launched', AT - H)];
    const fired = find(feeds({ outages: [outage({})], news }), 'internet-outage');
    assert.equal(fired?.kind === 'fired' && fired.indicator.links.stories[0]?.reason.label, 'country: Yemen');
  });

  it('fires on a watched provider with a partial or major outage, not on a degraded or unwatched one', () => {
    const quiet = find(feeds({ services: [status('aws', 'AWS', 'SERVICE_OPERATIONAL_STATUS_DEGRADED'), status('slack', 'Slack', 'SERVICE_OPERATIONAL_STATUS_MAJOR_OUTAGE')] }), 'service-outage');
    assert.equal(quiet?.kind, 'quiet');
    assert.match(quiet?.kind === 'quiet' ? quiet.detail : '', /degraded: AWS/);
    const news = [story('Azure outage hits Teams and Outlook users', AT - H)];
    const fired = find(feeds({
      services: [status('azure', 'Azure', 'SERVICE_OPERATIONAL_STATUS_PARTIAL_OUTAGE', 'Recent incidents reported'), status('openai', 'OpenAI', 'SERVICE_OPERATIONAL_STATUS_MAJOR_OUTAGE')],
      news,
    }), 'service-outage');
    assert.equal(fired?.kind, 'fired');
    if (fired?.kind !== 'fired') return;
    assert.equal(fired.indicator.name, 'Service outage · OpenAI', 'a major outage leads');
    assert.equal(fired.indicator.value, 'Major');
    assert.match(fired.indicator.detail ?? '', /also: Azure partial/);
    assert.equal(fired.indicator.trust.level, 'official');
    assert.equal(fired.indicator.links.stories[0]?.reason.label, 'driver: Azure');
  });

  it(`fires a KEV addition from the last ${KEV_NEW_DAYS} days, labelled with its date, and counts the week`, () => {
    assert.equal(find(feeds({ kev: [kevItem('CVE-2026-1', '2026-11-05')] }), 'kev-new')?.kind, 'quiet');
    const fired = find(feeds({ kev: [kevItem('CVE-2026-3', '2026-11-07'), kevItem('CVE-2026-2', '2026-11-06')] }), 'kev-new');
    assert.equal(fired?.kind, 'fired');
    if (fired?.kind !== 'fired') return;
    assert.equal(fired.indicator.name, 'Exploited vulnerability · CVE-2026-3');
    assert.equal(fired.indicator.value, '9.8 CVSS');
    assert.equal(fired.indicator.dataDate, 'added 7 Nov');
    assert.match(fired.indicator.detail ?? '', /\+1 more this week/);
    assert.deepEqual(kevWeekCounts([kevItem('a', '2026-11-08'), kevItem('b', '2026-11-02'), kevItem('c', '2026-11-01'), kevItem('d', '2026-10-25')], AT), { thisWeek: 2, lastWeek: 1 });
  });

  it('ranks a KEV addition from a starter-watchlist vendor first, using KEV\'s own vendor before NVD\'s CPE (#119)', () => {
    const unwatched = kevItem('CVE-2026-20', '2026-11-08', { name: 'Acme Widget Overflow', vendor: 'Acme', product: 'Widget' });
    const ivanti = kevItem('CVE-2026-21', '2026-11-07', { vendor: 'Ivanti', product: 'Connect Secure' });
    const msByCpe = kevItem('CVE-2026-22', '2026-11-06', { name: 'Exchange RCE', vendorProduct: 'microsoft:exchange_server' });
    assert.equal(watchedVendor(unwatched), null);
    assert.equal(watchedVendor(ivanti)?.name, 'Ivanti');
    assert.equal(watchedVendor(msByCpe)?.name, 'Microsoft');
    assert.equal(watchedVendor({ vendor: '', vendorProduct: 'palo_alto_networks:pan-os' })?.name, 'Palo Alto Networks');
    assert.equal(watchedVendor({ vendor: 'Ivanti', vendorProduct: '' }, [{ name: 'Acme', aliases: ['acme'], domains: ['acme.com'] }]), null);
    const fired = find(feeds({ kev: [unwatched, ivanti, msByCpe] }), 'kev-new');
    assert.equal(fired?.kind, 'fired');
    if (fired?.kind !== 'fired') return;
    // The newer Acme addition is not on the list, so the Ivanti one leads.
    assert.equal(fired.indicator.name, 'Exploited vulnerability · CVE-2026-21');
    assert.equal(fired.indicator.rule, 'KEV add · watchlist vendor');
    assert.match(fired.indicator.detail ?? '', /^Ivanti is on the starter vendor watchlist \(until the owner's list exists\) · /);
    assert.match(fired.indicator.detail ?? '', /\+2 more this week, 1 more from watchlist vendors$/);
    // No watchlist vendor: the newest addition, with KEV's vendor and product when CISA's name is empty.
    const plain = find(feeds({ kev: [kevItem('CVE-2026-23', '2026-11-08', { name: '', vendor: 'Acme', product: 'Widget' })] }), 'kev-new');
    assert.equal(plain?.kind === 'fired' && plain.indicator.rule, 'KEV add');
    assert.match(plain?.kind === 'fired' ? plain.indicator.detail ?? '' : '', /^Acme Widget · /);
    // KEV's vendor and product also drive the linked news.
    assert.deepEqual(kevSubject(kevItem('CVE-2026-24', '2026-11-07', { name: '', vendor: 'Fortinet', product: 'FortiOS' })).drivers, ['CVE-2026-24', 'fortinet', 'fortios']);
    assert.deepEqual(decodeRecentKev({ fetchedAt: 3, items: [{ id: 'CVE-2026-0001', addedAt: '2026-11-01', vendor: 'Ivanti', product: 7 }] })?.items.map((i) => [i.vendor, i.product]), [['Ivanti', '']]);
  });

  it(`fires on an 8-K reporting item ${CYBER_8K_ITEM} in ${FILING_WINDOW_HOURS} h from any filer, naming stock-list companies (#120)`, () => {
    const filing = (company: string, codes: string[], hoursAgo: number): MaterialEvent => ({
      company, cik: '1', form: '8-K', accession: `${company}-${hoursAgo}`, filedAtMs: AT - hoursAgo * H, url: 'https://www.sec.gov/x',
      items: codes.map((code) => ({ code, description: `Item ${code}` })),
    });
    assert.equal(find(feeds({ filings: [filing('Tiny Corp', ['1.01'], 1), filing('Old Corp', ['1.05'], 30)] }), 'cyber-8k')?.kind, 'quiet');
    const fired = find(feeds({
      filings: [filing('Acme Logistics Inc /DE/', ['1.05', '7.01'], 2), filing('APPLE INC', ['1.05'], 5), filing('Tiny Corp', ['1.01'], 1)],
      news: [story('Acme Logistics discloses ransomware attack', AT - 3 * H)],
    }), 'cyber-8k');
    assert.equal(fired?.kind, 'fired');
    if (fired?.kind !== 'fired') return;
    assert.equal(fired.indicator.name, 'Cyber incident 8-K · Acme Logistics Inc');
    assert.equal(fired.indicator.value, `Item ${CYBER_8K_ITEM}`);
    assert.equal(fired.indicator.detail, 'Listed filer; check whether it is a peer or supplier · also APPLE INC');
    assert.equal(fired.indicator.trust.level, 'official');
    assert.equal(fired.indicator.links.stories.length, 1);
    const apple = find(feeds({ filings: [filing('APPLE INC', ['1.05'], 1)] }), 'cyber-8k');
    assert.match(apple?.kind === 'fired' ? apple.indicator.detail ?? '' : '', /^Apple \(AAPL\) is on the default stock list$/);
    assert.deepEqual(cyberFilings({ events: [filing('A', ['1.05'], 30), filing('B', ['1.05'], 1)], unavailable: false, fetchedAtMs: AT }, AT).map((e) => e.company), ['B']);
  });

  it('links a KEV entry by its id and the vendor and product in CISA\'s name when NVD has no product yet', () => {
    assert.deepEqual(kevSubject(kevItem('CVE-2026-9', '2026-11-07')).drivers, ['CVE-2026-9', 'ivanti', 'connect']);
    assert.deepEqual(kevSubject(kevItem('CVE-2026-9', '2026-11-07', { vendorProduct: 'microsoft:exchange_server', name: 'Microsoft Exchange Server Remote Code Execution Vulnerability' })).drivers,
      ['CVE-2026-9', 'microsoft', 'exchange server', 'exchange']);
  });

  it(`fires attack infrastructure at ${SPIKE_RATIO}× its 7-day average, and builds a baseline first`, () => {
    const building = find(feeds({ history: history([100, 100], 500) }), 'attack-spike');
    assert.equal(building?.kind, 'quiet');
    assert.match(building?.kind === 'quiet' ? building.detail : '', /building baseline \(2 of 7 days\)/);
    assert.equal(find(feeds({ history: history([100, 100, 100, 100], 190) }), 'attack-spike')?.kind, 'quiet');
    const fired = find(feeds({ history: history([100, 100, 100, 100], 240) }), 'attack-spike');
    assert.equal(fired?.kind, 'fired');
    if (fired?.kind !== 'fired') return;
    assert.equal(fired.indicator.change, '×2.4 vs 7d');
    assert.match(fired.indicator.detail ?? '', /C2Intel 120 · AbuseIPDB 120 — top families: cobaltstrike 100%/);
    const base = threatBaseline(history([10, 10, 10, 10, 10, 10, 10, 100, 100], 50));
    assert.equal(base.days, 7, 'only the 7 complete days before today count');
  });

  it('decodes the on-demand payloads strictly and keeps a valid empty KEV list', () => {
    assert.equal(decodeThreatHistory(undefined), null);
    assert.equal(decodeThreatHistory({ updatedAt: 1, latest: { at: 1 }, days: [] }), null, 'a latest run without a total is not a history');
    const h = decodeThreatHistory({ updatedAt: 2, latest: { at: 2, total: 5, bySource: { otx: 5, bad: -1 }, byFamily: {} }, days: [{ date: '2026-11-08', total: 5 }, { date: 'x', total: 1 }] });
    assert.deepEqual(h?.latest.bySource, { otx: 5 });
    assert.deepEqual(h?.days.map((d) => d.date), ['2026-11-08']);
    assert.equal(decodeRecentKev(null), null);
    assert.deepEqual(decodeRecentKev({ fetchedAt: 3, days: 30, items: [] })?.items, []);
    assert.deepEqual(decodeRecentKev({ fetchedAt: 3, items: [{ id: 'nope', addedAt: '2026-11-01' }, { id: 'CVE-2026-0001', addedAt: '2026-11-01' }] })?.items.map((i) => i.id), ['CVE-2026-0001']);
  });

  it('reads unavailable, naming the seeder, when a source failed, and stale when it is late', () => {
    const list = techFeeds({
      outages: { status: 'error', data: null, at: AT, error: 'HTTP 503' },
      services: ready(services([status('aws', 'AWS', 'SERVICE_OPERATIONAL_STATUS_OPERATIONAL')])),
      kev: ready({ ...kev([]), fetchedAt: AT - 3 * 24 * H }),
      history: { status: 'empty', data: null, at: AT },
      filings: { status: 'error', data: null, at: AT, error: 'x' },
      news: [],
      now: AT,
    });
    assert.match((() => { const f = find(list, 'cyber-8k'); return f?.kind === 'unavailable' ? f.detail : ''; })(), /seed-sec-8k-stream/);
    const out = find(list, 'internet-outage');
    assert.equal(out?.kind, 'unavailable');
    assert.match(out?.kind === 'unavailable' ? out.detail : '', /seed-internet-outages/);
    assert.equal(find(list, 'kev-new')?.kind, 'stale');
    assert.equal(find(list, 'attack-spike')?.kind, 'unavailable');
  });
});

describe('Geopolitics watch feeds: chokepoint transits, Taiwan Strait, embassy alerts', () => {
  const HOTSPOTS = [
    { id: 'kyiv', name: 'Kyiv', lat: 50.45, lon: 30.52 },
    { id: 'taipei', name: 'Taipei', lat: 25.03, lon: 121.56 },
    { id: 'mexico', name: 'Mexico City', lat: 19.43, lon: -99.13 },
  ];

  // ---- chokepoints
  const cp = (id: string, avg7d: number | undefined, normal: number, extra: Partial<ChokepointInfo> = {}) => ({
    id, name: id === 'hormuz_strait' ? 'Strait of Hormuz' : id, lat: 0, lon: 0, status: 'green', disruptionScore: 0,
    transitSummary: {
      officialLatestDate: '2026-11-03', officialLatestTotal: 30, officialAvg7d: avg7d,
      baselineAvgDaily: normal, baselineFrom: normal > 0 ? '2024-11-08' : '', baselineTo: normal > 0 ? '2025-11-08' : '',
    },
    ...extra,
  } as unknown as ChokepointInfo);
  const status = (chokepoints: ChokepointInfo[], upstreamUnavailable = false): GetChokepointStatusResponse =>
    ({ chokepoints, fetchedAt: new Date(AT - 5 * 60_000).toISOString(), upstreamUnavailable } as GetChokepointStatusResponse);

  it('fires at 75% of the year-earlier normal, not at 76%, and never without a baseline', () => {
    const fired = chokepointIndicators(status([cp('hormuz_strait', 75, 100), cp('suez', 76, 100), cp('panama', 5, 0)]), [], AT);
    assert.deepEqual(fired.map((i) => i.id), ['chokepoint:hormuz_strait']);
    const card = fired[0]!;
    assert.equal(card.name, 'Chokepoint · Strait of Hormuz');
    assert.equal(card.value, '75 transits/day');
    assert.equal(card.change, '−25% vs year-earlier');
    assert.equal(card.trust.level, 'estimated');
    assert.equal(card.dataDate, 'data to 3 Nov');
    // The news window ends with the PortWatch day.
    assert.equal(card.at, Date.UTC(2026, 10, 3, 23, 59, 59, 999));
    assert.equal(CHOKEPOINT_TRANSIT_SHARE, 0.75);
  });

  it('fires on the tanker-flow disrupted flag alone and links news naming the chokepoint', () => {
    const flow = { currentMbd: 12.4, baselineMbd: 17, flowRatio: 0.73, disrupted: true } as ChokepointInfo['flowEstimate'];
    const news = [story('Tankers avoid Hormuz after drone strike', Date.UTC(2026, 10, 3, 10))];
    const fired = chokepointIndicators(status([cp('hormuz_strait', 98, 100, { flowEstimate: flow })]), news, AT);
    assert.equal(fired.length, 1);
    assert.equal(fired[0]!.value, '12.4 mb/d');
    assert.equal(fired[0]!.change, 'tanker flow 73% of 90-day normal');
    assert.equal(fired[0]!.links.stories.length, 1);
  });

  it('reads quiet with the data date, stale after 14 days, and unavailable without baselines', () => {
    const quiet = chokepointFeeds(ready(status([cp('suez', 90, 100)])), [], AT);
    assert.equal(quiet[0]!.kind, 'quiet');
    assert.match((quiet[0] as { detail: string }).detail, /1 chokepoint within normal · data to 3 Nov/);
    const stale = chokepointFeeds(ready(status([cp('suez', 90, 100)])), [], AT + 14 * 24 * H);
    assert.equal(stale[0]!.kind, 'stale');
    assert.match((stale[0] as { detail: string }).detail, /PortWatch data to 3 Nov/);
    // No year-earlier window: the seeder sends baselineAvgDaily 0 and no baselineFrom.
    const none = chokepointFeeds(ready(status([cp('suez', undefined, 0), cp('panama', 40, 0)])), [], AT);
    assert.equal(none[0]!.kind, 'unavailable');
    const down = chokepointFeeds(ready(status([cp('suez', 50, 100)], true)), [], AT);
    assert.equal(down[0]!.kind, 'unavailable');
    const failed = chokepointFeeds({ status: 'error', data: null, at: AT, error: 'x' }, [], AT);
    assert.match((failed[0] as { detail: string }).detail, /seed-portwatch/);
  });

  // ---- Taiwan Strait
  const window30 = (median: number | null, sufficient = true, sampleSize = 30) =>
    ({ windowDays: 30, state: sufficient ? 'sufficient' : 'insufficient_data', statistic: 'median', value: median, sampleSize, requiredSampleSize: 30 });
  const strait = (aircraft: number | null, ships: number | null, opts: { median?: [number, number]; sufficient?: boolean; sampleSize?: number } = {}) => {
    const [ma, ms] = opts.median ?? [10, 6];
    const day = '2026-11-08';
    return {
      schemaVersion: 1,
      generatedAt: new Date(AT - H).toISOString(),
      status: 'healthy',
      sources: [],
      coverage: { usableMndReportingDays: 120, earliestMndReportingDay: '2026-07-01', latestMndReportingDay: day, backfillComplete: true },
      observations: [{
        sourceId: 'taiwan-mnd', observationKind: 'official_daily_claim', reportingDay: day,
        reportingPeriod: { start: '2026-11-07T06:00:00+08:00', end: '2026-11-08T06:00:00+08:00', timezone: 'Asia/Taipei' },
        publicationTime: '2026-11-08T09:00:00+08:00',
        categories: { plaAircraftSorties: aircraft, planShips: ships, officialShips: 2, medianLineCrossings: 11, adizEntries: null },
      }],
      baselines: {
        sourceId: 'taiwan-mnd',
        semantics: 'prior-usable-reporting-days-excluding-current',
        categories: {
          plaAircraftSorties: { current: { value: aircraft, reportingDay: day }, windows: { 30: window30(ma, opts.sufficient, opts.sampleSize), 90: window30(ma) } },
          planShips: { current: { value: ships, reportingDay: day }, windows: { 30: window30(ms, opts.sufficient, opts.sampleSize), 90: window30(ms) } },
        },
      },
    } as unknown as CrossStraitActivitySnapshot;
  };

  it('fires at 1.5× the 30-day median with the minimum count, not at 1.4× or under the minimum', () => {
    assert.equal(TAIWAN_RATIO, 1.5);
    const fired = taiwanStraitIndicators(strait(15, 6), [], AT);
    assert.equal(fired.length, 1);
    assert.equal(fired[0]!.id, 'taiwan');
    assert.equal(fired[0]!.value, '15 aircraft · 6 ships');
    assert.equal(fired[0]!.change, 'aircraft 1.5× the 30-day median');
    assert.equal(fired[0]!.detail, '11 median-line crossings · 2 official ships');
    assert.equal(fired[0]!.trust.level, 'official');
    assert.equal(fired[0]!.dataDate, 'day 2026-11-08');
    assert.equal(fired[0]!.at, Date.parse('2026-11-08T06:00:00+08:00'));
    assert.equal(taiwanStraitIndicators(strait(14, 8), [], AT).length, 0, '1.4× aircraft, 1.33× ships');
    // 1.5× a median of 4 is 6, but under the 10-aircraft minimum.
    assert.equal(taiwanStraitIndicators(strait(8, 2, { median: [4, 6] }), [], AT).length, 0);
    assert.equal(taiwanStraitIndicators(strait(4, 9), [], AT)[0]!.change, 'ships 1.5× the 30-day median');
  });

  it('treats a null count as unknown and an insufficient window as building history', () => {
    assert.equal(taiwanStraitIndicators(strait(null, null), [], AT).length, 0);
    const building = taiwanStraitFeeds(ready(strait(40, 20, { sufficient: false, sampleSize: 12 })), [], AT);
    assert.equal(building[0]!.kind, 'unavailable');
    assert.equal((building[0] as { detail: string }).detail, 'Building history · 12 of 30 reporting days');
    const quiet = taiwanStraitFeeds(ready(strait(9, 5)), [], AT);
    assert.equal(quiet[0]!.kind, 'quiet');
    assert.match((quiet[0] as { detail: string }).detail, /day 2026-11-08: 9 aircraft · 5 ships, under 1.5×/);
    const stale = taiwanStraitFeeds(ready(strait(9, 5)), [], AT + 3 * 24 * H);
    assert.equal(stale[0]!.kind, 'stale');
    assert.ok(isCrossStraitSnapshot(strait(1, 1)));
    assert.ok(!isCrossStraitSnapshot({ schemaVersion: 1, observations: [] }));
  });

  // ---- embassy alerts
  const advisory = (source: string, country: string, ageH: number, title = 'Security alert: demonstrations'): SecurityAdvisoryItem => ({
    title, link: `https://example.gov/${source}/${country}/${ageH}`, pubDate: new Date(AT - ageH * H).toISOString(),
    source, sourceCountry: 'US', level: 'info', country,
  });
  const alerts = (items: SecurityAdvisoryItem[]): EmbassyAlerts => ({ advisories: items, fetchedAt: AT - 10 * 60_000 });

  it('fires on a US embassy alert for a hotspot country within 24 h only', () => {
    const data = alerts([
      advisory('US Embassy Ukraine', 'UA', 2),
      advisory('US Embassy Mexico', 'MX', 25),
      advisory('US Embassy Germany', 'DE', 1),
      advisory('US State Dept', 'UA', 1, 'Ukraine - Level 4: Do Not Travel'),
    ]);
    const fired = embassyAlertIndicators(data, HOTSPOTS, [story('Kyiv embassy warns of air strikes', AT - 3 * H)], AT);
    assert.equal(fired.length, 1);
    assert.match(fired[0]!.id, /^embassy:kyiv:/);
    assert.equal(fired[0]!.name, 'Embassy alert · Ukraine');
    assert.equal(fired[0]!.value, 'US Embassy Ukraine');
    assert.equal(fired[0]!.detail, 'Security alert: demonstrations');
    assert.equal(fired[0]!.trust.level, 'official');
    assert.equal(fired[0]!.links.stories.length, 1);
    assert.deepEqual(embassyCoverage(data, HOTSPOTS), ['MX', 'UA']);
  });

  it('names the covered hotspot countries when quiet, and the seeder when unavailable', () => {
    const quiet = embassyAlertFeeds(ready(alerts([advisory('US Embassy Mexico', 'MX', 30)])), HOTSPOTS, [], AT);
    assert.equal(quiet[0]!.kind, 'quiet');
    assert.equal((quiet[0] as { detail: string }).detail, 'Live · no alert in 24 h · embassy feeds cover MX of the hotspot countries');
    const empty = embassyAlertFeeds({ status: 'empty', data: null, at: AT }, HOTSPOTS, [], AT);
    assert.equal(empty[0]!.kind, 'unavailable');
    assert.match((empty[0] as { detail: string }).detail, /seed-security-advisories/);
    const stale = embassyAlertFeeds(ready(alerts([])), HOTSPOTS, [], AT + 3 * H);
    assert.equal(stale[0]!.kind, 'stale');
  });
});

describe('Geopolitics indicator panel grouped by region (#116)', () => {
  const fired = (id: string, at: number, place?: Indicator['place']): FeedState => ({
    kind: 'fired', id, name: id,
    indicator: { id, domain: 'geo', name: id, value: '1', rule: 'r', trust: { level: 'reported', source: 's' }, at, links: { stories: [], searched: 0, windowHours: 24 }, place },
  });
  const tile = (id: string, score: number | null, level = 'Elevated', tone: 'elev' | 'crit' = 'elev') => ({ id, name: id, level, tone, lead: score == null ? null : { name: 'x', score } });

  it('places by country first, else by the smallest region view holding the point, else nowhere', () => {
    assert.equal(regionOfPlace({ countries: ['UA'] })?.id, 'eastern-europe');
    assert.equal(regionOfPlace({ countries: ['TW'] })?.id, 'taiwan-strait');
    // Bab el-Mandeb sits in both the Red Sea and Gulf views; the Red Sea view is smaller.
    assert.equal(regionOfPlace({ lat: 12.6, lon: 43.3 })?.id, 'red-sea');
    // Hormuz sits only in the Gulf view.
    assert.equal(regionOfPlace({ lat: 26.6, lon: 56.3 })?.id, 'gulf-iran');
    // A country outside every region wins over a point inside one.
    assert.equal(regionOfPlace({ countries: ['DE'], lat: 26.6, lon: 56.3 })?.id, 'gulf-iran');
    assert.equal(regionOfPlace({ countries: ['DE'] }), null);
    assert.equal(regionOfPlace({ lat: 0, lon: -150 }), null);
    assert.equal(regionOfPlace(undefined), null);
  });

  it('orders regions by live level, newest first inside, Other last, and keeps the rest as one block', () => {
    const quiet: FeedState = { kind: 'quiet', id: 'sea', name: 'sea', detail: 'Live' };
    const down: FeedState = { kind: 'unavailable', id: 'airspace', name: 'airspace', detail: 'x' };
    const feeds = [
      quiet,
      fired('violence:UA', AT - 3 * H, { countries: ['UA'] }),
      fired('gps-region:europe', AT - H),
      fired('aircraft:kyiv', AT - H, { countries: ['UA'], lat: 50.45, lon: 30.5 }),
      fired('chokepoint:hormuz', AT - 2 * H, { lat: 26.6, lon: 56.3 }),
      fired('taiwan', AT, { countries: ['TW'] }),
      down,
    ];
    const tiles = [tile('red-sea', 4), tile('eastern-europe', 3.5), tile('gulf-iran', 4.4, 'Critical', 'crit'), tile('taiwan-strait', null)];
    const { groups, rest } = groupFeedsByRegion(feeds, tiles);
    assert.deepEqual(groups.map((g) => [g.id, g.feeds.map((f) => f.id)]), [
      ['gulf-iran', ['chokepoint:hormuz']],
      ['eastern-europe', ['aircraft:kyiv', 'violence:UA']],
      ['taiwan-strait', ['taiwan']],
      ['other', ['gps-region:europe']],
    ]);
    assert.deepEqual(groups[0]!.level, { label: 'Critical', tone: 'crit' });
    // An unscored region shows no level; "Other" never does.
    assert.equal(groups[2]!.level, undefined);
    assert.equal(groups[3]!.name, 'Other');
    assert.deepEqual(rest.map((f) => f.id), ['sea', 'airspace']);

    // Equal scores keep the strip's order; nothing fired means no groups.
    const tied = groupFeedsByRegion([fired('taiwan', AT, { countries: ['TW'] }), fired('violence:YE', AT, { countries: ['YE'] })], []);
    assert.deepEqual(tied.groups.map((g) => g.id), ['red-sea', 'taiwan-strait']);
    assert.deepEqual(groupFeedsByRegion([quiet, down], tiles).groups, []);
  });

});

describe('Region escalation (#117)', () => {
  const MIN = 60_000;
  const parts = (military: number, news = 20) => ({ newsActivity: news, ciiContribution: 40, geoConvergence: 10, militaryActivity: military });
  const tile = (id: string, score: number, lead = 'sanaa', components = parts(20)) => ({ id, lead: { id: lead, name: lead === 'sanaa' ? 'Sanaa' : lead, score, components } });
  const ok = { status: 'ready', data: {}, at: AT } as const;
  const run = (tiles: ReturnType<typeof tile>[], history: Record<string, { at: number; rank: number; lead?: string; parts?: ReturnType<typeof parts> }[]>, news: LiteItem[] = []) =>
    regionEscalationFeeds({ regions: ESCALATION_REGIONS, tiles, source: ok, history, news, now: AT });

  it(`fires when a region rises a step to ${REGION_LEVELS[REGION_FIRE_RANK - 1]} or higher against an earlier reading, naming the lead and what moved`, () => {
    const history = { 'red-sea': [{ at: AT - 5 * 60 * MIN, rank: 2, lead: 'sanaa', parts: parts(2) }, { at: AT - 60 * MIN, rank: 3, lead: 'sanaa', parts: parts(15) }] };
    const news = [story('Houthi strikes near Sanaa as Yemen tensions rise', AT - 2 * H)];
    const [feed] = run([tile('red-sea', 3.6, 'sanaa', parts(24))], history, news);
    assert.equal(feed?.kind, 'fired');
    if (feed?.kind !== 'fired') return;
    assert.equal(feed.id, 'region:red-sea');
    assert.equal(feed.indicator.name, 'Region escalation · Red Sea / Aden');
    // 3.6 rounds to High, two steps up from Watch.
    assert.equal(feed.indicator.value, 'High');
    assert.match(feed.indicator.change ?? '', /^up from Watch \(\d\d:\d\d UTC\)$/);
    assert.match(feed.indicator.detail ?? '', /^Led by Sanaa 3\.6\/5 · military activity \+22 · compared with a reading kept in this browser$/);
    assert.equal(feed.indicator.trust.level, 'estimated');
    assert.deepEqual(feed.indicator.place, { countries: ['YE', 'SA', 'EG'] });
    assert.equal(feed.indicator.links.stories.length, 1);
    // Since the first reading at the current level or above after the baseline.
    assert.equal(feed.indicator.at, AT - 60 * MIN);
  });

  it('stays quiet below Elevated, on no rise, and on a fall; needs a reading at least 30 min old', () => {
    const was = (rank: number, ago = 2 * 60) => [{ at: AT - ago * MIN, rank }];
    // Stable to Watch is a rise but stays below Elevated.
    const low = run([tile('red-sea', 2.2)], { 'red-sea': was(1) })[0]!;
    assert.equal(low.kind, 'quiet');
    assert.match(low.kind === 'quiet' ? low.detail : '', /Red Sea \/ Aden Watch/);
    assert.equal(run([tile('red-sea', 3.1)], { 'red-sea': was(3) })[0]!.kind, 'quiet');
    assert.equal(run([tile('red-sea', 3.1)], { 'red-sea': was(5) })[0]!.kind, 'quiet');
    // A reading 10 minutes old is too recent to compare; one past 24 h is gone.
    const fresh = run([tile('red-sea', 4)], { 'red-sea': was(1, 10) })[0]!;
    assert.match(fresh.kind === 'quiet' ? fresh.detail : '', /^First readings kept in this browser/);
    assert.equal(run([tile('red-sea', 4)], { 'red-sea': was(1, 25 * 60) })[0]!.kind, 'quiet');
    // A reading taken while an input was missing (a lower, partial score) is not a baseline for a full one.
    const partial = { 'red-sea': [{ at: AT - 2 * 60 * MIN, rank: 1, inputs: 'countryRisk' }] };
    assert.equal(run([tile('red-sea', 4)], partial)[0]!.kind, 'quiet');
    assert.equal(regionEscalationFeeds({ regions: ESCALATION_REGIONS, tiles: [tile('red-sea', 4)], source: ok, missing: ['countryRisk'], history: partial, news: [], now: AT })[0]!.kind, 'fired');
    // The baseline is the earliest qualifying reading, not the latest.
    assert.equal(run([tile('red-sea', 3)], { 'red-sea': [{ at: AT - 6 * 60 * MIN, rank: 2 }, { at: AT - 60 * MIN, rank: 3 }] })[0]!.kind, 'fired');
  });

  it('names a change of lead hotspot, and reports the source state when the score inputs failed', () => {
    const [feed] = run([tile('levant', 4, 'beirut')], { levant: [{ at: AT - 2 * 60 * MIN, rank: 3, lead: 'jerusalem', parts: parts(0) }] });
    assert.equal(feed?.kind === 'fired' && feed.indicator.detail, 'Led by beirut 4.0/5 · a different hotspot now leads · compared with a reading kept in this browser');
    const failed = regionEscalationFeeds({ regions: ESCALATION_REGIONS, tiles: [], source: { status: 'error', data: null, at: AT, error: 'x' }, history: {}, news: [], now: AT })[0]!;
    assert.equal(failed.kind, 'unavailable');
    assert.match(failed.kind === 'unavailable' ? failed.detail : '', /get-risk-scores/);
  });

  it('keeps one reading per 15 min unless the level changes, drops readings past 24 h, and survives bad storage', () => {
    const readings = regionReadings([tile('red-sea', 3.2), { id: 'sahel', lead: null } as never]);
    assert.deepEqual(readings.map((r) => [r.id, r.rank]), [['red-sea', 3]]);
    let h = recordReadings({}, readings, AT);
    h = recordReadings(h, readings, AT + 5 * MIN);
    assert.equal(h['red-sea']?.length, 1);
    h = recordReadings(h, regionReadings([tile('red-sea', 4.1)]), AT + 6 * MIN);
    assert.equal(h['red-sea']?.length, 2);
    h = recordReadings(h, readings, AT + 25 * 60 * MIN);
    assert.deepEqual(h['red-sea']?.map((s) => s.at), [AT + 25 * 60 * MIN]);
    assert.deepEqual(decodeRegionHistory(JSON.stringify(h)), h);
    assert.deepEqual(decodeRegionHistory('{bad'), {});
    assert.deepEqual(decodeRegionHistory(JSON.stringify({ 'red-sea': [{ at: 'x', rank: 9 }, { at: AT, rank: 2 }] })), { 'red-sea': [{ at: AT, rank: 2 }] });
    assert.equal(baselineOf(undefined, AT), null);
    assert.deepEqual(changedParts(parts(30, 22), parts(10, 20)), ['military activity +20']);
    assert.equal(rankOfScore(0.2), 1);
    assert.equal(rankOfScore(7), 5);
  });
});

describe('New OFAC sanctions (#118)', () => {
  type Entry = ListSanctionsPressureResponse['entries'][number];
  const entry = (o: Partial<Entry> & { id: string }): Entry => ({
    name: o.id.toUpperCase(), entityType: 'SANCTIONS_ENTITY_TYPE_ENTITY', countryCodes: ['RU'], countryNames: ['Russia'],
    programs: ['RUSSIA-EO14024'], sourceLists: ['SDN'], effectiveAt: String(AT - 30 * 24 * H), isNew: false, note: '', ...o,
  } as Entry);
  const data = (entries: Entry[]): ListSanctionsPressureResponse => ({
    entries, countries: [], programs: [], fetchedAt: String(AT - H), datasetDate: '0', totalCount: 18_000, sdnCount: 17_000,
    consolidatedCount: 400, newEntryCount: entries.filter((e) => e.isNew).length, vesselCount: 0, aircraftCount: 0, semaCount: 0,
  } as ListSanctionsPressureResponse);

  it('groups new OFAC designations by country, from the latest run or dated in the last 24 h', () => {
    const groups = newOfacDesignations(data([
      entry({ id: 'a', isNew: true }),
      entry({ id: 'b', isNew: true, programs: ['RUSSIA-EO14024', 'CYBER2'] }),
      entry({ id: 'c', effectiveAt: String(AT - 3 * H), countryCodes: ['IR', 'AE'], countryNames: ['Iran', 'United Arab Emirates'], programs: ['IRAN'] }),
      // Old, not new on the latest run: ignored.
      entry({ id: 'd' }),
      // Canada's SEMA list is not OFAC.
      entry({ id: 'e', isNew: true, sourceLists: ['SEMA'] }),
      // A date in the future beyond an hour is a bad date.
      entry({ id: 'f', effectiveAt: String(AT + 5 * H), countryCodes: ['KP'], countryNames: ['North Korea'] }),
    ]), AT);
    assert.deepEqual(groups.map((g) => [g.code, g.entries.map((e) => e.id), g.programs]), [
      ['RU', ['a', 'b'], ['RUSSIA-EO14024', 'CYBER2']],
      ['IR', ['c'], ['IRAN']],
      ['AE', ['c'], ['IRAN']],
    ]);
    assert.equal(groups[0]!.at, AT - H);
    assert.equal(groups[1]!.at, AT - 3 * H);
  });

  it('fires a card per country with the programmes, count and names, and links only sanctions stories about the country', () => {
    const news = [
      story('Russia hit by new US sanctions on shipping firms', AT - 2 * H),
      story('Russia reports record wheat harvest', AT - 2 * H),
    ];
    const feeds = newSanctionsFeeds(ready(data([entry({ id: 'alpha shipping', isNew: true }), entry({ id: 'beta trading', isNew: true }), entry({ id: 'gamma', isNew: true }), entry({ id: 'delta', isNew: true })])), news, AT);
    assert.equal(feeds.length, 1);
    const card = feeds[0]!;
    assert.equal(card.kind, 'fired');
    if (card.kind !== 'fired') return;
    assert.equal(card.id, 'sanctions:RU');
    assert.equal(card.indicator.name, 'New sanctions · Russia');
    assert.equal(card.indicator.value, '4 designations');
    assert.equal(card.indicator.change, 'RUSSIA-EO14024');
    assert.equal(card.indicator.detail, 'ALPHA SHIPPING, BETA TRADING, GAMMA +1 more');
    assert.deepEqual(card.indicator.trust, { level: 'official', source: 'US Treasury OFAC (SDN, Consolidated)' });
    assert.deepEqual(card.indicator.place, { countries: ['RU'] });
    assert.deepEqual(card.indicator.links.stories.map((st) => st.item.title), ['Russia hit by new US sanctions on shipping firms']);
  });

  it('says when the feed cut a large batch short, and keeps quiet, stale and unavailable states', () => {
    const big = Array.from({ length: SANCTIONS_ENTRY_LIMIT }, (_, i) => entry({ id: `e${i}`, isNew: true }));
    const [card] = newSanctionsFeeds(ready(data(big)), [], AT);
    assert.equal(card?.kind === 'fired' && card.indicator.value, `${SANCTIONS_ENTRY_LIMIT}+ designations`);
    assert.match(card?.kind === 'fired' ? card.indicator.detail ?? '' : '', /the feed carries the 60 newest entries/);
    const quiet = newSanctionsFeeds(ready(data([entry({ id: 'old' })])), [], AT)[0]!;
    assert.equal(quiet.kind, 'quiet');
    assert.equal(quiet.kind === 'quiet' && quiet.detail, 'Live · no new OFAC designation in 24 h · 17,400 listed');
    const stale = newSanctionsFeeds(ready({ ...data([]), fetchedAt: String(AT - 20 * H) }), [], AT)[0]!;
    assert.equal(stale.kind, 'stale');
    const down = newSanctionsFeeds({ status: 'error', data: null, at: AT, error: 'x' }, [], AT)[0]!;
    assert.equal(down.kind, 'unavailable');
    assert.match(down.kind === 'unavailable' ? down.detail : '', /seed-sanctions-pressure/);
  });
});

describe('Decision tiers (#121)', () => {
  it('tags each feed check daily or check weekly as the spec tables do, and leaves analyst inputs untagged', () => {
    for (const id of ['chokepoint:hormuz_strait', 'chokepoints', 'region:red-sea', 'sanctions:RU', 'export-controls:2026-1', 'restricted-parties:CN', 'travel-advisory:US:IL', 'taiwan', 'embassy:kyiv:x', 'treasury', 'other-bonds',
      'credit-spreads', 'fed-odds', 'vix', 'dollar-index', 'macro-print', 'btc-move', 'service-outage', 'kev-new', 'cyber-8k', 'internet-outage']) {
      assert.equal(feedTier(id), 'daily', id);
    }
    for (const id of ['etf-flows', 'stablecoin-depeg', 'perp-positioning', 'btc-funding', 'fear-greed', 'freight-scfi', 'freight-bdi', 'sec-8k', 'ai-models:new:openai', 'ai-models:price:openai/x', 'ai-regulation:celex:32026R2601']) {
      assert.equal(feedTier(id), 'weekly', id);
    }
    for (const id of ['aircraft:kyiv', 'gps:taipei', 'gps-region:europe', 'attack-spike', 'violence:UA', 'sea:u1', 'airspace', 'unknown']) {
      assert.equal(feedTier(id), null, id);
    }
  });
});

describe('Export controls and tariffs (#122)', () => {
  const docRaw = (o: Record<string, unknown> = {}) => ({
    id: '2026-20001', title: 'Addressing Remote Access to Advanced Semiconductors', type: 'Rule', action: 'Interim final rule.', agency: 'BIS',
    kind: 'export-control', publishedAt: '2026-11-07', effectiveOn: '2026-11-07', url: 'https://www.federalregister.gov/d/2026-20001', abstract: '', aiRelated: false, ...o,
  });
  const feed = (items: unknown[]) => decodeFederalRegister({ fetchedAt: AT - H, windowDays: 30, items })!;

  it('decodes the seeded payload strictly, newest first, and keeps an empty list valid', () => {
    assert.equal(decodeFederalRegister(null), null);
    assert.deepEqual(feed([]).items, []);
    const d = feed([docRaw({ id: 'old', publishedAt: '2026-10-30' }), docRaw(), docRaw({ id: 'bad', agency: 'FDA' }), docRaw({ id: 'x', url: 'https://evil.example' })]);
    // Same day: by document number, descending.
    assert.deepEqual(d.items.map((i) => i.id), ['x', '2026-20001', 'old']);
    assert.equal(d.items[0]!.url, '');
  });

  it(`fires one card per BIS or USTR action in the last ${FED_REG_NEW_DAYS} days, with its place and filtered news`, () => {
    const data = feed([
      docRaw(),
      docRaw({ id: '2026-2', agency: 'USTR', kind: 'tariff', type: 'Notice', action: 'Notice.', publishedAt: '2026-11-06', effectiveOn: '',
        title: "Notice of Modification of Section 301 Action: China's Targeting of the Maritime, Logistics, and Shipbuilding Sectors" }),
      docRaw({ id: '2026-old', publishedAt: '2026-11-04' }),
    ]);
    const news = [
      // The USTR notice is dated 6 Nov (14:00 UTC); its window is the 24 h before.
      story('China vows response after US raises Section 301 tariffs on ships', AT - 47 * H),
      story('EU and US agree on steel tariffs', AT - 47 * H),
      story('Commerce Department tightens chip curbs on remote access', AT - 26 * H),
    ];
    const list = exportControlFeeds(ready(data), news, AT);
    assert.deepEqual(list.map((f) => f.id), ['export-controls:2026-20001', 'export-controls:2026-2']);
    const [bis, ustr] = list;
    assert.equal(bis?.kind === 'fired' && bis.indicator.name, 'Export controls · BIS rule');
    assert.equal(bis?.kind === 'fired' && bis.indicator.value, 'Interim final rule');
    assert.equal(bis?.kind === 'fired' && bis.indicator.change, 'effective 7 Nov');
    assert.equal(bis?.kind === 'fired' && bis.indicator.place, undefined);
    assert.deepEqual(bis?.kind === 'fired' && bis.indicator.links.stories.map((st) => st.item.title), ['Commerce Department tightens chip curbs on remote access']);
    assert.equal(ustr?.kind === 'fired' && ustr.indicator.name, 'Tariffs · USTR notice');
    assert.deepEqual(ustr?.kind === 'fired' && ustr.indicator.place, { countries: ['CN'] });
    // A tariff story about other countries does not link to the China action.
    assert.deepEqual(ustr?.kind === 'fired' && ustr.indicator.links.stories.map((st) => st.item.title), ['China vows response after US raises Section 301 tariffs on ships']);
    assert.equal(ustr?.kind === 'fired' && ustr.indicator.trust.source, 'Federal Register (USTR)');
  });

  it('stays quiet naming the latest action, and reports stale and unavailable with the seeder', () => {
    const quiet = exportControlFeeds(ready(feed([docRaw({ publishedAt: '2026-10-30' })])), [], AT)[0]!;
    assert.equal(quiet.kind, 'quiet');
    assert.equal(quiet.kind === 'quiet' && quiet.detail, 'Live · no BIS or USTR action in 3 days · latest BIS rule, 30 Oct');
    assert.equal(exportControlFeeds(ready({ ...feed([]), fetchedAt: AT - 9 * H }), [], AT)[0]!.kind, 'stale');
    const down = exportControlFeeds({ status: 'error', data: null, at: AT, error: 'x' }, [], AT)[0]!;
    assert.match(down.kind === 'unavailable' ? down.detail : '', /seed-federal-register/);
    assert.deepEqual(tradeCountries("Vietnam's Acts and Chinese overcapacity; North Korean entities"), ['CN', 'VN', 'KP']);
    assert.deepEqual(tradeCountries('Republic of Korea steel'), ['KR']);
  });

  it('reads what the seeder writes (producer → reader)', async () => {
    const { fetchFederalRegister } = await import('../scripts/seed-federal-register.mjs');
    const body = { total_pages: 1, results: [{ document_number: '2026-9', title: 'Additions to the Entity List', type: 'Rule', action: 'Final rule.', abstract: '', publication_date: '2026-11-08',
      effective_on: '2026-11-08', html_url: 'https://www.federalregister.gov/d/2026-9', agencies: [{ slug: 'industry-and-security-bureau' }] }] };
    const seeded = await fetchFederalRegister({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => body }) as never, nowMs: AT });
    const read = decodeFederalRegister(JSON.parse(JSON.stringify(seeded)));
    assert.deepEqual(read?.items.map((i) => [i.id, i.agency, i.kind]), [['2026-9', 'BIS', 'export-control']]);
    assert.equal(exportControlFeeds(ready(read!), [], AT)[0]?.kind, 'fired');
  });
});

describe('New restricted parties (#123)', () => {
  const ev = (o: Record<string, unknown> = {}) => ({
    at: AT - 2 * H, list: 'CSL-EL', name: 'Shenzhen Example Technology Co., Ltd.', cc: ['CN'], pr: [], effectiveAt: String(Date.UTC(2026, 10, 7)),
    notice: '91 FR 70001', ...o,
  });
  const lists = [
    { list: 'CSL-EL', status: 'ok', count: 3317, publishedAt: Date.UTC(2026, 10, 7, 20) },
    { list: 'CSL-DTC', status: 'ok', count: 797, publishedAt: Date.UTC(2026, 6, 24) },
  ];
  const feed = (events: unknown[], o: Record<string, unknown> = {}) =>
    decodeCslAdditions({ version: 1, fetchedAt: AT - H, windowDays: 7, lists, events, truncated: false, gaps: [], ...o })!;

  it('decodes the projection strictly, newest first, and keeps no additions valid', () => {
    assert.equal(decodeCslAdditions(null), null);
    assert.equal(decodeCslAdditions({ fetchedAt: AT, lists: [] }), null);
    assert.deepEqual(feed([]).events, []);
    const d = feed([ev({ name: 'older', at: AT - 5 * H }), ev(), ev({ name: '' }), ev({ cc: ['cn', 'XXX'], name: 'lower' })]);
    assert.deepEqual(d.events.map((e) => e.name), ['Shenzhen Example Technology Co., Ltd.', 'lower', 'older']);
    assert.deepEqual(d.events[1]!.countries, ['CN']);
    assert.equal(d.events[0]!.effectiveAt, Date.UTC(2026, 10, 7));
  });

  it(`fires per country on any Entity List addition, or ${RESTRICTED_COUNTRY_MIN} on one list, within 24 h`, () => {
    const dtc = (i: number, cc = ['RU']) => ev({ list: 'CSL-DTC', name: `Debarred person ${i}`, cc, notice: '', effectiveAt: '0' });
    const data = feed([
      ev(),
      ev({ name: 'Hong Kong Example Trading', cc: ['HK', 'CN'] }),
      ...[1, 2, 3, 4, 5].map((i) => dtc(i)),
      ...[1, 2, 3, 4].map((i) => dtc(i, ['IR'])),
      ev({ name: 'Old listing', cc: ['AE'], at: AT - 30 * H }),
    ]);
    const groups = newRestrictedParties(data, AT);
    assert.deepEqual(groups.map((g) => [g.code, g.additions.length, g.entityList]), [['CN', 2, 2], ['HK', 1, 1], ['RU', 5, 0]]);
    const news = [
      story('US adds Chinese chipmakers to Entity List', AT - 4 * H),
      story('China hosts trade fair in Shenzhen', AT - 4 * H),
      story('Commerce Department blacklists Russian firms', AT - 4 * H),
    ];
    const list = restrictedPartyFeeds(ready(data), news, AT);
    assert.deepEqual(list.map((f) => f.id), ['restricted-parties:CN', 'restricted-parties:HK', 'restricted-parties:RU']);
    const [cn, , ru] = list;
    assert.equal(cn?.kind === 'fired' && cn.indicator.name, 'New restricted parties · China');
    assert.equal(cn?.kind === 'fired' && cn.indicator.value, '2 added');
    assert.equal(cn?.kind === 'fired' && cn.indicator.change, 'Entity List 2');
    assert.equal(cn?.kind === 'fired' && cn.indicator.dataDate, 'listed 7 Nov');
    assert.match(cn?.kind === 'fired' ? cn.indicator.detail ?? '' : '', /91 FR 70001/);
    assert.deepEqual(cn?.kind === 'fired' && cn.indicator.place, { countries: ['CN'] });
    // A story about the country links only when it is about listings.
    assert.deepEqual(cn?.kind === 'fired' && cn.indicator.links.stories.map((st) => st.item.title), ['US adds Chinese chipmakers to Entity List']);
    assert.equal(ru?.kind === 'fired' && ru.indicator.change, 'ITAR Debarred List 5');
    assert.equal(ru?.kind === 'fired' && ru.indicator.trust.source, 'US Consolidated Screening List (State)');
    assert.deepEqual(ru?.kind === 'fired' && ru.indicator.links.stories.map((st) => st.item.title), ['Commerce Department blacklists Russian firms']);
  });

  it('stays quiet with the Entity List size, says when a list was not compared, and reports stale and unavailable', () => {
    const quiet = restrictedPartyFeeds(ready(feed([ev({ at: AT - 30 * H })])), [], AT)[0]!;
    assert.equal(quiet.kind === 'quiet' && quiet.detail, 'Live · no new BIS or State listing in 24 h · Entity List 3,317 parties, updated 7 Nov');
    const held = feed([], { gaps: [{ list: 'CSL-EL', from: AT - 7 * H, to: AT - H, reason: 'held' }, { list: 'CSL-DTC', from: AT - 30 * H, to: AT - 20 * H, reason: 'unavailable' }] });
    assert.equal(cslComparisonNote(held), 'not compared on the last run: Entity List');
    assert.equal(cslComparisonNote(feed([], { gaps: [{ list: 'CSL-EL', from: AT - H, to: AT - H, reason: 'baseline-unavailable' }] })), 'first comparison on the next run');
    assert.equal(restrictedPartyFeeds(ready({ ...feed([]), fetchedAt: AT - 20 * H }), [], AT)[0]!.kind, 'stale');
    const down = restrictedPartyFeeds({ status: 'error', data: null, at: AT, error: 'x' }, [], AT)[0]!;
    assert.match(down.kind === 'unavailable' ? down.detail : '', /seed-sanctions-pressure/);
  });

  it('reads what seed-sanctions-pressure writes (CSL download → change history → projection → reader)', async () => {
    const { parseCslPayload, CSL_SOURCES } = await import('../scripts/_csl-sanctions.mjs');
    const { buildSanctionsChanges, projectCslAdditions } = await import('../scripts/_sanctions-changes.mjs');
    const row = (id: string, name: string, country: string) => ({
      source: 'Entity List (EL) - Bureau of Industry and Security', id: id.repeat(56), name, addresses: [{ country }],
      start_date: '2026-11-07', federal_register_notice: '91 FR 70001', source_list_url: 'https://www.bis.gov/entity-list', programs: [],
    });
    const payload = (rows: unknown[]) => ({ results: rows, sources_used: [{ source: 'Entity List (EL) - Bureau of Industry and Security', source_last_updated: '2026-11-07T20:00:00+00:00' }] });
    const t0 = AT - 8 * H;
    const t1 = AT - H;
    const before = parseCslPayload(payload([row('a', 'Existing Party', 'CN')]), t0).lists;
    const after = parseCslPayload(payload([row('a', 'Existing Party', 'CN'), row('b', 'New Party Ltd', 'CN')]), t1).lists;
    const snap = (lists: Record<string, { records: unknown[], publishedAt: number }>, at: number) =>
      Object.fromEntries(CSL_SOURCES.filter((s: string) => lists[s]?.records.length).map((s: string) => [s, { fetchedAt: at, publishedAt: lists[s]!.publishedAt, records: lists[s]!.records }]));
    const health = { 'CSL-EL': { status: 'ok', recordCount: 2, publishedAt: Date.UTC(2026, 10, 7, 20) } };
    const changes = buildSanctionsChanges({ history: null, previous: snap(before, t0), current: snap(after, t1), health, now: t1 });
    const projected = projectCslAdditions(changes, health, CSL_SOURCES);
    const read = decodeCslAdditions(JSON.parse(JSON.stringify(projected)));
    assert.deepEqual(read?.events.map((e) => [e.list, e.name, e.countries]), [['CSL-EL', 'New Party Ltd', ['CN']]]);
    const fired = restrictedPartyFeeds(ready(read!), [], AT)[0];
    assert.equal(fired?.kind === 'fired' && fired.indicator.id, 'restricted-parties:CN');
    assert.equal(fired?.kind === 'fired' && fired.indicator.dataDate, 'listed 7 Nov');
  });
});

describe('EU sanctions (#129)', () => {
  const moscow = { id: 'moscow', name: 'Moscow', lat: 55.75, lon: 37.62 };
  const listing = (id: string, o: Record<string, unknown> = {}) => ({
    at: AT - 2 * H, id, ref: `EU.${id}.12`, name: `Person ${id}`, type: 'person', programmes: ['RUS'], countries: ['RU'],
    listedOn: '2026-11-07', regulation: '2026/2601', url: 'https://eur-lex.europa.eu/x', ...o,
  });
  const feed = (additions: unknown[], o: Record<string, unknown> = {}) => decodeEuSanctions({ fetchedAt: AT - H, generatedAt: AT - 3 * H, entityCount: 5123, baselineAt: AT - 10 * 86_400_000, windowDays: 14, additions, ...o })!;

  it('decodes strictly', () => {
    assert.equal(decodeEuSanctions(null), null);
    assert.equal(decodeEuSanctions({ fetchedAt: AT, additions: [] }), null, 'no entity count');
    const d = feed([listing('1', { countries: ['ru', 'XX1'], url: 'https://evil.example' }), { id: '2', at: AT }]);
    assert.deepEqual(d.additions.map((a) => [a.id, a.countries, a.url]), [['1', ['RU'], '']]);
  });

  it('fires for a hotspot country on one listing, and for every country from five listings', () => {
    const one = euSanctionsFeeds(ready(feed([listing('1'), listing('2', { countries: ['FR'] })])), [moscow], [], AT);
    assert.deepEqual(one.map((f) => f.id), ['eu-sanctions:RU']);
    const card = one[0]!;
    assert.equal(card.kind === 'fired' && card.indicator.name, 'New EU sanctions · Russia');
    assert.equal(card.kind === 'fired' && card.indicator.rule, 'new EU listing ≤ 24 h, hotspot country');
    assert.equal(card.kind === 'fired' && card.indicator.detail, 'Person 1 · under 2026/2601');
    assert.deepEqual(card.kind === 'fired' && card.indicator.place?.countries, ['RU']);
    const busy = [listing('1'), ...['2', '3', '4', '5'].map((id) => listing(id, { countries: ['AE'], programmes: ['IRN'] }))];
    const { groups, total } = newEuListings(feed(busy), [moscow], AT);
    assert.equal(total, EU_SANCTIONS_DAY_MIN);
    assert.deepEqual(groups.map((g) => [g.code, g.listings.length, g.hotspot]), [['RU', 1, true], ['AE', 4, false]]);
    const ae = euSanctionsFeeds(ready(feed(busy)), [moscow], [], AT).find((f) => f.id === 'eu-sanctions:AE')!;
    assert.equal(ae.kind === 'fired' && ae.indicator.rule, `${EU_SANCTIONS_DAY_MIN}+ EU listings ≤ 24 h (5 today)`);
  });

  it('stays quiet past the window or off the hotspots, says so, and notes a fresh baseline', () => {
    const old = euSanctionsFeeds(ready(feed([listing('1', { at: AT - 30 * H })])), [moscow], [], AT)[0]!;
    assert.equal(old.kind === 'quiet' && old.detail, 'Live · no new EU listing in 24 h · 5,123 listed');
    const off = euSanctionsFeeds(ready(feed([listing('1', { countries: ['FR'] })])), [moscow], [], AT)[0]!;
    assert.equal(off.kind === 'quiet' && off.detail, 'Live · 1 new EU listing in 24 h, none for a hotspot country · 5,123 listed');
    const fresh = euSanctionsFeeds(ready(feed([], { baselineAt: AT - 2 * H })), [moscow], [], AT)[0]!;
    assert.match(fresh.kind === 'quiet' ? fresh.detail : '', /first read of the list 8 Nov; new listings show from the next change/);
    assert.equal(euSanctionsFeeds(ready(feed([], { fetchedAt: AT - 13 * H })), [moscow], [], AT)[0]!.kind, 'stale');
  });

  it('reads what the seeder writes (producer → reader)', async () => {
    const { parseEuList } = await import('../scripts/seed-eu-sanctions.mjs');
    const xml = `<export xmlns="http://eu.europa.ec/fpi/fsd/export" generationDate="2026-11-08T09:00:00+01:00"><sanctionEntity euReferenceNumber="EU.9.1" logicalId="9"><regulation publicationDate="2026-11-07" numberTitle="2026/2601" programme="RUS"/><subjectType code="enterprise" classificationCode="E"/><nameAlias wholeName="OOO Example" strong="true" nameLanguage=""/><citizenship countryIso2Code="RU"/></sanctionEntity></export>`;
    const [e] = parseEuList(xml).entities;
    const read = decodeEuSanctions(JSON.parse(JSON.stringify({ fetchedAt: AT - H, generatedAt: AT - 3 * H, entityCount: 5000, baselineAt: AT - 86_400_000 * 5, windowDays: 14, additions: [{ ...e, at: AT - H }] })));
    assert.deepEqual(read?.additions.map((a) => [a.id, a.name, a.type, a.countries, a.programmes]), [['9', 'OOO Example', 'entity', ['RU'], ['RUS']]]);
  });
});

describe('Travel advisories (#124)', () => {
  const telaviv = { id: 'telaviv', name: 'Tel Aviv', lat: 32.08, lon: 34.78 };
  const kyiv = { id: 'kyiv', name: 'Kyiv', lat: 50.45, lon: 30.52 };
  const us = (o: Record<string, unknown> = {}) => ({ at: AT - 2 * H, source: 'US', country: 'IL', name: 'Israel', from: 2, to: 3, url: 'https://travel.state.gov/isr.html', updatedAt: Date.UTC(2026, 10, 7), ...o });
  const uk = (o: Record<string, unknown> = {}) => ({ at: AT - 3 * H, source: 'UK', country: 'UA', name: 'Ukraine', from: ['avoid_all_but_essential_travel_to_parts'], to: ['avoid_all_travel_to_parts', 'avoid_all_but_essential_travel_to_parts'], url: 'https://www.gov.uk/foreign-travel-advice/ukraine', updatedAt: null, note: 'Updated information about the Russian invasion', ...o });
  const feed = (changes: unknown[], o: Record<string, unknown> = {}) => decodeTravelLevels({
    fetchedAt: AT - H, keepDays: 14, us: { ok: true, countries: 208, level4: 24, level3: 25, baseline: true }, uk: { ok: true, indexed: 213, known: 213, pending: 0 }, changes, ...o,
  })!;

  it('decodes strictly and fires only on tighter advice', () => {
    assert.equal(decodeTravelLevels(null), null);
    assert.equal(decodeTravelLevels({ fetchedAt: AT, changes: [] }), null);
    const d = feed([us({ to: 9 }), us({ url: 'https://evil.example' }), uk({ to: ['bogus', 'avoid_all_travel_to_whole_country'] }), { source: 'EU', country: 'FR', at: AT }]);
    assert.deepEqual(d.changes.map((c) => [c.source, c.country, c.url]), [['US', 'IL', ''], ['UK', 'UA', 'https://www.gov.uk/foreign-travel-advice/ukraine']]);
    assert.deepEqual(d.changes[1]!.to, ['avoid_all_travel_to_whole_country']);
    const [up, ukUp] = feed([us(), uk()]).changes;
    assert.equal(travelChangeFires(up!), true);
    assert.equal(travelChangeFires({ ...up!, from: 4, to: 3 } as never), false, 'a fall does not fire');
    assert.equal(travelChangeFires({ ...up!, from: null, to: 3 } as never), true, 'new to the register at Level 3');
    assert.equal(travelChangeFires({ ...up!, from: null, to: 2 } as never), false);
    assert.equal(travelChangeFires(ukUp!), true);
    assert.equal(travelChangeFires({ ...ukUp!, from: (ukUp as { to: string[] }).to, to: (ukUp as { from: string[] }).from } as never), false, 'a lifted UK warning does not fire');
  });

  it('fires one card per source and hotspot country, newest change first, with filtered news', () => {
    const data = feed([us(), us({ at: AT - 5 * H, from: 1, to: 2 }), uk(), us({ country: 'FR', name: 'France' }), us({ country: 'UA', at: AT - 30 * H })]);
    const news = [
      story('Israel travel advisory raised as tensions grow', AT - 4 * H),
      story('Israel wins the match', AT - 4 * H),
      story('UK Foreign Office warns against all travel to parts of Ukraine', AT - 4 * H),
    ];
    const list = travelAdvisoryFeeds(ready(data), [telaviv, kyiv], news, AT);
    assert.deepEqual(list.map((f) => f.id), ['travel-advisory:US:IL', 'travel-advisory:UK:UA']);
    const [il, ua] = list;
    assert.equal(il?.kind === 'fired' && il.indicator.name, 'Travel advisory · Israel');
    assert.equal(il?.kind === 'fired' && il.indicator.value, 'US Level 3');
    assert.equal(il?.kind === 'fired' && il.indicator.change, 'from Level 2');
    assert.equal(il?.kind === 'fired' && il.indicator.detail, 'Reconsider travel');
    assert.equal(il?.kind === 'fired' && il.indicator.dataDate, 'issued 7 Nov');
    assert.deepEqual(il?.kind === 'fired' && il.indicator.links.stories.map((st) => st.item.title), ['Israel travel advisory raised as tensions grow']);
    assert.equal(ua?.kind === 'fired' && ua.indicator.value, 'UK: no travel to parts');
    assert.equal(ua?.kind === 'fired' && ua.indicator.change, 'was essential travel only, parts');
    assert.equal(ua?.kind === 'fired' && ua.indicator.detail, 'FCDO advises against all travel to parts; against all but essential travel to parts · Updated information about the Russian invasion');
    assert.equal(ua?.kind === 'fired' && ua.indicator.trust.source, 'UK FCDO (GOV.UK)');
    assert.deepEqual(ua?.kind === 'fired' && ua.indicator.place?.countries, ['UA']);
  });

  it('stays quiet naming coverage, says when a source failed or a baseline is filling, and reports stale and unavailable', () => {
    const quiet = travelAdvisoryFeeds(ready(feed([us({ from: 3, to: 2 })])), [telaviv], [], AT)[0]!;
    assert.equal(quiet.kind === 'quiet' && quiet.detail, 'Live · no tighter advice for a hotspot country in 24 h · US Level 4 in 24 countries');
    assert.equal(travelCoverageNote(feed([], { us: { ok: false, okAt: Date.UTC(2026, 10, 8, 9, 5) }, uk: { ok: true, indexed: 213, known: 80, pending: 133 } })), 'US register last read 8 Nov 09:05 UTC · UK baseline 80 of 213 countries');
    assert.equal(travelCoverageNote(feed([], { us: { ok: true, baseline: false, level4: 24 }, uk: { ok: false } })), 'US baseline set; changes count from the next run · GOV.UK not read yet');
    // Freshness is the older source's: a US register last read 7 h ago makes the feed stale.
    assert.equal(travelAdvisoryFeeds(ready(feed([], { us: { ok: false, okAt: AT - 7 * H }, uk: { ok: true, okAt: AT - H, indexed: 213, known: 213, pending: 0 } })), [telaviv], [], AT)[0]!.kind, 'stale');
    assert.equal(travelAdvisoryFeeds(ready({ ...feed([]), fetchedAt: AT - 7 * H }), [telaviv], [], AT)[0]!.kind, 'stale');
    const down = travelAdvisoryFeeds({ status: 'error', data: null, at: AT, error: 'x' }, [telaviv], [], AT)[0]!;
    assert.match(down.kind === 'unavailable' ? down.detail : '', /seed-travel-advisories/);
  });

  it('reads what the seeder writes (producer → reader)', async () => {
    const { diffLevels, mergeChanges, publishTransform } = await import('../scripts/seed-travel-advisories.mjs');
    const usRead = new Map([['IL', { code: 'IL', name: 'Israel', level: 4, url: 'https://travel.state.gov/isr.html', updatedAt: AT - 5 * H }]]);
    const ukPages = new Map([['UA', { slug: 'ukraine', name: 'Ukraine', updatedAt: '2026-11-08T08:00:00Z', flags: ['avoid_all_travel_to_whole_country'], note: 'Updated' }]]);
    const { state, changes } = diffLevels({ previous: { us: { IL: 3 }, uk: { UA: { flags: [], updatedAt: 'old' } } }, us: usRead, ukIndex: new Map(), ukPages, nowMs: AT - H });
    const payload = { fetchedAt: AT - H, keepDays: 14, us: { ok: true, countries: 1, level4: 1, level3: 0, baseline: true }, uk: { ok: true, indexed: 1, known: 1, pending: 0 }, changes: mergeChanges(changes, [], AT - H), state };
    const read = decodeTravelLevels(JSON.parse(JSON.stringify(publishTransform(payload))));
    assert.deepEqual(read?.changes.map((c) => [c.source, c.country]), [['UK', 'UA'], ['US', 'IL']]);
    const fired = travelAdvisoryFeeds(ready(read!), [telaviv, kyiv], [], AT);
    assert.deepEqual(fired.map((f) => f.kind === 'fired' && f.indicator.value), ['UK: no travel', 'US Level 4']);
  });
});

describe('Stablecoin supply (#137)', () => {
  const bn = (n: number) => n * 1e9;
  const coin = (symbol: string, name: string, cur: number, week: number | null, month: number | null = week) => ({ symbol, name, current: bn(cur), prevWeek: week === null ? null : bn(week), prevMonth: month === null ? null : bn(month) });
  const calm = [coin('USDT', 'Tether', 175, 174), coin('USDC', 'USD Coin', 69, 68.5), coin('USDe', 'Ethena USDe', 4.9, 4.85), coin('DAI', 'Dai', 4.6, 4.62), coin('USDS', 'Sky Dollar', 3.2, 3.15)];
  const payload = (top: unknown[], total: Record<string, number> = {}, o: Record<string, unknown> = {}) => decodeStablecoinSupply({
    fetchedAt: AT - H, unit: 'USD', top,
    total: { current: bn(284), weekNow: bn(283), weekAgo: bn(281), monthNow: bn(283), monthAgo: bn(278), ...total },
    ...o,
  })!;

  it('decodes strictly, largest coin first', () => {
    assert.equal(decodeStablecoinSupply(null), null);
    assert.equal(decodeStablecoinSupply({ fetchedAt: AT, total: { current: 1 }, top: [] }), null, 'an incomplete total is not a reading');
    assert.deepEqual(payload([calm[1], calm[0], { symbol: '', current: 1 }]).top.map((c) => c.symbol), ['USDT', 'USDC']);
  });

  it(`fires on the total moving ${SUPPLY_TOTAL_WEEK_PCT}% in 7 days, or a top-5 coin ${SUPPLY_COIN_WEEK_PCT}%, linking stories that name it`, () => {
    // Total +2.5% in a week.
    const [total] = stablecoinSupplyFeeds(ready(payload(calm, { weekNow: bn(287), weekAgo: bn(280) })), [story('Stablecoin supply hits record as traders return', AT - 2 * H)], AT);
    const t = total!.kind === 'fired' ? total!.indicator : null;
    assert.equal(t?.id, 'stablecoin-supply:total');
    assert.equal(t?.value, '$284.0bn');
    assert.equal(t?.change, '+2.5% in 7 days');
    assert.equal(t?.rule, 'total ±2% in 7 days');
    assert.equal(t?.detail, 'up $7.00bn in a week · +1.8% in 30 days · largest: USDT +0.6%, USDC +0.7%, USDe +1.0%');
    assert.deepEqual(t?.trust, { level: 'market', source: 'DefiLlama' });
    assert.equal(t?.links.stories.length, 1);

    // USDS −41.6% (live on 20 Nov 2026), the total calm: one card for the coin, linked only to a story naming it.
    const usds = [...calm.slice(0, 4), coin('USDS', 'Sky Dollar', 3.15, 5.39, 6.0)];
    const news = [story('Sky Dollar supply shrinks as USDS holders redeem', AT - 2 * H), story('Stablecoins steady as bitcoin rallies', AT - 2 * H)];
    const feeds = stablecoinSupplyFeeds(ready(payload(usds)), news, AT);
    assert.deepEqual(feeds.map((f) => f.id), ['stablecoin-supply:USDS']);
    const c = feeds[0]!.kind === 'fired' ? feeds[0]!.indicator : null;
    assert.equal(c?.value, '$3.15bn');
    assert.equal(c?.change, '−41.6% in 7 days');
    assert.equal(c?.rule, 'a top-5 coin ±5% in 7 days');
    assert.equal(c?.detail, 'Sky Dollar: $5.39bn a week ago · −47.5% in 30 days · all US$ coins +0.7% in 7 days');
    assert.deepEqual(c?.links.stories.map((st) => st.item.title), ['Sky Dollar supply shrinks as USDS holders redeem']);
    // A coin outside the top 5 never fires.
    assert.equal(stablecoinSupplyFeeds(ready(payload([...calm, coin('PYUSD', 'PayPal USD', 1, 2)])), [], AT)[0]!.kind, 'quiet');
    // A coin shrinking out of the top 5 by today's supply keeps its card: ranked by the larger of now and a week ago.
    const shrinking = [...calm.slice(0, 4), coin('USDS', 'Sky Dollar', 3.2, 3.15), coin('USD1', 'World Liberty Financial USD', 2.0, 5.0)];
    assert.deepEqual(stablecoinSupplyFeeds(ready(payload(shrinking)), [], AT).map((f) => f.id), ['stablecoin-supply:USD1']);
    assert.equal(SUPPLY_TOP_COINS, 5);
    // DAI's card does not link a story about Sky the broadcaster or Dai-ichi Life.
    const dai = [...calm.slice(0, 3), coin('DAI', 'Dai', 4.0, 4.62), calm[4]!];
    const [daiCard] = stablecoinSupplyFeeds(ready(payload(dai)), [story("Comcast's Sky to cut jobs", AT - H), story('Dai-ichi Life buys US insurer', AT - H), story('MakerDAO votes to cut Dai stablecoin rate', AT - H)], AT);
    assert.deepEqual(daiCard!.kind === 'fired' ? daiCard!.indicator.links.stories.map((st) => st.item.title) : [], ['MakerDAO votes to cut Dai stablecoin rate']);
  });

  it('is quiet below both triggers, and reports stale and unavailable', () => {
    const [quiet] = stablecoinSupplyFeeds(ready(payload(calm)), [], AT);
    assert.equal(quiet!.kind === 'quiet' && quiet!.detail, 'Live · all US$ coins $284.0bn, +0.7% in 7 days · largest: USDT +0.6%, USDC +0.7%, USDe +1.0%, DAI −0.4%, USDS +1.6% · fires at ±2% total or ±5% for a top-5 coin');
    assert.equal(stablecoinSupplyFeeds(ready(payload(calm, {}, { fetchedAt: AT - 13 * H })), [], AT)[0]!.kind, 'stale');
    // The rule fires on the rounded number the card shows: +1.96% reads +2.0% and fires; +1.94% reads +1.9% and does not.
    assert.equal(stablecoinSupplyFeeds(ready(payload(calm, { weekNow: bn(101.96), weekAgo: bn(100) })), [], AT)[0]!.kind, 'fired');
    assert.equal(stablecoinSupplyFeeds(ready(payload(calm, { weekNow: bn(101.94), weekAgo: bn(100) })), [], AT)[0]!.kind, 'quiet');
    // A tiny fall reads +0.0%, not −0.0%.
    const [flat] = stablecoinSupplyFeeds(ready(payload(calm, { weekNow: bn(99.99), weekAgo: bn(100) })), [], AT);
    assert.match(flat!.kind === 'quiet' ? flat!.detail : '', /\$284\.0bn, \+0\.0% in 7 days/);
    const err = stablecoinSupplyFeeds({ status: 'error', data: null, at: AT, error: 'x' }, [], AT)[0]!;
    assert.match(err.kind === 'unavailable' ? err.detail : '', /seed-stablecoin-supply/);
  });

  it('reads what the seeder writes (producer → reader)', async () => {
    const { supplyFrom } = await import('../scripts/seed-stablecoin-supply.mjs');
    const a = (id: number, symbol: string, name: string, cur: number, week: number) => ({ id: String(id), symbol, name, pegType: 'peggedUSD', circulating: { peggedUSD: bn(cur) }, circulatingPrevWeek: { peggedUSD: bn(week) }, circulatingPrevMonth: { peggedUSD: bn(week) } });
    const { total, top } = supplyFrom({ peggedAssets: [a(1, 'USDT', 'Tether', 175, 175), a(2, 'USDC', 'USD Coin', 69, 69), a(3, 'USDe', 'Ethena USDe', 5, 5), a(4, 'DAI', 'Dai', 4.6, 4.6), a(5, 'USDS', 'Sky Dollar', 3.15, 5.39)] });
    const read = decodeStablecoinSupply(JSON.parse(JSON.stringify({ fetchedAt: AT - H, unit: 'USD', total, top })))!;
    const feeds = stablecoinSupplyFeeds(ready(read), [], AT);
    assert.deepEqual(feeds.map((f) => [f.id, f.kind]), [['stablecoin-supply:USDS', 'fired']]);
    // Wired into the Finance feeds.
    const failed = { status: 'error', data: null, at: AT, error: 'x' } as const;
    assert.ok(financeFeeds({ crypto: failed, flow: failed, stables: failed, fearGreed: failed, supply: ready(read), news: [], now: AT }).some((f) => f.id === 'stablecoin-supply:USDS'));
  });
});

describe('Fed decision odds (#125)', () => {
  const meetingAt = Date.UTC(2026, 11, 9, 18, 55);
  const bucket = (upper: number | null, p: number, pPrev: number, o: Record<string, unknown> = {}) => ({ upper, below: false, above: null, p, pPrev, ...o });
  const odds = (buckets: unknown[], o: Record<string, unknown> = {}) => decodeRateOdds({
    fetchedAt: AT - 30 * 60_000, target: { value: 4, date: '2026-11-07' },
    meetings: [{ event: 'KXFED-26DEC', decisionAt: meetingAt, volume: 1_300_000, url: 'https://kalshi.com/markets/kxfed', buckets }], ...o,
  })!;
  const ladder = (hold: number, holdPrev: number) => [
    bucket(3.5, 0.01, 0.01, { below: true }), bucket(3.75, 0.99 - hold - 0.05, 0.99 - holdPrev - 0.05), bucket(4, hold, holdPrev), bucket(4.25, 0.05, 0.05), bucket(null, 0, 0, { above: 4.25 }),
  ];

  it('decodes strictly and labels outcomes against the current target', () => {
    assert.equal(decodeRateOdds(null), null);
    const d = odds([...ladder(0.7, 0.7), bucket(4.5, 2, 0)]);
    assert.equal(d.meetings[0]!.buckets.length, 5, 'an odds value above 1 is dropped');
    assert.equal(decodeRateOdds({ fetchedAt: AT, target: null, meetings: [{ decisionAt: meetingAt, buckets: [bucket(4, 1, 1)] }] })!.meetings.length, 0, 'a meeting needs three outcomes');
    assert.equal(rateOutcomeLabel(bucket(4, 0, 0), 4), 'Hold');
    assert.equal(rateOutcomeLabel(bucket(3.75, 0, 0), 4), 'Cut 25 bp');
    assert.equal(rateOutcomeLabel(bucket(4.5, 0, 0), 4), 'Hike 50 bp');
    assert.equal(rateOutcomeLabel(bucket(3.5, 0, 0, { below: true }), 4), 'Cut ≥ 50 bp');
    assert.equal(rateOutcomeLabel(bucket(null, 0, 0, { above: 4.25 }), 4), 'Hike > 25 bp');
    assert.equal(rateOutcomeLabel(bucket(4.25, 0, 0), null), '4.25%');
  });

  it(`fires when the move odds shift ${RATE_ODDS_MOVE_PTS} pts in a day, with Fed news`, () => {
    const news = [story('Powell signals the Fed could cut rates in December', AT - 2 * H), story('Retail sales beat estimates', AT - 2 * H)];
    // Hold 70% → 50%: move odds 30% → 50%, +20 pts; hold stays the most likely outcome.
    const fired = rateOddsFeed({ odds: ready(odds(ladder(0.5, 0.7))), news, now: AT });
    assert.equal(fired.kind, 'fired');
    const ind = fired.kind === 'fired' ? fired.indicator : null;
    assert.equal(ind?.name, 'Fed decision odds · 9 Dec');
    assert.equal(ind?.value, 'Hold 50%');
    assert.equal(ind?.change, 'move odds 30% → 50%');
    assert.equal(ind?.trust.level, 'market');
    assert.match(ind?.detail ?? '', /Hold 50% · Cut 25 bp 44% · Hike 25 bp 5% · target upper bound 4\.00% \(FRED, 7 Nov\)/);
    assert.deepEqual(ind?.links.stories.map((st) => st.item.title), ['Powell signals the Fed could cut rates in December']);
  });

  it('fires when the most likely outcome changes, and stays quiet on a small shift', () => {
    // Hold 50% → 40%: +10 pts only, but a cut (54%) overtakes the hold.
    const flip = rateOddsFeed({ odds: ready(odds(ladder(0.4, 0.5))), news: [], now: AT });
    assert.equal(flip.kind === 'fired' && flip.indicator.value, 'Cut 25 bp 54%');
    assert.match(flip.kind === 'fired' ? flip.indicator.detail ?? '' : '', /most likely was Hold 50% a day earlier/);
    const quiet = rateOddsFeed({ odds: ready(odds(ladder(0.7, 0.75))), news: [], now: AT });
    assert.equal(quiet.kind, 'quiet');
    assert.equal(quiet.kind === 'quiet' && quiet.detail, 'Hold 70% at the 9 Dec meeting · move odds 30% (+5 pts in a day) · target upper bound 4.00% (FRED, 7 Nov)');
    // Without the current target only the most-likely rule can fire.
    const noTarget = rateOddsFeed({ odds: ready(odds(ladder(0.5, 0.7), { target: null })), news: [], now: AT });
    assert.equal(noTarget.kind, 'quiet');
    assert.match(noTarget.kind === 'quiet' ? noTarget.detail : '', /move odds need the current target/);
    // The target at the open bottom bucket ("≤ 4.00%" mixes hold and cuts): no move odds, never a made-up 100%.
    const offLadder = rateOddsFeed({ odds: ready(odds([bucket(4, 0.3, 0.6, { below: true }), bucket(4.25, 0.6, 0.35), bucket(4.5, 0.1, 0.05), bucket(null, 0, 0, { above: 4.5 })])), news: [], now: AT });
    assert.equal(offLadder.kind === 'fired' && offLadder.indicator.change, 'was ≤ 4.00% 60%');
  });

  it('reports stale, unavailable and a passed meeting', () => {
    assert.equal(rateOddsFeed({ odds: ready({ ...odds(ladder(0.7, 0.7)), fetchedAt: AT - 3 * H }), news: [], now: AT }).kind, 'stale');
    const down = rateOddsFeed({ odds: { status: 'error', data: null, at: AT, error: 'x' }, news: [], now: AT });
    assert.match(down.kind === 'unavailable' ? down.detail : '', /seed-rate-odds/);
    assert.notEqual(rateOddsFeed({ odds: ready(odds(ladder(0.7, 0.7))), news: [], now: meetingAt + H }).kind, 'quiet');
  });

  it('reads what the seeder writes (producer → reader)', async () => {
    const { buildMeetings } = await import('../scripts/seed-rate-odds.mjs');
    const r = (strike: number, last: number, prev: number) => ({ event_ticker: 'KXFED-26DEC', strike_type: 'greater', floor_strike: strike, last_price_dollars: String(last), previous_price_dollars: String(prev), volume_fp: '10', close_time: '2026-12-09T18:55:00Z' });
    const meetings = buildMeetings([r(3.5, 0.99, 0.99), r(3.75, 0.9, 0.9), r(4, 0.6, 0.2), r(4.25, 0.05, 0.05)], AT);
    const read = decodeRateOdds(JSON.parse(JSON.stringify({ fetchedAt: AT - 30 * 60_000, series: 'KXFED', target: { value: 4, date: '2026-11-07' }, meetings })));
    const feed = rateOddsFeed({ odds: ready(read!), news: [], now: AT });
    // A hike to 4.25% went from 15% to 55%: it is now the most likely outcome, and move odds rose 40 pts.
    assert.equal(feed.kind === 'fired' && feed.indicator.value, 'Hike 25 bp 55%');
    assert.equal(feed.kind === 'fired' && feed.indicator.change, 'move odds 30% → 70%');
  });
});

describe('Open-weight models (#132)', () => {
  const hubModel = (id: string, seenAgoH: number, o: Record<string, unknown> = {}) => ({
    id, lab: id.split('/')[0], labName: ({ Qwen: 'Qwen', 'deepseek-ai': 'DeepSeek', mistralai: 'Mistral', google: 'Google' } as Record<string, string>)[id.split('/')[0]!] ?? 'Meta',
    name: id.split('/')[1], firstSeenAt: AT - seenAgoH * H, createdAt: AT - seenAgoH * H, task: 'text-generation', license: 'apache-2.0', likes: 420, downloads: 31_000,
    url: `https://huggingface.co/${id}`, ...o,
  });
  const payload = (models: unknown[], o: Record<string, unknown> = {}) => decodeAiModels({
    fetchedAt: AT - H, listed: 477, watched: 210, baseline: true, models: [], changes: [],
    open: { models, latest: [{ lab: 'Qwen', labName: 'Qwen', name: 'Qwen3.8-27B', firstSeenAt: AT - 10 * 24 * H, url: 'https://huggingface.co/Qwen/Qwen3.8-27B' }], baseline: true, okAt: AT - H, failedLabs: [], ...o },
  })!;

  it(`fires one card per lab for open weights first seen in ${OPEN_MODEL_NEW_DAYS} days over the threshold, with Hub links and model news`, () => {
    const news = [story('DeepSeek-V4.2 open weights beat GPT on coding benchmarks', AT - 2 * H), story('DeepSeek hires a new chief scientist', AT - 2 * H)];
    const feeds = openModelFeeds(ready(payload([
      hubModel('deepseek-ai/DeepSeek-V4.2', 5, { likes: 2400, downloads: 120_000, license: 'mit' }),
      hubModel('deepseek-ai/DeepSeek-V4.2-Base', 5, { likes: 300 }),
      hubModel('Qwen/Qwen3.8-Tiny', 6, { likes: 12, downloads: 900 }),
      hubModel('mistralai/Mistral-Old', 9 * 24),
    ])), news, AT);
    assert.equal(feeds.length, 1);
    const ind = feeds[0]!.kind === 'fired' ? feeds[0]!.indicator : null;
    assert.equal(ind?.id, 'open-models:deepseek-ai');
    assert.equal(ind?.name, 'Open-weight models · DeepSeek');
    assert.equal(ind?.value, '2 released');
    assert.equal(ind?.change, 'DeepSeek-V4.2, DeepSeek-V4.2-Base');
    // Long Hub names stop where they would overflow the one-line change.
    assert.equal(fitNames(['DeepSeek-V9-Example', 'DeepSeek-V9-Example-Base', 'X'], 40), 'DeepSeek-V9-Example +2 more');
    assert.equal(ind?.rule, 'open weights first seen ≤ 7 days, ≥ 100 likes or ≥ 10k downloads');
    assert.equal(ind?.detail, 'DeepSeek-V4.2: text-generation, mit · 2k likes · 120k downloads · DeepSeek-V4.2-Base: text-generation, apache-2.0 · 300 likes · 31k downloads');
    assert.deepEqual(ind?.trust, { level: 'reported', source: 'Hugging Face Hub', url: 'https://huggingface.co/deepseek-ai/DeepSeek-V4.2' });
    assert.deepEqual(ind?.links.stories.map((st) => st.item.title), ['DeepSeek-V4.2 open weights beat GPT on coding benchmarks']);
  });

  it('is quiet below the threshold, names the newest release and a failed lab, and reports stale, missing and unavailable', () => {
    const [quiet] = openModelFeeds(ready(payload([hubModel('Qwen/Qwen3.8-Tiny', 6, { likes: 12, downloads: 900 })], { failedLabs: ['google'] })), [], AT);
    assert.equal(quiet!.kind === 'quiet' && quiet!.detail, 'Live · 1 new open-weight model in 7 days, none over the threshold yet · newest Qwen Qwen3.8-27B, 29 Oct · google not read on the last run');
    // The Hub read older than the cadence allows makes the row stale, though OpenRouter is fresh.
    assert.equal(openModelFeeds(ready(payload([], { okAt: AT - 14 * H })), [], AT)[0]!.kind, 'stale');
    // A payload from before #132 has no Hub block: unavailable, not a confident quiet.
    const old = decodeAiModels({ fetchedAt: AT - H, listed: 477, watched: 210, baseline: true, models: [], changes: [] })!;
    assert.equal(old.open, null);
    assert.notEqual(openModelFeeds(ready(old), [], AT)[0]!.kind, 'quiet');
    const err = openModelFeeds({ status: 'error', data: null, at: AT, error: 'x' }, [], AT)[0]!;
    assert.match(err.kind === 'unavailable' ? err.detail : '', /seed-ai-models/);
  });

  it('reads what the seeder writes (producer → reader)', async () => {
    const { normalizeHfModel } = await import('../scripts/seed-ai-models.mjs');
    const m = normalizeHfModel({ id: 'google/gemma-5-9b-it', createdAt: new Date(AT - 2 * H).toISOString(), likes: 150, downloads: 4000, pipeline_tag: 'image-text-to-text', tags: ['license:gemma'] }, 'google');
    const read = decodeAiModels(JSON.parse(JSON.stringify({ fetchedAt: AT - H, listed: 477, watched: 210, baseline: true, models: [], changes: [], open: { models: [{ ...m, firstSeenAt: AT - 2 * H }], latest: [], baseline: true, okAt: AT - H, failedLabs: [] } })))!;
    const [feed] = openModelFeeds(ready(read), [], AT);
    assert.equal(feed!.kind === 'fired' && feed!.indicator.detail, 'gemma-5-9b-it: image-text-to-text, gemma · 150 likes · 4k downloads');
  });
});

describe('AI lab announcements (#133)', () => {
  const post = (source: string, title: string, agoH: number, o: Record<string, unknown> = {}) => ({
    source, lab: '', title, url: `${({ openai: 'https://openai.com/index/', google: 'https://blog.google/technology/ai/', deepmind: 'https://deepmind.google/blog/', anthropic: 'https://www.anthropic.com/news/' } as Record<string, string>)[source]}${title.toLowerCase().replace(/\W+/g, '-')}`,
    at: AT - agoH * H, firstSeen: source === 'anthropic', release: /^Introducing|now available/.test(title), ...o,
  });
  const ok = { ok: true, okAt: AT - H };
  const feed = (posts: unknown[], sources: Record<string, unknown> = { openai: ok, google: ok, deepmind: ok, anthropic: ok }) =>
    decodeAiLabNews({ fetchedAt: AT - H, keepDays: 14, sources, posts })!;

  it('decodes strictly: only a lab\'s own links, the lab named from its feed', () => {
    assert.equal(decodeAiLabNews(null), null);
    const d = feed([post('openai', 'Introducing GPT-6.2', 3), post('openai', 'Spoofed', 2, { url: 'https://evil.example/x' }), post('bogus', 'x', 1)]);
    assert.deepEqual(d.posts.map((p) => [p.lab, p.title]), [['OpenAI', 'Introducing GPT-6.2']]);
  });

  it(`fires one card per lab for release announcements in ${LAB_NEWS_NEW_DAYS} days, linking the post and product news`, () => {
    const news = [story('OpenAI unveils GPT-6.2 Astra with a 2M-token context', AT - 2 * H), story('OpenAI hires a new CFO', AT - 2 * H)];
    const feeds = labNewsFeeds(ready(feed([
      post('openai', 'Introducing GPT-6.2 Astra and Sol', 20),
      post('openai', 'How OpenAI keeps ChatGPT fast', 5, { release: false }),
      post('deepmind', 'Introducing Gemini 4 Neon', 30),
      post('deepmind', 'Genie 4 is now available', 31),
      post('google', 'Introducing Gemma 2 in 2024', 8 * 24),
    ])), news, AT);
    assert.deepEqual(feeds.map((f) => f.id), ['lab-news:openai', 'lab-news:deepmind']);
    const openai = feeds[0]!.kind === 'fired' ? feeds[0]!.indicator : null;
    assert.equal(openai?.name, 'Lab announcement · OpenAI');
    assert.equal(openai?.value, '1 release');
    assert.equal(openai?.change, 'GPT-6.2');
    assert.equal(openai?.rule, "release announced on the lab's own site ≤ 7 days");
    assert.equal(openai?.detail, 'Introducing GPT-6.2 Astra and Sol (7 Nov)');
    assert.deepEqual(openai?.trust, { level: 'official', source: 'OpenAI (own site)', url: 'https://openai.com/index/introducing-gpt-6-2-astra-and-sol' });
    assert.deepEqual(openai?.links.stories.map((st) => st.item.title), ['OpenAI unveils GPT-6.2 Astra with a 2M-token context']);
    const dm = feeds[1]!.kind === 'fired' ? feeds[1]!.indicator : null;
    assert.deepEqual([dm?.value, dm?.change], ['2 releases', 'Gemini 4, Genie 4']);
    // An Anthropic page is dated by first sight and says so.
    const anth = labNewsFeeds(ready(feed([post('anthropic', 'Introducing Claude Opus 5', 4)])), [], AT)[0]!;
    assert.equal(anth.kind === 'fired' && anth.indicator.detail, 'Introducing Claude Opus 5 (8 Nov, first seen)');
    assert.equal(anth.kind === 'fired' && anth.indicator.change, 'Claude Opus 5');
  });

  it('is quiet without a release, names a failed lab, and is as fresh as its oldest source', () => {
    const [quiet] = labNewsFeeds(ready(feed([post('openai', 'How OpenAI keeps ChatGPT fast', 5, { release: false })], { openai: ok, google: { ok: false, okAt: AT - 2 * H }, deepmind: ok, anthropic: ok })), [], AT);
    assert.equal(quiet!.kind === 'quiet' && quiet!.detail, 'Live · 1 lab post in 7 days, none announcing a model or product · newest OpenAI: How OpenAI keeps ChatGPT fast · Google not read on the last run');
    assert.equal(labNewsFeeds(ready(feed([], { openai: ok, google: { ok: false, okAt: AT - 7 * H }, deepmind: ok, anthropic: ok })), [], AT)[0]!.kind, 'stale');
    const err = labNewsFeeds({ status: 'error', data: null, at: AT, error: 'x' }, [], AT)[0]!;
    assert.match(err.kind === 'unavailable' ? err.detail : '', /seed-ai-lab-news/);
  });

  it('reads what the seeder writes (producer → reader)', async () => {
    const { rssPosts, isReleasePost, SOURCES } = await import('../scripts/seed-ai-lab-news.mjs');
    const xml = `<rss><channel><item><title>Introducing Gemini 4 Neon</title><link>https://deepmind.google/blog/gemini-4-neon/</link><pubDate>${new Date(AT - 5 * H).toUTCString()}</pubDate></item></channel></rss>`;
    const posts = rssPosts(xml, SOURCES.find((s: { id: string }) => s.id === 'deepmind')).map((p: { title: string }) => ({ ...p, release: isReleasePost(p.title) }));
    const read = decodeAiLabNews(JSON.parse(JSON.stringify({ fetchedAt: AT - H, keepDays: 14, sources: { openai: ok, google: ok, deepmind: ok, anthropic: ok }, posts })))!;
    const [f] = labNewsFeeds(ready(read), [], AT);
    assert.equal(f!.kind === 'fired' && f!.indicator.name, 'Lab announcement · Google DeepMind');
  });
});

describe('Hyperscaler capital spending (#135)', () => {
  const start = (end: string) => `${end.slice(0, 5)}${String(Number(end.slice(5, 7)) - 2).padStart(2, '0')}-01`;
  const q = (end: string, bn: number, o: Record<string, unknown> = {}) => ({ start: start(end), end, value: bn * 1e9, filed: '2026-10-28', form: '10-Q', accn: '', derived: false, ...o });
  // Each company: Jul–Sep and Apr–Jun of 2026 and 2025. Quiet ones grow 50% y/y in both quarters (no shift).
  const firm = (ticker: string, name: string, cik: string, quarters: unknown[]) => ({ ticker, name, cik, quarters });
  const flat = (filed = '2026-10-28') => [q('2026-09-30', 30, { filed }), q('2026-06-30', 30), q('2025-09-30', 20), q('2025-06-30', 20)];
  const payload = (amazon: unknown[], o: Record<string, unknown> = {}) => decodeHyperscalerCapex({
    fetchedAt: AT - H,
    companies: [firm('MSFT', 'Microsoft', '0000789019', flat()), firm('GOOGL', 'Alphabet', '0001652044', flat()), firm('AMZN', 'Amazon', '0001018724', amazon), firm('META', 'Meta', '0001326801', flat())],
    ...o,
  })!;
  // Amazon, filed two days before AT: +100% y/y in Jul–Sep against +50% in Apr–Jun, a 50-point shift.
  const amazon = (o: Record<string, unknown> = {}) => [
    q('2026-09-30', 80, { filed: '2026-11-06', accn: '0001018724-26-000030', ...o }), q('2026-06-30', 60), q('2025-09-30', 40), q('2025-06-30', 40),
  ];

  it('decodes strictly, newest quarter first', () => {
    assert.equal(decodeHyperscalerCapex(null), null);
    assert.equal(decodeHyperscalerCapex({ fetchedAt: AT, companies: [] }), null, 'no company is not a reading');
    const d = decodeHyperscalerCapex({ fetchedAt: AT, companies: [firm('MSFT', 'Microsoft', '1', [q('2025-09-30', 20), q('2026-09-30', 30), { end: 'Sep', value: 1 }])] })!;
    assert.deepEqual(d.companies[0]!.quarters.map((x) => x.end), ['2026-09-30', '2025-09-30']);
    assert.deepEqual(capexTotal(payload(amazon())), { quarter: payload(amazon()).companies[0]!.quarters[0], total: 170e9, yoy: 70 });
  });

  it(`fires when a company's y/y growth moves ${CAPEX_YOY_SHIFT_PTS}+ pts from the quarter before, within a week of the filing, with news naming it and its spending`, () => {
    const news = [story('Amazon lifts capital spending again on AI data centres', AT - 20 * H), story('Score a 49% saving on a Samsung SSD at Amazon', AT - 20 * H), story('Cloud prices steady', AT - 20 * H)];
    const feeds = hyperscalerCapexFeeds(ready(payload(amazon())), news, AT);
    assert.equal(feeds.length, 1, 'only the fired card');
    const ind = feeds[0]!.kind === 'fired' ? feeds[0]!.indicator : null;
    assert.equal(ind?.id, 'hyperscaler-capex:AMZN');
    assert.equal(ind?.name, 'Amazon capital spending · Jul–Sep 2026');
    assert.equal(ind?.value, '$80.0bn');
    assert.equal(ind?.change, '+100.0% y/y');
    assert.equal(ind?.rule, 'y/y growth ±15 pts from the quarter before');
    assert.equal(ind?.detail, 'y/y growth +50.0 pts from Apr–Jun 2026 +50.0% · all four $170.0bn, +70.0% y/y in Jul–Sep 2026');
    assert.deepEqual(ind?.trust, { level: 'official', source: 'Amazon 10-Q via SEC EDGAR', url: 'https://www.sec.gov/Archives/edgar/data/1018724/000101872426000030/0001018724-26-000030-index.htm' });
    assert.equal(ind?.dataDate, 'filed 6 Nov');
    assert.deepEqual(ind?.links.stories.map((st) => st.item.title), ['Amazon lifts capital spending again on AI data centres']);
    // A quarter in doubt (year-to-date figures on two bases) is not compared: no card, and the four together fall back
    // to the quarter before.
    const [doubted] = hyperscalerCapexFeeds(ready(payload(amazon({ derived: true, doubt: 'restated' }))), news, AT);
    assert.equal(doubted!.kind, 'quiet');
    assert.match(doubted!.kind === 'quiet' ? doubted!.detail : '', /^Live · all four \$150\.0bn, \+50\.0% y\/y in Apr–Jun 2026 · .*Amazon n\/a \(restated figures, not compared\)/);
    // A quarter computed from year-to-date figures says so.
    const derived = hyperscalerCapexFeeds(ready(payload(amazon({ derived: true }))), [], AT)[0]!;
    assert.match(derived.kind === 'fired' ? derived.indicator.detail ?? '' : '', /year to date less the quarter before/);
  });

  it('is quiet on a small shift or an old filing, and reports stale and unavailable', () => {
    const [quiet] = hyperscalerCapexFeeds(ready(payload(amazon({ filed: '2026-10-30' }))), [], AT);
    assert.equal(quiet!.kind === 'quiet' && quiet!.detail,
      'Live · all four $170.0bn, +70.0% y/y in Jul–Sep 2026 · latest quarters y/y: Microsoft +50.0% (+0.0 pts), Alphabet +50.0% (+0.0 pts), Amazon +100.0% (+50.0 pts), Meta +50.0% (+0.0 pts) · fires at ±15 pts within 7 days of a filing');
    assert.equal(hyperscalerCapexFeeds(ready(payload(flat('2026-11-06'))), [], AT)[0]!.kind, 'quiet', 'a fresh filing with no shift');
    assert.equal(hyperscalerCapexFeeds(ready(payload(amazon(), { fetchedAt: AT - 13 * H })), [], AT)[0]!.kind, 'stale');
    const err = hyperscalerCapexFeeds({ status: 'error', data: null, at: AT, error: 'x' }, [], AT)[0]!;
    assert.match(err.kind === 'unavailable' ? err.detail : '', /seed-hyperscaler-capex/);
  });

  it('reads what the seeder writes (producer → reader)', async () => {
    const { quarterly } = await import('../scripts/seed-hyperscaler-capex.mjs');
    const f = (start: string, end: string, val: number, filed: string, form = '10-Q') => ({ start, end, val, filed, form, accn: '0001652044-26-000123' });
    const facts = [
      f('2025-01-01', '2025-03-31', 17_197e6, '2025-04-25'), f('2025-01-01', '2025-06-30', 39_643e6, '2025-07-24'), f('2025-01-01', '2025-09-30', 63_596e6, '2025-10-30'),
      f('2026-01-01', '2026-03-31', 35_674e6, '2026-04-30'), f('2026-01-01', '2026-06-30', 80_598e6, '2026-07-23'), f('2026-01-01', '2026-09-30', 131_953e6, '2026-10-29'),
    ];
    const qs = quarterly(facts);
    const written = { fetchedAt: AT - H, unit: 'USD', companies: ['Microsoft', 'Alphabet', 'Amazon', 'Meta'].map((name, i) => ({ ticker: String(i), name, cik: '1652044', concept: 'x', quarters: qs })) };
    const read = decodeHyperscalerCapex(JSON.parse(JSON.stringify(written)))!;
    const [feed] = hyperscalerCapexFeeds(ready(read), [], AT);
    assert.match(feed!.kind === 'quiet' ? feed!.detail : '', /Alphabet \+114\.4% \(\+14\.3 pts\)/);
    const dayAfterFiling = hyperscalerCapexFeeds(ready(read), [], Date.UTC(2026, 9, 30, 12))[0]!;
    assert.equal(dayAfterFiling.kind, 'quiet', 'a 14.3-point shift stays under the trigger');
  });
});

describe('TSMC monthly revenue (#134)', () => {
  const month = (m: string, yoy: number | null, o: Record<string, unknown> = {}) => ({ month: m, revenue: 586_890_319, mom: 14.66, yoy, ytdYoy: 43.29, seenAt: AT - 2 * 86_400_000, source: 'mops', ...o });
  const feed = (months: unknown[], o: Record<string, unknown> = {}) => decodeChipRevenue({ fetchedAt: AT - H, company: 'TSMC', unit: 'thousand TWD', months, ...o })!;

  it('decodes strictly, newest month first', () => {
    assert.equal(decodeChipRevenue(null), null);
    assert.equal(decodeChipRevenue({ fetchedAt: AT, months: [] }), null, 'no month is not a reading');
    const d = feed([month('2026-09', 54.64), month('2026-10', 59.71), { month: 'Oct', revenue: 1, seenAt: AT }]);
    assert.deepEqual(d.months.map((m) => m.month), ['2026-10', '2026-09']);
  });

  it(`fires when y/y growth moves ${CHIP_YOY_SHIFT_PTS}+ pts from the month before, for a month filed in the last week, with TSMC news`, () => {
    const news = [story('TSMC October revenue jumps on AI chip demand', AT - 20 * H), story('Taiwan dollar firms', AT - 20 * H)];
    const [f] = chipRevenueFeeds(ready(feed([month('2026-10', 67.86, { mom: 6.16, ytdYoy: 40.1 }), month('2026-09', 30.09)])), news, AT);
    const ind = f!.kind === 'fired' ? f!.indicator : null;
    assert.equal(ind?.id, 'chip-revenue:2330');
    assert.equal(ind?.name, 'TSMC monthly revenue · Oct 2026');
    assert.equal(ind?.value, 'NT$586.9bn');
    assert.equal(ind?.change, '+67.9% y/y');
    assert.equal(ind?.rule, 'y/y growth ±10 pts from the month before');
    assert.equal(ind?.detail, 'y/y growth +37.8 pts from Sep +30.1% · +6.2% m/m · year to date +40.1% y/y');
    assert.deepEqual(ind?.trust, { level: 'official', source: 'TSMC filing via TWSE' });
    assert.deepEqual(ind?.links.stories.map((st) => st.item.title), ['TSMC October revenue jumps on AI chip demand']);
    // A fall year on year fires on its own.
    const [fall] = chipRevenueFeeds(ready(feed([month('2026-10', -3.2), month('2026-09', 2)])), [], AT);
    assert.equal(fall!.kind === 'fired' && fall!.indicator.rule, 'revenue down year on year');
  });

  it('is quiet on a small shift or an old filing, says when the month before is missing, and reports stale and unavailable', () => {
    const [quiet] = chipRevenueFeeds(ready(feed([month('2026-10', 59.71), month('2026-09', 54.64)])), [], AT);
    assert.equal(quiet!.kind === 'quiet' && quiet!.detail, 'Live · Oct 2026 NT$586.9bn, +59.7% y/y (Sep +54.6%, +5.1 pts) · fires at ±10 pts or a y/y fall · near the trigger');
    // A big shift filed more than a week ago no longer fires.
    assert.equal(chipRevenueFeeds(ready(feed([month('2026-10', 67.86, { seenAt: AT - 9 * 86_400_000 }), month('2026-09', 30.09)])), [], AT)[0]!.kind, 'quiet');
    const [lone] = chipRevenueFeeds(ready(feed([month('2026-10', 59.71)])), [], AT);
    assert.match(lone!.kind === 'quiet' ? lone!.detail : '', /the month before not read yet/);
    assert.equal(chipRevenueFeeds(ready(feed([month('2026-10', 59.71)], { fetchedAt: AT - 13 * H })), [], AT)[0]!.kind, 'stale');
    const err = chipRevenueFeeds({ status: 'error', data: null, at: AT, error: 'x' }, [], AT)[0]!;
    assert.match(err.kind === 'unavailable' ? err.detail : '', /seed-chip-revenue/);
  });

  it('reads what the seeder writes (producer → reader)', async () => {
    const { fromApi, fromMops } = await import('../scripts/seed-chip-revenue.mjs');
    const oct = fromApi([{ 出表日期: '1151117', 資料年月: '11510', 公司代號: '2330', '營業收入-當月營收': '586890319', '營業收入-上月營收': '511857399', '營業收入-去年當月營收': '367473051', '營業收入-上月比較增減(%)': '14.66', '營業收入-去年同月增減(%)': '59.71', '累計營業收入-前期比較增減(%)': '43.29' }]);
    const sep = fromMops('<tr><td>2330</td><td>TSMC</td><td>511,857,399</td><td>514,805,337</td><td>330,980,920</td><td>-0.57</td><Td>44.00</Td><td>1</td><td>1</td><td>41.10</td></tr>', '2026-09');
    const read = decodeChipRevenue(JSON.parse(JSON.stringify({ fetchedAt: AT - H, company: 'TSMC', months: [{ ...oct, seenAt: AT - 3 * H }, { ...sep, seenAt: AT - 30 * 86_400_000 }] })))!;
    const [f] = chipRevenueFeeds(ready(read), [], AT);
    assert.equal(f!.kind === 'fired' && f!.indicator.detail?.startsWith('y/y growth +15.7 pts from Sep +44.0%'), true);
  });
});

describe('Central bank decisions (#130)', () => {
  const FED = 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20261107a.htm';
  const ECB = 'https://www.ecb.europa.eu/press/pr/date/2026/html/ecb.mp261029~5b1e9a2c11.en.html';
  const fed = (o: Record<string, unknown> = {}) => ({
    bank: 'fed', at: AT - 4 * H, url: FED, parsed: true, action: 'cut', changeBp: -25, rate: 3.75, rateText: '3.50–3.75%', rateLabel: 'target range', votes: '10–2',
    dissent: 'Beth M. Hammack, who preferred to maintain the target range', summary: 'The Committee decided to lower the target range for the federal funds rate by 1/4 percentage point to 3-1/2 to 3-3/4 percent.', ...o,
  });
  const ecb = (o: Record<string, unknown> = {}) => ({
    bank: 'ecb', at: Date.UTC(2026, 9, 29, 13, 15), url: ECB, parsed: true, action: 'hold', changeBp: 0, rate: 2.5, rateText: '2.50%', rateLabel: 'deposit facility rate', votes: null, dissent: null,
    summary: 'The Governing Council today decided to keep the three key ECB interest rates unchanged.', ...o,
  });
  const payload = (decisions: unknown[], o: Record<string, unknown> = {}) => ({ fetchedAt: AT - 10 * 60_000, decisions, sources: { fed: { ok: true, okAt: AT - 10 * 60_000 }, ecb: { ok: true, okAt: AT - 10 * 60_000 } }, ...o });
  const calendar = ready({ events: [
    { event: 'FOMC Rate Decision', country: 'US', date: '2026-12-09', impact: 'high', actual: '', estimate: '', previous: '', unit: '' },
    { event: 'ECB Rate Decision', country: 'EU', date: '2026-12-17', impact: 'high', actual: '', estimate: '', previous: '', unit: '' },
  ], fromDate: '2026-11-07', toDate: '2026-12-09', total: 2, unavailable: false, asOf: new Date(AT - H).toISOString() } as never);

  it('decodes strictly and labels the decision', () => {
    assert.equal(decodeCbDecisions(null), null);
    const d = decodeCbDecisions(payload([fed(), ecb(), fed({ url: 'https://evil.example/x' }), { bank: 'boe', at: AT, url: FED }, ecb({ action: 'raise', parsed: true, url: `${ECB}?2` })]))!;
    assert.deepEqual(d.decisions.map((x) => [x.bank, x.parsed]), [['fed', true], ['ecb', true], ['ecb', false]], 'other hosts and banks are dropped; an unknown action reads as unread');
    assert.deepEqual([cbDecisionValue(d.decisions[0]!), cbDecisionValue(d.decisions[1]!), cbDecisionValue(d.decisions[2]!)], ['Cut 25 bp', 'Hold', 'Decision out']);
    assert.deepEqual(d.sources, { fed: { ok: true, okAt: AT - 10 * 60_000 }, ecb: { ok: true, okAt: AT - 10 * 60_000 } });
  });

  it(`fires for a decision published in the last ${CB_DECISION_WINDOW_HOURS} h, with the vote, the dissent and Fed news`, () => {
    const news = [story('Fed cuts rates by a quarter point; Powell signals a pause', AT - 3 * H), story('Retail sales beat estimates', AT - 3 * H)];
    const feeds = centralBankFeeds({ decisions: ready(decodeCbDecisions(payload([fed(), ecb()]))!), calendar, news, now: AT });
    assert.equal(feeds.length, 1);
    const ind = feeds[0]!.kind === 'fired' ? feeds[0]!.indicator : null;
    assert.equal(ind?.id, 'cb-decision:fed');
    assert.equal(ind?.name, 'Central bank decision · Fed');
    assert.equal(ind?.value, 'Cut 25 bp');
    assert.equal(ind?.change, 'range 3.50–3.75%');
    assert.equal(ind?.rule, 'FOMC decision published ≤ 24 h');
    assert.equal(ind?.trust.level, 'official');
    assert.equal(ind?.dataDate, 'decided 8 Nov');
    assert.match(ind?.detail ?? '', /^The Committee decided to lower .* · vote 10–2 · dissent: Beth M\. Hammack, who preferred to maintain the target range$/);
    assert.deepEqual(ind?.links.stories.map((st) => st.item.title), ['Fed cuts rates by a quarter point; Powell signals a pause']);
    // The fired decision is pinned at its bank on the Finance map; the quiet row covering both is not.
    assert.equal(pinIdForFeed(feeds[0]!), 'signal:fed');
    assert.deepEqual(signalPins(feeds, [], 10).map((p) => [p.issuer.id, p.fired, p.signals[0]?.text]), [['fed', true, 'Fed Cut 25 bp']]);
    assert.equal(pinIdForFeed(centralBankFeeds({ decisions: ready(decodeCbDecisions(payload([ecb()]))!), news: [], now: AT })[0]!), null);
    // A statement not read yet still fires, and says so.
    const unread = centralBankFeeds({ decisions: ready(decodeCbDecisions(payload([fed({ parsed: false, action: null, rateText: '', summary: '', votes: null, dissent: null })]))!), news: [], now: AT });
    assert.equal(unread[0]!.kind === 'fired' && unread[0]!.indicator.value, 'Decision out');
    assert.match(unread[0]!.kind === 'fired' ? unread[0]!.indicator.detail ?? '' : '', /not been read yet/);
  });

  it('is quiet with the last decisions and the next meetings, and reports stale, unavailable and a failed feed', () => {
    const old = decodeCbDecisions(payload([fed({ at: AT - 25 * H }), ecb()]))!;
    const [quiet] = centralBankFeeds({ decisions: ready(old), calendar, news: [], now: AT });
    assert.equal(quiet!.kind, 'quiet');
    assert.equal(quiet!.kind === 'quiet' && quiet!.detail, 'Fed cut 25 bp at 3.50–3.75% 7 Nov, next FOMC 9 Dec · ECB held at 2.50% 29 Oct, next ECB 17 Dec · fires when a decision is published');
    const ecbDown = (okAt: number) => decodeCbDecisions(payload([fed({ at: AT - 25 * H })], { sources: { fed: { ok: true, okAt: AT }, ecb: { ok: false, okAt } } }))!;
    const [down] = centralBankFeeds({ decisions: ready(ecbDown(AT - 40 * 60_000)), news: [], now: AT });
    assert.match(down!.kind === 'quiet' ? down!.detail : '', /ECB: no decision read yet, ECB feed unread since 11:20 UTC/);
    // The feed is as fresh as its older source: an ECB feed unread for 3 h makes the row stale.
    assert.equal(centralBankFeeds({ decisions: ready(ecbDown(AT - 3 * H)), news: [], now: AT })[0]!.kind, 'stale');
    // A fired Fed card still says the ECB feed is down.
    const firedDown = centralBankFeeds({ decisions: ready(decodeCbDecisions(payload([fed()], { sources: { fed: { ok: true, okAt: AT }, ecb: { ok: false, okAt: AT - 40 * 60_000 } } }))!), news: [], now: AT });
    assert.match(firedDown[0]!.kind === 'fired' ? firedDown[0]!.indicator.detail ?? '' : '', / · ECB feed unread since 11:20 UTC$/);
    // The next meeting beyond the calendar's window is named as such, not left out.
    const empty = ready({ events: [], fromDate: '2026-11-07', toDate: '2026-12-09', total: 0, unavailable: false, asOf: new Date(AT - H).toISOString() } as never);
    const [beyond] = centralBankFeeds({ decisions: ready(old), calendar: empty, news: [], now: AT });
    assert.match(beyond!.kind === 'quiet' ? beyond!.detail : '', /next FOMC beyond the calendar's 31 days/);
    assert.equal(centralBankFeeds({ decisions: ready({ ...old, fetchedAt: AT - 2 * H }), news: [], now: AT })[0]!.kind, 'stale');
    const err = centralBankFeeds({ decisions: { status: 'error', data: null, at: AT, error: 'x' }, news: [], now: AT })[0]!;
    assert.match(err.kind === 'unavailable' ? err.detail : '', /seed-central-bank-decisions/);
  });

  it('matches a calendar meeting to its decision and the one before it', () => {
    const d = decodeCbDecisions(payload([fed(), fed({ at: Date.UTC(2026, 8, 16, 18), url: `${FED}?sep`, action: 'hike', changeBp: 25, rate: 4 }), ecb()]))!;
    const nov = cbDecisionForEvent(d, { event: 'FOMC Rate Decision', date: '2026-11-08' });
    assert.deepEqual([nov?.decision.rate, nov?.prior?.rate], [3.75, 4]);
    assert.equal(cbDecisionForEvent(d, { event: 'FOMC Rate Decision', date: '2026-12-09' }), null, 'a meeting not decided yet');
    assert.equal(cbDecisionForEvent(d, { event: 'ECB Rate Decision', date: '2026-10-29' })?.decision.rate, 2.5);
    assert.equal(cbDecisionForEvent(d, { event: 'CPI', date: '2026-11-08' }), null);
    // An unread decision before it is the prior (its rate unknown), never the one two meetings back.
    const gap = decodeCbDecisions(payload([fed(), fed({ at: Date.UTC(2026, 8, 16, 18), url: `${FED}?sep`, parsed: false, action: null, rate: null }), fed({ at: Date.UTC(2026, 6, 29, 18), url: `${FED}?jul`, rate: 4.25 })]))!;
    const withGap = cbDecisionForEvent(gap, { event: 'FOMC Rate Decision', date: '2026-11-08' });
    assert.deepEqual([withGap?.prior?.parsed, withGap?.prior?.rate], [false, null]);
  });

  it('reads what the seeder writes (producer → reader)', async () => {
    const { parseFedStatement, pageText } = await import('../scripts/seed-central-bank-decisions.mjs');
    const parsed = parseFedStatement(pageText('<p>The Federal Open Market Committee approved the following statement for release by a 12 &ndash; 0 vote:</p><p>The Committee decided to raise the target range for the federal funds rate by 1/4 percentage point to 3-3/4 to 4 percent, in support of the Federal Reserve\'s dual mandate.</p>'));
    const read = decodeCbDecisions(JSON.parse(JSON.stringify(payload([{ bank: 'fed', url: FED, at: AT - H, parsed: true, ...parsed }]))))!;
    const [feed] = centralBankFeeds({ decisions: ready(read), news: [], now: AT });
    assert.equal(feed!.kind === 'fired' && feed!.indicator.value, 'Hike 25 bp');
    assert.equal(feed!.kind === 'fired' && feed!.indicator.change, 'range 3.75–4.00%');
    assert.match(feed!.kind === 'fired' ? feed!.indicator.detail ?? '' : '', /vote 12–0$/);
  });
});

describe('AI models (#126)', () => {
  const model = (id: string, labName: string, releasedAt: number, o: Record<string, unknown> = {}) => ({
    id, lab: id.split('/')[0], labName, name: id.split('/')[1]!.toUpperCase(), releasedAt, context: 1_000_000, inPrice: 2, outPrice: 10, url: `https://openrouter.ai/${id}`, ...o,
  });
  const feed = (models: unknown[], changes: unknown[] = [], o: Record<string, unknown> = {}) =>
    decodeAiModels({ fetchedAt: AT - H, listed: 477, watched: 210, baseline: true, models, changes, ...o })!;

  it('decodes strictly, newest first, and formats prices', () => {
    assert.equal(decodeAiModels(null), null);
    const d = feed([model('openai/a', 'OpenAI', AT - 5 * 86_400_000), model('google/b', 'Google', AT - 86_400_000, { url: 'https://evil.example' }), { id: 'x' }]);
    assert.deepEqual(d.models.map((m) => [m.id, m.url]), [['google/b', ''], ['openai/a', 'https://openrouter.ai/openai/a']]);
    assert.equal(modelPriceText(2, 10), '$2 / $10');
    assert.equal(modelPriceText(1.425, 4.275), '$1.425 / $4.275');
    assert.equal(modelPriceText(0, 0), 'free');
    assert.equal(modelPriceText(null, null), '—');
  });

  it(`fires one card per lab with models listed in the last ${AI_NEW_DAYS} days, and one per price change`, () => {
    const data = feed([
      model('openai/gpt-astra', 'OpenAI', AT - 2 * 86_400_000), model('openai/gpt-sol', 'OpenAI', AT - 2 * 86_400_000 - H),
      model('google/gemini-neon', 'Google', AT - 3 * 86_400_000), model('anthropic/old', 'Anthropic', AT - 30 * 86_400_000),
    ], [{ at: AT - 5 * H, id: 'qwen/qwen-max', labName: 'Qwen', name: 'Qwen Max', from: [2, 6], to: [1.5, 4.5], url: 'https://openrouter.ai/qwen/qwen-max', litellm: 'match' }]);
    const news = [story('OpenAI launches GPT-ASTRA for enterprise', AT - 2 * 86_400_000 - 2 * H), story('Markets rally on rate hopes', AT - 2 * 86_400_000)];
    const list = aiModelFeeds(ready(data), news, AT);
    assert.deepEqual(list.map((f) => f.id), ['ai-models:price:qwen/qwen-max', 'ai-models:new:openai', 'ai-models:new:google']);
    const [price, openai] = list;
    assert.equal(openai?.kind === 'fired' && openai.indicator.name, 'New AI models · OpenAI');
    assert.equal(openai?.kind === 'fired' && openai.indicator.value, '2 listed');
    assert.equal(openai?.kind === 'fired' && openai.indicator.change, 'GPT-ASTRA, GPT-SOL');
    assert.equal(openai?.kind === 'fired' && openai.indicator.trust.level, 'reported');
    assert.deepEqual(openai?.kind === 'fired' && openai.indicator.links.stories.map((st) => st.item.title), ['OpenAI launches GPT-ASTRA for enterprise']);
    assert.equal(price?.kind === 'fired' && price.indicator.value, 'input −25%');
    assert.equal(price?.kind === 'fired' && price.indicator.change, '$2 / $6 → $1.5 / $4.5 per 1M');
    assert.equal(price?.kind === 'fired' && price.indicator.detail, 'Qwen · LiteLLM price file agrees');
  });

  it('stays quiet naming the latest model and the price baseline, and reports stale and unavailable', () => {
    const quiet = aiModelFeeds(ready(feed([model('anthropic/old', 'Anthropic', Date.UTC(2026, 9, 20))], [], { baseline: false })), [], AT)[0]!;
    assert.equal(quiet.kind === 'quiet' && quiet.detail, 'Live · no new model from a watched lab in 7 days · latest Anthropic OLD, 20 Oct · price baseline set; changes count from the next run');
    assert.equal(aiModelFeeds(ready({ ...feed([]), fetchedAt: AT - 13 * H }), [], AT)[0]!.kind, 'stale');
    const down = aiModelFeeds({ status: 'error', data: null, at: AT, error: 'x' }, [], AT)[0]!;
    assert.match(down.kind === 'unavailable' ? down.detail : '', /seed-ai-models/);
  });

  it('reads what the seeder writes (producer → reader)', async () => {
    const { normalizeModel, priceChanges, publishTransform } = await import('../scripts/seed-ai-models.mjs');
    const m = normalizeModel({ id: 'deepseek/deepseek-v5', name: 'DeepSeek: DeepSeek V5', created: Math.floor((AT - 86_400_000) / 1000), context_length: 256000, pricing: { prompt: '0.0000003', completion: '0.0000012' } });
    const changes = priceChanges([m], { 'deepseek/deepseek-v5': [0.6, 2.4] }, AT - H).map((c: object) => ({ ...c, litellm: 'missing' }));
    const read = decodeAiModels(JSON.parse(JSON.stringify(publishTransform({ fetchedAt: AT - H, listed: 477, watched: 1, baseline: true, models: [m], changes, state: { prices: {} } }))));
    const list = aiModelFeeds(ready(read!), [], AT);
    assert.deepEqual(list.map((f) => f.kind === 'fired' && f.indicator.name), ['AI price change · DeepSeek V5', 'New AI models · DeepSeek']);
  });
});

describe('AI regulation (#127)', () => {
  const src = (o: Record<string, unknown> = {}) => ({ id: 'eurlex-oj', label: 'EUR-Lex, Official Journal L', ok: true, okAt: AT - H, ...o });
  const item = (o: Record<string, unknown> = {}) => ({
    id: 'celex:32026R2601', jurisdiction: 'EU', source: 'EUR-Lex', kind: 'implementing act', agency: '',
    title: 'Commission Implementing Regulation (EU) 2026/2601 on AI regulatory sandboxes', url: 'https://eur-lex.europa.eu/x', publishedAt: AT - 2 * 86_400_000, ...o,
  });
  const feed = (items: unknown[], o: Record<string, unknown> = {}) => decodeAiRegulation({ fetchedAt: AT - H, logDays: 60, sources: [src()], items, ...o })!;

  it('decodes strictly, newest first, and keeps an empty log valid', () => {
    assert.equal(decodeAiRegulation(null), null);
    assert.deepEqual(feed([]).items, []);
    const d = feed([item({ id: 'old', publishedAt: AT - 20 * 86_400_000 }), item(), item({ id: 'x', jurisdiction: 'UK' }), item({ id: 'y', url: 'https://evil.example' })]);
    assert.deepEqual(d.items.map((i) => [i.id, i.url]), [['celex:32026R2601', 'https://eur-lex.europa.eu/x'], ['y', ''], ['old', 'https://eur-lex.europa.eu/x']]);
  });

  it(`fires one card per EU or US rule published in the last ${AI_REG_NEW_DAYS} days, with AI news only`, () => {
    const data = feed([
      item(),
      item({ id: 'fr:2026-30001', jurisdiction: 'US', source: 'Federal Register', kind: 'proposed rule', agency: 'Labor Department', title: 'Use of Artificial Intelligence in Benefit Determinations', publishedAt: AT - 3 * 86_400_000, url: 'https://www.federalregister.gov/d/1' }),
      item({ id: 'old', publishedAt: AT - 9 * 86_400_000 }),
    ]);
    const news = [story('Brussels sets rules for AI Act sandboxes', AT - 2 * 86_400_000 - 3 * H), story('European Commission fines a carmaker', AT - 2 * 86_400_000 - 3 * H)];
    const list = aiRegulationFeeds(ready(data), news, AT);
    assert.deepEqual(list.map((f) => f.id), ['ai-regulation:celex:32026R2601', 'ai-regulation:fr:2026-30001']);
    const [eu, us] = list;
    assert.equal(eu?.kind === 'fired' && eu.indicator.name, 'AI rule · EU implementing act');
    assert.equal(eu?.kind === 'fired' && eu.indicator.trust.source, 'EUR-Lex');
    assert.equal(eu?.kind === 'fired' && eu.indicator.dataDate, 'published 6 Nov');
    assert.deepEqual(eu?.kind === 'fired' && eu.indicator.links.stories.map((st) => st.item.title), ['Brussels sets rules for AI Act sandboxes']);
    assert.equal(us?.kind === 'fired' && us.indicator.change, 'Labor Department');
  });

  it('says "first seen" for an item the feed gave no date', () => {
    const [card] = aiRegulationFeeds(ready(feed([item({ id: 'celex:52026PC0640', kind: 'proposal', dateKind: 'seen' })])), [], AT);
    assert.equal(card?.kind === 'fired' && card.indicator.dataDate, 'first seen 6 Nov');
  });

  it('stays quiet naming the latest rule and unread sources, and is as fresh as its oldest source', () => {
    const quiet = aiRegulationFeeds(ready(feed([item({ publishedAt: AT - 20 * 86_400_000 })], { sources: [src(), src({ id: 'federal-register', label: 'Federal Register', ok: false, okAt: AT - 3 * H })] })), [], AT)[0]!;
    assert.equal(quiet.kind === 'quiet' && quiet.detail, 'Live · no new EU or US AI rule in 7 days · latest EU implementing act, 19 Oct · not read on the last run: Federal Register');
    assert.equal(aiRegulationFeeds(ready(feed([], { sources: [src({ okAt: AT - 5 * H })] })), [], AT)[0]!.kind, 'stale');
    const down = aiRegulationFeeds({ status: 'error', data: null, at: AT, error: 'x' }, [], AT)[0]!;
    assert.match(down.kind === 'unavailable' ? down.detail : '', /seed-ai-regulation/);
  });

  it('reads what the seeder writes (producer → reader)', async () => {
    const { euItem, frItem, mergeLog } = await import('../scripts/seed-ai-regulation.mjs');
    const eu = euItem({ title: 'CELEX:32026R2601: Commission Implementing Regulation (EU) 2026/2601 applying Regulation (EU) 2024/1689', link: 'https://eur-lex.europa.eu/x', pubDate: new Date(AT - 86_400_000).toUTCString() }, 'EUR-Lex', { needInstrument: false });
    const us = frItem({ document_number: '9', title: 'Artificial Intelligence Disclosures', type: 'Rule', abstract: '', publication_date: '2026-11-07', html_url: 'https://www.federalregister.gov/d/9', agencies: [{ name: 'Securities and Exchange Commission' }] });
    const read = decodeAiRegulation(JSON.parse(JSON.stringify({ fetchedAt: AT - H, logDays: 60, sources: [src()], items: mergeLog([eu, us], [], AT) })));
    assert.deepEqual(aiRegulationFeeds(ready(read!), [], AT).map((f) => f.id), ['ai-regulation:fr:9', 'ai-regulation:celex:32026R2601']);
  });
});

describe('Data breaches (#131)', () => {
  const breach = (name: string, addedAgoH: number, o: Record<string, unknown> = {}) => ({
    name, title: name, domain: `${name.toLowerCase()}.com`, breachDate: '2026-11-01', addedAt: AT - addedAgoH * H, pwnCount: 3_609_421,
    dataClasses: ['Academic records', 'Castes', 'Email addresses', 'Names', 'Phone numbers'], verified: true, fabricated: false, sensitive: false,
    spamList: false, malware: false, stealerLog: false, url: `https://haveibeenpwned.com/Breach/${name}`, ...o,
  });
  const feed = (breaches: unknown[], o: Record<string, unknown> = {}) => decodeBreaches({ fetchedAt: AT - H, total: 1053, keepDays: 30, breaches, ...o })!;

  it('decodes strictly and matches a starter-list vendor by domain or subdomain', () => {
    assert.equal(decodeBreaches(null), null);
    const d = feed([breach('Old', 48), breach('New', 2, { url: 'https://evil.example/x' }), { name: 'x' }]);
    assert.deepEqual(d.breaches.map((b) => [b.name, b.url]), [['New', ''], ['Old', 'https://haveibeenpwned.com/Breach/Old']]);
    assert.equal(breachVendor({ domain: 'trello.com' })?.name, 'Atlassian');
    assert.equal(breachVendor({ domain: 'jira.atlassian.net' })?.name, 'Atlassian');
    assert.equal(breachVendor({ domain: 'notatlassian.net' }), null, 'a suffix that is not a subdomain does not match');
    assert.equal(breachVendor({ domain: '' }), null);
    assert.deepEqual([accountsText(3_609_421), accountsText(850_537), accountsText(1_204)], ['3.6M', '851k', '1,204']);
  });

  it(`fires for a breach of ${BREACH_MIN_ACCOUNTS.toLocaleString('en-US')}+ accounts listed in ${BREACH_NEW_DAYS} days, with both dates and breach news`, () => {
    const news = [
      story('Careers360 data breach exposes 3.6 million students', AT - 2 * H),
      story('Careers360 launches a new college predictor', AT - 2 * H),
    ];
    const feeds = breachFeeds(ready(feed([breach('Careers360', 2, { breachDate: '2026-11-14' }), breach('Small', 3, { pwnCount: 850_537 })])), news, AT);
    assert.equal(feeds.length, 1);
    const ind = feeds[0]!.kind === 'fired' ? feeds[0]!.indicator : null;
    assert.equal(ind?.id, 'breach:Careers360');
    assert.equal(ind?.name, 'Data breach · Careers360');
    assert.equal(ind?.value, '3.6M accounts');
    assert.equal(ind?.change, 'breached 14 Nov 2026 · listed 8 Nov');
    assert.equal(ind?.rule, 'listed ≤ 3 days, ≥ 1M accounts');
    assert.equal(ind?.detail, 'careers360.com · Academic records, Castes, Email addresses, Names +1 more');
    assert.deepEqual(ind?.trust, { level: 'reported', source: 'Have I Been Pwned (CC BY 4.0)', url: 'https://haveibeenpwned.com/Breach/Careers360' });
    assert.deepEqual(ind?.links.stories.map((st) => st.item.title), ['Careers360 data breach exposes 3.6 million students']);
  });

  it('fires for a small breach at a starter-list vendor, and never for a spam list or a fabricated one', () => {
    const vendor = breachFeeds(ready(feed([breach('Trello', 5, { domain: 'trello.com', pwnCount: 120_000, verified: false })])), [], AT);
    const ind = vendor[0]!.kind === 'fired' ? vendor[0]!.indicator : null;
    assert.equal(ind?.rule, 'listed ≤ 3 days, Atlassian (starter vendor list)');
    assert.match(ind?.detail ?? '', /· unverified$/);
    // Without its own page (a rejected link), the card still links HIBP for the CC BY attribution.
    const noPage = breachFeeds(ready(feed([breach('Big', 1, { url: 'https://evil.example/x' })])), [], AT);
    assert.equal(noPage[0]!.kind === 'fired' && noPage[0]!.indicator.trust.url, 'https://haveibeenpwned.com/');
    const skipped = breachFeeds(ready(feed([breach('Combo', 1, { spamList: true }), breach('Fake', 1, { fabricated: true })])), [], AT);
    assert.equal(skipped[0]!.kind, 'quiet');
    assert.equal(skipped[0]!.kind === 'quiet' && skipped[0]!.detail, 'Live · no breach listed in 3 days · 1,053 breaches in HIBP');
  });

  it('is quiet past three days or below the threshold, and reports stale and unavailable', () => {
    const [quiet] = breachFeeds(ready(feed([breach('Small', 10, { pwnCount: 850_537 }), breach('Big', 80)])), [], AT);
    assert.equal(quiet!.kind === 'quiet' && quiet!.detail, 'Live · 1 breach listed in 3 days, none with 1M+ accounts or at a starter-list vendor · latest Small, 851k accounts, listed 8 Nov · 1,053 breaches in HIBP');
    assert.equal(breachFeeds(ready(feed([], { fetchedAt: AT - 7 * H })), [], AT)[0]!.kind, 'stale');
    const err = breachFeeds({ status: 'error', data: null, at: AT, error: 'x' }, [], AT)[0]!;
    assert.match(err.kind === 'unavailable' ? err.detail : '', /seed-breaches/);
  });

  it('reads what the seeder writes (producer → reader), inside the Technology feeds', async () => {
    const { toBreach } = await import('../scripts/seed-breaches.mjs');
    const b = toBreach({ Name: 'YouHack', Title: 'YouHack', Domain: 'youhack.ru', BreachDate: '2013-05-29', AddedDate: new Date(AT - 20 * H).toISOString(), PwnCount: 7_160_849, DataClasses: ['Email addresses', 'IP addresses', 'Passwords'], IsVerified: true });
    const read = decodeBreaches(JSON.parse(JSON.stringify({ fetchedAt: AT - H, total: 1053, keepDays: 30, breaches: [b] })))!;
    const all = techFeeds({ outages: { status: 'loading', data: null, at: 0 }, services: { status: 'loading', data: null, at: 0 }, kev: { status: 'loading', data: null, at: 0 }, history: { status: 'loading', data: null, at: 0 }, filings: { status: 'loading', data: null, at: 0 }, breaches: ready(read), news: [], now: AT } as never);
    const card = all.find((f) => f.id === 'breach:YouHack');
    assert.equal(card?.kind === 'fired' && card.indicator.change, 'breached 29 May 2013 · listed 7 Nov');
  });
});
