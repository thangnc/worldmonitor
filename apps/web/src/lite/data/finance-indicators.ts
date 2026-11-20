/**
 * Finance & Crypto indicator feeds (spec: Early indicators › Catalogue, and
 * the Finance screen's indicator panel). Step 1 carries the four rules the
 * risk-alerts panel already evaluated; step 3 adds the rest of the catalogue;
 * #115 adds the VIX and the dollar index (`riskGaugeFeeds`).
 */
import type {
  CommodityQuote,
  CryptoQuote,
  GetFearGreedIndexResponse,
  GetGoldIntelligenceResponse,
  GetHyperliquidFlowResponse,
  ListStablecoinMarketsResponse,
} from '@wm/contracts/generated/client/worldmonitor/market/v1/service_client';
import type { FredObservation } from '@wm/contracts/generated/client/worldmonitor/economic/v1/service_client';
import { price, signed } from '../format';
import { feedState, sortFeeds, withReading, type FeedState, type Indicator } from './indicators';
import { DRIVERS, LINK_WINDOW_HOURS, linkNews, type LinkSubject } from './news-link';
import type { ResourceState } from './store';
import { fearGreedState, thresholdState, type LiteItem } from './transforms';

/** BTC 24h move that fires, in percent. */
export const BTC_MOVE_PCT = 4;
/** BTC perp funding that fires, in percent per hour. */
export const FUNDING_PCT_PER_HOUR = 0.01;
const HOURS_PER_YEAR = 24 * 365;

/** Display symbols for the tracked stablecoins (the feed sends lower case). */
const STABLECOIN_SYMBOL: Readonly<Record<string, string>> = { usdt: 'USDT', usdc: 'USDC', dai: 'DAI', fdusd: 'FDUSD', usde: 'USDe' };

/** Distance from $1 that fires, in percent (owner's choice, 2026-11-08). */
export const STABLECOIN_DEPEG_PCT = 0.5;

/** VIX level that fires, and its rise in a day that fires, in percent. */
export const VIX_LEVEL = 25;
export const VIX_JUMP_PCT = 20;
/** Dollar index move in a day that fires, in percent. */
export const DXY_MOVE_PCT = 1;
/** FRED's daily VIX close, read only when the Yahoo quote is missing. */
export const VIX_FRED_SERIES = 'VIXCLS';

export const FINANCE_RULES =
  `BTC 24h move ≥ ${BTC_MOVE_PCT}%; BTC perp funding ≥ ${FUNDING_PCT_PER_HOUR}%/h; ` +
  `a stablecoin more than ${STABLECOIN_DEPEG_PCT}% from $1; fear & greed ≤ 20 or ≥ 80; ` +
  `VIX ≥ ${VIX_LEVEL} or up ≥ ${VIX_JUMP_PCT}% in a day; the dollar index ±${DXY_MOVE_PCT}% in a day. ` +
  'Linked news: finance digest stories from 6 h before to 1 h after.';

const SUBJECTS: Readonly<Record<string, LinkSubject>> = {
  btcMove: { instruments: ['BTC'], entities: ['bitcoin'], drivers: DRIVERS.BTC },
  funding: { instruments: ['BTC'], entities: ['bitcoin'], drivers: ['funding', 'perpetual', 'perp', 'leverage', 'open interest', 'liquidation', 'liquidations'] },
  depeg: { drivers: ['stablecoin', 'stablecoins', 'depeg', 'peg', 'redemption', 'redemptions'] },
  sentiment: { instruments: ['BTC', 'ETH', '^GSPC'], drivers: ['fear', 'greed', 'sentiment', 'sell-off', 'selloff', 'risk-off', 'rally'] },
  vix: { instruments: ['^VIX', '^GSPC'], drivers: ['VIX', 'volatility', 'fear gauge', 'sell-off', 'selloff', 'risk-off', 'market turmoil'] },
  dollar: { instruments: ['DXY'], drivers: [...DRIVERS.DXY!, 'dollar index', 'greenback'] },
};

