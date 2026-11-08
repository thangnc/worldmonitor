/**
 * The news link rule (spec: Early indicators › News link rule). An indicator
 * lists up to three digest stories published in its link window before it
 * fired (and up to an hour after), matched on its subject. The match is a
 * reason to read the story together with the move, never a cause.
 */
import { ENTITY_REGISTRY } from '../../../shared/entity-registry.js';
import { escapeRegExp, isCountryHeadline } from '../../../shared/country-headline-match';
import type { Domain } from './briefing';
import { namedInstruments } from './prices';
import { corroborationOf, dropNearDuplicates, publisherCount, type LiteItem } from './transforms';

const HOUR_MS = 3_600_000;

/** Hours before the trigger searched per domain (spec catalogue). */
export const LINK_WINDOW_HOURS: Readonly<Record<Domain, number>> = { geo: 24, fin: 6, tech: 12 };
/** Stories published up to this long after the trigger still count. */
export const LINK_AFTER_MS = HOUR_MS;
export const MAX_LINKED_STORIES = 3;

export interface LinkSubject {
  /** Price-board symbols the indicator is about: 'BTC', '^TNX', 'BZ=F'. */
  instruments?: readonly string[];
  /** Words that commonly drive the subject: 'Fed', 'CPI', 'depeg'. */
  drivers?: readonly string[];
  countries?: ReadonlyArray<{ name: string; code: string }>;
  /** `shared/entity-registry.js` ids. */
  entities?: readonly string[];
}

export type LinkKind = 'ticker' | 'country' | 'entity' | 'driver';

export interface LinkedStory {
  item: LiteItem;
  reason: { kind: LinkKind; label: string };
  /** publishedAt minus the trigger time: negative is before. */
  offsetMs: number;
}

export interface NewsLinks {
  stories: LinkedStory[];
  /** Stories inside the window that were searched. */
  searched: number;
  windowHours: number;
}

/** Ticker beats a named country or entity, which beats a driver word. */
const STRENGTH: Readonly<Record<LinkKind, number>> = { ticker: 3, country: 2, entity: 2, driver: 1 };

/** Drivers per instrument, a fixed list (spec: "the instrument's named drivers"). */
export const DRIVERS: Readonly<Record<string, readonly string[]>> = {
  '^TNX': ['Fed', 'FOMC', 'Treasury', 'CPI', 'PCE', 'inflation', 'payrolls', 'jobs report', 'auction', 'rate cut', 'rate hike'],
  DXY: ['Fed', 'FOMC', 'dollar', 'CPI', 'payrolls', 'tariff'],
  BTC: ['bitcoin', 'crypto', 'ETF', 'SEC', 'liquidation', 'liquidations', 'stablecoin', 'Fed'],
  ETH: ['ethereum', 'crypto', 'ETF', 'SEC', 'staking'],
  'BZ=F': ['OPEC', 'crude', 'oil', 'refinery', 'pipeline', 'tanker', 'Hormuz', 'Red Sea'],
  'GC=F': ['gold', 'Fed', 'safe haven', 'central bank'],
};

function wordPattern(word: string): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(word)}($|[^\\p{L}\\p{N}])`, 'iu');
}

const entityPatterns = new Map<string, Array<{ name: string; pattern: RegExp }>>();
function entityAliases(id: string): Array<{ name: string; pattern: RegExp }> {
  let cached = entityPatterns.get(id);
  if (!cached) {
    const entry = ENTITY_REGISTRY.find((e) => e.id === id);
    cached = entry ? [entry.name, ...entry.aliases].filter((a) => a.length >= 3).map((a) => ({ name: entry.name, pattern: wordPattern(a) })) : [];
    entityPatterns.set(id, cached);
  }
  return cached;
}

/** The strongest reason a story matches the subject, or null. */
export function matchReason(subject: LinkSubject, item: Pick<LiteItem, 'title' | 'snippet' | 'tickers'>): LinkedStory['reason'] | null {
  const title = item.title;
  const text = `${title} ${item.snippet ?? ''}`;
  if (subject.instruments?.length) {
    const wanted = new Set(subject.instruments.map((s) => s.toUpperCase()));
    const hit = namedInstruments(item).find((inst) => wanted.has(inst.symbol.toUpperCase()));
    if (hit) return { kind: 'ticker', label: `ticker: ${hit.label}` };
  }
  for (const c of subject.countries ?? []) {
    if (isCountryHeadline(title, c.name, c.code)) return { kind: 'country', label: `country: ${c.name}` };
  }
  for (const id of subject.entities ?? []) {
    const hit = entityAliases(id).find((a) => a.pattern.test(text));
    if (hit) return { kind: 'entity', label: `entity: ${hit.name}` };
  }
  for (const word of subject.drivers ?? []) {
    if (wordPattern(word).test(text)) return { kind: 'driver', label: `driver: ${word}` };
  }
  return null;
}

/**
 * Stories around a trigger at `at`: published in [at − windowHours, at + 1 h],
 * matched on the subject, ranked by match strength, then closeness in time,
 * then publisher count. Near-duplicate titles count once.
 */
export function linkNews(subject: LinkSubject, items: readonly LiteItem[], at: number, windowHours: number): NewsLinks {
  const from = at - windowHours * HOUR_MS;
  const to = at + LINK_AFTER_MS;
  const inWindow = items.filter((i) => i.publishedAt >= from && i.publishedAt <= to);
  const matched: LinkedStory[] = [];
  for (const item of inWindow) {
    const reason = matchReason(subject, item);
    if (reason) matched.push({ item, reason, offsetMs: item.publishedAt - at });
  }
  matched.sort(
    (a, b) =>
      STRENGTH[b.reason.kind] - STRENGTH[a.reason.kind] ||
      Math.abs(a.offsetMs) - Math.abs(b.offsetMs) ||
      (publisherCount(corroborationOf(b.item)) ?? 0) - (publisherCount(corroborationOf(a.item)) ?? 0),
  );
  const unique = dropNearDuplicates(matched.map((m) => ({ ...m, title: m.item.title })));
  return {
    stories: unique.slice(0, MAX_LINKED_STORIES).map(({ item, reason, offsetMs }) => ({ item, reason, offsetMs })),
    searched: dropNearDuplicates(inWindow).length,
    windowHours,
  };
}

/** "−1h", "+20m", "−3h", "now". */
export function offsetLabel(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60_000);
  if (minutes < 1) return 'now';
  const sign = ms < 0 ? '−' : '+';
  return minutes < 60 ? `${sign}${minutes}m` : `${sign}${Math.round(minutes / 60)}h`;
}
