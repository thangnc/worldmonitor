// Lite early indicators: the news link rule, feed states and the Finance
// rules (spec: docs/engineering/architecture/lite.md › Early indicators).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { NewsItem } from '../src/generated/client/worldmonitor/news/v1/service_client.ts';
import type {
  CryptoQuote,
  GetFearGreedIndexResponse,
  GetHyperliquidFlowResponse,
  ListStablecoinMarketsResponse,
} from '../src/generated/client/worldmonitor/market/v1/service_client.ts';
import { DRIVERS, LINK_WINDOW_HOURS, MAX_LINKED_STORIES, linkNews, matchReason, offsetLabel } from '../src/lite/data/news-link.ts';
import { STALE_FACTOR, feedCounts, feedState, sortFeeds, type FeedState, type Indicator } from '../src/lite/data/indicators.ts';
import { chokepointPins, featureIso2, newSanctionCountries, pinIdForFeed, sanctionFills, shippingLanes, signalPins } from '../src/lite/data/markets-map.ts';
import { buildPriceBoard } from '../src/lite/data/prices.ts';
import { CENTRAL_BANKS } from '../src/config/finance-geo.ts';
import { STRATEGIC_WATERWAYS } from '../src/config/geo.ts';
import { TRADE_ROUTES } from '../src/config/trade-routes.ts';
import type { ChokepointInfo } from '../src/generated/client/worldmonitor/supply_chain/v1/service_client.ts';
import { STABLECOIN_DEPEG_PCT, financeFeeds } from '../src/lite/data/finance-indicators.ts';
import type { InternetOutage, ListInternetOutagesResponse, ListServiceStatusesResponse, ServiceStatus } from '../src/generated/client/worldmonitor/infrastructure/v1/service_client.ts';
import {
  KEV_NEW_DAYS,
  SPIKE_RATIO,
  decodeRecentKev,
  decodeThreatHistory,
  kevSubject,
  kevWeekCounts,
  techFeeds,
  threatBaseline,
  type ExploitedVulnerability,
  type RecentKev,
  type ThreatHistory,
} from '../src/lite/data/tech-indicators.ts';
import type { LiteItem } from '../src/lite/data/transforms.ts';
import type { MilitaryFlight } from '../src/generated/client/worldmonitor/military/v1/service_client.ts';
import type { ListUkmtoIncidentsResponse } from '../src/generated/client/worldmonitor/maritime/v1/service_client.ts';
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
} from '../src/lite/data/geo-layers.ts';
import {
  MIN_REPORTS,
  conflictHistogram,
  countryShading,
  shadingBasis,
  historyReady,
  hotspotStrip,
  violenceFeeds,
  violenceIndicators,
  violenceSpike,
  type ConflictCounts,
} from '../src/lite/data/conflict.ts';
import type {
  EconomicEvent,
  GetEconomicCalendarResponse,
  GetGovernmentYieldCurveResponse,
  UsTreasuryParYieldCurve,
} from '../src/generated/client/worldmonitor/economic/v1/service_client.ts';
import type { ListEtfFlowsResponse } from '../src/generated/client/worldmonitor/market/v1/service_client.ts';
import type { GetShippingRatesResponse, ShippingIndex } from '../src/generated/client/worldmonitor/supply_chain/v1/service_client.ts';
import type { ListMaterialEventsResponse, MaterialEvent } from '../src/generated/client/worldmonitor/intelligence/v1/service_client.ts';
import {
  ETF_SAME_WAY,
  FILING_WINDOW_HOURS,
  FREIGHT_MOVE_PCT,
  KEY_8K_ITEMS,
  MACRO_PAYROLLS_K,
  MACRO_PCT_PT,
  MACRO_RECENT_DAYS,
  PERP_STRESS,
  YIELD_MOVE_BP,
  bdiFeed,
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
  treasuryFeed,
  treasuryWindow,
  watchCompany,
} from '../src/lite/data/finance-macro-indicators.ts';
import type { ResourceState } from '../src/lite/data/store.ts';
import {
  CHOKEPOINT_TRANSIT_SHARE,
  TAIWAN_RATIO,
  chokepointFeeds,
  chokepointIndicators,
  embassyAlertFeeds,
  embassyAlertIndicators,
  embassyCoverage,
  isCrossStraitSnapshot,
  taiwanStraitFeeds,
  taiwanStraitIndicators,
  type EmbassyAlerts,
} from '../src/lite/data/geo-watch.ts';
import type { GetChokepointStatusResponse } from '../src/generated/client/worldmonitor/supply_chain/v1/service_client.ts';
import type { SecurityAdvisoryItem } from '../src/generated/client/worldmonitor/intelligence/v1/service_client.ts';
import type { CrossStraitActivitySnapshot } from '../src/types/cross-strait-activity.ts';

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

  it('builds the hotspot strip from the five highest live scores, easing on a fall', () => {
    const scored = [
      { hotspot: { id: 'kyiv', name: 'Kyiv' }, score: 4.2, level: { tone: 'high' as const, label: 'High' } },
      { hotspot: { id: 'sanaa', name: "Sana'a" }, score: 3.1, level: { tone: 'elev' as const, label: 'Elevated' } },
      { hotspot: { id: 'moscow', name: 'Moscow' }, score: 1.2, level: { tone: 'muted' as const, label: 'Stable' } },
    ];
    // Ukraine: 24 h at 4/h = 96 against 40 a day (+140%); Yemen: 24 h at 0 against 10 a day (−100%).
    const c = build({ day: () => ({ UA: 40, YE: 10 }), hour: () => ({ UA: 4 }) });
    const tiles = hotspotStrip(scored, c, NOW, 2);
    assert.deepEqual(tiles.map((t) => t.id), ['kyiv', 'sanaa']);
    assert.equal(tiles[0]?.level, 'High');
    assert.equal(Math.round(tiles[0]?.change ?? 0), 140);
    assert.equal(tiles[1]?.level, 'Easing');
    assert.equal(tiles[1]?.tone, 'muted');
    assert.equal(tiles[0]?.bars.length, 14);
    assert.equal(hotspotStrip(scored, null, NOW)[0]?.change, null, 'no counts: change unknown');
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
    assert.match(feed.indicator.detail ?? '', /no forecast source/);
    assert.equal(feed.indicator.trust.level, 'official');
    // 0.3 after 0.1 is exactly 0.2 pt: it fires. 0.2 after 0.1 does not.
    assert.equal(macroFeed({ calendar: calendar([event({ actual: '+0.3', previous: '+0.1' })]), ...ctx }).kind, 'fired');
    assert.equal(macroFeed({ calendar: calendar([event({ actual: '+0.2', previous: '+0.1' })]), ...ctx }).kind, 'quiet');
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

  it('lists every step-3 feed, each naming its seeder when its source failed', () => {
    const failed = { status: 'error', data: null, at: AT, error: 'x' } as const;
    const feeds = financeMacroFeeds({ calendar: failed, curves: failed, bonds: failed, etf: failed, flow: failed, rates: failed, filings: failed, ...ctx });
    assert.deepEqual(feeds.map((f) => f.id), ['macro-print', 'treasury', 'other-bonds', 'etf-flows', 'perp-positioning', 'freight-scfi', 'freight-bdi', 'sec-8k']);
    assert.ok(feeds.every((f) => f.kind === 'unavailable' && /seed-/.test(f.detail)));
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
    id, addedAt, dueAt: '2026-11-27', name: 'Ivanti Connect Secure Authentication Bypass Vulnerability', vendorProduct: '',
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
    news?: LiteItem[];
  } = {}) {
    return techFeeds({
      outages: ready(outages(opts.outages ?? [])),
      services: ready(services(opts.services ?? [status('aws', 'AWS', 'SERVICE_OPERATIONAL_STATUS_OPERATIONAL')])),
      kev: ready(kev(opts.kev ?? [])),
      history: ready(opts.history ?? history([100, 100, 100], 100)),
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
      news: [],
      now: AT,
    });
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