/** Stablecoin names a depeg story may use instead of the word "stablecoin". */
const STABLECOIN_DRIVERS: Readonly<Record<string, readonly string[]>> = {
  USDT: ['Tether', 'USDT'],
  USDC: ['Circle', 'USDC'],
  DAI: ['DAI', 'MakerDAO', 'Sky'],
  FDUSD: ['FDUSD', 'First Digital'],
  USDE: ['USDe', 'Ethena'],
};

function coinSymbol(symbol: string): string {
  return STABLECOIN_SYMBOL[symbol.toLowerCase()] ?? symbol.toUpperCase();
}

export function parseTime(value: string | number | undefined): number | null {
  if (!value) return null;
  const t = typeof value === 'number' ? value : Number.isNaN(Number(value)) ? Date.parse(value) : Number(value);
  return Number.isFinite(t) && t > 0 ? t : null;
}

export function nearDetail(state: ReturnType<typeof thresholdState>, reading: string): string {
  return state === 'watching' ? `${reading} · near the trigger` : reading;
}

/** A quiet feed shows its current reading instead of the generic line. */
export function quietDetail(feed: FeedState, detail: string | null): FeedState {
  return feed.kind === 'quiet' && detail ? { ...feed, detail } : feed;
}

export function financeFeeds(input: {
  crypto: ResourceState<CryptoQuote[]>;
  flow: ResourceState<GetHyperliquidFlowResponse>;
  stables: ResourceState<ListStablecoinMarketsResponse>;
  fearGreed: ResourceState<GetFearGreedIndexResponse>;
  news: readonly LiteItem[];
  now: number;
}): FeedState[] {
  const { crypto, flow, stables, fearGreed, news, now } = input;
  const window = LINK_WINDOW_HOURS.fin;
  const link = (subject: LinkSubject, at: number) => linkNews(subject, news, at, window);
  const feeds: FeedState[] = [];

  // BTC 24h move. Quotes carry no timestamp: the load time stands in.
  const btc = crypto.status === 'ready' ? crypto.data.find((q) => q.symbol.toUpperCase() === 'BTC') : undefined;
  const btcState = thresholdState(btc?.change, BTC_MOVE_PCT * 0.6, BTC_MOVE_PCT);
  const btcAt = crypto.status === 'ready' ? crypto.at : now;
  const btcFired: Indicator | null = btc && btcState === 'triggered'
    ? {
        id: 'btc-move', domain: 'fin', name: 'Price move · BTC 24h',
        value: price(btc.price), change: `${signed(btc.change)} 24h`, rule: `±${BTC_MOVE_PCT}%`,
        trust: { level: 'market', source: 'CoinGecko' }, at: btcAt, links: link(SUBJECTS.btcMove!, btcAt),
      }
    : null;
  feeds.push(quietDetail(
    feedState({ id: 'btc-move', name: 'Price move · BTC 24h', source: crypto, seeder: 'seed-crypto-quotes', cadenceMin: 5, fired: btcFired, now }),
    btc ? nearDetail(btcState, `BTC 24h ${signed(btc.change)} · fires at ±${BTC_MOVE_PCT}%`) : null,
  ));

  // BTC perp funding (one venue).
  const hl = flow.status === 'ready' ? flow.data.assets.find((a) => a.symbol.toUpperCase() === 'BTC') : undefined;
  const fundingPct = hl ? Number(hl.funding) * 100 : null;
  const fundingState = thresholdState(fundingPct, FUNDING_PCT_PER_HOUR / 2, FUNDING_PCT_PER_HOUR);
  const flowAt = flow.status === 'ready' ? parseTime(flow.data.fetchedAt) ?? parseTime(flow.data.ts) : null;
  const fundingFired: Indicator | null = fundingPct != null && fundingState === 'triggered'
    ? {
        id: 'btc-funding', domain: 'fin', name: 'Perp funding · BTC',
        value: `${fundingPct >= 0 ? '+' : '−'}${Math.abs(fundingPct).toFixed(4)}%/h`, change: `${signed(fundingPct * HOURS_PER_YEAR, 0)} annualized`, rule: `±${FUNDING_PCT_PER_HOUR}%/h`,
        trust: { level: 'market', source: 'Hyperliquid (one venue)' }, at: flowAt ?? now, updatedAt: flowAt ?? undefined,
        links: link(SUBJECTS.funding!, flowAt ?? now),
      }
    : null;
  const fundingFeed = feedState({ id: 'btc-funding', name: 'Perp funding · BTC', source: flow, seeder: 'seed-hyperliquid-flow', cadenceMin: 5, dataAt: flowAt, fired: fundingFired, now });
  feeds.push(quietDetail(fundingFeed, fundingPct != null ? nearDetail(fundingState, `BTC perp ${fundingPct.toFixed(4)}%/h · fires at ±${FUNDING_PCT_PER_HOUR}%/h`) : null));

  // Stablecoin depeg: the coin furthest from $1.
  const coins = stables.status === 'ready' ? stables.data.stablecoins : [];
  const worst = coins.reduce<(typeof coins)[number] | null>((w, c) => (!w || Math.abs(c.deviation) > Math.abs(w.deviation) ? c : w), null);
  const stablesAt = stables.status === 'ready' ? parseTime(stables.data.timestamp) : null;
  const depegFired: Indicator | null = worst && Math.abs(worst.deviation) > STABLECOIN_DEPEG_PCT
    ? {
        id: 'stablecoin-depeg', domain: 'fin', name: `Stablecoin depeg · ${coinSymbol(worst.symbol)}`,
        value: `$${worst.price.toFixed(4)}`, change: `${signed(worst.price >= 1 ? Math.abs(worst.deviation) : -Math.abs(worst.deviation), 2)} from $1`,
        rule: `> ${STABLECOIN_DEPEG_PCT}% from $1`,
        trust: { level: 'market', source: 'CoinGecko' }, at: stablesAt ?? now, updatedAt: stablesAt ?? undefined,
        links: link({ ...SUBJECTS.depeg, drivers: [...(STABLECOIN_DRIVERS[worst.symbol.toUpperCase()] ?? [worst.name]), ...(SUBJECTS.depeg!.drivers ?? [])] }, stablesAt ?? now),
      }
    : null;
  const depegFeed = feedState({ id: 'stablecoin-depeg', name: 'Stablecoin peg', source: stables, seeder: 'seed-stablecoin-markets', cadenceMin: 10, dataAt: stablesAt, fired: depegFired, now });
  feeds.push(quietDetail(depegFeed, worst ? `${coins.length} on peg · widest ${coinSymbol(worst.symbol)} ${Math.abs(worst.deviation).toFixed(2)}% · fires above ${STABLECOIN_DEPEG_PCT}%` : null));

  // Fear & greed extremes (a composite of market inputs, every 6 h).
  const score = fearGreed.status === 'ready' ? fearGreed.data.compositeScore : null;
  const fgState = fearGreedState(score);
  const fgAt = fearGreed.status === 'ready' ? parseTime(fearGreed.data.seededAt) : null;
  const fgFired: Indicator | null = score != null && fgState === 'triggered' && fearGreed.status === 'ready'
    ? {
        id: 'fear-greed', domain: 'fin', name: 'Sentiment extreme · fear & greed',
        value: String(Math.round(score)), change: fearGreed.data.compositeLabel, rule: '≤ 20 or ≥ 80',
        trust: { level: 'estimated', source: 'World Monitor composite' }, at: fgAt ?? now, updatedAt: fgAt ?? undefined,
        links: link(SUBJECTS.sentiment!, fgAt ?? now),
      }
    : null;
  const fgFeed = feedState({ id: 'fear-greed', name: 'Sentiment · fear & greed', source: fearGreed, seeder: 'seed-fear-greed', cadenceMin: 360, dataAt: fgAt, fired: fgFired, now });
  feeds.push(quietDetail(fgFeed, score != null && fearGreed.status === 'ready'
    ? nearDetail(fgState, `Score ${Math.round(score)} (${fearGreed.data.compositeLabel}) · fires at ≤ 20 or ≥ 80`)
    : null));

  return sortFeeds(feeds);
}

