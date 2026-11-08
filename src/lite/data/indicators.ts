/**
 * The indicator model shared by every Lite screen (spec: Early indicators ›
 * Screen design). A feed is fired (an Indicator with its linked news), quiet,
 * stale or unavailable.
 */
import type { Domain } from './briefing';
import type { NewsLinks } from './news-link';
import type { ResourceState } from './store';

/** Evidence labels (spec: Catalogue, owner's label rule). */
export type Trust = 'official' | 'verified' | 'reported' | 'estimated' | 'market';

export const TRUST_LABEL: Readonly<Record<Trust, string>> = {
  official: 'OFFICIAL',
  verified: 'VERIFIED',
  reported: 'REPORTED',
  estimated: 'ESTIMATED',
  market: 'MARKET DATA',
};

export const TRUST_MEANING: Readonly<Record<Trust, string>> = {
  official: 'Published by a government, regulator, central bank, exchange operator or the issuer itself.',
  verified: 'An independently verified dataset.',
  reported: 'Third-party telemetry or machine-coded reports.',
  estimated: 'Derived from proxies.',
  market: 'Prices and market-derived values from a quote provider.',
};

export interface Indicator {
  id: string;
  domain: Domain;
  name: string;
  /** "4.62%", "$0.9940". */
  value: string;
  /** "+14 bp today", "−0.60% from $1". */
  change?: string;
  /** "±10 bp", "> 0.5% from $1". */
  rule: string;
  trust: { level: Trust; source: string };
  /** When the rule fired: the time of the data it read. */
  at: number;
  /** Slow feeds name the period their data covers instead of a clock time. */
  dataDate?: string;
  /** When the feed last refreshed, if it says. */
  updatedAt?: number;
  links: NewsLinks;
  /** A grounded one-line "why", labelled model inference. Not produced yet. */
  why?: string;
}

export type FeedState =
  | { kind: 'fired'; id: string; name: string; indicator: Indicator }
  | { kind: 'quiet' | 'stale' | 'unavailable' | 'loading'; id: string; name: string; detail: string };

export type FeedKind = FeedState['kind'];

/** Late means older than this many cadences. */
export const STALE_FACTOR = 2;

function agoLabel(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

export function updatedLabel(updatedAt: number | undefined, now: number): string | null {
  return updatedAt ? `updated ${agoLabel(now - updatedAt)}` : null;
}

/**
 * One feed's state. A source that failed or returned nothing is unavailable
 * (naming its seeder); one whose data is older than STALE_FACTOR × cadence is
 * stale; otherwise it is fired when its rule produced an indicator, else quiet.
 * A feed without a data timestamp never claims to be stale.
 */
export function feedState(input: {
  id: string;
  name: string;
  source: ResourceState<unknown>;
  seeder: string;
  cadenceMin: number;
  dataAt?: number | null;
  fired: Indicator | null;
  now: number;
}): FeedState {
  const { id, name, source, now } = input;
  if (source.status === 'loading') return { kind: 'loading', id, name, detail: 'Loading…' };
  if (source.status !== 'ready') {
    return { kind: 'unavailable', id, name, detail: source.status === 'error' ? `Source unavailable · ${input.seeder}` : `No data yet · ${input.seeder}` };
  }
  const age = input.dataAt ? now - input.dataAt : null;
  if (age != null && age > STALE_FACTOR * input.cadenceMin * 60_000) {
    return { kind: 'stale', id, name, detail: `Late · last update ${agoLabel(age)} (expected every ${input.cadenceMin} min)` };
  }
  if (input.fired) return { kind: 'fired', id, name, indicator: input.fired };
  const updated = age != null ? ` · ${updatedLabel(input.dataAt ?? undefined, now)}` : '';
  return { kind: 'quiet', id, name, detail: `Live · no trigger${updated}` };
}

const ORDER: Readonly<Record<FeedKind, number>> = { fired: 0, quiet: 1, stale: 2, unavailable: 3, loading: 4 };

/** Fired first (newest first), then quiet, stale and unavailable. */
export function sortFeeds(feeds: readonly FeedState[]): FeedState[] {
  return [...feeds].sort((a, b) => {
    if (ORDER[a.kind] !== ORDER[b.kind]) return ORDER[a.kind] - ORDER[b.kind];
    return a.kind === 'fired' && b.kind === 'fired' ? b.indicator.at - a.indicator.at : 0;
  });
}

export function feedCounts(feeds: readonly FeedState[]): Record<FeedKind, number> {
  const out: Record<FeedKind, number> = { fired: 0, quiet: 0, stale: 0, unavailable: 0, loading: 0 };
  for (const f of feeds) out[f.kind] += 1;
  return out;
}
