/**
 * Finance indicator feeds added in build step 3 (spec: Early indicators ›
 * Catalogue, Finance and crypto): macro prints, Treasury yields, credit
 * spreads (#114), other 10-year bonds, bitcoin ETF flows, perp positioning, freight and 8-K filings. Pure
 * functions over loaded sources; Finance.tsx renders the result through the
 * shared indicator card.
 */
import type {
  GetEconomicCalendarResponse,
  GetGovernmentYieldCurveResponse,
  UsTreasuryParYieldCurve,
  EconomicEvent,
  FredObservation,
  FredSeries,
} from '@wm/contracts/generated/client/worldmonitor/economic/v1/service_client';
import type { EarningsEntry, GetHyperliquidFlowResponse, ListEtfFlowsResponse } from '@wm/contracts/generated/client/worldmonitor/market/v1/service_client';
import type { GetShippingRatesResponse, ShippingIndex } from '@wm/contracts/generated/client/worldmonitor/supply_chain/v1/service_client';
import type { ListMaterialEventsResponse, MaterialEvent } from '@wm/contracts/generated/client/worldmonitor/intelligence/v1/service_client';
import { MARKET_SYMBOLS } from '@wm/client/config/markets';
import { MINUS, signed, usdCompact } from '../format';
import { feedState, withReading, type FeedState, type Indicator } from './indicators';
import { DRIVERS, LINK_WINDOW_HOURS, linkNews, type LinkSubject } from './news-link';
import type { ResourceState } from './store';
import type { LiteItem } from './transforms';
import { nearDetail, parseTime, quietDetail } from './finance-indicators';
import { thresholdState } from './transforms';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Macro: change from the prior print that fires, the fallback when no market forecast exists. */
export const MACRO_PCT_PT = 0.2;
export const MACRO_PAYROLLS_K = 100;
/** Macro: gap to the Kalshi market-implied forecast that fires (#128; spec open decision 2). */
export const MACRO_FORECAST_PCT_PT = 0.1;
export const MACRO_FORECAST_PAYROLLS_K = 50;
/** A forecast counts only when its last snapshot was taken this close before the release. */
export const MACRO_FORECAST_MAX_AGE_HOURS = 24;
/** The next release's forecast is shown only from a read this recent (3× the hourly cadence). */
export const MACRO_FORECAST_NEXT_MAX_AGE_HOURS = 3;
/** A release counts for this long after its date. */
export const MACRO_RECENT_DAYS = 3;
/** Treasury and other 10-year moves that fire, in basis points per day. */
export const YIELD_MOVE_BP = 10;
/** High-yield spread widening that fires: in a day, and over 5 trading days, in basis points. */
export const HY_DAY_BP = 20;
export const HY_WEEK_BP = 50;
/** Investment-grade spread widening in a day that fires, in basis points. */
export const IG_DAY_BP = 5;
/** A move in the odds of a rate change at the next Fed meeting that fires, in percentage points per day (#125). */
export const RATE_ODDS_MOVE_PTS = 15;
/** A Fed or ECB decision fires for this long after it is published (#130). */
export const CB_DECISION_WINDOW_HOURS = 24;
/** seed-central-bank-decisions runs every 30 min. */
export const CB_DECISIONS_CADENCE_MIN = 30;
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
  `US CPI m/m ≥ ${MACRO_FORECAST_PCT_PT} pt or payrolls ≥ ${MACRO_FORECAST_PAYROLLS_K}k from the Kalshi market-implied forecast; ` +
  `without a forecast (always for PCE), CPI or PCE m/m ≥ ${MACRO_PCT_PT} pt or payrolls ≥ ${MACRO_PAYROLLS_K}k from the prior print; ` +
  `the US 2-year or 10-year moves ≥ ${YIELD_MOVE_BP} bp in a day, or 2s10s changes sign; a DE, GB or JP 10-year moves ≥ ${YIELD_MOVE_BP} bp; ` +
  `the odds of a move at the next Fed meeting change ≥ ${RATE_ODDS_MOVE_PTS} pts in a day, or its most likely outcome changes (Kalshi); ` +
  `a Fed or ECB rate decision published in the last ${CB_DECISION_WINDOW_HOURS} h; ` +
  `the high-yield spread widens ≥ ${HY_DAY_BP} bp in a day or ≥ ${HY_WEEK_BP} bp in 5 trading days, or the investment-grade spread widens ≥ ${IG_DAY_BP} bp in a day; ` +
  'the Fed balance sheet changes ≥ $50bn in a week (H.4.1), or reverse repo take-up changes ≥ $100bn in a day (NY Fed); ' +
  'US commercial crude stocks change ≥ 5m barrels in a week (EIA); ' +
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
  /** The seed-macro-forecasts release name, when Kalshi has a market for it. */
  forecastRelease: string | null;
  forecastThreshold: number;
}

const MACRO: readonly MacroRule[] = [
  { test: /^cpi\b/i, label: 'US CPI', threshold: MACRO_PCT_PT, payrolls: false, source: 'BLS via FRED', drivers: ['CPI', 'inflation', 'consumer prices'], forecastRelease: 'CPI', forecastThreshold: MACRO_FORECAST_PCT_PT },
  // Kalshi lists core PCE only; the calendar's PCE is headline, so it keeps the prior-print rule.
  { test: /^pce\b/i, label: 'US PCE', threshold: MACRO_PCT_PT, payrolls: false, source: 'BEA via FRED', drivers: ['PCE', 'inflation', 'personal consumption'], forecastRelease: null, forecastThreshold: MACRO_PCT_PT },
  { test: /payroll/i, label: 'US payrolls', threshold: MACRO_PAYROLLS_K, payrolls: true, source: 'BLS via FRED', drivers: ['payrolls', 'nonfarm', 'jobs report', 'unemployment', 'hiring'], forecastRelease: 'Nonfarm Payrolls', forecastThreshold: MACRO_FORECAST_PAYROLLS_K },
];

/** One release's market-implied forecast (seed-macro-forecasts, #128). */
export interface MacroForecast {
  /** Kalshi series: KXCPI or KXPAYROLLS. */
  series: string;
  /** The economic calendar's event name: CPI or Nonfarm Payrolls. */
  release: string;
  event: string;
  releaseAt: number;
  /** Implied median: % m/m for CPI, thousands of jobs for payrolls. */
  median: number;
  volume: number;
  /** When this snapshot was taken (ms). */
  at: number;
  url: string;
}

export interface MacroForecasts {
  fetchedAt: number;
  forecasts: MacroForecast[];
}

/** The seeded payload (`economic:macro-forecasts:v1`), or null when it is not one. */
export function decodeMacroForecasts(value: unknown): MacroForecasts | null {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== 'object' || !Number.isFinite(v.fetchedAt) || !Array.isArray(v.forecasts)) return null;
  const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  const forecasts: MacroForecast[] = [];
  for (const raw of v.forecasts as Array<Record<string, unknown>>) {
    if (!raw || typeof raw.release !== 'string' || typeof raw.event !== 'string' || !fin(raw.releaseAt) || !fin(raw.median) || !fin(raw.at)) continue;
    forecasts.push({
      series: typeof raw.series === 'string' ? raw.series : '', release: raw.release, event: raw.event, releaseAt: raw.releaseAt, median: raw.median,
      volume: fin(raw.volume) ? raw.volume : 0, at: raw.at, url: typeof raw.url === 'string' && raw.url.startsWith('https://kalshi.com/') ? raw.url : '',
    });
  }
  forecasts.sort((a, b) => a.releaseAt - b.releaseAt);
  return { fetchedAt: v.fetchedAt as number, forecasts };
}