// ---- VIX and the dollar index (#115) ----------------------------------------

/** About 4 pm New York, when the VIX closes, as an offset from UTC midnight. */
const CLOSE_UTC_MS = 21 * 3_600_000;
const ymdMs = (ymd: string) => Date.parse(`${ymd.slice(0, 10)}T00:00:00Z`);
const dayMonth = (ts: number) => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const notReady = <T,>(state: ResourceState<T>): ResourceState<T> => (state.status === 'ready' ? { status: 'empty', data: null, at: state.at } : state);

export interface VixReading {
  level: number;
  /** Change from the prior close, in percent. */
  changePct: number | null;
  source: 'yahoo' | 'fred';
  /** FRED close date (YYYY-MM-DD); Yahoo quotes carry none. */
  date?: string;
}

/** The VIX from the Yahoo quote, or the latest FRED `VIXCLS` close when the quote is missing. */
export function vixReading(quotes: readonly CommodityQuote[] | null | undefined, fred: readonly FredObservation[] | null | undefined): VixReading | null {
  const q = quotes?.find((c) => c.symbol === '^VIX' && Number.isFinite(c.price) && c.price > 0);
  if (q) return { level: q.price, changePct: Number.isFinite(q.change) ? q.change : null, source: 'yahoo' };
  const obs = [...(fred ?? [])].filter((o) => Number.isFinite(o.value) && o.value > 0).sort((a, b) => a.date.localeCompare(b.date));
  const latest = obs[obs.length - 1];
  if (!latest) return null;
  const prior = obs[obs.length - 2];
  return { level: latest.value, changePct: prior ? ((latest.value - prior.value) / prior.value) * 100 : null, source: 'fred', date: latest.date.slice(0, 10) };
}

