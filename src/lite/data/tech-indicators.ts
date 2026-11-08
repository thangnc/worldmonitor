/**
 * Technology & AI indicator feeds (spec: Early indicators › Catalogue ›
 * Technology and AI): internet outages, cloud and AI service outages, newly
 * exploited vulnerabilities and attack-infrastructure spikes. Each fired feed
 * links to tech digest stories through the shared news link rule.
 */
import type { InternetOutage, ListInternetOutagesResponse, ListServiceStatusesResponse, ServiceStatus } from '@/generated/client/worldmonitor/infrastructure/v1/service_client';
import { resolveCountryCode } from '../../../shared/country-code-resolve';
import { feedState, sortFeeds, type FeedState, type Indicator } from './indicators';
import { LINK_WINDOW_HOURS, linkNews, type LinkSubject } from './news-link';
import type { ResourceState } from './store';
import type { LiteItem } from './transforms';

// ---- Payloads (on-demand bootstrap keys, no RPC) ----------------------------

/** One run's or one UTC day's counts (`cyber:threats:history:v1`, seed-cyber-threats). */
export interface ThreatCounts {
  total: number;
  /** Raw feed names: feodo, urlhaus, c2intel, otx, abuseipdb. */
  bySource: Record<string, number>;
  /** Top malware families, from Feodo, URLhaus and C2Intel only. */
  byFamily: Record<string, number>;
}

export interface ThreatHistory {
  updatedAt: number;
  latest: ThreatCounts & { at: number };
  /** Oldest first; a day keeps its largest run. */
  days: Array<ThreatCounts & { date: string }>;
}

/** One CVE CISA added to KEV (`cyber:kev-recent:v1`, seed-cve-reference). */
export interface ExploitedVulnerability {
  id: string;
  /** YYYY-MM-DD. */
  addedAt: string;
  dueAt: string;
  name: string;
  /** First NVD "vendor:product", empty until NVD analyses the CVE. */
  vendorProduct: string;
  cvssScore: number;
  cvssSeverity: string;
  description: string;
}

export interface RecentKev {
  fetchedAt: number;
  /** Days the list covers. */
  days: number;
  attribution: string;
  /** Newest first. */
  items: ExploitedVulnerability[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function countMap(v: unknown): Record<string, number> {
  return isRecord(v) ? Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => isCount(e[1]))) : {};
}