/** The forecast for a release at `at`: same release, released within 12 h of it, last read at most MACRO_FORECAST_MAX_AGE_HOURS before. */
export function forecastFor(rule: MacroRule, at: number, forecasts: readonly MacroForecast[]): MacroForecast | null {
  if (!rule.forecastRelease) return null;
  return forecasts.find((f) => f.release === rule.forecastRelease && Math.abs(f.releaseAt - at) <= 12 * HOUR_MS
    && f.at <= f.releaseAt && f.releaseAt - f.at <= MACRO_FORECAST_MAX_AGE_HOURS * HOUR_MS) ?? null;
}

export interface MacroPrint {
  event: EconomicEvent;
  rule: MacroRule;
  actual: number;
  previous: number;
  change: number;
  at: number;
  forecast: MacroForecast | null;
  /** Actual minus the forecast, when there is one. */
  surprise: number | null;
}

const num = (v: string | undefined) => (v && v.trim() ? Number.parseFloat(v) : Number.NaN);

/** Value with its unit: "+0.3% m/m", "+165k". */
export function macroValue(value: number, payrolls: boolean, digits = payrolls ? 0 : 1): string {
  return payrolls ? `${value < 0 ? MINUS : '+'}${Math.abs(value).toFixed(digits)}k` : `${value < 0 ? MINUS : '+'}${Math.abs(value).toFixed(digits)}% m/m`;
}

