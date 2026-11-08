/**
 * Finance indicator feeds added in build step 3 (spec: Early indicators ›
 * Catalogue, Finance and crypto): macro prints, Treasury yields, other 10-year
 * bonds, bitcoin ETF flows, perp positioning, freight and 8-K filings. Pure
 * functions over loaded sources; Finance.tsx renders the result through the
 * shared indicator card.
 */
import type {
  GetEconomicCalendarResponse,
  GetGovernmentYieldCurveResponse,
  UsTreasuryParYieldCurve,
  EconomicEvent,
} from '@/generated/client/worldmonitor/economic/v1/service_client';
import type { GetHyperliquidFlowResponse, ListEtfFlowsResponse } from '@/generated/client/worldmonitor/market/v1/service_client';
import type { GetShippingRatesResponse, ShippingIndex } from '@/generated/client/worldmonitor/supply_chain/v1/service_client';
import type { ListMaterialEventsResponse, MaterialEvent } from '@/generated/client/worldmonitor/intelligence/v1/service_client';
import { MARKET_SYMBOLS } from '@/config/markets';
import { MINUS, signed, usdCompact } from '../format';
import { feedState, withReading, type FeedState, type Indicator } from './indicators';
import { DRIVERS, LINK_WINDOW_HOURS, linkNews, type LinkSubject } from './news-link';
import type { ResourceState } from './store';
import type { LiteItem } from './transforms';
import { nearDetail, parseTime, quietDetail } from './finance-indicators';
import { thresholdState } from './transforms';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Macro: change from the prior print that fires (no forecast source exists). */
export const MACRO_PCT_PT = 0.2;
export const MACRO_PAYROLLS_K = 100;
/** A release counts for this long after its date. */
export const MACRO_RECENT_DAYS = 3;
/** Treasury and other 10-year moves that fire, in basis points per day. */
export const YIELD_MOVE_BP = 10;
/** Bitcoin ETFs that must flow the same way. */
export const ETF_SAME_WAY = 8;
/** Hyperliquid stress score that fires: the seeder's ALERT_THRESHOLD. */
export const PERP_STRESS = 60;
/** SCFI week-on-week and Baltic Dry day-on-day moves that fire, in percent. */
export const FREIGHT_MOVE_PCT = 5;
/** 8-K filings count for this long after filing. */
export const FILING_WINDOW_HOURS = 24;
/** 8-K items that fire whoever files them. */
export const KEY_8K_ITEMS: Readonly<Record<string, string>> = {
  '1.03': 'bankruptcy or receivership',
  '1.05': 'material cybersecurity incident',
  '2.04': 'debt obligation accelerated',
  '4.02': 'prior financials no longer reliable',
};

export const MACRO_RULES =
  `US CPI or PCE m/m ≥ ${MACRO_PCT_PT} pt from the prior print, or payrolls ≥ ${MACRO_PAYROLLS_K}k from the prior print (no forecast source yet); ` +
  `the US 2-year or 10-year moves ≥ ${YIELD_MOVE_BP} bp in a day, or 2s10s changes sign; a DE, GB or JP 10-year moves ≥ ${YIELD_MOVE_BP} bp; ` +
  `${ETF_SAME_WAY} or more spot bitcoin ETFs flow the same way; a Hyperliquid stress score ≥ ${PERP_STRESS}; ` +
  `SCFI ≥ ${FREIGHT_MOVE_PCT}% week on week or the Baltic Dry ≥ ${FREIGHT_MOVE_PCT}% in a day; ` +
  `an 8-K from a company in the default stock list, or any filer reporting item ${Object.keys(KEY_8K_ITEMS).join(', ')}.`;

const dayMonth = (ts: number) => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const ymdMs = (ymd: string) => Date.parse(`${ymd.slice(0, 10)}T00:00:00Z`);

/** Epoch ms of hh:mm New York time on a YYYY-MM-DD date. */
export function newYorkTime(ymd: string, hour: number, minute: number): number {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number) as [number, number, number];
  const est = Date.UTC(y, m - 1, d, hour + 5, minute);
  const nyHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(est));
  return est - (nyHour - hour) * HOUR_MS;
}