/** The history payload, or null when it is not one (a miss or a malformed value). */
export function decodeThreatHistory(value: unknown): ThreatHistory | null {
  if (!isRecord(value) || !Number.isFinite(value.updatedAt) || !isRecord(value.latest) || !Array.isArray(value.days)) return null;
  const { latest } = value;
  if (!Number.isFinite(latest.at) || !isCount(latest.total)) return null;
  const days: ThreatHistory['days'] = [];
  for (const d of value.days) {
    if (isRecord(d) && typeof d.date === 'string' && DATE_RE.test(d.date) && isCount(d.total)) {
      days.push({ date: d.date, total: d.total, bySource: countMap(d.bySource), byFamily: countMap(d.byFamily) });
    }
  }
  return {
    updatedAt: value.updatedAt as number,
    latest: { at: latest.at as number, total: latest.total, bySource: countMap(latest.bySource), byFamily: countMap(latest.byFamily) },
    days: days.sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/** The recent-KEV payload, or null when it is not one. An empty list is valid. */
export function decodeRecentKev(value: unknown): RecentKev | null {
  if (!isRecord(value) || !Number.isFinite(value.fetchedAt) || !Array.isArray(value.items)) return null;
  const items: ExploitedVulnerability[] = [];
  for (const i of value.items) {
    if (!isRecord(i) || !/^CVE-\d{4}-\d{4,}$/.test(str(i.id)) || !DATE_RE.test(str(i.addedAt))) continue;
    items.push({
      id: str(i.id), addedAt: str(i.addedAt), dueAt: str(i.dueAt), name: str(i.name), vendorProduct: str(i.vendorProduct),
      cvssScore: typeof i.cvssScore === 'number' && Number.isFinite(i.cvssScore) ? i.cvssScore : 0,
      cvssSeverity: str(i.cvssSeverity), description: str(i.description),
    });
  }
  items.sort((a, b) => b.addedAt.localeCompare(a.addedAt) || b.id.localeCompare(a.id));
  return { fetchedAt: value.fetchedAt as number, days: isCount(value.days) ? value.days : 30, attribution: str(value.attribution), items };
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** An outage fires while ongoing, or for this long after it was detected. */
export const OUTAGE_RECENT_HOURS = 24;
/** A KEV addition fires for this many days, which covers a weekend. */
export const KEV_NEW_DAYS = 3;
/** Attack infrastructure fires at this multiple of its 7-day average. */
export const SPIKE_RATIO = 2;
/** Days averaged for the attack-infrastructure baseline, and the fewest needed. */
export const SPIKE_BASELINE_DAYS = 7;
export const SPIKE_MIN_BASELINE_DAYS = 3;

/** Providers whose partial or major outage fires (cloud and AI). */
export const WATCHED_PROVIDERS: Readonly<Record<string, readonly string[]>> = {
  aws: ['AWS', 'Amazon Web Services'],
  azure: ['Azure', 'Microsoft Azure'],
  gcp: ['Google Cloud', 'GCP'],
  cloudflare: ['Cloudflare'],
  github: ['GitHub'],
  vercel: ['Vercel'],
  openai: ['OpenAI', 'ChatGPT'],
  anthropic: ['Anthropic', 'Claude'],
  replicate: ['Replicate'],
};

export const TECH_RULES =
  `An internet outage ongoing or detected in the last ${OUTAGE_RECENT_HOURS} h; ` +
  'a watched cloud or AI provider reporting a partial or major outage; ' +
  `a CVE added to CISA KEV in the last ${KEV_NEW_DAYS} days; ` +
  `attack-infrastructure indicators at ${SPIKE_RATIO}× their ${SPIKE_BASELINE_DAYS}-day average or more. ` +
  'Linked news: tech digest stories from 12 h before to 1 h after (date-only feeds: from 12 h before the day).';

/** Feed labels for the threat counts (seed-cyber-threats raw source names). */
export const THREAT_FEED_LABEL: Readonly<Record<string, string>> = {
  feodo: 'Feodo',
  urlhaus: 'URLhaus',
  otx: 'OTX',
  abuseipdb: 'AbuseIPDB',
  c2intel: 'C2Intel',
};

const OUTAGE_SCOPE: Readonly<Record<string, string>> = {
  OUTAGE_SEVERITY_TOTAL: 'Nationwide',
  OUTAGE_SEVERITY_MAJOR: 'Regional',
  OUTAGE_SEVERITY_PARTIAL: 'Network',
};

const SERVICE_LEVEL: Readonly<Record<string, string>> = {
  SERVICE_OPERATIONAL_STATUS_PARTIAL_OUTAGE: 'Partial',
  SERVICE_OPERATIONAL_STATUS_MAJOR_OUTAGE: 'Major',
};

function hhmm(ts: number): string {
  return new Date(ts).toISOString().slice(11, 16);
}

/** "6 Nov". */
export function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function quietDetail(feed: FeedState, detail: string | null): FeedState {
  return feed.kind === 'quiet' && detail ? { ...feed, detail } : feed;
}

// ---- Internet outages --------------------------------------------------------

export function isOutageLive(o: InternetOutage, now: number): boolean {
  return !o.endedAt || o.detectedAt >= now - OUTAGE_RECENT_HOURS * HOUR_MS;
}

/** ASN or network names Cloudflare lists after the cause and type. */
function outageNetworks(o: InternetOutage): string[] {
  return o.categories.slice(3).filter((c) => c && c !== o.cause && c !== o.outageType);
}

export function outageSubject(o: InternetOutage): LinkSubject {
  const code = resolveCountryCode(o.country);
  return {
    countries: code ? [{ name: o.country, code }] : [],
    drivers: [...outageNetworks(o), ...(code ? [] : [o.country])].filter((d) => d.length >= 3),
  };
}

function outageFeed(state: ResourceState<ListInternetOutagesResponse>, news: readonly LiteItem[], now: number): FeedState {
  const data = state.status === 'ready' ? state.data : null;
  const fetchedAt = data?.fetchedAt || null;
  const live = data ? data.outages.filter((o) => isOutageLive(o, now)).sort((a, b) => b.detectedAt - a.detectedAt) : [];
  const newest = live[0];
  let fired: Indicator | null = null;
  if (newest) {
    const scope = OUTAGE_SCOPE[newest.severity] ?? 'Outage';
    const networks = outageNetworks(newest);
    const cause = newest.cause ? newest.cause.replace(/_/g, ' ').toLowerCase() : '';
    const facts = [
      networks.length ? networks.join(', ') : 'no network named',
      cause ? `stated cause: ${cause}` : 'no stated cause',
      `started ${hhmm(newest.detectedAt)} UTC`,
      newest.endedAt ? `ended ${hhmm(newest.endedAt)} UTC` : 'ongoing',
      live.length > 1 ? `+${live.length - 1} more` : null,
    ].filter(Boolean);
    fired = {
      id: 'internet-outage', domain: 'tech', name: `Internet outage · ${newest.country || 'unknown country'}`,
      value: scope, change: cause || undefined, rule: 'new outage',
      detail: facts.join(' · '),
      trust: { level: 'reported', source: 'Cloudflare Radar' }, at: newest.detectedAt, updatedAt: fetchedAt ?? undefined,
      links: linkNews(outageSubject(newest), news, newest.detectedAt, LINK_WINDOW_HOURS.tech),
    };
  }
  const feed = feedState({ id: 'internet-outage', name: 'Internet outages', source: state, seeder: 'seed-internet-outages', cadenceMin: 30, dataAt: fetchedAt, fired, now });
  return quietDetail(feed, data ? `No outage in the last ${OUTAGE_RECENT_HOURS} h · ${data.outages.length} in the 28-day list` : null);
}

// ---- Cloud and AI service outages -------------------------------------------

export function isWatchedOutage(s: ServiceStatus): boolean {
  return s.id in WATCHED_PROVIDERS && s.status in SERVICE_LEVEL;
}

function serviceFeed(state: ResourceState<ListServiceStatusesResponse>, news: readonly LiteItem[], now: number): FeedState {
  const statuses = state.status === 'ready' ? state.data.statuses : [];
  const watched = statuses.filter((s) => s.id in WATCHED_PROVIDERS);
  const checkedAt = watched.reduce((max, s) => Math.max(max, s.checkedAt || 0), 0) || null;
  const out = watched.filter(isWatchedOutage).sort((a, b) =>
    (b.status === 'SERVICE_OPERATIONAL_STATUS_MAJOR_OUTAGE' ? 1 : 0) - (a.status === 'SERVICE_OPERATIONAL_STATUS_MAJOR_OUTAGE' ? 1 : 0));
  const top = out[0];
  let fired: Indicator | null = null;
  if (top) {
    const at = top.checkedAt || now;
    const others = out.slice(1).map((s) => `${s.name} ${SERVICE_LEVEL[s.status]?.toLowerCase()}`);
    fired = {
      id: 'service-outage', domain: 'tech', name: `Service outage · ${top.name}`,
      value: SERVICE_LEVEL[top.status] ?? 'Outage', change: 'outage', rule: 'partial or major',
      detail: [top.description || 'No incident text on the status page', ...(others.length ? [`also: ${others.join(', ')}`] : [])].join(' · '),
      trust: { level: 'official', source: `${top.name} status page` }, at, updatedAt: checkedAt ?? undefined,
      links: linkNews({ drivers: out.flatMap((s) => WATCHED_PROVIDERS[s.id] ?? [s.name]) }, news, at, LINK_WINDOW_HOURS.tech),
    };
  }
  const degraded = watched.filter((s) => s.status === 'SERVICE_OPERATIONAL_STATUS_DEGRADED');
  const feed = feedState({ id: 'service-outage', name: 'Cloud and AI services', source: state, seeder: 'provider status pages (list-service-statuses)', cadenceMin: 15, dataAt: checkedAt, fired, now });
  return quietDetail(feed, watched.length
    ? `${watched.length} providers watched · ${degraded.length ? `degraded: ${degraded.map((s) => s.name).join(', ')}` : 'none degraded'}`
    : null);
}

// ---- Exploited vulnerabilities ----------------------------------------------

/** Whole UTC days from the KEV date to now. */
function daysSince(date: string, now: number): number {
  return Math.floor((Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY_MS);
}

export function isNewKev(item: ExploitedVulnerability, now: number): boolean {
  const d = daysSince(item.addedAt, now);
  return d >= 0 && d < KEV_NEW_DAYS;
}

/** Words of CISA's name that are not the vulnerability type ("SonicWall SonicOS SSLVPN Use of …" → SonicWall, SonicOS). */
const KEV_NAME_STOP = /^(use|improper|missing|incorrect|unrestricted|path|server-side|cross-site|deserialization|command|code|os|sql|authentication|out-of-bounds|heap-based|stack-based|buffer|integer|race|privilege|remote|arbitrary|insecure|hard-coded|exposure|information|unspecified|multiple)$/i;

export function kevSubject(item: ExploitedVulnerability): LinkSubject {
  const [vendor = '', product = ''] = item.vendorProduct.split(':');
  const fromCpe = [vendor, product].map((w) => w.replace(/_/g, ' ').trim());
  const nameWords: string[] = [];
  for (const word of item.name.split(/\s+/)) {
    if (KEV_NAME_STOP.test(word) || nameWords.length >= 2) break;
    nameWords.push(word);
  }
  const words = [...new Set([...fromCpe, ...nameWords].filter((w) => w.length >= 4).map((w) => w.toLowerCase()))];
  return { drivers: [item.id, ...words] };
}

/** Exploited CVEs added this week (last 7 days) and the week before. */
export function kevWeekCounts(items: readonly ExploitedVulnerability[], now: number): { thisWeek: number; lastWeek: number } {
  let thisWeek = 0;
  let lastWeek = 0;
  for (const item of items) {
    const d = daysSince(item.addedAt, now);
    if (d >= 0 && d < 7) thisWeek += 1;
    else if (d >= 7 && d < 14) lastWeek += 1;
  }
  return { thisWeek, lastWeek };
}

function kevFeed(state: ResourceState<RecentKev>, news: readonly LiteItem[], now: number): FeedState {
  const data = state.status === 'ready' ? state.data : null;
  const fresh = data ? data.items.filter((i) => isNewKev(i, now)) : [];
  const newest = fresh[0];
  let fired: Indicator | null = null;
  if (newest) {
    // A date-only feed: the link window ends with the added day and starts 12 h before it.
    const dayStart = Date.parse(`${newest.addedAt}T00:00:00Z`);
    const at = Math.min(now, dayStart + DAY_MS);
    const score = newest.cvssScore > 0 ? `${newest.cvssScore.toFixed(1)} CVSS` : 'no CVSS';
    fired = {
      id: 'kev-new', domain: 'tech', name: `Exploited vulnerability · ${newest.id}`,
      value: score, change: newest.cvssSeverity ? newest.cvssSeverity.toLowerCase() : undefined, rule: 'KEV add',
      detail: [
        newest.name || newest.vendorProduct || newest.description.slice(0, 120),
        `added ${dayLabel(newest.addedAt)}`,
        newest.dueAt ? `due ${dayLabel(newest.dueAt)}` : null,
        fresh.length > 1 ? `+${fresh.length - 1} more this week` : null,
      ].filter(Boolean).join(' · '),
      trust: { level: 'official', source: 'CISA KEV catalog' }, at, dataDate: `added ${dayLabel(newest.addedAt)}`,
      updatedAt: data?.fetchedAt || undefined,
      links: linkNews(kevSubject(newest), news, at, LINK_WINDOW_HOURS.tech + 24),
    };
  }
  const feed = feedState({ id: 'kev-new', name: 'Exploited vulnerabilities', source: state, seeder: 'seed-cve-reference', cadenceMin: 1440, dataAt: data?.fetchedAt || null, fired, now });
  const latest = data?.items[0];
  return quietDetail(feed, data ? (latest ? `No KEV addition in ${KEV_NEW_DAYS} days · latest ${latest.id}, ${dayLabel(latest.addedAt)}` : `No KEV addition in ${data.days} days`) : null);
}

// ---- Attack infrastructure ---------------------------------------------------

export interface ThreatBaseline {
  latest: number;
  /** Average of the previous complete days, or null while the baseline builds. */
  average: number | null;
  ratio: number | null;
  /** Previous days the average used. */
  days: number;
}

/** The latest run against the average of up to 7 complete days before today. */
export function threatBaseline(history: ThreatHistory): ThreatBaseline {
  const latest = history.latest.total;
  const today = new Date(history.latest.at).toISOString().slice(0, 10);
  const prior = history.days.filter((d) => d.date < today).slice(-SPIKE_BASELINE_DAYS);
  if (prior.length < SPIKE_MIN_BASELINE_DAYS) return { latest, average: null, ratio: null, days: prior.length };
  const average = prior.reduce((sum, d) => sum + d.total, 0) / prior.length;
  return { latest, average, ratio: average > 0 ? latest / average : null, days: prior.length };
}

function topFamilies(byFamily: Record<string, number>, total: number, n = 3): string {
  return Object.entries(byFamily)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => `${name} ${total > 0 ? Math.round((count / total) * 100) : 0}%`)
    .join(', ');
}

function spikeFeed(state: ResourceState<ThreatHistory>, news: readonly LiteItem[], now: number): FeedState {
  const data = state.status === 'ready' ? state.data : null;
  const base = data ? threatBaseline(data) : null;
  const at = data?.latest.at ?? null;
  let fired: Indicator | null = null;
  if (data && base?.ratio != null && base.ratio >= SPIKE_RATIO) {
    const { bySource, byFamily, total } = data.latest;
    const feeds = Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${THREAT_FEED_LABEL[s] ?? s} ${n.toLocaleString('en-US')}`);
    const families = topFamilies(byFamily, Object.values(byFamily).reduce((a, b) => a + b, 0));
    fired = {
      id: 'attack-spike', domain: 'tech', name: 'Attack infrastructure spike',
      value: `${total.toLocaleString('en-US')} indicators`, change: `×${base.ratio.toFixed(1)} vs 7d`, rule: `×${SPIKE_RATIO}`,
      detail: [feeds.join(' · '), families ? `top families: ${families}` : null].filter(Boolean).join(' — '),
      trust: { level: 'reported', source: `${Object.keys(bySource).length} threat feeds` }, at: at ?? now, updatedAt: at ?? undefined,
      links: linkNews({ drivers: ['botnet', ...Object.keys(byFamily).slice(0, 5)] }, news, at ?? now, LINK_WINDOW_HOURS.tech),
    };
  }
  const feed = feedState({ id: 'attack-spike', name: 'Attack infrastructure', source: state, seeder: 'seed-cyber-threats', cadenceMin: 120, dataAt: at, fired, now });
  if (!base) return feed;
  return quietDetail(feed, base.average == null
    ? `${base.latest.toLocaleString('en-US')} indicators · building baseline (${base.days} of ${SPIKE_BASELINE_DAYS} days)`
    : `${base.latest.toLocaleString('en-US')} indicators · ×${(base.ratio ?? 0).toFixed(1)} vs ${Math.round(base.average).toLocaleString('en-US')} avg · fires at ×${SPIKE_RATIO}`);
}

export function techFeeds(input: {
  outages: ResourceState<ListInternetOutagesResponse>;
  services: ResourceState<ListServiceStatusesResponse>;
  kev: ResourceState<RecentKev>;
  history: ResourceState<ThreatHistory>;
  news: readonly LiteItem[];
  now: number;
}): FeedState[] {
  const { news, now } = input;
  return sortFeeds([
    outageFeed(input.outages, news, now),
    serviceFeed(input.services, news, now),
    kevFeed(input.kev, news, now),
    spikeFeed(input.history, news, now),
  ]);
}
