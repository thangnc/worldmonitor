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