/** US CPI, PCE and payrolls prints released in the last MACRO_RECENT_DAYS, newest first, each with its forecast when there is one. */
export function recentMacroPrints(events: readonly EconomicEvent[], now: number, forecasts: readonly MacroForecast[] = []): MacroPrint[] {
  const out: MacroPrint[] = [];
  for (const event of events) {
    if (event.country && event.country !== 'US') continue;
    const rule = MACRO.find((r) => r.test.test(event.event));
    const actual = num(event.actual);
    const previous = num(event.previous);
    if (!rule || !Number.isFinite(actual) || !Number.isFinite(previous)) continue;
    const at = newYorkTime(event.date, 8, 30);
    if (at > now || now - at > MACRO_RECENT_DAYS * DAY_MS) continue;
    const forecast = forecastFor(rule, at, forecasts);
    out.push({ event, rule, actual, previous, change: actual - previous, at, forecast, surprise: forecast ? actual - forecast.median : null });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Did this print fire: against its forecast when it has one, else against the prior print. */
export function macroPrintFires(p: MacroPrint): boolean {
  // Rounding: prints carry one decimal, so 0.2 can arrive as 0.19999.
  return p.surprise !== null ? Math.abs(p.surprise) + 1e-9 >= p.rule.forecastThreshold : Math.abs(p.change) + 1e-9 >= p.rule.threshold;
}

/** A forecast in the print's unit: "−0.12% m/m", "+91k". */
const forecastValue = (value: number, payrolls: boolean) => macroValue(value, payrolls, payrolls ? 0 : 2);
const gapText = (value: number, payrolls: boolean) => (payrolls ? macroValue(value, true) : signed(value, 2, ' pt'));

export function macroFeed(input: { calendar: ResourceState<GetEconomicCalendarResponse>; forecasts?: ResourceState<MacroForecasts> } & Ctx): FeedState {
  const { calendar, now } = input;
  const events = calendar.status === 'ready' ? calendar.data.events : [];
  const forecasts = input.forecasts?.status === 'ready' ? input.forecasts.data.forecasts : [];
  const prints = recentMacroPrints(events, now, forecasts);
  // Until the forecasts load, a CPI or payrolls print waits rather than firing on the prior print and then un-firing.
  const pending = input.forecasts?.status === 'loading';
  const fired = prints.find((p) => !(pending && p.rule.forecastRelease) && macroPrintFires(p));
  let indicator: Indicator | null = null;
  if (fired) {
    const { rule, forecast } = fired;
    const prior = `prior print ${macroValue(fired.previous, rule.payrolls)}`;
    indicator = {
      id: 'macro-print', domain: 'fin', name: `Macro print · ${rule.label}`,
      value: macroValue(fired.actual, rule.payrolls),
      ...(forecast && fired.surprise !== null
        ? {
            change: `${gapText(fired.surprise, rule.payrolls)} vs forecast`,
            rule: rule.payrolls ? `±${MACRO_FORECAST_PAYROLLS_K}k vs Kalshi forecast` : `±${MACRO_FORECAST_PCT_PT} pt vs Kalshi forecast`,
            detail: `Forecast ${forecastValue(forecast.median, rule.payrolls)}: market data (Kalshi ${forecast.series}, implied median, ${Math.round(forecast.volume).toLocaleString('en-US')} contracts, read ${Math.max(0, Math.round((forecast.releaseAt - forecast.at) / 60_000))} min before release) · ${prior}`,
          }
        : {
            change: `${rule.payrolls ? macroValue(fired.change, true) : signed(fired.change, 1, ' pt')} vs prior`,
            rule: rule.payrolls ? `±${MACRO_PAYROLLS_K}k vs prior` : `±${MACRO_PCT_PT} pt vs prior`,
            detail: `${prior[0]!.toUpperCase()}${prior.slice(1)} · ${rule.forecastRelease ? 'no Kalshi forecast for this release' : `no market forecast for ${rule.label.replace('US ', '')}`}, so the prior print stands in`,
          }),
      trust: { level: 'official', source: rule.source }, at: fired.at, dataDate: `released ${dayMonth(fired.at)}`,
      links: link(input, { instruments: ['^TNX'], drivers: rule.drivers }, fired.at),
    };
  }
  const asOf = calendar.status === 'ready' ? parseTime(calendar.data.asOf) : null;
  const feed = feedState({ id: 'macro-print', name: 'Macro prints · US', source: calendar, seeder: 'seed-economic-calendar', cadenceMin: 720, dataAt: asOf, fired: indicator, now });
  const last = prints[0];
  const next = events
    .filter((e) => MACRO.some((r) => r.test.test(e.event)) && (!e.country || e.country === 'US') && newYorkTime(e.date, 8, 30) > now)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const nextRule = next ? MACRO.find((r) => r.test.test(next.event)) : undefined;
  // The next release's current forecast, only from a recent read: an older one means the seeder stopped covering it.
  const nextAt = next ? newYorkTime(next.date, 8, 30) : 0;
  const nextForecast = nextRule?.forecastRelease
    ? forecasts.find((f) => f.release === nextRule.forecastRelease && Math.abs(f.releaseAt - nextAt) <= 12 * HOUR_MS && now - f.at <= MACRO_FORECAST_NEXT_MAX_AGE_HOURS * HOUR_MS)
    : undefined;
  const nextText = next
    ? `next ${nextRule?.label ?? next.event} ${dayMonth(ymdMs(next.date))}${nextForecast && nextRule ? `, market expects ${forecastValue(nextForecast.median, nextRule.payrolls)}` : ''}`
    : null;
  const lastText = last
    ? `${last.rule.label} ${macroValue(last.actual, last.rule.payrolls)}, ${last.forecast ? `forecast ${forecastValue(last.forecast.median, last.rule.payrolls)}` : `prior ${macroValue(last.previous, last.rule.payrolls)}`}`
    : null;
  const forecastsDown = input.forecasts && (input.forecasts.status === 'error' || input.forecasts.status === 'empty') ? 'Kalshi forecasts unavailable' : null;
  const reading = fired
    ? `${fired.rule.label.replace('US ', '')} ${fired.surprise !== null ? `${gapText(fired.surprise, fired.rule.payrolls)} vs forecast` : `${fired.rule.payrolls ? macroValue(fired.change, true) : signed(fired.change, 1, ' pt')} vs prior`}`
    : last ? `${last.rule.label.replace('US ', '')} ${macroValue(last.actual, last.rule.payrolls)}` : nextText;
  return withReading(quietDetail(feed, [lastText, nextText, forecastsDown, 'fires on a gap to the Kalshi forecast (CPI, payrolls) or the prior print'].filter(Boolean).join(' · ')), reading);
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

// ---- Credit spreads ---------------------------------------------------------

/** ICE BofA option-adjusted spreads on FRED, in percent: US high yield and US investment grade. */
export const CREDIT_SERIES = { hy: 'BAMLH0A0HYM2', ig: 'BAMLC0A0CM' } as const;

export interface CreditSpreads {
  hy: readonly FredObservation[];
  ig: readonly FredObservation[];
}

export interface SpreadMove {
  /** Latest spread, in basis points. */
  level: number;
  /** Change from the previous observation, in basis points. */
  day: number | null;
  /** Change over 5 observations (trading days), in basis points. */
  week: number | null;
  date: string;
}

/** Observations from a FRED batch response, or null when neither series came back. */
export function decodeCreditSpreads(results: Readonly<Record<string, FredSeries>> | null | undefined): CreditSpreads | null {
  const obs = (id: string) => (results?.[id]?.observations ?? []).filter((o) => Number.isFinite(o.value) && /^\d{4}-\d{2}-\d{2}/.test(o.date));
  const hy = obs(CREDIT_SERIES.hy);
  const ig = obs(CREDIT_SERIES.ig);
  return hy.length || ig.length ? { hy, ig } : null;
}

/** The latest spread and its 1-day and 5-day changes, in basis points. */
export function spreadMove(series: readonly FredObservation[] | null | undefined): SpreadMove | null {
  const sorted = [...(series ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];
  if (!latest) return null;
  const back = (n: number) => sorted[sorted.length - 1 - n];
  const diff = (o: FredObservation | undefined) => (o ? Math.round((latest.value - o.value) * 1000) / 10 : null);
  return { level: Math.round(latest.value * 1000) / 10, day: diff(back(1)), week: diff(back(5)), date: latest.date.slice(0, 10) };
}

/**
 * Bond-market phrases only: a bare "high-yield" also matches savings
 * accounts, and "default" or "downgrade" match stock and settings stories.
 */
const CREDIT_DRIVERS = [
  'credit spread', 'credit spreads', 'junk bond', 'junk bonds', 'high-yield bond', 'high-yield bonds', 'high yield bond', 'high yield bonds',
  'high-yield debt', 'corporate bond', 'corporate bonds', 'corporate debt', 'credit market', 'credit markets', 'private credit',
  'leveraged loan', 'leveraged loans', 'bond default', 'debt default',
];
const reached = (value: number | null, threshold: number) => value != null && value + 1e-9 >= threshold;

export function creditSpreadFeed(input: { spreads: ResourceState<CreditSpreads> } & Ctx): FeedState {
  const { spreads, now } = input;
  const data = spreads.status === 'ready' ? spreads.data : null;
  const hy = spreadMove(data?.hy);
  const ig = spreadMove(data?.ig);
  const hyDay = reached(hy?.day ?? null, HY_DAY_BP);
  const hyWeek = reached(hy?.week ?? null, HY_WEEK_BP);
  const igDay = reached(ig?.day ?? null, IG_DAY_BP);
  const newest = [hy?.date, ig?.date].filter((d): d is string => !!d).sort().pop();
  const at = newest ? newYorkTime(newest, 17, 0) : now;
  const level = (m: SpreadMove | null) => (m ? `${m.level.toFixed(0)}` : '—');
  const move = (d: number | null | undefined) => (d != null ? bp(d) : '—');
  const reasons = [hyDay ? `HY ${move(hy?.day)} in a day` : null, hyWeek ? `HY ${move(hy?.week)} in 5 days` : null, igDay ? `IG ${move(ig?.day)} in a day` : null].filter(Boolean);
  const indicator: Indicator | null = newest && reasons.length
    ? {
        id: 'credit-spreads', domain: 'fin', name: 'Credit spreads · HY / IG',
        value: `${level(hy)} / ${level(ig)} bp`, change: `${move(hy?.day).replace(' bp', '')} / ${move(ig?.day)}`,
        rule: `HY +${HY_DAY_BP} bp/day or +${HY_WEEK_BP} bp/5d · IG +${IG_DAY_BP} bp/day`,
        detail: [...reasons, !hyWeek && hy?.week != null ? `HY ${move(hy.week)} over 5 days` : null].filter(Boolean).join(' · '),
        trust: { level: 'market', source: 'ICE BofA via FRED' }, at, dataDate: `data to ${dayMonth(ymdMs(newest))}`,
        links: link(input, { drivers: CREDIT_DRIVERS }, at),
      }
    : null;
  const feed = feedState({
    id: 'credit-spreads', name: 'Credit spreads · HY / IG', source: data ? spreads : emptyOf(spreads), seeder: 'seed-fred-rates',
    cadenceMin: 3 * 1440, dataAt: newest ? ymdMs(newest) : null, fired: indicator, now,
  });
  const near = (hy?.day != null && hy.day >= HY_DAY_BP / 2) || (hy?.week != null && hy.week >= HY_WEEK_BP / 2) || (ig?.day != null && ig.day >= IG_DAY_BP / 2);
  const reading = hy || ig ? `HY ${level(hy)} bp ${move(hy?.day)} · IG ${level(ig)} bp ${move(ig?.day)}` : null;
  return withReading(quietDetail(feed, newest
    ? `${reading} · HY ${move(hy?.week)} over 5 days · data to ${dayMonth(ymdMs(newest))}${near ? ' · near the trigger' : ''}`
    : null), reading);
}

// ---- Fed liquidity: balance sheet and reverse repo (#136) -------------------

/** FRED's weekly Fed total assets (H.4.1, Wednesday level, millions of US$), published by seed-fred-rates. */
export const BALANCE_SHEET_SERIES = 'WALCL';
/** A weekly change in the Fed's balance sheet that fires, in billions of US$. */
export const BALANCE_SHEET_WEEK_BN = 50;
/** A day-on-day change in reverse repo take-up that fires, in billions of US$. */
export const RRP_DAY_BN = 100;
/** seed-reverse-repo runs every 3 h. */
export const RRP_CADENCE_MIN = 180;
/**
 * Phrases about Fed and dollar funding only: a bare "liquidity" also matches crypto and single-stock stories, and
 * "repo rate" is the Reserve Bank of India's policy rate.
 */
const LIQUIDITY_DRIVERS = [
  'Fed balance sheet', "Fed's balance sheet", 'quantitative tightening', 'quantitative easing', 'reverse repo', 'overnight reverse repo',
  'repo market', 'bank reserves', 'Fed liquidity', 'dollar liquidity', 'funding markets', 'Treasury General Account', 'SOFR',
];

/** WALCL observations, oldest first, or null when the series did not come back. */
export function decodeFedBalanceSheet(results: Readonly<Record<string, FredSeries>> | null | undefined): FredObservation[] | null {
  const obs = (results?.[BALANCE_SHEET_SERIES]?.observations ?? [])
    .filter((o) => Number.isFinite(o.value) && /^\d{4}-\d{2}-\d{2}/.test(o.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  return obs.length ? obs : null;
}

/** "$6.74tn", "$586.9bn" or "$0.41bn" from billions. */
const usdBnTn = (bn: number) => (Math.abs(bn) >= 1000 ? `$${(bn / 1000).toFixed(2)}tn` : `$${bn.toFixed(Math.abs(bn) < 1 ? 2 : 1)}bn`);
/** "+$12.3bn" or "−$0.07bn": two decimals under $1bn. */
const signedBn = (bn: number) => `${bn < 0 ? MINUS : '+'}$${Math.abs(bn).toFixed(Math.abs(bn) < 1 ? 2 : 1)}bn`;

export function balanceSheetFeed(input: { balance: ResourceState<FredObservation[]> } & Ctx): FeedState {
  const { balance, now } = input;
  const data = balance.status === 'ready' ? balance.data : null;
  const back = (n: number) => (data && data.length > n ? data[data.length - 1 - n] : undefined);
  const latest = back(0);
  const prev = back(1);
  const month = back(4);
  // WALCL is the Wednesday level; the H.4.1 release comes the next day at 16:30 New York time.
  const at = latest ? Math.min(now, newYorkTime(new Date(ymdMs(latest.date) + DAY_MS).toISOString().slice(0, 10), 16, 30)) : now;
  const week = latest && prev ? (latest.value - prev.value) / 1000 : null;
  const fourWeeks = latest && month ? (latest.value - month.value) / 1000 : null;
  const weekTo = latest ? `week to ${dayMonth(ymdMs(latest.date))}` : '';
  const fires = week !== null && Math.abs(week) + 1e-9 >= BALANCE_SHEET_WEEK_BN;
  const indicator: Indicator | null = latest && fires
    ? {
        id: 'fed-balance-sheet', domain: 'fin', name: 'Fed balance sheet · H.4.1',
        value: usdBnTn(latest.value / 1000), change: `${signedBn(week!)} w/w`,
        rule: `balance sheet ±$${BALANCE_SHEET_WEEK_BN}bn in a week`,
        detail: [`${week! < 0 ? 'shrank' : 'grew'} ${signedBn(week!).slice(1)} in the ${weekTo}`, fourWeeks !== null ? `${signedBn(fourWeeks)} over 4 weeks` : null].filter(Boolean).join(' · '),
        trust: { level: 'official', source: 'Federal Reserve H.4.1 via FRED' }, at, dataDate: weekTo,
        links: link(input, { drivers: LIQUIDITY_DRIVERS }, at),
      }
    : null;
  const feed = feedState({
    id: 'fed-balance-sheet', name: 'Fed balance sheet · H.4.1', source: data ? balance : emptyOf(balance), seeder: 'seed-fred-rates',
    cadenceMin: 7 * 1440, dataAt: latest ? at : null, fired: indicator, now,
  });
  const reading = latest ? `Fed ${usdBnTn(latest.value / 1000)}${week !== null ? ` ${signedBn(week)} w/w` : ''}` : null;
  const near = week !== null && Math.abs(week) >= BALANCE_SHEET_WEEK_BN / 2;
  return withReading(quietDetail(feed, latest
    ? `${usdBnTn(latest.value / 1000)}${week !== null ? `, ${signedBn(week)} in the ${weekTo}` : ''}${fourWeeks !== null ? ` (${signedBn(fourWeeks)} over 4 weeks)` : ''} · fires at ±$${BALANCE_SHEET_WEEK_BN}bn a week${near ? ' · near the trigger' : ''}`
    : null), reading);
}

export interface RrpDay {
  /** Operation date, "2026-11-19". */
  date: string;
  /** Amount accepted, US$. */
  accepted: number;
}

export interface ReverseRepo {
  fetchedAt: number;
  /** Newest first. */
  days: RrpDay[];
}

/** The seeded payload (`economic:reverse-repo:v1`), or null when it is not one. */
export function decodeReverseRepo(value: unknown): ReverseRepo | null {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== 'object' || !Number.isFinite(v.fetchedAt) || !Array.isArray(v.days)) return null;
  const days: RrpDay[] = [];
  for (const raw of v.days as Array<Record<string, unknown>>) {
    if (typeof raw?.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date) || typeof raw.accepted !== 'number' || !Number.isFinite(raw.accepted)) continue;
    days.push({ date: raw.date, accepted: raw.accepted });
  }
  days.sort((a, b) => b.date.localeCompare(a.date));
  return days.length ? { fetchedAt: v.fetchedAt as number, days } : null;
}

export function reverseRepoFeed(input: { rrp: ResourceState<ReverseRepo> } & Ctx): FeedState {
  const { rrp, now } = input;
  const data = rrp.status === 'ready' ? rrp.data : null;
  const [latest, prev] = data?.days ?? [];
  // Results come out after the operation closes at 13:15 New York time.
  const at = latest ? Math.min(now, newYorkTime(latest.date, 13, 30)) : now;
  const day = latest && prev ? (latest.accepted - prev.accepted) / 1e9 : null;
  const fires = day !== null && Math.abs(day) + 1e-9 >= RRP_DAY_BN;
  // Most large moves are month and quarter ends: cash parked over the turn, then taken back out.
  const turn = latest && prev && (latest.date.slice(0, 7) !== prev.date.slice(0, 7) || Number(latest.date.slice(8, 10)) >= 25);
  const opDay = latest ? dayMonth(ymdMs(latest.date)) : '';
  const indicator: Indicator | null = latest && prev && fires
    ? {
        id: 'reverse-repo', domain: 'fin', name: 'Fed reverse repo · NY Fed',
        value: usdBnTn(latest.accepted / 1e9), change: `${signedBn(day!)} d/d`,
        rule: `reverse repo ±$${RRP_DAY_BN}bn in a day`,
        detail: [`${signedBn(day!)} from ${usdBnTn(prev.accepted / 1e9)} on ${dayMonth(ymdMs(prev.date))}`, turn ? 'around the month end' : null].filter(Boolean).join(' · '),
        trust: { level: 'official', source: 'NY Fed reverse repo operations' }, at, dataDate: `operation ${opDay}`,
        links: link(input, { drivers: LIQUIDITY_DRIVERS }, at),
      }
    : null;
  const feed = feedState({
    id: 'reverse-repo', name: 'Fed reverse repo · NY Fed', source: rrp, seeder: 'seed-reverse-repo',
    cadenceMin: RRP_CADENCE_MIN, dataAt: data?.fetchedAt ?? null, fired: indicator, now,
  });
  const reading = latest ? `RRP ${usdBnTn(latest.accepted / 1e9)}${day !== null ? ` ${signedBn(day)}` : ''}` : null;
  const near = day !== null && Math.abs(day) >= RRP_DAY_BN / 2;
  return withReading(quietDetail(feed, latest
    ? `${usdBnTn(latest.accepted / 1e9)} on ${opDay}${day !== null && prev ? `, ${signedBn(day)} from ${dayMonth(ymdMs(prev.date))}` : ''} · fires at ±$${RRP_DAY_BN}bn a day${near ? ' · near the trigger' : ''}`
    : null), reading);
}

// ---- Fed decision odds (#125) ------------------------------------------------

/** seed-rate-odds runs hourly. */
export const RATE_ODDS_CADENCE_MIN = 60;
const FED_DRIVERS = ['Fed', 'FOMC', 'Federal Reserve', 'Powell', 'rate cut', 'rate cuts', 'rate hike', 'rate hikes', 'interest rates', 'federal funds'];

export interface RateOddsBucket {
  /** The target range's upper bound after the meeting, in percent; null for the open top bucket. */
  upper: number | null;
  /** The bottom bucket: at or below `upper`. */
  below: boolean;
  /** The top bucket: above this strike. */
  above: number | null;
  p: number;
  /** The same outcome a day earlier (Kalshi's previous prices). */
  pPrev: number;
}

export interface RateOddsMeeting {
  event: string;
  /** When the market closes on the decision (ms). */
  decisionAt: number;
  volume: number;
  url: string;
  buckets: RateOddsBucket[];
}

export interface RateOdds {
  fetchedAt: number;
  /** FRED DFEDTARU: the current upper bound, or null. */
  target: { value: number; date: string } | null;
  meetings: RateOddsMeeting[];
}

/** The seeded payload (`economic:rate-odds:v1`), or null when it is not one. */
export function decodeRateOdds(value: unknown): RateOdds | null {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== 'object' || !Number.isFinite(v.fetchedAt) || !Array.isArray(v.meetings)) return null;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const prob = (x: unknown) => { const n = num(x); return n !== null && n >= 0 && n <= 1 ? n : null; };
  const meetings: RateOddsMeeting[] = [];
  for (const raw of v.meetings as Array<Record<string, unknown>>) {
    const decisionAt = num(raw?.decisionAt);
    if (decisionAt === null || !Array.isArray(raw.buckets)) continue;
    const buckets: RateOddsBucket[] = [];
    for (const b of raw.buckets as Array<Record<string, unknown>>) {
      const p = prob(b?.p);
      const pPrev = prob(b?.pPrev);
      if (p === null || pPrev === null) continue;
      buckets.push({ upper: num(b.upper), below: b.below === true, above: num(b.above), p, pPrev });
    }
    if (buckets.length < 3) continue;
    meetings.push({ event: typeof raw.event === 'string' ? raw.event : '', decisionAt, volume: num(raw.volume) ?? 0,
      url: typeof raw.url === 'string' && raw.url.startsWith('https://kalshi.com/') ? raw.url : '', buckets });
  }
  meetings.sort((a, b) => a.decisionAt - b.decisionAt);
  const t = v.target as Record<string, unknown> | null;
  const target = t && num(t.value) !== null && typeof t.date === 'string' ? { value: num(t.value)!, date: t.date } : null;
  return { fetchedAt: v.fetchedAt as number, target, meetings };
}

const bpOf = (pts: number) => Math.round(pts * 100);

/** "Hold", "Cut 25 bp", "Hike 50 bp", or the bound itself when the current target is unknown. */
export function rateOutcomeLabel(b: RateOddsBucket, target: number | null): string {
  if (b.upper === null) return target === null ? `Above ${b.above?.toFixed(2)}%` : `Hike > ${bpOf((b.above ?? 0) - target)} bp`;
  if (target === null) return `${b.below ? '≤ ' : ''}${b.upper.toFixed(2)}%`;
  const d = bpOf(b.upper - target);
  if (b.below) return d >= 0 ? `≤ ${b.upper.toFixed(2)}%` : `Cut ≥ ${-d} bp`;
  return d === 0 ? 'Hold' : d < 0 ? `Cut ${-d} bp` : `Hike ${d} bp`;
}

export interface RateOddsReading {
  meeting: RateOddsMeeting;
  modal: RateOddsBucket;
  modalPrev: RateOddsBucket;
  /** Odds of any move, now and a day earlier; null without the current target. */
  move: number | null;
  movePrev: number | null;
}

/** The next meeting's most likely outcome and move odds, now and a day earlier. */
export function rateOddsReading(odds: RateOdds, now: number): RateOddsReading | null {
  const meeting = odds.meetings.find((m) => m.decisionAt > now);
  if (!meeting) return null;
  const top = (key: 'p' | 'pPrev') => meeting.buckets.reduce((best, b) => (b[key] > best[key] ? b : best));
  const target = odds.target?.value ?? null;
  const hold = target === null ? undefined : meeting.buckets.find((b) => b.upper !== null && !b.below && Math.abs(b.upper - target) < 1e-6);
  // No bucket at the current target (it falls in the open bottom bucket, or off the ladder):
  // the odds of a move cannot be read, so only the most-likely rule applies.
  return {
    meeting, modal: top('p'), modalPrev: top('pPrev'),
    move: hold ? 1 - hold.p : null,
    movePrev: hold ? 1 - hold.pPrev : null,
  };
}

const pctOf = (p: number) => `${Math.round(p * 100)}%`;
const ptsOf = (d: number) => {
  const n = Math.abs(Math.round(d * 100));
  return `${d < 0 ? MINUS : '+'}${n} pt${n === 1 ? '' : 's'}`;
};

export function rateOddsFeed(input: { odds: ResourceState<RateOdds> } & Ctx): FeedState {
  const { odds, now } = input;
  const data = odds.status === 'ready' ? odds.data : null;
  const r = data ? rateOddsReading(data, now) : null;
  const target = data?.target?.value ?? null;
  const shift = r && r.move !== null && r.movePrev !== null ? r.move - r.movePrev : null;
  const moved = shift !== null && Math.abs(shift) * 100 + 1e-9 >= RATE_ODDS_MOVE_PTS;
  const label = (b: RateOddsBucket) => rateOutcomeLabel(b, target);
  const flipped = r ? label(r.modal) !== label(r.modalPrev) : false;
  const meetingDay = r ? dayMonth(r.meeting.decisionAt) : '';
  const at = data?.fetchedAt ?? now;
  const top3 = r ? [...r.meeting.buckets].sort((a, b) => b.p - a.p).slice(0, 3).filter((b) => b.p >= 0.01).map((b) => `${label(b)} ${pctOf(b.p)}`).join(' · ') : '';
  const targetText = data?.target ? `target upper bound ${data.target.value.toFixed(2)}% (FRED, ${dayMonth(ymdMs(data.target.date))})` : 'current target unknown';
  const indicator: Indicator | null = r && (moved || flipped)
    ? {
        id: 'fed-odds', domain: 'fin', name: `Fed decision odds · ${meetingDay}`,
        value: `${label(r.modal)} ${pctOf(r.modal.p)}`,
        change: shift !== null ? `move odds ${pctOf(r.movePrev!)} → ${pctOf(r.move!)}` : `was ${label(r.modalPrev)} ${pctOf(r.modalPrev.pPrev)}`,
        rule: `move odds ±${RATE_ODDS_MOVE_PTS} pts in a day, or the most likely outcome changes (next meeting)`,
        detail: [flipped ? `most likely was ${label(r.modalPrev)} ${pctOf(r.modalPrev.pPrev)} a day earlier` : null, top3, targetText].filter(Boolean).join(' · '),
        trust: { level: 'market', source: 'Kalshi KXFED (one venue)' }, at, dataDate: `meeting ${meetingDay}`,
        links: link(input, { drivers: FED_DRIVERS }, at),
      }
    : null;
  const feed = feedState({
    id: 'fed-odds', name: 'Fed decision odds · Kalshi', source: data && r ? odds : emptyOf(odds), seeder: 'seed-rate-odds',
    cadenceMin: RATE_ODDS_CADENCE_MIN, dataAt: data?.fetchedAt ?? null, fired: indicator, now,
  });
  const reading = r ? `${label(r.modal)} ${pctOf(r.modal.p)} at the ${meetingDay} meeting` : null;
  const near = shift !== null && Math.abs(shift) * 100 >= RATE_ODDS_MOVE_PTS / 2;
  return withReading(quietDetail(feed, r
    ? `${reading} · ${r.move !== null ? `move odds ${pctOf(r.move)} (${ptsOf(shift!)} in a day)` : (target === null ? 'move odds need the current target' : 'move odds unreadable: no outcome at the current target')} · ${targetText}${near ? ' · near the trigger' : ''}`
    : null), reading);
}

// ---- Central bank decisions (#130) -------------------------------------------

export type CbBank = 'fed' | 'ecb';

export interface CbDecision {
  bank: CbBank;
  /** When the statement was published (ms). */
  at: number;
  url: string;
  /** False while the statement page has not been read or its wording was not recognised. */
  parsed: boolean;
  action: 'hold' | 'hike' | 'cut' | null;
  /** +25, −50, 0 for a hold; null when not stated. */
  changeBp: number | null;
  /** The Fed's upper bound or the ECB's deposit facility rate, in percent. */
  rate: number | null;
  /** "3.75–4.00%" (Fed target range) or "2.50%" (ECB deposit facility rate). */
  rateText: string;
  votes: string | null;
  dissent: string | null;
  summary: string;
}

export interface CbDecisions {
  fetchedAt: number;
  decisions: CbDecision[];
  /** Each feed's last good read; `ok` is false when this run could not read it. */
  sources: Record<CbBank, { ok: boolean; okAt: number | null }>;
}

const CB_BANKS: Readonly<Record<CbBank, { name: string; meeting: string; host: string; source: string; calendar: RegExp; drivers: readonly string[] }>> = {
  fed: { name: 'Fed', meeting: 'FOMC', host: 'https://www.federalreserve.gov/', source: 'Federal Reserve (FOMC statement)', calendar: /^FOMC\b/i, drivers: FED_DRIVERS },
  ecb: {
    name: 'ECB', meeting: 'ECB', host: 'https://www.ecb.europa.eu/', source: 'European Central Bank (monetary policy decisions)', calendar: /^ECB\b/i,
    drivers: ['ECB', 'European Central Bank', 'Lagarde', 'Governing Council', 'deposit rate', 'deposit facility', 'rate cut', 'rate hike', 'interest rates'],
  },
};

/** The seeded payload (`economic:central-bank-decisions:v1`), or null when it is not one. */
export function decodeCbDecisions(value: unknown): CbDecisions | null {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== 'object' || !Number.isFinite(v.fetchedAt) || !Array.isArray(v.decisions)) return null;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const str = (x: unknown) => (typeof x === 'string' ? x : '');
  const decisions: CbDecision[] = [];
  for (const raw of v.decisions as Array<Record<string, unknown>>) {
    const bank = raw?.bank;
    const at = num(raw?.at);
    if ((bank !== 'fed' && bank !== 'ecb') || at === null || !str(raw.url).startsWith(CB_BANKS[bank].host)) continue;
    const action = raw.action === 'hold' || raw.action === 'hike' || raw.action === 'cut' ? raw.action : null;
    decisions.push({
      bank, at, url: str(raw.url), parsed: raw.parsed === true && action !== null, action,
      changeBp: num(raw.changeBp), rate: num(raw.rate), rateText: str(raw.rateText), votes: str(raw.votes) || null, dissent: str(raw.dissent) || null, summary: str(raw.summary),
    });
  }
  decisions.sort((a, b) => b.at - a.at);
  const src = (v.sources ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const source = (bank: CbBank) => ({ ok: src[bank]?.ok !== false, okAt: num(src[bank]?.okAt) });
  return { fetchedAt: v.fetchedAt as number, decisions, sources: { fed: source('fed'), ecb: source('ecb') } };
}

/** "Hold", "Hike 25 bp", "Cut 50 bp", or "Decision out" while the statement is unread. */
export function cbDecisionValue(d: CbDecision): string {
  if (!d.parsed || !d.action) return 'Decision out';
  if (d.action === 'hold') return 'Hold';
  const verb = d.action === 'hike' ? 'Hike' : 'Cut';
  return d.changeBp ? `${verb} ${Math.abs(d.changeBp)} bp` : verb;
}

const cbRateText = (d: CbDecision) => (d.rateText ? `${d.bank === 'fed' ? 'range' : 'deposit rate'} ${d.rateText}` : '');
const pastTense: Readonly<Record<'hold' | 'hike' | 'cut', string>> = { hold: 'held', hike: 'hiked', cut: 'cut' };

/** The bank's newest decision, if it was published in the last CB_DECISION_WINDOW_HOURS. */
export function recentCbDecision(data: CbDecisions, bank: CbBank, now: number): CbDecision | null {
  const d = data.decisions.find((x) => x.bank === bank);
  return d && d.at <= now + HOUR_MS && now - d.at <= CB_DECISION_WINDOW_HOURS * HOUR_MS ? d : null;
}

/**
 * The next FOMC or ECB meeting on the macro calendar, as epoch ms of its date;
 * 'beyond' when the calendar (31 days ahead) has none; null when it is not loaded.
 */
function nextMeeting(calendar: ResourceState<GetEconomicCalendarResponse> | undefined, bank: CbBank, now: number): number | 'beyond' | null {
  if (calendar?.status !== 'ready') return null;
  const today = new Date(now).toISOString().slice(0, 10);
  const next = calendar.data.events
    .filter((e) => CB_BANKS[bank].calendar.test(e.event) && e.date.slice(0, 10) > today)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  return next ? ymdMs(next.date) : 'beyond';
}

/** The bank a macro calendar row is a meeting of: "FOMC Rate Decision" → fed, "ECB Rate Decision" → ecb. */
export function cbBankOf(event: string): CbBank | null {
  return CB_BANKS.fed.calendar.test(event) ? 'fed' : CB_BANKS.ecb.calendar.test(event) ? 'ecb' : null;
}

/**
 * The decision a calendar meeting row produced (published on its date, a day
 * either side for time zones), with the bank's decision before it for the
 * PRIOR column; null for other rows or a meeting not decided yet.
 */
export function cbDecisionForEvent(data: CbDecisions | null, event: Pick<EconomicEvent, 'event' | 'date'>): { decision: CbDecision; prior: CbDecision | null } | null {
  const bank = cbBankOf(event.event);
  if (!data || !bank) return null;
  const day = ymdMs(event.date);
  // The prior is the bank's decision just before, read or not: an unread one shows "—", never an older rate.
  const own = data.decisions.filter((d) => d.bank === bank);
  const i = own.findIndex((d) => d.parsed && Math.abs(ymdMs(new Date(d.at).toISOString()) - day) <= DAY_MS);
  return i < 0 ? null : { decision: own[i]!, prior: own[i + 1] ?? null };
}

export function centralBankFeeds(input: { decisions: ResourceState<CbDecisions>; calendar?: ResourceState<GetEconomicCalendarResponse> } & Ctx): FeedState[] {
  const { decisions, now } = input;
  const data = decisions.status === 'ready' ? decisions.data : null;
  // As fresh as the older feed's last good read.
  const dataAt = data ? Math.min(data.fetchedAt, data.sources.fed.okAt ?? data.fetchedAt, data.sources.ecb.okAt ?? data.fetchedAt) : null;
  const base = feedState({
    id: 'cb-decision', name: 'Central bank decisions · Fed, ECB', source: decisions, seeder: 'seed-central-bank-decisions',
    cadenceMin: CB_DECISIONS_CADENCE_MIN, dataAt, fired: null, now,
  });
  if (base.kind !== 'quiet' || !data) return [base];
  const unread = (bank: CbBank) => {
    const src = data.sources[bank];
    return src.ok ? null : `${CB_BANKS[bank].name} feed unread${src.okAt ? ` since ${new Date(src.okAt).toISOString().slice(11, 16)} UTC` : ''}`;
  };
  const fired: Indicator[] = [];
  for (const bank of ['fed', 'ecb'] as const) {
    const d = recentCbDecision(data, bank, now);
    if (!d) continue;
    const b = CB_BANKS[bank];
    fired.push({
      id: `cb-decision:${bank}`, domain: 'fin', name: `Central bank decision · ${b.name}`,
      value: cbDecisionValue(d),
      ...(cbRateText(d) ? { change: cbRateText(d) } : {}),
      rule: `${b.meeting} decision published ≤ ${CB_DECISION_WINDOW_HOURS} h`,
      detail: [
        d.parsed ? d.summary : 'The statement is out but has not been read yet; the seeder reads it again on its next run',
        d.votes ? `vote ${d.votes}` : null,
        d.dissent ? `dissent: ${d.dissent}` : null,
        // A card for one bank still says when the other bank's feed is down.
        unread(bank === 'fed' ? 'ecb' : 'fed'),
      ].filter(Boolean).join(' · '),
      trust: { level: 'official', source: b.source }, at: d.at, updatedAt: data.fetchedAt, dataDate: `decided ${dayMonth(d.at)}`,
      links: link(input, { drivers: b.drivers }, d.at),
    });
  }
  if (fired.length) return fired.map((indicator) => withReading({ kind: 'fired', id: indicator.id, name: indicator.name, indicator }, `${indicator.name.replace('Central bank decision · ', '')} ${indicator.value}`));
  const parts = (['fed', 'ecb'] as const).map((bank) => {
    const b = CB_BANKS[bank];
    const last = data.decisions.find((x) => x.bank === bank && x.parsed && x.action);
    const lastText = last ? `${b.name} ${pastTense[last.action!]}${last.changeBp ? ` ${Math.abs(last.changeBp)} bp` : ''}${last.rateText ? ` at ${last.rateText}` : ''} ${dayMonth(last.at)}` : `${b.name}: no decision read yet`;
    const next = nextMeeting(input.calendar, bank, now);
    const nextText = next === 'beyond' ? `next ${b.meeting} beyond the calendar's 31 days` : next ? `next ${b.meeting} ${dayMonth(next)}` : null;
    return [lastText, nextText, unread(bank)].filter(Boolean).join(', ');
  });
  const newest = data.decisions.find((x) => x.parsed && x.action);
  return [withReading(
    quietDetail(base, `${parts.join(' · ')} · fires when a decision is published`),
    newest ? `${CB_BANKS[newest.bank].name} ${pastTense[newest.action!]} ${dayMonth(newest.at)}` : null,
  )];
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

/** A filer's name without EDGAR's state suffix ("ACME CORP /DE/" → "ACME CORP"). */
export const filerName = (name: string) => name.replace(/\s*\/[A-Z]{2}\/?\s*$/, '').replace(/,?\s*$/, '');

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
  forecasts?: ResourceState<MacroForecasts>;
  curves: ResourceState<UsTreasuryParYieldCurve[]>;
  spreads: ResourceState<CreditSpreads>;
  bonds: ResourceState<GetGovernmentYieldCurveResponse[]>;
  etf: ResourceState<ListEtfFlowsResponse>;
  flow: ResourceState<GetHyperliquidFlowResponse>;
  rates: ResourceState<GetShippingRatesResponse>;
  filings: ResourceState<ListMaterialEventsResponse>;
  balance?: ResourceState<FredObservation[]>;
  rrp?: ResourceState<ReverseRepo>;
  stocks?: ResourceState<OilStocks>;
} & Ctx): FeedState[] {
  return [
    macroFeed(input),
    treasuryFeed(input),
    creditSpreadFeed(input),
    otherBondsFeed(input),
    etfFlowFeed(input),
    perpPositioningFeed(input),
    scfiFeed(input),
    bdiFeed(input),
    filingsFeed(input),
    ...(input.balance ? [balanceSheetFeed({ ...input, balance: input.balance })] : []),
    ...(input.rrp ? [reverseRepoFeed({ ...input, rrp: input.rrp })] : []),
    ...(input.stocks ? [oilStocksFeed({ ...input, stocks: input.stocks })] : []),
  ];
}

// ---- Earnings dates for the watch list (#138) ---------------------------------

/**
 * The card's window around today: recent results and the next two weeks. seed-earnings-calendar reads 14 days ahead
 * of its run; the card stops a day short, so its last day was fetched even when the data is a day old.
 */
export const EARNINGS_PAST_DAYS = 7;
export const EARNINGS_AHEAD_DAYS = 13;

/**
 * The default stock list's US companies (the watchlist stand-in): symbol to display name. Finnhub's free calendar
 * lists US companies only, so listings with an exchange suffix ("0700.HK") and indices are left out rather than
 * shown as never reporting.
 */
export const EARNINGS_WATCH: ReadonlyMap<string, string> = new Map(
  MARKET_SYMBOLS.filter((s) => !s.symbol.startsWith('^') && !/\.[A-Z]{1,2}$/.test(s.symbol)).map((s) => [s.symbol, s.name]),
);

export interface WatchEarning {
  symbol: string;
  name: string;
  /** "2026-11-19". */
  date: string;
  /** "before open", "after close", "during the session", or "" when Finnhub does not say. */
  time: string;
  /** EPS estimate and actual, or null when unknown (the RPC sends 0 for a missing estimate). */
  epsEstimate: number | null;
  epsActual: number | null;
  surprise: 'beat' | 'miss' | '';
}

const EARNINGS_TIME: Readonly<Record<string, string>> = { bmo: 'before open', amc: 'after close', dmh: 'during the session' };

/** Watch-list companies reporting from EARNINGS_PAST_DAYS before today to EARNINGS_AHEAD_DAYS after, in date order. */
export function watchlistEarnings(entries: readonly EarningsEntry[] | null | undefined, today: string): WatchEarning[] {
  const day = (offset: number) => new Date(ymdMs(today) + offset * DAY_MS).toISOString().slice(0, 10);
  const from = day(-EARNINGS_PAST_DAYS);
  const to = day(EARNINGS_AHEAD_DAYS);
  const seen = new Set<string>();
  const rows: WatchEarning[] = [];
  for (const e of entries ?? []) {
    // Class shares: "BRK.B" at Finnhub is "BRK-B" on the list.
    const symbol = EARNINGS_WATCH.has(e.symbol) ? e.symbol : e.symbol.replace('.', '-');
    const name = EARNINGS_WATCH.get(symbol);
    const date = (e.date ?? '').slice(0, 10);
    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < from || date > to || seen.has(`${symbol}${date}`)) continue;
    seen.add(`${symbol}${date}`);
    rows.push({
      symbol, name, date, time: EARNINGS_TIME[e.hour] ?? '',
      epsEstimate: Number.isFinite(e.epsEstimate) && e.epsEstimate !== 0 ? e.epsEstimate : null,
      epsActual: e.hasActuals && Number.isFinite(e.epsActual) ? e.epsActual : null,
      surprise: e.hasActuals && (e.surpriseDirection === 'beat' || e.surpriseDirection === 'miss') ? e.surpriseDirection : '',
    });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));
}