const bp = (value: number) => `${value < 0 ? MINUS : '+'}${Math.abs(value).toFixed(0)} bp`;
const pct2 = (value: number) => `${value.toFixed(2)}%`;
const emptyOf = <T,>(state: ResourceState<T>): ResourceState<T> => (state.status === 'ready' ? { status: 'empty', data: null, at: state.at } : state);

interface Ctx {
  news: readonly LiteItem[];
  now: number;
}

const link = (ctx: Ctx, subject: LinkSubject, at: number) => linkNews(subject, ctx.news, at, LINK_WINDOW_HOURS.fin);

// ---- Macro prints -----------------------------------------------------------

interface MacroRule {
  test: RegExp;
  label: string;
  threshold: number;
  payrolls: boolean;
  source: string;
  drivers: readonly string[];
}

const MACRO: readonly MacroRule[] = [
  { test: /^cpi\b/i, label: 'US CPI', threshold: MACRO_PCT_PT, payrolls: false, source: 'BLS via FRED', drivers: ['CPI', 'inflation', 'consumer prices'] },
  { test: /^pce\b/i, label: 'US PCE', threshold: MACRO_PCT_PT, payrolls: false, source: 'BEA via FRED', drivers: ['PCE', 'inflation', 'personal consumption'] },
  { test: /payroll/i, label: 'US payrolls', threshold: MACRO_PAYROLLS_K, payrolls: true, source: 'BLS via FRED', drivers: ['payrolls', 'nonfarm', 'jobs report', 'unemployment', 'hiring'] },
];

export interface MacroPrint {
  event: EconomicEvent;
  rule: MacroRule;
  actual: number;
  previous: number;
  change: number;
  at: number;
}

const num = (v: string | undefined) => (v && v.trim() ? Number.parseFloat(v) : Number.NaN);

/** Value with its unit: "+0.3% m/m", "+165k". */
export function macroValue(value: number, payrolls: boolean, digits = payrolls ? 0 : 1): string {
  return payrolls ? `${value < 0 ? MINUS : '+'}${Math.abs(value).toFixed(digits)}k` : `${value < 0 ? MINUS : '+'}${Math.abs(value).toFixed(digits)}% m/m`;
}

/** US CPI, PCE and payrolls prints released in the last MACRO_RECENT_DAYS, newest first. */
export function recentMacroPrints(events: readonly EconomicEvent[], now: number): MacroPrint[] {
  const out: MacroPrint[] = [];
  for (const event of events) {
    if (event.country && event.country !== 'US') continue;
    const rule = MACRO.find((r) => r.test.test(event.event));
    const actual = num(event.actual);
    const previous = num(event.previous);
    if (!rule || !Number.isFinite(actual) || !Number.isFinite(previous)) continue;
    const at = newYorkTime(event.date, 8, 30);
    if (at > now || now - at > MACRO_RECENT_DAYS * DAY_MS) continue;
    out.push({ event, rule, actual, previous, change: actual - previous, at });
  }
  return out.sort((a, b) => b.at - a.at);
}