/** The dollar index from the gold drivers (Yahoo `DX-Y.NYB`). */
export function dollarIndex(gold: GetGoldIntelligenceResponse | null | undefined): { value: number; changePct: number } | null {
  const d = gold?.drivers.find((x) => x.symbol === 'DX-Y.NYB' || /^dxy$/i.test(x.label));
  return d && Number.isFinite(d.value) && d.value > 0 && Number.isFinite(d.changePct) ? { value: d.value, changePct: d.changePct } : null;
}

export function riskGaugeFeeds(input: {
  commodities: ResourceState<CommodityQuote[]>;
  vixDaily: ResourceState<FredObservation[]>;
  gold: ResourceState<GetGoldIntelligenceResponse>;
  news: readonly LiteItem[];
  now: number;
}): FeedState[] {
  const { commodities, vixDaily, gold, news, now } = input;
  const link = (subject: LinkSubject, at: number) => linkNews(subject, news, at, LINK_WINDOW_HOURS.fin);

  // VIX: level, or the rise in a day.
  const vix = vixReading(commodities.status === 'ready' ? commodities.data : null, vixDaily.status === 'ready' ? vixDaily.data : null);
  const fromFred = vix?.source === 'fred';
  const vixAt = fromFred && vix?.date ? ymdMs(vix.date) + CLOSE_UTC_MS : commodities.status === 'ready' ? commodities.at : now;
  const high = vix != null && vix.level + 1e-9 >= VIX_LEVEL;
  const jump = vix?.changePct != null && vix.changePct + 1e-9 >= VIX_JUMP_PCT;
  const vixChange = vix?.changePct != null ? `${signed(vix.changePct)} ${fromFred ? 'on the prior close' : 'today'}` : undefined;
  const vixFired: Indicator | null = vix && (high || jump)
    ? {
        id: 'vix', domain: 'fin', name: 'Volatility · VIX',
        value: vix.level.toFixed(2), change: vixChange, rule: `≥ ${VIX_LEVEL} or +${VIX_JUMP_PCT}% in a day`,
        detail: [high ? `at or above ${VIX_LEVEL}` : null, jump ? `up ${vix.changePct!.toFixed(1)}% in a day` : null].filter(Boolean).join(' · '),
        trust: { level: 'market', source: fromFred ? 'Cboe via FRED (VIXCLS)' : 'Cboe via Yahoo' }, at: vixAt,
        ...(fromFred && vix.date ? { dataDate: `close ${dayMonth(ymdMs(vix.date))}` } : { updatedAt: vixAt }),
        links: link(SUBJECTS.vix!, vixAt),
      }
    : null;
  const vixSource: ResourceState<unknown> = vix
    ? (fromFred ? vixDaily : commodities)
    : commodities.status !== 'ready' ? commodities : vixDaily.status === 'ready' ? notReady(vixDaily) : vixDaily;
  const vixFeed = feedState({
    id: 'vix', name: 'Volatility · VIX', source: vixSource,
    seeder: fromFred ? 'seed-fred-rates' : 'seed-commodity-quotes', cadenceMin: fromFred ? 3 * 1440 : 10,
    dataAt: fromFred && vix?.date ? ymdMs(vix.date) : null, fired: vixFired, now,
  });
  const vixNear = vix != null && (vix.level >= VIX_LEVEL * 0.8 || (vix.changePct ?? 0) >= VIX_JUMP_PCT / 2);
  const vixReadingText = vix ? `VIX ${vix.level.toFixed(2)}${vix.changePct != null ? ` ${signed(vix.changePct)}` : ''}` : null;
  const vixDetail = vix
    ? `${vixReadingText}${fromFred && vix.date ? ` · FRED close ${dayMonth(ymdMs(vix.date))}` : ''} · fires at ≥ ${VIX_LEVEL} or +${VIX_JUMP_PCT}%${vixNear ? ' · near the trigger' : ''}`
    : null;

  // Dollar index: the move in a day.
  const dxy = gold.status === 'ready' ? dollarIndex(gold.data) : null;
  const goldAt = gold.status === 'ready' ? parseTime(gold.data.updatedAt) : null;
  const dxyAt = goldAt ?? (gold.status === 'ready' ? gold.at : now);
  const dxyState = thresholdState(dxy?.changePct, DXY_MOVE_PCT * 0.6, DXY_MOVE_PCT);
  const dxyFired: Indicator | null = dxy && dxyState === 'triggered'
    ? {
        id: 'dollar-index', domain: 'fin', name: 'Dollar index · DXY',
        value: dxy.value.toFixed(2), change: `${signed(dxy.changePct, 2)} today`, rule: `±${DXY_MOVE_PCT}% in a day`,
        detail: dxy.changePct > 0 ? 'Dollar stronger: squeezes foreign revenue and emerging markets' : 'Dollar weaker',
        trust: { level: 'market', source: 'ICE dollar index via Yahoo' }, at: dxyAt, updatedAt: dxyAt,
        links: link(SUBJECTS.dollar!, dxyAt),
      }
    : null;
  const dxyFeed = feedState({
    id: 'dollar-index', name: 'Dollar index · DXY', source: dxy ? gold : notReady(gold), seeder: 'seed-commodity-quotes',
    cadenceMin: 10, dataAt: goldAt, fired: dxyFired, now,
  });

  return [
    withReading(quietDetail(vixFeed, vixDetail), vixReadingText),
    withReading(
      quietDetail(dxyFeed, dxy ? nearDetail(dxyState, `DXY ${dxy.value.toFixed(2)} ${signed(dxy.changePct, 2)} · fires at ±${DXY_MOVE_PCT}%`) : null),
      dxy ? `DXY ${dxy.value.toFixed(2)} ${signed(dxy.changePct, 2)}` : null,
    ),
  ];
}