// ---- US oil inventories (#139) ------------------------------------------------

/** A week-on-week change in US commercial crude stocks that fires, in million barrels. */
export const OIL_STOCKS_WEEK_MBBL = 5;
/** Phrases about oil stocks only: a bare "stockpiles" also matches ammunition, chip and grain stories. */
const OIL_STOCK_DRIVERS = [
  'crude inventories', 'crude inventory', 'crude stocks', 'crude stockpiles', 'oil inventories', 'oil stockpiles',
  'EIA', 'Energy Information Administration', 'gasoline inventories', 'gasoline stocks', 'distillate stocks', 'distillate inventories',
];

export interface StockSeries {
  /** Thousand barrels. */
  current: number;
  previous: number | null;
  /** The week the figure is for (EIA's period, a Friday), and the week before. */
  date: string;
  previousDate: string;
}

export interface OilStocks {
  crude: StockSeries | null;
  gasoline: StockSeries | null;
  distillate: StockSeries | null;
}

/** The seeded payload (`energy:eia-petroleum:v1`) cut to the stock series, or null when it has none. */
export function decodeOilStocks(value: unknown): OilStocks | null {
  const v = value as Record<string, Record<string, unknown> | undefined> | null;
  if (!v || typeof v !== 'object') return null;
  const series = (raw: Record<string, unknown> | undefined): StockSeries | null => {
    const current = typeof raw?.current === 'number' && Number.isFinite(raw.current) ? raw.current : null;
    const date = typeof raw?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : null;
    if (current === null || date === null) return null;
    const previous = typeof raw?.previous === 'number' && Number.isFinite(raw.previous) ? raw.previous : null;
    return { current, previous, date, previousDate: typeof raw?.previousDate === 'string' ? raw.previousDate : '' };
  };
  const out = { crude: series(v.inventory), gasoline: series(v.gasoline), distillate: series(v.distillate) };
  return out.crude || out.gasoline || out.distillate ? out : null;
}