export function macroFeed(input: { calendar: ResourceState<GetEconomicCalendarResponse> } & Ctx): FeedState {
  const { calendar, now } = input;
  const events = calendar.status === 'ready' ? calendar.data.events : [];
  const prints = recentMacroPrints(events, now);
  // Rounding: prints carry one decimal, so 0.2 can arrive as 0.19999.
  const fired = prints.find((p) => Math.abs(p.change) + 1e-9 >= p.rule.threshold);
  const indicator: Indicator | null = fired
    ? {
        id: 'macro-print', domain: 'fin', name: `Macro print · ${fired.rule.label}`,
        value: macroValue(fired.actual, fired.rule.payrolls),
        change: `${fired.rule.payrolls ? macroValue(fired.change, true) : signed(fired.change, 1, ' pt')} vs prior`,
        rule: fired.rule.payrolls ? `±${MACRO_PAYROLLS_K}k vs prior` : `±${MACRO_PCT_PT} pt vs prior`,
        detail: `Prior print ${macroValue(fired.previous, fired.rule.payrolls)} · no forecast source, so the prior print stands in`,
        trust: { level: 'official', source: fired.rule.source }, at: fired.at, dataDate: `released ${dayMonth(fired.at)}`,
        links: link(input, { instruments: ['^TNX'], drivers: fired.rule.drivers }, fired.at),
      }
    : null;
  const asOf = calendar.status === 'ready' ? parseTime(calendar.data.asOf) : null;
  const feed = feedState({ id: 'macro-print', name: 'Macro prints · US', source: calendar, seeder: 'seed-economic-calendar', cadenceMin: 720, dataAt: asOf, fired: indicator, now });
  const last = prints[0];
  const next = events
    .filter((e) => MACRO.some((r) => r.test.test(e.event)) && (!e.country || e.country === 'US') && newYorkTime(e.date, 8, 30) > now)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const nextText = next ? `next ${MACRO.find((r) => r.test.test(next.event))?.label ?? next.event} ${dayMonth(ymdMs(next.date))}` : null;
  const lastText = last ? `${last.rule.label} ${macroValue(last.actual, last.rule.payrolls)}, prior ${macroValue(last.previous, last.rule.payrolls)}` : null;
  const reading = fired
    ? `${fired.rule.label.replace('US ', '')} ${fired.rule.payrolls ? macroValue(fired.change, true) : signed(fired.change, 1, ' pt')} vs prior`
    : last ? `${last.rule.label.replace('US ', '')} ${macroValue(last.actual, last.rule.payrolls)}` : nextText;
  return withReading(quietDetail(feed, [lastText, nextText, 'fires on a gap to the prior print'].filter(Boolean).join(' · ')), reading);
}

// ---- Treasury yields --------------------------------------------------------

export interface TreasuryWindow {
  latest: UsTreasuryParYieldCurve;
  prior: UsTreasuryParYieldCurve | null;
  weekAgo: UsTreasuryParYieldCurve | null;
}

/** Newest curve, the business day before it, and the newest curve at least 7 days older. */
export function treasuryWindow(curves: readonly UsTreasuryParYieldCurve[] | null | undefined): TreasuryWindow | null {
  const sorted = [...(curves ?? [])].filter((c) => c.tenYear != null || c.twoYear != null).sort((a, b) => a.date - b.date);
  const latest = sorted[sorted.length - 1];
  if (!latest) return null;
  const prior = sorted[sorted.length - 2] ?? null;
  const weekAgo = [...sorted].reverse().find((c) => c.date <= latest.date - 7 * DAY_MS) ?? null;
  return { latest, prior, weekAgo };
}

/** 2s10s spread in basis points. */
export function spreadBp(curve: UsTreasuryParYieldCurve | null | undefined): number | null {
  return curve?.twoYear != null && curve.tenYear != null ? (curve.tenYear - curve.twoYear) * 100 : null;
}

const moveBp = (a: number | undefined, b: number | undefined) => (a != null && b != null ? (a - b) * 100 : null);

