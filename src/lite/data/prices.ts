/**
 * Links a market story to price moves: the 24h change of the instruments the
 * headline names (or its stock tickers), else its asset class's benchmarks.
 * This shows what moved alongside the story. It does not prove the story
 * moved the price. Pure functions; Finance.tsx renders the result.
 */
import type { NewsItem } from '@/generated/client/worldmonitor/news/v1/service_client';
import { isWarStory, marketTag } from './transforms';
import { signed } from '../format';

export interface BoardQuote {
  price: number;
  /** 24h change in percent. */
  change: number;
}

/** Quotes keyed by upper-case symbol (crypto tickers, Yahoo symbols, `DXY`). */
export type PriceBoard = ReadonlyMap<string, BoardQuote>;

export function buildPriceBoard(lists: ReadonlyArray<ReadonlyArray<{ symbol: string; price: number; change: number }> | null | undefined>, dxy?: { value: number; changePct: number }): PriceBoard {
  const board = new Map<string, BoardQuote>();
  for (const list of lists) {
    for (const q of list ?? []) {
      if (!q.symbol || !Number.isFinite(q.price) || q.price <= 0 || !Number.isFinite(q.change)) continue;
      const key = q.symbol.toUpperCase();
      if (!board.has(key)) board.set(key, { price: q.price, change: q.change });
    }
  }
  if (dxy && Number.isFinite(dxy.value) && Number.isFinite(dxy.changePct)) board.set('DXY', { price: dxy.value, change: dxy.changePct });
  return board;
}

interface Instrument {
  symbol: string;
  label: string;
  /** Row tag for a commodity story that names it. */
  tag?: string;
  /** Shown as a level with a basis-point move rule (yields). */
  yield?: boolean;
}

const I = {
  brent: { symbol: 'BZ=F', label: 'Brent', tag: 'OIL' },
  wti: { symbol: 'CL=F', label: 'WTI', tag: 'OIL' },
  natgas: { symbol: 'NG=F', label: 'NatGas', tag: 'GAS' },
  gold: { symbol: 'GC=F', label: 'Gold', tag: 'GOLD' },
  silver: { symbol: 'SI=F', label: 'Silver', tag: 'METALS' },
  copper: { symbol: 'HG=F', label: 'Copper', tag: 'METALS' },
  wheat: { symbol: 'ZW=F', label: 'Wheat', tag: 'GRAINS' },
  corn: { symbol: 'ZC=F', label: 'Corn', tag: 'GRAINS' },
  soy: { symbol: 'ZS=F', label: 'Soybeans', tag: 'GRAINS' },
  coffee: { symbol: 'KC=F', label: 'Coffee', tag: 'SOFTS' },
  cocoa: { symbol: 'CC=F', label: 'Cocoa', tag: 'SOFTS' },
  sugar: { symbol: 'SB=F', label: 'Sugar', tag: 'SOFTS' },
  btc: { symbol: 'BTC', label: 'BTC' },
  eth: { symbol: 'ETH', label: 'ETH' },
  sol: { symbol: 'SOL', label: 'SOL' },
  xrp: { symbol: 'XRP', label: 'XRP' },
  us10y: { symbol: '^TNX', label: 'US10Y', yield: true },
  dxy: { symbol: 'DXY', label: 'DXY' },
  eur: { symbol: 'EURUSD=X', label: 'EUR/USD' },
  gbp: { symbol: 'GBPUSD=X', label: 'GBP/USD' },
  jpy: { symbol: 'USDJPY=X', label: 'USD/JPY' },
  cny: { symbol: 'USDCNY=X', label: 'USD/CNY' },
  inr: { symbol: 'USDINR=X', label: 'USD/INR' },
  try: { symbol: 'USDTRY=X', label: 'USD/TRY' },
  spx: { symbol: '^GSPC', label: 'S&P 500' },
  ndx: { symbol: '^IXIC', label: 'Nasdaq' },
  dow: { symbol: '^DJI', label: 'Dow' },
  nikkei: { symbol: '^N225', label: 'Nikkei' },
  hsi: { symbol: '^HSI', label: 'Hang Seng' },
  ftse: { symbol: '^FTSE', label: 'FTSE' },
  dax: { symbol: '^GDAXI', label: 'DAX' },
  nifty: { symbol: '^NSEI', label: 'Nifty' },
} satisfies Record<string, Instrument>;