/**
 * Week-on-week change in million barrels, or null without a figure for the week before. Before the seeder stored the
 * previous week's date, the two figures were EIA's last two rows, which are consecutive weeks.
 */
export function stockChange(s: StockSeries | null): number | null {
  if (!s || s.previous === null) return null;
  if (s.previousDate && Math.round((ymdMs(s.date) - ymdMs(s.previousDate)) / DAY_MS) !== 7) return null;
  // Rounded to the 0.1m barrels the card shows, so the rule fires on the number it displays.
  return Math.round((s.current - s.previous) / 100) / 10;
}

const mbbl = (n: number) => `${n < 0 ? MINUS : '+'}${Math.abs(n).toFixed(1)}m`.replace(`${MINUS}0.0m`, '+0.0m');

export function oilStocksFeed(input: { stocks: ResourceState<OilStocks> } & Ctx): FeedState {
  const { stocks, now } = input;
  const data = stocks.status === 'ready' ? stocks.data : null;
  const crude = data?.crude ?? null;
  const week = stockChange(crude);
  // The weekly petroleum status report comes out the Wednesday after the week (a Friday) at 10:30 New York time.
  const at = crude ? Math.min(now, newYorkTime(new Date(ymdMs(crude.date) + 5 * DAY_MS).toISOString().slice(0, 10), 10, 30)) : now;
  const weekTo = crude ? `week to ${dayMonth(ymdMs(crude.date))}` : '';
  const products = [
    data?.gasoline ? `gasoline ${stockChange(data.gasoline) !== null ? `${mbbl(stockChange(data.gasoline)!)} bbl` : 'n/a'}` : null,
    data?.distillate ? `distillate ${stockChange(data.distillate) !== null ? `${mbbl(stockChange(data.distillate)!)} bbl` : 'n/a'}` : null,
  ].filter(Boolean).join(' · ');
  const fires = week !== null && Math.abs(week) + 1e-9 >= OIL_STOCKS_WEEK_MBBL;
  const indicator: Indicator | null = crude && fires
    ? {
        id: 'oil-inventories', domain: 'fin', name: 'US crude stocks · EIA',
        value: `${(crude.current / 1000).toFixed(1)}m bbl`, change: `${mbbl(week!)} bbl w/w`,
        rule: `crude stocks ±${OIL_STOCKS_WEEK_MBBL}m bbl in a week`,
        detail: [`${week! < 0 ? 'a draw' : 'a build'} of ${Math.abs(week!).toFixed(1)}m barrels in the ${weekTo}`, products || null].filter(Boolean).join(' · '),
        trust: { level: 'official', source: 'EIA weekly petroleum status' }, at, dataDate: weekTo,
        links: link(input, { instruments: ['CL=F', 'BZ=F'], drivers: OIL_STOCK_DRIVERS }, at),
      }
    : null;
  const feed = feedState({
    // Without the crude series (one failed EIA request publishes the others), the row is unavailable, not quiet.
    id: 'oil-inventories', name: 'US crude stocks · EIA', source: crude ? stocks : emptyOf(stocks), seeder: 'seed-eia-petroleum',
    cadenceMin: 7 * 1440, dataAt: crude ? at : null, fired: indicator, now,
  });
  const reading = crude ? `crude ${(crude.current / 1000).toFixed(1)}m bbl${week !== null ? ` ${mbbl(week)}` : ''}` : null;
  const near = week !== null && Math.abs(week) >= OIL_STOCKS_WEEK_MBBL / 2;
  return withReading(quietDetail(feed, crude
    ? `${(crude.current / 1000).toFixed(1)}m bbl, ${week !== null ? `${mbbl(week)} bbl` : 'no change read'} in the ${weekTo}${products ? ` · ${products}` : ''} · fires at ±${OIL_STOCKS_WEEK_MBBL}m bbl a week${near ? ' · near the trigger' : ''}`
    : null), reading);
}
