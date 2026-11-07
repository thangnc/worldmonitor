/**
 * Pure rules behind the cross-domain Briefing (`/lite`). No DOM, no fetch:
 * tests/lite-ui.test.mts covers them.
 *
 * Every rule here is a stated heuristic. The UI tags what it computes as
 * DERIVED and says how in a tooltip (docs/engineering/architecture/lite.md, "Lite UI").
 */
import type { NewsItem } from '@/generated/client/worldmonitor/news/v1/service_client';
import { GEO_CATEGORIES, MARKET_CATEGORIES, TECH_CATEGORIES, isPrimarySource, sourceCount, type LiteItem, type Tone } from './transforms';

export type Domain = 'geo' | 'fin' | 'tech';

export const DOMAIN_LABEL: Record<Domain, string> = { geo: 'GEO', fin: 'FIN', tech: 'AI' };

/** Which domain a digest or insights category belongs to. Unknown buckets read as geopolitics. */
export function domainOfCategory(category: string): Domain {
  if ((MARKET_CATEGORIES as readonly string[]).includes(category) || category === 'finance' || category === 'energy') return 'fin';
  if ((TECH_CATEGORIES as readonly string[]).includes(category) || category === 'tech' || category === 'science') return 'tech';
  if ((GEO_CATEGORIES as readonly string[]).includes(category)) return 'geo';
  return 'geo';
}

export interface PriorityEvent extends LiteItem {
  domain: Domain;
  /** importanceScore × credibilityScore / 100, rounded. */
  priority: number;
}

/** Events below this importance score are counted, not listed. */
export const PRIORITY_THRESHOLD = 50;

/** The ranking key: impact (importance) weighted by source confidence (credibility). */
export function priorityScore(item: Pick<NewsItem, 'importanceScore' | 'credibilityScore'>): number {
  const impact = item.importanceScore || 0;
  const confidence = item.credibilityScore || 0;
  return Math.round((impact * confidence) / 100);
}

/**
 * Merges each domain's event list, drops repeated titles (the first domain
 * wins), and splits at PRIORITY_THRESHOLD. `ranked` is sorted by
 * impact × confidence, then impact, then recency.
 */
export function rankPriorityEvents(groups: ReadonlyArray<{ domain: Domain; items: readonly LiteItem[] }>): {
  ranked: PriorityEvent[];
  below: PriorityEvent[];
} {
  const seen = new Set<string>();
  const all: PriorityEvent[] = [];
  for (const { domain, items } of groups) {
    for (const item of items) {
      const key = item.title.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      all.push({ ...item, domain, priority: priorityScore(item) });
    }
  }
  const order = (a: PriorityEvent, b: PriorityEvent) =>
    b.priority - a.priority || (b.importanceScore || 0) - (a.importanceScore || 0) || (b.publishedAt || 0) - (a.publishedAt || 0);
  return {
    ranked: all.filter((e) => (e.importanceScore || 0) >= PRIORITY_THRESHOLD).sort(order),
    below: all.filter((e) => (e.importanceScore || 0) < PRIORITY_THRESHOLD),
  };
}

/** When the story was first seen, falling back to publication time. */
export function firstSeen(item: NewsItem): number {
  return item.storyMeta?.firstSeen || item.publishedAt || 0;
}

/** Story phase as momentum: breaking and developing rise, sustained holds, fading falls. */
export function momentum(phase: string | undefined): { label: 'rising' | 'steady' | 'fading'; tone: Tone } {
  switch (phase) {
    case 'STORY_PHASE_BREAKING':
    case 'STORY_PHASE_DEVELOPING':
      return { label: 'rising', tone: 'high' };
    case 'STORY_PHASE_FADING':
      return { label: 'fading', tone: 'dim' };
    default:
      return { label: 'steady', tone: 'muted' };
  }
}

/** "7 sources · 1 primary": the cluster size, and whether the lead outlet is tier 1. */
export function evidenceLine(item: NewsItem): string {
  const count = sourceCount(item);
  const primary = isPrimarySource(item.source);
  return `${count} source${count === 1 ? '' : 's'}${primary ? ' · primary' : count === 1 ? ' · single' : ''}`;
}

/** Day-over-day change as an escalation word. ±10% is the stable band. */
export function trendLabel(change: number | null | undefined): { label: string; tone: Tone } | null {
  if (change == null || !Number.isFinite(change)) return null;
  if (change >= 10) return { label: 'escalating', tone: 'high' };
  if (change <= -10) return { label: 'de-escalating', tone: 'muted' };
  return { label: 'stable', tone: 'muted' };
}

export interface RegimeMoves {
  /** 24h percent changes. */
  btc?: number | null;
  oil?: number | null;
  usd?: number | null;
  spx?: number | null;
  gold?: number | null;
}

/**
 * A risk-on / risk-off read from five 24h moves. Risk-off signals: oil up
 * more than 1%, BTC down more than 2%, the dollar up more than 0.2%, the S&P
 * down more than 0.5%, gold up more than 0.5%. Risk-on is the mirror image
 * (oil excluded). A tilt needs a lead of two signals.
 */