/** Headline words that name an instrument, checked in this order. */
const NAMED: ReadonlyArray<[RegExp, Instrument]> = [
  [/\bbrent\b/i, I.brent],
  [/\bwti\b/i, I.wti],
  [/\b(crude|oil|opec\+?)\b/i, I.brent],
  [/\b(natural gas|natgas|lng)\b/i, I.natgas],
  [/\bgold\b/i, I.gold],
  [/\bsilver\b/i, I.silver],
  [/\bcopper\b/i, I.copper],
  [/\bwheat\b/i, I.wheat],
  [/\bcorn\b/i, I.corn],
  [/\bsoy(beans?)?\b/i, I.soy],
  [/\bcoffee\b/i, I.coffee],
  [/\bcocoa\b/i, I.cocoa],
  [/\bsugar\b/i, I.sugar],
  [/\b(bitcoin|btc)\b/i, I.btc],
  [/\b(ether|ethereum|eth)\b/i, I.eth],
  [/\bsolana\b/i, I.sol],
  [/\b(xrp|ripple)\b/i, I.xrp],
  [/\b(treasur(y|ies)|10-year|yields?)\b/i, I.us10y],
  [/\b(dollar|dxy|greenback)\b/i, I.dxy],
  [/\b(euro|eur\/usd)\b/i, I.eur],
  [/\b(sterling|british pound|gbp\/usd)\b/i, I.gbp],
  [/\b(yen|usd\/jpy)\b/i, I.jpy],
  [/\b(yuan|renminbi)\b/i, I.cny],
  [/\brupee\b/i, I.inr],
  [/\blira\b/i, I.try],
  [/(\bs&p\b|s&p 500|\bs&amp;p\b)/i, I.spx],
  [/\bnasdaq\b/i, I.ndx],
  [/\bdow\b/i, I.dow],
  [/\bnikkei\b/i, I.nikkei],
  [/\bhang seng\b/i, I.hsi],
  [/\bftse\b/i, I.ftse],
  [/\bdax\b/i, I.dax],
  [/\b(nifty|sensex)\b/i, I.nifty],
];

/** The instrument read next to a named one, so a lone name has context. */
const COMPANION: Readonly<Record<string, Instrument>> = {
  BTC: I.eth,
  ETH: I.btc,
  SOL: I.btc,
  XRP: I.btc,
  '^TNX': I.dxy,
  DXY: I.us10y,
  'BZ=F': I.wti,
  'CL=F': I.brent,
  'GC=F': I.dxy,
  '^GSPC': I.ndx,
  '^IXIC': I.spx,
  '^DJI': I.spx,
};

/** Benchmarks per asset-class tag (marketTag labels) when the headline names nothing. */
const BENCHMARKS: Readonly<Record<string, readonly Instrument[]>> = {
  'OIL & COMMOD.': [I.brent, I.gold],
  CRYPTO: [I.btc, I.eth],
  RATES: [I.us10y, I.dxy],
  FX: [I.dxy, I.eur],
  CORPORATE: [I.spx, I.ndx],
  MARKETS: [I.spx, I.ndx],
};

/** Instruments the headline names, then its stock tickers, without repeats. */
export function namedInstruments(item: Pick<NewsItem, 'title' | 'tickers'>): Instrument[] {
  const out: Instrument[] = [];
  const add = (inst: Instrument) => {
    if (!out.some((o) => o.symbol === inst.symbol)) out.push(inst);
  };
  for (const [pattern, inst] of NAMED) if (pattern.test(item.title)) add(inst);
  for (const ticker of item.tickers ?? []) add({ symbol: ticker.toUpperCase(), label: ticker.toUpperCase().replace(/\.[A-Z]+$/, '') });
  return out;
}