export function treasuryFeed(input: { curves: ResourceState<UsTreasuryParYieldCurve[]> } & Ctx): FeedState {
  const { curves, now } = input;
  const win = curves.status === 'ready' ? treasuryWindow(curves.data) : null;
  const latest = win?.latest;
  const d2 = moveBp(latest?.twoYear, win?.prior?.twoYear);
  const d10 = moveBp(latest?.tenYear, win?.prior?.tenYear);
  const spread = spreadBp(latest);
  const spreadPrior = spreadBp(win?.prior);
  const spreadWeek = spreadBp(win?.weekAgo);
  const flipped = spread != null && spreadPrior != null && spread !== 0 && spreadPrior !== 0 && Math.sign(spread) !== Math.sign(spreadPrior);
  const moved = [d2, d10].some((d) => d != null && Math.abs(d) + 1e-9 >= YIELD_MOVE_BP);
  const at = latest ? newYorkTime(new Date(latest.date).toISOString(), 16, 0) : now;
  const levels = latest ? `${latest.twoYear?.toFixed(2) ?? '—'} / ${latest.tenYear != null ? pct2(latest.tenYear) : '—'}` : '—';
  const moves = `${d2 != null ? bp(d2).replace(' bp', '') : '—'} / ${d10 != null ? bp(d10) : '—'}`;
  const spreadText = spread != null
    ? `2s10s ${bp(spread)}${spreadWeek != null ? ` (${bp(spread - spreadWeek)} w/w)` : ''}`
    : null;
  const indicator: Indicator | null = latest && (moved || flipped)
    ? {
        id: 'treasury', domain: 'fin', name: 'Treasury yields · 2Y / 10Y',
        value: levels, change: moves, rule: `±${YIELD_MOVE_BP} bp or 2s10s flip`,
        detail: [spreadText, flipped ? 'sign flip' : 'no sign flip'].filter(Boolean).join(' · '),
        trust: { level: 'official', source: 'US Treasury' }, at, dataDate: `data to ${dayMonth(latest.date)}`,
        links: link(input, { instruments: ['^TNX'], drivers: DRIVERS['^TNX'] }, at),
      }
    : null;
  const feed = feedState({
    id: 'treasury', name: 'Treasury yields · 2Y / 10Y', source: win ? curves : emptyOf(curves), seeder: 'seed-us-treasury-par-yield',
    cadenceMin: 3 * 1440, dataAt: latest ? latest.date : null, fired: indicator, now,
  });
  const reading = latest ? `UST 10Y ${latest.tenYear?.toFixed(2) ?? '—'}% ${d10 != null ? bp(d10) : ''}`.trim() : null;
  return withReading(quietDetail(feed, latest
    ? `2Y ${latest.twoYear?.toFixed(2) ?? '—'}% (${d2 != null ? bp(d2) : '—'}) · 10Y ${latest.tenYear?.toFixed(2) ?? '—'}% (${d10 != null ? bp(d10) : '—'}) · ${spreadText ?? '2s10s —'} · data to ${dayMonth(latest.date)}`
    : null), reading);
}

// ---- Other 10-year bonds ----------------------------------------------------

const BOND_MARKETS: Readonly<Record<string, { name: string; bond: string; drivers: readonly string[] }>> = {
  DE: { name: 'Germany', bond: 'Bund', drivers: ['Bund', 'Bunds', 'ECB', 'Lagarde'] },
  GB: { name: 'United Kingdom', bond: 'gilt', drivers: ['gilt', 'gilts', 'Bank of England', 'BoE', 'Reeves'] },
  JP: { name: 'Japan', bond: 'JGB', drivers: ['JGB', 'JGBs', 'Bank of Japan', 'BoJ', 'Ueda'] },
};

export interface BondMove {
  country: string;
  source: string;
  level: number;
  moveBp: number;
  date: number;
}

/** Each market's newest 10-year level and its move from the day before. */
export function bondMoves(markets: readonly GetGovernmentYieldCurveResponse[] | null | undefined): BondMove[] {
  const out: BondMove[] = [];
  for (const m of markets ?? []) {
    const points = [...m.curves].filter((c) => Number.isFinite(c.tenors['10y'])).sort((a, b) => a.date - b.date);
    const latest = points[points.length - 1];
    const prior = points[points.length - 2];
    if (!latest || !prior) continue;
    out.push({ country: m.country.toUpperCase(), source: m.source, level: latest.tenors['10y']!, moveBp: (latest.tenors['10y']! - prior.tenors['10y']!) * 100, date: latest.date });
  }
  return out;
}

const bondLabel = (m: BondMove) => `${m.country} ${pct2(m.level)} ${bp(m.moveBp)}`;

export function otherBondsFeed(input: { bonds: ResourceState<GetGovernmentYieldCurveResponse[]> } & Ctx): FeedState {
  const { bonds, now } = input;
  const moves = bonds.status === 'ready' ? bondMoves(bonds.data) : [];
  const top = [...moves].sort((a, b) => Math.abs(b.moveBp) - Math.abs(a.moveBp))[0];
  const newest = moves.reduce((t, m) => Math.max(t, m.date), 0);
  const at = top ? top.date + 17 * HOUR_MS : now;
  const market = top ? BOND_MARKETS[top.country] : undefined;
  const indicator: Indicator | null = top && Math.abs(top.moveBp) + 1e-9 >= YIELD_MOVE_BP
    ? {
        id: 'other-bonds', domain: 'fin', name: `Other 10y bonds · ${top.country}`,
        value: pct2(top.level), change: bp(top.moveBp), rule: `±${YIELD_MOVE_BP} bp`,
        detail: moves.filter((m) => m !== top).map(bondLabel).join(' · ') || undefined,
        trust: { level: 'official', source: top.source || `${market?.bond ?? top.country} curve` }, at, dataDate: `data to ${dayMonth(top.date)}`,
        links: link(input, { countries: market ? [{ name: market.name, code: top.country }] : [], drivers: market?.drivers ?? [] }, at),
      }
    : null;
  const feed = feedState({
    id: 'other-bonds', name: 'Other 10y bonds · DE GB JP', source: moves.length ? bonds : emptyOf(bonds), seeder: 'seed-bundle-yield-curves',
    cadenceMin: 3 * 1440, dataAt: newest || null, fired: indicator, now,
  });
  return quietDetail(feed, moves.length ? `${moves.map(bondLabel).join(' · ')} · fires at ±${YIELD_MOVE_BP} bp` : null);
}

