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
import { LINK_WINDOW_HOURS, MAX_LINKED_STORIES, linkNews, matchReason, offsetLabel } from '../src/lite/data/news-link.ts';
import { STALE_FACTOR, feedCounts, feedState, sortFeeds, type FeedState, type Indicator } from '../src/lite/data/indicators.ts';
import { chokepointPins, featureIso2, newSanctionCountries, pinIdForFeed, sanctionFills, shippingLanes, signalPins } from '../src/lite/data/markets-map.ts';
import { buildPriceBoard } from '../src/lite/data/prices.ts';
import { CENTRAL_BANKS } from '../src/config/finance-geo.ts';
import { STRATEGIC_WATERWAYS } from '../src/config/geo.ts';
import { TRADE_ROUTES } from '../src/config/trade-routes.ts';
import type { ChokepointInfo } from '../src/generated/client/worldmonitor/supply_chain/v1/service_client.ts';
import { STABLECOIN_DEPEG_PCT, financeFeeds } from '../src/lite/data/finance-indicators.ts';
import type { LiteItem } from '../src/lite/data/transforms.ts';
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
