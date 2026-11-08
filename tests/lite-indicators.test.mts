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
import { STALE_FACTOR, feedCounts, feedState, sortFeeds, type Indicator } from '../src/lite/data/indicators.ts';
import { STABLECOIN_DEPEG_PCT, financeFeeds } from '../src/lite/data/finance-indicators.ts';
import type { LiteItem } from '../src/lite/data/transforms.ts';
import {
  MIN_REPORTS,
  conflictHistogram,
  countryShading,
  historyReady,
  hotspotStrip,
  violenceFeeds,
  violenceIndicators,
  violenceSpike,
  type ConflictCounts,
} from '../src/lite/data/conflict.ts';
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
    // The US files ten times Ukraine's volume at its normal: unshaded at 7d and 30d.
    const week = build({ day: (start) => ({ US: 400, UA: start >= today - 7 * DAY ? 120 : 40 }) });
    for (const range of ['7d', '30d'] as const) {
      const s = countryShading(week, range, NOW);
      assert.equal(s.byCountry.get('US')?.step, 0, `${range}: volume alone never shades`);
      assert.equal(s.byCountry.get('UA')?.step, 3, `${range}: Ukraine's week at ×3 its normal`);
    }
    assert.match(countryShading(week, '30d', NOW).basis, /30 days hold no earlier normal/);
    assert.equal(countryShading(build({ hourCohorts: () => 3 }), '6h', NOW).partial, true);
  });

  it('draws hourly bars for 6h and 24h and daily bars for 7d and 30d, today partial', () => {
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