// ---- Bitcoin ETF flows ------------------------------------------------------

export function etfFlowFeed(input: { etf: ResourceState<ListEtfFlowsResponse> } & Ctx): FeedState {
  const { etf, now } = input;
  const summary = etf.status === 'ready' ? etf.data.summary : undefined;
  const at = (etf.status === 'ready' ? parseTime(etf.data.timestamp) : null) ?? now;
  const same = summary ? Math.max(summary.inflowCount, summary.outflowCount) : 0;
  const reading = summary ? `${usdCompact(summary.totalEstFlow)} net · ${summary.inflowCount} in / ${summary.outflowCount} out of ${summary.etfCount}` : null;
  const indicator: Indicator | null = summary && same >= ETF_SAME_WAY
    ? {
        id: 'etf-flows', domain: 'fin', name: 'Bitcoin ETF flows',
        value: `${usdCompact(summary.totalEstFlow)} net`, change: `${summary.inflowCount} in / ${summary.outflowCount} out`, rule: `≥ ${ETF_SAME_WAY} same way`,
        detail: `Estimated across ${summary.etfCount} US spot ETFs from price × volume, not issuer-reported flows`,
        trust: { level: 'estimated', source: 'price × volume' }, at, updatedAt: at,
        links: link(input, { instruments: ['BTC'], drivers: ['bitcoin ETF', 'spot ETF', 'ETF', 'IBIT', 'BlackRock', 'Fidelity', 'inflows', 'outflows'] }, at),
      }
    : null;
  const feed = feedState({ id: 'etf-flows', name: 'Bitcoin ETF flows', source: summary ? etf : emptyOf(etf), seeder: 'seed-etf-flows', cadenceMin: 15, dataAt: at, fired: indicator, now });
  return quietDetail(feed, reading ? `${reading} · fires at ${ETF_SAME_WAY} same way` : null);
}

// ---- Perp positioning -------------------------------------------------------

/** Price-board instrument for a Hyperliquid market. */
const PERP_INSTRUMENT: Readonly<Record<string, string>> = {
  BTC: 'BTC', ETH: 'ETH', SOL: 'SOL', PAXG: 'GC=F',
  'XYZ:CL': 'CL=F', 'XYZ:BRENTOIL': 'BZ=F', 'XYZ:GOLD': 'GC=F', 'XYZ:SILVER': 'SI=F', 'XYZ:COPPER': 'HG=F',
  'XYZ:NATGAS': 'NG=F', 'XYZ:EUR': 'EURUSD=X', 'XYZ:JPY': 'USDJPY=X',
};