export function marketRegime(moves: RegimeMoves): { label: string; why: string; tone: Tone } | null {
  const known = Object.values(moves).filter((v) => v != null && Number.isFinite(v)).length;
  if (known < 3) return null;
  const v = (x: number | null | undefined) => (x != null && Number.isFinite(x) ? x : 0);
  const off = [v(moves.oil) > 1, v(moves.btc) < -2, v(moves.usd) > 0.2, v(moves.spx) < -0.5, v(moves.gold) > 0.5].filter(Boolean).length;
  const on = [v(moves.btc) > 2, v(moves.usd) < -0.2, v(moves.spx) > 0.5, v(moves.gold) < -0.5].filter(Boolean).length;
  const arrow = (x: number | null | undefined, band: number) => (x == null || !Number.isFinite(x) || Math.abs(x) < band ? null : x > 0 ? '↑' : '↓');
  const why = [
    ['oil', arrow(moves.oil, 1)],
    ['crypto', arrow(moves.btc, 2)],
    ['USD', arrow(moves.usd, 0.2)],
    ['S&P', arrow(moves.spx, 0.5)],
    ['gold', arrow(moves.gold, 0.5)],
  ]
    .filter(([, a]) => a)
    .map(([name, a]) => `${name} ${a}`)
    .join(', ');
  if (off - on >= 2) return { label: 'Risk-off tilt', why: why || 'broad', tone: 'crit' };
  if (on - off >= 2) return { label: 'Risk-on tilt', why: why || 'broad', tone: 'ok' };
  return { label: 'No clear tilt', why: why || 'moves within normal bands', tone: 'muted' };
}

/**
 * The last `hours` move of an hourly close series against the series' own
 * hourly volatility scaled to that window. Returns null below 12 closes.
 */
export function sigmaMove(closes: readonly number[], hours = 2): { movePct: number; z: number } | null {
  const xs = closes.filter((v) => Number.isFinite(v) && v > 0);
  if (xs.length < 12 || xs.length <= hours) return null;
  const returns: number[] = [];
  for (let i = 1; i < xs.length - hours; i++) returns.push(Math.log((xs[i] ?? 1) / (xs[i - 1] ?? 1)));
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const sd = Math.sqrt(returns.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, returns.length - 1));
  const last = xs[xs.length - 1] ?? 0;
  const base = xs[xs.length - 1 - hours] ?? last;
  const move = Math.log(last / base);
  const window = sd * Math.sqrt(hours);
  return { movePct: (Math.exp(move) - 1) * 100, z: window > 0 ? move / window : 0 };
}

export interface WatchAlert {
  id: string;
  title: string;
  rule: string;
  at: number;
  domain: Domain;
}

/** Thresholds for the Briefing's built-in watch rules. */
export const WATCH_RULES = {
  impact: { minImpact: 80, minCredibility: 45, rule: 'Rule: impact ≥ 80 & confidence ≥ medium' },
  btcVol: { z: 4, rule: 'Rule: 2h move > 4σ' },
  aiPrimary: { rule: 'Rule: primary-source AI policy item' },
} as const;

/**
 * Evaluates the built-in watch rules over the last 24 hours. These stand in
 * for user watchlists until the alerts phase; they never deliver anything.
 */
export function evaluateWatchRules(input: {
  events: readonly PriorityEvent[];
  btcCloses: readonly number[];
  techItems: readonly LiteItem[];
  now: number;
}): WatchAlert[] {
  const dayAgo = input.now - 86_400_000;
  const out: WatchAlert[] = [];
  for (const e of input.events) {
    if ((e.importanceScore || 0) >= WATCH_RULES.impact.minImpact && (e.credibilityScore || 0) >= WATCH_RULES.impact.minCredibility && firstSeen(e) >= dayAgo) {
      out.push({ id: `impact:${e.title}`, title: e.title, rule: WATCH_RULES.impact.rule, at: firstSeen(e), domain: e.domain });
    }
  }
  const btc = sigmaMove(input.btcCloses, 2);
  if (btc && Math.abs(btc.z) > WATCH_RULES.btcVol.z) {
    out.push({ id: 'btc-vol', title: `BTC ${btc.movePct >= 0 ? '+' : '−'}${Math.abs(btc.movePct).toFixed(1)}% in 2h`, rule: WATCH_RULES.btcVol.rule, at: input.now, domain: 'fin' });
  }
  for (const item of input.techItems) {
    if (item.category === 'policy' && isPrimarySource(item.source) && firstSeen(item) >= dayAgo) {
      out.push({ id: `ai:${item.title}`, title: item.title, rule: WATCH_RULES.aiPrimary.rule, at: firstSeen(item), domain: 'tech' });
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Counts behind the brief's "since" box. */
export function sinceStats(events: readonly PriorityEvent[], since: number): { fresh: number; breaking: number; fading: number } {
  return {
    fresh: events.filter((e) => firstSeen(e) >= since).length,
    breaking: events.filter((e) => e.storyMeta?.phase === 'STORY_PHASE_BREAKING').length,
    fading: events.filter((e) => e.storyMeta?.phase === 'STORY_PHASE_FADING').length,
  };
}