/**
 * A war story stays a market event only when its headline names a commodity
 * ("Brent jumps after strike on …"). Other instrument words are too loose in
 * war headlines ("forces pound the city").
 */
export function isMarketMovingWarStory(item: NewsItem): boolean {
  return isWarStory(item) && NAMED.some(([pattern, inst]) => inst.tag !== undefined && pattern.test(item.title));
}

/** The row's tag: the named commodity (OIL, GOLD …) for commodity stories, else the asset class. */
export function eventTag(item: NewsItem & { category: string }): ReturnType<typeof marketTag> {
  const tag = marketTag(item.category);
  if (item.category !== 'commodities') return tag;
  const named = namedInstruments(item).find((i) => i.tag);
  return named?.tag ? { ...tag, label: named.tag } : tag;
}

export interface PriceMove {
  symbol: string;
  /** "BTC −4.8%", "US10Y 4.38%". */
  text: string;
  /** Whether the move clears FLAT_MOVE (percent, or bp for yields). */
  moved: boolean;
}

/** Below these the linked quotes count as flat: 0.25% in 24h, or 3bp for a yield. */
export const FLAT_MOVE = { pct: 0.25, bp: 3 } as const;

export const PRICE_LINK_RULE =
  'Price link: 24h change of the instruments the headline names or its stock tickers, else its asset-class benchmarks. ' +
  `"No price impact" when every linked quote moved under ${FLAT_MOVE.pct}% (${FLAT_MOVE.bp}bp for yields). ` +
  'Shows what moved alongside the story, not what the story caused.';

function toMove(inst: Instrument, q: BoardQuote): PriceMove {
  if (inst.yield) {
    const bp = (q.price - q.price / (1 + q.change / 100)) * 100;
    return { symbol: inst.symbol, text: `${inst.label} ${q.price.toFixed(2)}%`, moved: Math.abs(bp) >= FLAT_MOVE.bp };
  }
  return { symbol: inst.symbol, text: `${inst.label} ${signed(q.change)}`, moved: Math.abs(q.change) >= FLAT_MOVE.pct };
}

/**
 * Up to `max` quoted moves for a story: the instruments it names (each named
 * one may bring its companion), else its asset class's benchmarks.
 */
export function linkPriceMoves(item: NewsItem & { category: string }, board: PriceBoard, max = 2): PriceMove[] {
  const named = namedInstruments(item).filter((i) => board.has(i.symbol));
  let picks: Instrument[] = named.slice(0, max);
  if (picks.length === 1) {
    const companion = COMPANION[picks[0]!.symbol] ?? (item.tickers?.length ? I.spx : undefined);
    if (companion && board.has(companion.symbol) && companion.symbol !== picks[0]!.symbol) picks.push(companion);
  }
  if (picks.length === 0) picks = (BENCHMARKS[marketTag(item.category).label] ?? BENCHMARKS.MARKETS!).filter((i) => board.has(i.symbol)).slice(0, max);
  return picks.map((inst) => toMove(inst, board.get(inst.symbol)!));
}

/** The right-hand column: the moves, "No price impact", or no quote. */
export function priceMoveLabel(moves: readonly PriceMove[]): { text: string; flat: boolean; detail: string } {
  if (moves.length === 0) return { text: 'No linked quote', flat: true, detail: 'No quote loaded for this story’s instruments.' };
  const joined = moves.map((m) => m.text).join(' · ');
  if (moves.every((m) => !m.moved)) return { text: 'No price impact', flat: true, detail: `Linked quotes, 24h: ${joined}` };
  return { text: joined, flat: false, detail: `24h change · ${joined}` };
}

const WAR_CAUSE: Readonly<Record<string, string>> = { conflict: 'conflict', military: 'military activity', terrorism: 'attack' };

/** "Linked to GEO · Yemen conflict" for a war story kept as a market event, else null. */
export function geoCause(item: NewsItem): string | null {
  if (!isWarStory(item)) return null;
  const what = WAR_CAUSE[item.threat?.category ?? ''] ?? 'incident';
  const where = item.locationName?.trim();
  return where ? `${where} ${what}` : what.charAt(0).toUpperCase() + what.slice(1);
}