export function perpPositioningFeed(input: { flow: ResourceState<GetHyperliquidFlowResponse> } & Ctx): FeedState {
  const { flow, now } = input;
  const assets = flow.status === 'ready' ? flow.data.assets.filter((a) => !a.warmup && !a.stale && Number.isFinite(a.composite)) : [];
  const ranked = [...assets].sort((a, b) => b.composite - a.composite);
  const hot = ranked.filter((a) => a.composite >= PERP_STRESS);
  const top = hot[0];
  const at = (flow.status === 'ready' ? parseTime(flow.data.fetchedAt) ?? parseTime(flow.data.ts) : null) ?? now;
  const name = (a: { display: string; symbol: string }) => a.display || a.symbol.replace(/^xyz:/i, '');
  const indicator: Indicator | null = top
    ? {
        id: 'perp-positioning', domain: 'fin', name: `Perp positioning · ${name(top)}`,
        value: `${Math.round(top.composite)}/100`, change: 'stress score', rule: `≥ ${PERP_STRESS}`,
        detail: [
          `Funding ${Math.round(top.fundingScore)} · volume ${Math.round(top.volumeScore)} · open interest ${Math.round(top.oiScore)} · basis ${Math.round(top.basisScore)}`,
          hot.length > 1 ? `also ${hot.slice(1).map((a) => `${name(a)} ${Math.round(a.composite)}`).join(', ')}` : '',
        ].filter(Boolean).join(' · '),
        trust: { level: 'market', source: 'Hyperliquid (one venue)' }, at, updatedAt: at,
        links: link(input, {
          instruments: [PERP_INSTRUMENT[top.symbol.toUpperCase()] ?? top.symbol.toUpperCase()],
          drivers: ['funding', 'perpetual', 'perp', 'leverage', 'open interest', 'liquidation', 'liquidations'],
        }, at),
      }
    : null;
  const feed = feedState({ id: 'perp-positioning', name: 'Perp positioning · Hyperliquid', source: flow, seeder: 'seed-hyperliquid-flow', cadenceMin: 5, dataAt: at, fired: indicator, now });
  const highest = ranked[0];
  const warming = flow.status === 'ready' && !assets.length && flow.data.assets.length > 0;
  return quietDetail(feed, highest
    ? nearDetail(thresholdState(highest.composite, PERP_STRESS * 0.75, PERP_STRESS), `Highest ${name(highest)} ${Math.round(highest.composite)}/100 · fires at ${PERP_STRESS}`)
    : warming ? 'Baselines warming up · no score yet' : null);
}

// ---- Freight ----------------------------------------------------------------

const FREIGHT_DRIVERS = ['freight', 'freight rates', 'shipping', 'container', 'containers', 'carriers', 'Red Sea', 'Suez', 'Panama Canal', 'Maersk'];

const lastPoint = (index: ShippingIndex) => [...index.history].sort((a, b) => a.date.localeCompare(b.date)).pop();

export function scfiFeed(input: { rates: ResourceState<GetShippingRatesResponse> } & Ctx): FeedState {
  const { rates, now } = input;
  const index = rates.status === 'ready' ? rates.data.indices.find((i) => i.indexId === 'SCFI') : undefined;
  const fetchedAt = rates.status === 'ready' ? parseTime(rates.data.fetchedAt) : null;
  // Only the dated prior is safe: changePct may be a display value.
  const change = index?.periodChangePct != null && Number.isFinite(index.periodChangePct) ? index.periodChangePct : null;
  const point = index ? lastPoint(index) : undefined;
  const at = point ? Date.parse(`${point.date}T04:30:00Z`) : now;
  const indicator: Indicator | null = index && change != null && Math.abs(change) + 1e-9 >= FREIGHT_MOVE_PCT
    ? {
        id: 'freight-scfi', domain: 'fin', name: 'Container freight · SCFI',
        value: Math.round(index.currentValue).toLocaleString('en-US'), change: `${signed(change)} w/w`, rule: `±${FREIGHT_MOVE_PCT}% w/w`,
        detail: index.priorPeriodValue ? `Prior ${Math.round(index.priorPeriodValue).toLocaleString('en-US')}${index.priorPeriodDate ? ` on ${dayMonth(ymdMs(index.priorPeriodDate))}` : ''}` : undefined,
        trust: { level: 'official', source: 'Shanghai Shipping Exchange' }, at, dataDate: point ? `week to ${dayMonth(ymdMs(point.date))}` : undefined,
        links: link(input, { drivers: FREIGHT_DRIVERS }, at),
      }
    : null;
  const feed = feedState({ id: 'freight-scfi', name: 'Container freight · SCFI', source: index ? rates : emptyOf(rates), seeder: 'seed-supply-chain-trade', cadenceMin: 360, dataAt: fetchedAt, fired: indicator, now });
  const reading = index ? `SCFI ${Math.round(index.currentValue).toLocaleString('en-US')}${change != null ? ` ${signed(change)} w/w` : ''}` : null;
  return withReading(quietDetail(feed, index
    ? `${Math.round(index.currentValue).toLocaleString('en-US')} · ${change != null ? `${signed(change)} w/w` : 'no dated prior week'}${point ? ` · week to ${dayMonth(ymdMs(point.date))}` : ''} · fires at ±${FREIGHT_MOVE_PCT}%`
    : null), reading);
}

export function bdiFeed(input: { rates: ResourceState<GetShippingRatesResponse> } & Ctx): FeedState {
  const { rates, now } = input;
  const index = rates.status === 'ready' ? rates.data.indices.find((i) => i.indexId === 'BDI') : undefined;
  const fetchedAt = rates.status === 'ready' ? parseTime(rates.data.fetchedAt) : null;
  // The source reports a change only when its text says one; otherwise prior equals current.
  const change = index && index.previousValue > 0 && index.previousValue !== index.currentValue
    ? ((index.currentValue - index.previousValue) / index.previousValue) * 100
    : null;
  const point = index ? lastPoint(index) : undefined;
  const at = point ? Date.parse(`${point.date}T13:00:00Z`) : now;
  const indicator: Indicator | null = index && change != null && Math.abs(change) + 1e-9 >= FREIGHT_MOVE_PCT
    ? {
        id: 'freight-bdi', domain: 'fin', name: 'Dry bulk · Baltic Dry',
        value: Math.round(index.currentValue).toLocaleString('en-US'), change: `${signed(change)} d/d`, rule: `±${FREIGHT_MOVE_PCT}% d/d`,
        detail: `Prior ${Math.round(index.previousValue).toLocaleString('en-US')}`,
        trust: { level: 'market', source: 'Baltic Exchange via HandyBulk' }, at, dataDate: point ? `data to ${dayMonth(ymdMs(point.date))}` : undefined,
        links: link(input, { drivers: ['Baltic Dry', 'dry bulk', 'bulk carriers', 'iron ore', 'coal', 'grain', 'freight', 'shipping'] }, at),
      }
    : null;
  const feed = feedState({ id: 'freight-bdi', name: 'Dry bulk · Baltic Dry', source: index ? rates : emptyOf(rates), seeder: 'seed-supply-chain-trade', cadenceMin: 360, dataAt: fetchedAt, fired: indicator, now });
  const reading = index ? `BDI ${Math.round(index.currentValue).toLocaleString('en-US')}${change != null ? ` ${signed(change)} d/d` : ''}` : null;
  return withReading(quietDetail(feed, index
    ? `${Math.round(index.currentValue).toLocaleString('en-US')} · ${change != null ? `${signed(change)} d/d` : 'no prior day reported'}${point ? ` · data to ${dayMonth(ymdMs(point.date))}` : ''} · fires at ±${FREIGHT_MOVE_PCT}%`
    : null), reading);
}

// ---- 8-K filings ------------------------------------------------------------

const COMPANY_SUFFIX = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|holdings?|group|sa|nv|ag|se|the|and)\b/g;

/** "DELTA AIR LINES, INC." → "delta air lines"; "Eli Lilly & Co" → "eli lilly". */
export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/\/[a-z]{2}\/?/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(COMPANY_SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Names the default stock list abbreviates. */
const COMPANY_ALIASES: Readonly<Record<string, string>> = {
  'P&G': 'procter gamble',
  'J&J': 'johnson johnson',
  BofA: 'bank of america',
  Meta: 'meta platforms',
  Berkshire: 'berkshire hathaway',
  TSMC: 'taiwan semiconductor',
  Exxon: 'exxon mobil',
};

export interface WatchCompany {
  symbol: string;
  name: string;
  key: string;
}

/** The interim watch list: the dashboard's default stock list, companies only. */
export const WATCH_COMPANIES: readonly WatchCompany[] = MARKET_SYMBOLS
  .filter((s) => !s.symbol.startsWith('^') && !s.name.includes('('))
  .map((s) => ({ symbol: s.symbol, name: s.name, key: normalizeCompany(COMPANY_ALIASES[s.name] ?? s.name) }))
  .filter((c) => c.key.length >= 3);

export function watchCompany(filer: string): WatchCompany | null {
  const key = normalizeCompany(filer);
  return WATCH_COMPANIES.find((c) => key === c.key || key.startsWith(`${c.key} `)) ?? null;
}

export interface FilingMatch {
  event: MaterialEvent;
  company: WatchCompany | null;
  keyItems: MaterialEvent['items'];
}

/** Filings in the last FILING_WINDOW_HOURS by a watch-list company or carrying a key item, newest first. */
export function matchFilings(events: readonly MaterialEvent[], now: number): FilingMatch[] {
  return events
    .filter((e) => e.filedAtMs <= now + HOUR_MS && now - e.filedAtMs <= FILING_WINDOW_HOURS * HOUR_MS)
    .map((event) => ({ event, company: watchCompany(event.company), keyItems: event.items.filter((i) => KEY_8K_ITEMS[i.code]) }))
    .filter((m) => m.company || m.keyItems.length)
    .sort((a, b) => b.event.filedAtMs - a.event.filedAtMs);
}

const filerName = (name: string) => name.replace(/\s*\/[A-Z]{2}\/?\s*$/, '').replace(/,?\s*$/, '');

export function filingsFeed(input: { filings: ResourceState<ListMaterialEventsResponse> } & Ctx): FeedState {
  const { filings, now } = input;
  const events = filings.status === 'ready' ? filings.data.events : [];
  const matches = matchFilings(events, now);
  const top = matches[0];
  const item = top ? (top.keyItems[0] ?? top.event.items[0]) : undefined;
  const fetchedAt = filings.status === 'ready' && filings.data.fetchedAtMs > 0 ? filings.data.fetchedAtMs : null;
  const indicator: Indicator | null = top
    ? {
        id: 'sec-8k', domain: 'fin', name: `8-K filing · ${filerName(top.event.company)}`,
        value: item ? `Item ${item.code}` : top.event.form, change: item?.description,
        rule: top.keyItems.length ? 'key item' : 'watch list',
        detail: [
          top.company ? `${top.company.name} (${top.company.symbol}) is on the default stock list` : `Key item from a filer outside the stock list`,
          top.event.items.length > 1 ? `${top.event.items.length} items` : '',
          matches.length > 1 ? `${matches.length - 1} more matching filing${matches.length > 2 ? 's' : ''} in ${FILING_WINDOW_HOURS} h` : '',
        ].filter(Boolean).join(' · '),
        trust: { level: 'official', source: 'SEC EDGAR' }, at: top.event.filedAtMs, updatedAt: fetchedAt ?? undefined,
        links: link(input, {
          instruments: top.company ? [top.company.symbol] : [],
          drivers: [top.company?.name ?? filerName(top.event.company)],
        }, top.event.filedAtMs),
      }
    : null;
  const feed = feedState({ id: 'sec-8k', name: 'Company filings · 8-K', source: filings, seeder: 'seed-sec-8k-stream', cadenceMin: 30, dataAt: fetchedAt, fired: indicator, now });
  const recent = events.filter((e) => now - e.filedAtMs <= FILING_WINDOW_HOURS * HOUR_MS).length;
  const reading = top ? `8-K ${filerName(top.event.company)}${item ? ` · ${item.code}` : ''}` : filings.status === 'ready' ? `8-K · ${recent} filings, none matched` : null;
  return withReading(quietDetail(feed, filings.status === 'ready'
    ? `${recent} material filing${recent === 1 ? '' : 's'} in ${FILING_WINDOW_HOURS} h · none from the stock list or with a key item`
    : null), reading);
}

/** Every step-3 feed, unsorted. */
export function financeMacroFeeds(input: {
  calendar: ResourceState<GetEconomicCalendarResponse>;
  curves: ResourceState<UsTreasuryParYieldCurve[]>;
  bonds: ResourceState<GetGovernmentYieldCurveResponse[]>;
  etf: ResourceState<ListEtfFlowsResponse>;
  flow: ResourceState<GetHyperliquidFlowResponse>;
  rates: ResourceState<GetShippingRatesResponse>;
  filings: ResourceState<ListMaterialEventsResponse>;
} & Ctx): FeedState[] {
  return [
    macroFeed(input),
    treasuryFeed(input),
    otherBondsFeed(input),
    etfFlowFeed(input),
    perpPositioningFeed(input),
    scfiFeed(input),
    bdiFeed(input),
    filingsFeed(input),
  ];
}
