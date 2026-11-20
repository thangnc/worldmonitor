/**
 * Technology & AI indicator feeds (spec: Early indicators › Catalogue ›
 * Technology and AI): internet outages, cloud and AI service outages, newly
 * exploited vulnerabilities and attack-infrastructure spikes. Each fired feed
 * links to tech digest stories through the shared news link rule.
 */
import type { InternetOutage, ListInternetOutagesResponse, ListServiceStatusesResponse, ServiceStatus } from '@wm/contracts/generated/client/worldmonitor/infrastructure/v1/service_client';
import { resolveCountryCode } from '@wm/shared/country-code-resolve';
import { STARTER_VENDOR_WATCHLIST, type WatchedVendor } from '@wm/client/config/vendor-watchlist';
import type { ListMaterialEventsResponse } from '@wm/contracts/generated/client/worldmonitor/intelligence/v1/service_client';
import { FILING_WINDOW_HOURS, filerName, watchCompany } from './finance-macro-indicators';
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
  /** CISA KEV's own vendorProject and product, set from the day the CVE is added (#119); empty when the catalog was unavailable. */
  vendor: string;
  product: string;
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
      vendor: str(i.vendor), product: str(i.product),
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
/** The 8-K item for a material cybersecurity incident (also a key item on Finance's 8-K rule; #120). */
export const CYBER_8K_ITEM = '1.05';
/** Attack infrastructure fires at this multiple of its 7-day average. */
export const SPIKE_RATIO = 2;
/** Days averaged for the attack-infrastructure baseline, and the fewest needed. */
export const SPIKE_BASELINE_DAYS = 7;
export const SPIKE_MIN_BASELINE_DAYS = 3;

/** An AI model counts as new for this many days after OpenRouter listed it (weekly tier; #126). */
export const AI_NEW_DAYS = 7;
/** A price change of this many percent or more, in or out, fires (the seeder's PRICE_CHANGE_PCT). */
export const AI_PRICE_PCT = 20;
/** seed-ai-models runs every 6 h. */
export const AI_MODELS_CADENCE_MIN = 360;
/** An open-weight release fires when first seen this recently (#132). */
export const OPEN_MODEL_NEW_DAYS = 7;
/** It must also pass one of these on the Hugging Face Hub. */
export const OPEN_MODEL_MIN_LIKES = 100;
export const OPEN_MODEL_MIN_DOWNLOADS = 10_000;
/** An AI or data rule counts as new for this many days after publication (weekly tier; #127). */
export const AI_REG_NEW_DAYS = 7;
/** seed-ai-regulation runs every 2 h. */
export const AI_REG_CADENCE_MIN = 120;
/** A breach fires when HIBP listed it this recently (#131). */
export const BREACH_NEW_DAYS = 3;
/** Accounts at which a newly listed breach fires whoever it hit. */
export const BREACH_MIN_ACCOUNTS = 1_000_000;
/** seed-breaches runs every 3 h. */
export const BREACHES_CADENCE_MIN = 180;
const BREACH_MAX_CARDS = 6;

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
  `a CVE added to CISA KEV in the last ${KEV_NEW_DAYS} days, a vendor on the starter watchlist ranked first; ` +
  `attack-infrastructure indicators at ${SPIKE_RATIO}× their ${SPIKE_BASELINE_DAYS}-day average or more; ` +
  `an 8-K reporting item ${CYBER_8K_ITEM} (material cybersecurity incident) in the last ${FILING_WINDOW_HOURS} h; ` +
  `a model from a watched AI lab (OpenAI, Anthropic, Google, Meta, Mistral, xAI, DeepSeek, Qwen) listed on OpenRouter in the last ${AI_NEW_DAYS} days, or a price change of ${AI_PRICE_PCT}% or more on one; ` +
  `open weights from Meta, Mistral, Qwen, DeepSeek or Google first seen on Hugging Face in the last ${OPEN_MODEL_NEW_DAYS} days with ${OPEN_MODEL_MIN_LIKES}+ likes or ${OPEN_MODEL_MIN_DOWNLOADS.toLocaleString('en-US')}+ downloads; ` +
  `an EU act, implementing act or guidelines on AI or data, or a US final or proposed rule on AI, published in the last ${AI_REG_NEW_DAYS} days; ` +
  `a breach listed by Have I Been Pwned in the last ${BREACH_NEW_DAYS} days with ${BREACH_MIN_ACCOUNTS.toLocaleString('en-US')} or more accounts, or at a domain of a vendor on the starter list. ` +
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
      trust: { level: 'reported', source: 'Cloudflare Radar' }, at: newest.detectedAt, updatedAt: fetchedAt ?? undefined, focusId: `outage:${newest.id}`,
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
      trust: { level: 'official', source: `${top.name} status page` }, at, updatedAt: checkedAt ?? undefined, focusId: `provider:${top.id}`,
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

/**
 * The watchlist vendor a KEV addition names: KEV's own vendor first, else
 * NVD's CPE vendor ("palo_alto_networks"). Null when it names none.
 */
export function watchedVendor(item: Pick<ExploitedVulnerability, 'vendor' | 'vendorProduct'>, watchlist: readonly WatchedVendor[] = STARTER_VENDOR_WATCHLIST): WatchedVendor | null {
  const names = [item.vendor, item.vendorProduct.split(':')[0] ?? ''].map((v) => v.replace(/_/g, ' ').trim().toLowerCase()).filter(Boolean);
  return watchlist.find((w) => names.some((n) => w.aliases.includes(n) || n === w.name.toLowerCase())) ?? null;
}

export function kevSubject(item: ExploitedVulnerability): LinkSubject {
  const [vendor = '', product = ''] = item.vendorProduct.split(':');
  const fromCpe = [vendor, product, item.vendor, item.product].map((w) => w.replace(/_/g, ' ').trim());
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
  // Additions of the last days, a watchlist vendor first, then newest first (the list's order).
  const fresh = data ? data.items.filter((i) => isNewKev(i, now)) : [];
  const watched = fresh.filter((i) => watchedVendor(i));
  const ranked = [...watched, ...fresh.filter((i) => !watchedVendor(i))];
  const newest = ranked[0];
  const vendorOf = newest ? watchedVendor(newest) : null;
  let fired: Indicator | null = null;
  if (newest) {
    // A date-only feed: the link window ends with the added day and starts 12 h before it.
    const dayStart = Date.parse(`${newest.addedAt}T00:00:00Z`);
    const at = Math.min(now, dayStart + DAY_MS);
    const score = newest.cvssScore > 0 ? `${newest.cvssScore.toFixed(1)} CVSS` : 'no CVSS';
    fired = {
      id: 'kev-new', domain: 'tech', name: `Exploited vulnerability · ${newest.id}`,
      value: score, change: newest.cvssSeverity ? newest.cvssSeverity.toLowerCase() : undefined, rule: vendorOf ? 'KEV add · watchlist vendor' : 'KEV add',
      detail: [
        vendorOf ? `${vendorOf.name} is on the starter vendor watchlist (until the owner's list exists)` : null,
        newest.name || [newest.vendor, newest.product].filter(Boolean).join(' ') || newest.vendorProduct || newest.description.slice(0, 120),
        `added ${dayLabel(newest.addedAt)}`,
        newest.dueAt ? `due ${dayLabel(newest.dueAt)}` : null,
        fresh.length > 1 ? `+${fresh.length - 1} more this week${watched.length > (vendorOf ? 1 : 0) ? `, ${watched.length - (vendorOf ? 1 : 0)} more from watchlist vendors` : ''}` : null,
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
      trust: { level: 'reported', source: `${Object.keys(bySource).length} threat feeds` }, at: at ?? now, updatedAt: at ?? undefined, focusId: 'attackers',
      links: linkNews({ drivers: ['botnet', ...Object.keys(byFamily).slice(0, 5)] }, news, at ?? now, LINK_WINDOW_HOURS.tech),
    };
  }
  const feed = feedState({ id: 'attack-spike', name: 'Attack infrastructure', source: state, seeder: 'seed-cyber-threats', cadenceMin: 120, dataAt: at, fired, now });
  if (!base) return feed;
  return quietDetail(feed, base.average == null
    ? `${base.latest.toLocaleString('en-US')} indicators · building baseline (${base.days} of ${SPIKE_BASELINE_DAYS} days)`
    : `${base.latest.toLocaleString('en-US')} indicators · ×${(base.ratio ?? 0).toFixed(1)} vs ${Math.round(base.average).toLocaleString('en-US')} avg · fires at ×${SPIKE_RATIO}`);
}

// ---- Cyber incidents at peers and suppliers (#120) --------------------------

/**
 * 8-K filings reporting item 1.05 in the last 24 h, newest first: a listed
 * company telling the SEC it had a material cyber incident. Every filer
 * counts (third-party risk reaches beyond the stock list); a filer on the
 * default stock list is named as such.
 */
const CORP_SUFFIX = /[,\s]+(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|holdings?|group|sa|nv|ag|se|llc|lp)\.?$/i;
/** A filer's name as headlines write it: "ACME LOGISTICS INC" → "ACME LOGISTICS". */
export function shortCompany(name: string): string {
  let out = name.trim();
  for (let i = 0; i < 2; i++) out = out.replace(CORP_SUFFIX, '').trim();
  return out || name;
}

export function cyberFilings(data: ListMaterialEventsResponse | null | undefined, now: number) {
  return (data?.events ?? [])
    .filter((e) => e.filedAtMs <= now + HOUR_MS && now - e.filedAtMs <= FILING_WINDOW_HOURS * HOUR_MS && e.items.some((i) => i.code === CYBER_8K_ITEM))
    .sort((a, b) => b.filedAtMs - a.filedAtMs);
}

export function cyberFilingFeed(state: ResourceState<ListMaterialEventsResponse>, news: readonly LiteItem[], now: number): FeedState {
  const data = state.status === 'ready' ? state.data : null;
  const filings = cyberFilings(data, now);
  const top = filings[0];
  const fetchedAt = data && data.fetchedAtMs > 0 ? data.fetchedAtMs : null;
  let fired: Indicator | null = null;
  if (top) {
    const name = filerName(top.company);
    const company = watchCompany(top.company);
    const others = filings.slice(1).map((f) => filerName(f.company));
    fired = {
      id: 'cyber-8k', domain: 'tech', name: `Cyber incident 8-K · ${name}`,
      value: `Item ${CYBER_8K_ITEM}`, change: 'material cybersecurity incident', rule: `item ${CYBER_8K_ITEM} ≤ ${FILING_WINDOW_HOURS} h`,
      detail: [
        company ? `${company.name} (${company.symbol}) is on the default stock list` : 'Listed filer; check whether it is a peer or supplier',
        others.length ? `also ${others.slice(0, 2).join(', ')}${others.length > 2 ? ` +${others.length - 2} more` : ''}` : null,
      ].filter(Boolean).join(' · '),
      trust: { level: 'official', source: 'SEC EDGAR 8-K' }, at: top.filedAtMs, updatedAt: fetchedAt ?? undefined,
      links: linkNews({ instruments: company ? [company.symbol] : [], drivers: [company?.name ?? shortCompany(name)] }, news, top.filedAtMs, LINK_WINDOW_HOURS.tech),
    };
  }
  const feed = feedState({ id: 'cyber-8k', name: 'Cyber incidents · 8-K item 1.05', source: state, seeder: 'seed-sec-8k-stream', cadenceMin: 30, dataAt: fetchedAt, fired, now });
  const recent = data ? data.events.filter((e) => now - e.filedAtMs <= FILING_WINDOW_HOURS * HOUR_MS).length : 0;
  return quietDetail(feed, data ? `${recent} material filing${recent === 1 ? '' : 's'} in ${FILING_WINDOW_HOURS} h · none reports a cyber incident (item ${CYBER_8K_ITEM})` : null);
}

export function techFeeds(input: {
  outages: ResourceState<ListInternetOutagesResponse>;
  services: ResourceState<ListServiceStatusesResponse>;
  kev: ResourceState<RecentKev>;
  history: ResourceState<ThreatHistory>;
  filings: ResourceState<ListMaterialEventsResponse>;
  models?: ResourceState<AiModels>;
  regulation?: ResourceState<AiRegulation>;
  breaches?: ResourceState<Breaches>;
  news: readonly LiteItem[];
  now: number;
}): FeedState[] {
  const { news, now } = input;
  return sortFeeds([
    outageFeed(input.outages, news, now),
    serviceFeed(input.services, news, now),
    kevFeed(input.kev, news, now),
    spikeFeed(input.history, news, now),
    cyberFilingFeed(input.filings, news, now),
    ...(input.models ? aiModelFeeds(input.models, news, now) : []),
    ...(input.models ? openModelFeeds(input.models, news, now) : []),
    ...(input.regulation ? aiRegulationFeeds(input.regulation, news, now) : []),
    ...(input.breaches ? breachFeeds(input.breaches, news, now) : []),
  ]);
}

// ---- AI model releases and price changes (#126) -------------------------------

export interface AiModel {
  /** OpenRouter id, "openai/gpt-6.2-astra". */
  id: string;
  lab: string;
  labName: string;
  name: string;
  /** When OpenRouter listed it (ms): usually the release, sometimes a later listing. */
  releasedAt: number;
  context: number | null;
  /** USD per million input and output tokens; null when not listed. */
  inPrice: number | null;
  outPrice: number | null;
  url: string;
}

export interface AiPriceChange {
  at: number;
  id: string;
  labName: string;
  name: string;
  from: [number | null, number | null];
  to: [number | null, number | null];
  url: string;
  /** LiteLLM's price file: match, differs, missing or unavailable. */
  litellm: string;
}

/** An open-weight release on the Hugging Face Hub (#132). */
export interface OpenModel {
  /** Hub id, "deepseek-ai/DeepSeek-V4.1-Flash". */
  id: string;
  lab: string;
  labName: string;
  name: string;
  /** When the seeder first saw it (ms): the release date, since repos are often made public after creation. */
  firstSeenAt: number;
  createdAt: number;
  /** Hub task ("text-generation"), or '' when the repo names none. */
  task: string;
  license: string;
  likes: number;
  /** Downloads in the last 30 days (the Hub's count). */
  downloads: number;
  url: string;
}

export interface OpenModels {
  models: OpenModel[];
  /** Each lab's newest release on the Hub, over any threshold. */
  latest: Array<Pick<OpenModel, 'lab' | 'labName' | 'name' | 'firstSeenAt' | 'url'>>;
  /** False on the first read, which dates the backlog by creation. */
  baseline: boolean;
  /** The last run that read every lab (ms), or null. */
  okAt: number | null;
  failedLabs: string[];
}

export interface AiModels {
  fetchedAt: number;
  listed: number;
  watched: number;
  baseline: boolean;
  models: AiModel[];
  changes: AiPriceChange[];
  /** Absent in payloads written before #132. */
  open: OpenModels | null;
}

/** The seeded payload (`tech:ai-models:v1`), or null when it is not one. */
export function decodeAiModels(value: unknown): AiModels | null {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== 'object' || !Number.isFinite(v.fetchedAt) || !Array.isArray(v.models) || !Array.isArray(v.changes)) return null;
  const str = (x: unknown) => (typeof x === 'string' ? x : '');
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const pair = (x: unknown): [number | null, number | null] => (Array.isArray(x) ? [num(x[0]), num(x[1])] : [null, null]);
  const url = (x: unknown) => (str(x).startsWith('https://openrouter.ai/') ? str(x) : '');
  const models: AiModel[] = [];
  for (const raw of v.models as Array<Record<string, unknown>>) {
    const releasedAt = num(raw?.releasedAt);
    if (!str(raw?.id) || !str(raw.labName) || releasedAt === null) continue;
    models.push({ id: str(raw.id), lab: str(raw.lab), labName: str(raw.labName), name: str(raw.name) || str(raw.id), releasedAt,
      context: num(raw.context), inPrice: num(raw.inPrice), outPrice: num(raw.outPrice), url: url(raw.url) });
  }
  models.sort((a, b) => b.releasedAt - a.releasedAt || a.id.localeCompare(b.id));
  const changes: AiPriceChange[] = [];
  for (const raw of v.changes as Array<Record<string, unknown>>) {
    const at = num(raw?.at);
    if (at === null || !str(raw.id)) continue;
    changes.push({ at, id: str(raw.id), labName: str(raw.labName), name: str(raw.name) || str(raw.id), from: pair(raw.from), to: pair(raw.to), url: url(raw.url), litellm: str(raw.litellm) || 'missing' });
  }
  changes.sort((a, b) => b.at - a.at);
  return { fetchedAt: v.fetchedAt as number, listed: num(v.listed) ?? 0, watched: num(v.watched) ?? 0, baseline: v.baseline === true, models, changes, open: decodeOpenModels(v.open) };
}

function decodeOpenModels(value: unknown): OpenModels | null {
  const o = value as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || !Array.isArray(o.models)) return null;
  const str = (x: unknown) => (typeof x === 'string' ? x : '');
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const hub = (x: unknown) => (str(x).startsWith('https://huggingface.co/') ? str(x) : '');
  const models: OpenModel[] = [];
  for (const raw of o.models as Array<Record<string, unknown>>) {
    const firstSeenAt = num(raw?.firstSeenAt);
    if (!str(raw?.id) || !str(raw.labName) || firstSeenAt === null) continue;
    models.push({
      id: str(raw.id), lab: str(raw.lab), labName: str(raw.labName), name: str(raw.name) || str(raw.id), firstSeenAt, createdAt: num(raw.createdAt) ?? firstSeenAt,
      task: str(raw.task), license: str(raw.license), likes: num(raw.likes) ?? 0, downloads: num(raw.downloads) ?? 0, url: hub(raw.url),
    });
  }
  models.sort((a, b) => b.firstSeenAt - a.firstSeenAt || a.id.localeCompare(b.id));
  const latest = (Array.isArray(o.latest) ? (o.latest as Array<Record<string, unknown>>) : [])
    .filter((m) => str(m?.labName) && num(m?.firstSeenAt) !== null)
    .map((m) => ({ lab: str(m.lab), labName: str(m.labName), name: str(m.name), firstSeenAt: num(m.firstSeenAt)!, url: hub(m.url) }))
    .sort((a, b) => b.firstSeenAt - a.firstSeenAt);
  return { models, latest, baseline: o.baseline === true, okAt: num(o.okAt), failedLabs: Array.isArray(o.failedLabs) ? (o.failedLabs as unknown[]).filter((x): x is string => typeof x === 'string') : [] };
}

/** A context length as "128k", "1M" or "1.1M" tokens, or "—". */
export function contextText(n: number | null): string {
  if (n === null) return '—';
  return n >= 1_000_000 ? `${Number((n / 1_000_000).toFixed(1))}M` : `${Math.round(n / 1000)}k`;
}

/** "$1.50 / $7.50" per million tokens, "free", or "—". */
export function modelPriceText(inPrice: number | null, outPrice: number | null): string {
  if (inPrice === null && outPrice === null) return '—';
  if (inPrice === 0 && outPrice === 0) return 'free';
  const usd = (n: number | null) => (n === null ? '—' : `$${n >= 10 ? n.toFixed(0) : Number(n.toFixed(3)).toString()}`);
  return `${usd(inPrice)} / ${usd(outPrice)}`;
}

const priceMove = (from: number | null, to: number | null) =>
  from !== null && to !== null && from > 0 ? Math.round(((to - from) / from) * 100) : null;
const signedPct = (n: number) => `${n < 0 ? '−' : '+'}${Math.abs(n)}%`;
const LITELLM_TEXT: Readonly<Record<string, string>> = {
  match: 'LiteLLM price file agrees', differs: 'LiteLLM price file shows a different price', missing: 'not in the LiteLLM price file', unavailable: 'LiteLLM price file unavailable',
};

/**
 * One card per watched lab with models listed in the last AI_NEW_DAYS (the
 * newest listing's time), and one per price change in the same window.
 */
export function aiModelIndicators(data: AiModels, news: readonly LiteItem[], now: number): Indicator[] {
  const cutoff = now - AI_NEW_DAYS * DAY_MS;
  const byLab = new Map<string, AiModel[]>();
  for (const m of data.models) {
    if (m.releasedAt < cutoff || m.releasedAt > now + HOUR_MS) continue;
    byLab.set(m.labName, [...(byLab.get(m.labName) ?? []), m]);
  }
  const out: Indicator[] = [];
  for (const [labName, list] of byLab) {
    const at = Math.min(now, list[0]!.releasedAt);
    const names = list.map((m) => m.name);
    const links = linkNews({ drivers: [labName, ...names] }, news, at, AI_NEW_DAYS * 24);
    // A story links only when it names the lab or one of the models.
    const stories = links.stories.filter((st) => [labName, ...names].some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(`${st.item.title} ${st.item.snippet ?? ''}`)));
    out.push({
      id: `ai-models:new:${list[0]!.lab}`, domain: 'tech', name: `New AI models · ${labName}`,
      value: `${list.length} listed`,
      change: names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3} more` : names.join(', '),
      rule: `model from a watched lab listed ≤ ${AI_NEW_DAYS} days`,
      detail: list.slice(0, 4).map((m) => `${m.name} ${modelPriceText(m.inPrice, m.outPrice)} per 1M tokens${m.context ? ` · ${contextText(m.context)} context` : ''}`).join(' · '),
      trust: { level: 'reported', source: 'OpenRouter listing' },
      at, dataDate: `listed ${new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`,
      updatedAt: data.fetchedAt, links: { ...links, stories },
    });
  }
  for (const c of data.changes) {
    if (c.at < cutoff || c.at > now + HOUR_MS || out.some((i) => i.id === `ai-models:price:${c.id}`)) continue;
    const dIn = priceMove(c.from[0], c.to[0]);
    const dOut = priceMove(c.from[1], c.to[1]);
    const lead = dIn !== null && (dOut === null || Math.abs(dIn) >= Math.abs(dOut)) ? 'input' : 'output';
    const d = lead === 'input' ? dIn : dOut;
    out.push({
      id: `ai-models:price:${c.id}`, domain: 'tech', name: `AI price change · ${c.name}`,
      value: d !== null ? `${lead} ${signedPct(d)}` : 'price changed',
      change: `${modelPriceText(c.from[0], c.from[1])} → ${modelPriceText(c.to[0], c.to[1])} per 1M`,
      rule: `price change ≥ ${AI_PRICE_PCT}% on a watched lab's model`,
      detail: [c.labName, LITELLM_TEXT[c.litellm] ?? c.litellm].filter(Boolean).join(' · '),
      trust: { level: 'reported', source: 'OpenRouter listing' },
      at: Math.min(now, c.at), updatedAt: data.fetchedAt,
      links: linkNews({ drivers: [c.name, `${c.labName} pricing`, `${c.labName} price`] }, news, Math.min(now, c.at), AI_NEW_DAYS * 24),
    });
  }
  return out.sort((a, b) => b.at - a.at);
}

export function aiModelFeeds(source: ResourceState<AiModels>, news: readonly LiteItem[], now: number): FeedState[] {
  const data = source.status === 'ready' ? source.data : null;
  const fired = data ? aiModelIndicators(data, news, now) : [];
  const base = feedState({
    id: 'ai-models', name: 'AI models · OpenRouter', source, seeder: 'seed-ai-models',
    cadenceMin: AI_MODELS_CADENCE_MIN, dataAt: data?.fetchedAt ?? null, fired: null, now,
  });
  if (base.kind !== 'quiet' || !data) return [base];
  if (fired.length) return fired.map((indicator) => ({ kind: 'fired' as const, id: indicator.id, name: indicator.name, indicator }));
  const latest = data.models[0];
  const day = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return [{ ...base, detail: [`Live · no new model from a watched lab in ${AI_NEW_DAYS} days`, latest ? `latest ${latest.labName} ${latest.name}, ${day(latest.releasedAt)}` : null, data.baseline ? null : 'price baseline set; changes count from the next run'].filter(Boolean).join(' · ') }];
}

// ---- AI and data regulation (#127) --------------------------------------------

export interface AiRegulationItem {
  id: string;
  jurisdiction: 'EU' | 'US';
  /** European Commission, EUR-Lex or Federal Register. */
  source: string;
  /** guidelines, implementing act, regulation, proposal, final rule, proposed rule, … */
  kind: string;
  title: string;
  agency: string;
  url: string;
  publishedAt: number;
  /** 'seen' when the feed gave no date and publishedAt is the first sighting (EUR-Lex proposals). */
  dateKind: 'published' | 'seen';
}

export interface AiRegulationSource {
  id: string;
  label: string;
  ok: boolean;
  /** The source's last good read (ms), or null. */
  okAt: number | null;
}

export interface AiRegulation {
  fetchedAt: number;
  logDays: number;
  sources: AiRegulationSource[];
  items: AiRegulationItem[];
}

const REG_URL = /^https:\/\/(digital-strategy\.ec\.europa\.eu|eur-lex\.europa\.eu|www\.federalregister\.gov)\//;

/** The seeded payload (`policy:ai-regulation:v1`), or null when it is not one. An empty log is valid. */
export function decodeAiRegulation(value: unknown): AiRegulation | null {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== 'object' || !Number.isFinite(v.fetchedAt) || !Array.isArray(v.items) || !Array.isArray(v.sources)) return null;
  const str = (x: unknown) => (typeof x === 'string' ? x : '');
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const items: AiRegulationItem[] = [];
  for (const raw of v.items as Array<Record<string, unknown>>) {
    const publishedAt = num(raw?.publishedAt);
    const jurisdiction = raw?.jurisdiction === 'EU' || raw?.jurisdiction === 'US' ? raw.jurisdiction : null;
    if (publishedAt === null || !jurisdiction || !str(raw.id) || !str(raw.title)) continue;
    items.push({ id: str(raw.id), jurisdiction, source: str(raw.source), kind: str(raw.kind) || 'notice', title: str(raw.title), agency: str(raw.agency),
      url: REG_URL.test(str(raw.url)) ? str(raw.url) : '', publishedAt, dateKind: raw.dateKind === 'seen' ? 'seen' : 'published' });
  }
  items.sort((a, b) => b.publishedAt - a.publishedAt || a.id.localeCompare(b.id));
  const sources = (v.sources as Array<Record<string, unknown>>).filter((x) => str(x?.id)).map((x) => ({ id: str(x.id), label: str(x.label) || str(x.id), ok: x.ok === true, okAt: num(x.okAt) }));
  return { fetchedAt: v.fetchedAt as number, logDays: Number.isInteger(v.logDays) ? (v.logDays as number) : 60, sources, items };
}

const AI_NEWS_WORDS = /\b(AI|A\.I\.|artificial intelligence|AI Act|machine learning|algorithm\w*|data protection|GDPR|Data Act)\b/i;
/** "first seen" when the feed gave no date, else "published". */
const regDateWord = (i: Pick<AiRegulationItem, 'dateKind'>) => (i.dateKind === 'seen' ? 'first seen' : 'published');
const regDay = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** One card per EU or US AI or data rule published in the last AI_REG_NEW_DAYS (at most four, newest first). */
export function aiRegulationIndicators(data: AiRegulation, news: readonly LiteItem[], now: number): Indicator[] {
  return data.items
    .filter((i) => i.publishedAt <= now + HOUR_MS && now - i.publishedAt <= AI_REG_NEW_DAYS * DAY_MS)
    .slice(0, 4)
    .map((i) => {
      const at = Math.min(now, i.publishedAt);
      const drivers = i.jurisdiction === 'EU' ? ['AI Act', 'European Commission', 'EU regulation', 'Brussels'] : ['AI regulation', 'AI rule', ...(i.agency ? [i.agency] : [])];
      const links = linkNews({ drivers }, news, at, AI_REG_NEW_DAYS * 24);
      // A story links only when it is about AI or data rules.
      const stories = links.stories.filter((st) => AI_NEWS_WORDS.test(`${st.item.title} ${st.item.snippet ?? ''}`));
      return {
        id: `ai-regulation:${i.id}`, domain: 'tech', name: `AI rule · ${i.jurisdiction} ${i.kind}`,
        value: `${i.jurisdiction} ${i.kind}`,
        change: i.agency || i.source,
        rule: `EU act, implementing act or guidelines on AI or data, or a US AI rule, ≤ ${AI_REG_NEW_DAYS} days`,
        detail: i.title,
        trust: { level: 'official', source: i.source || (i.jurisdiction === 'EU' ? 'EUR-Lex' : 'Federal Register') },
        at, dataDate: `${regDateWord(i)} ${regDay(i.publishedAt)}`, updatedAt: data.fetchedAt,
        links: { ...links, stories },
      } satisfies Indicator;
    });
}

/** The feed is as fresh as its oldest source's last good read, else the fetch time. */
export function aiRegulationDataAt(data: AiRegulation | null): number | null {
  if (!data) return null;
  const reads = data.sources.map((s) => s.okAt).filter((t): t is number => t !== null);
  return reads.length ? Math.min(data.fetchedAt, ...reads) : data.fetchedAt;
}

export function aiRegulationFeeds(source: ResourceState<AiRegulation>, news: readonly LiteItem[], now: number): FeedState[] {
  const data = source.status === 'ready' ? source.data : null;
  const base = feedState({
    id: 'ai-regulation', name: 'AI and data rules · EU and US', source, seeder: 'seed-ai-regulation',
    cadenceMin: AI_REG_CADENCE_MIN, dataAt: aiRegulationDataAt(data), fired: null, now,
  });
  if (base.kind !== 'quiet' || !data) return [base];
  const fired = aiRegulationIndicators(data, news, now);
  if (fired.length) return fired.map((indicator) => ({ kind: 'fired' as const, id: indicator.id, name: indicator.name, indicator }));
  const latest = data.items[0];
  const failed = data.sources.filter((s) => !s.ok).map((s) => s.label);
  return [{ ...base, detail: [
    `Live · no new EU or US AI rule in ${AI_REG_NEW_DAYS} days`,
    latest ? `latest ${latest.jurisdiction} ${latest.kind}, ${latest.dateKind === 'seen' ? 'first seen ' : ''}${regDay(latest.publishedAt)}` : `none in the ${data.logDays}-day log`,
    failed.length ? `not read on the last run: ${failed.join(', ')}` : null,
  ].filter(Boolean).join(' · ') }];
}

// ---- Data breaches (#131) -------------------------------------------------------

export interface Breach {
  /** HIBP's breach name, its id ("Careers360"). */
  name: string;
  title: string;
  /** The breached site's domain, or '' (malware and combo lists have none). */
  domain: string;
  /** When it happened, YYYY-MM-DD, or ''. */
  breachDate: string;
  /** When HIBP listed it (ms). */
  addedAt: number;
  pwnCount: number;
  dataClasses: string[];
  verified: boolean;
  fabricated: boolean;
  sensitive: boolean;
  spamList: boolean;
  malware: boolean;
  stealerLog: boolean;
  url: string;
}

export interface Breaches {
  fetchedAt: number;
  /** Breaches in HIBP's catalogue. */
  total: number;
  keepDays: number;
  /** Listed in the last `keepDays`, newest first. */
  breaches: Breach[];
}

/** The seeded payload (`cyber:breaches:v1`), or null when it is not one. */
export function decodeBreaches(value: unknown): Breaches | null {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== 'object' || !Number.isFinite(v.fetchedAt) || !Number.isFinite(v.total) || !Array.isArray(v.breaches)) return null;
  const str = (x: unknown) => (typeof x === 'string' ? x : '');
  const breaches: Breach[] = [];
  for (const raw of v.breaches as Array<Record<string, unknown>>) {
    const addedAt = raw?.addedAt;
    const pwnCount = raw?.pwnCount;
    if (!str(raw?.name) || typeof addedAt !== 'number' || !Number.isFinite(addedAt) || typeof pwnCount !== 'number' || !Number.isFinite(pwnCount)) continue;
    breaches.push({
      name: str(raw.name), title: str(raw.title) || str(raw.name), domain: str(raw.domain).toLowerCase(),
      breachDate: /^\d{4}-\d{2}-\d{2}$/.test(str(raw.breachDate)) ? str(raw.breachDate) : '', addedAt, pwnCount,
      dataClasses: Array.isArray(raw.dataClasses) ? (raw.dataClasses as unknown[]).filter((c): c is string => typeof c === 'string') : [],
      verified: raw.verified === true, fabricated: raw.fabricated === true, sensitive: raw.sensitive === true,
      spamList: raw.spamList === true, malware: raw.malware === true, stealerLog: raw.stealerLog === true,
      url: str(raw.url).startsWith('https://haveibeenpwned.com/') ? str(raw.url) : '',
    });
  }
  breaches.sort((a, b) => b.addedAt - a.addedAt);
  return { fetchedAt: v.fetchedAt as number, total: v.total as number, keepDays: Number.isInteger(v.keepDays) ? (v.keepDays as number) : 30, breaches };
}

/** The starter-list vendor whose domain (or a parent of it) the breach names. */
export function breachVendor(b: Pick<Breach, 'domain'>, watchlist: readonly WatchedVendor[] = STARTER_VENDOR_WATCHLIST): WatchedVendor | null {
  const d = b.domain.toLowerCase();
  if (!d) return null;
  return watchlist.find((v) => v.domains.some((w) => d === w || d.endsWith(`.${w}`))) ?? null;
}

/** "3.6M", "850k", "1,204". */
export function accountsText(n: number): string {
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1))}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return n.toLocaleString('en-US');
}

const dayMonthYear = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const dayMonthOf = (ts: number) => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const BREACH_WORDS = /\b(breach(es|ed)?|leak(s|ed)?|hack(s|ed|ers?)?|stolen|exposed|compromised|data theft|pwned|ransomware)\b/i;

/** Does a breach fire: listed recently, a real breach, and big or at a watched vendor. */
export function breachFires(b: Breach, now: number): boolean {
  if (b.fabricated || b.spamList || b.addedAt > now + HOUR_MS || now - b.addedAt > BREACH_NEW_DAYS * DAY_MS) return false;
  return b.pwnCount >= BREACH_MIN_ACCOUNTS || breachVendor(b) !== null;
}

export function breachIndicators(data: Breaches, news: readonly LiteItem[], now: number): Indicator[] {
  return data.breaches
    .filter((b) => breachFires(b, now))
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, BREACH_MAX_CARDS)
    .map((b) => {
      const vendor = breachVendor(b);
      const at = Math.min(now, b.addedAt);
      const site = b.domain ? b.domain.replace(/^www\./, '').split('.').slice(0, -1).join('.') : '';
      const names = [b.title, b.name, site].filter((n, i, all) => n && n.length >= 3 && all.indexOf(n) === i);
      const links = linkNews({ drivers: names }, news, at, LINK_WINDOW_HOURS.tech);
      // A story links only when it names the breached site and talks about a breach or leak.
      const named = (t: string) => names.some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t));
      const stories = links.stories.filter((st) => { const t = `${st.item.title} ${st.item.snippet ?? ''}`; return named(t) && BREACH_WORDS.test(t); });
      const flags = [
        b.verified ? null : 'unverified',
        b.malware ? 'malware log' : null,
        b.stealerLog ? 'stealer log' : null,
        b.sensitive ? 'sensitive (not searchable)' : null,
      ].filter(Boolean);
      return {
        id: `breach:${b.name}`, domain: 'tech', name: `Data breach · ${b.title}`,
        value: `${accountsText(b.pwnCount)} accounts`,
        change: `${b.breachDate ? `breached ${dayMonthYear(b.breachDate)}` : 'breach date unknown'} · listed ${dayMonthOf(b.addedAt)}`,
        rule: vendor && b.pwnCount < BREACH_MIN_ACCOUNTS
          ? `listed ≤ ${BREACH_NEW_DAYS} days, ${vendor.name} (starter vendor list)`
          : `listed ≤ ${BREACH_NEW_DAYS} days, ≥ ${accountsText(BREACH_MIN_ACCOUNTS)} accounts${vendor ? ` · ${vendor.name} (starter vendor list)` : ''}`,
        detail: [
          b.domain || null,
          b.dataClasses.length ? (b.dataClasses.length > 4 ? `${b.dataClasses.slice(0, 4).join(', ')} +${b.dataClasses.length - 4} more` : b.dataClasses.join(', ')) : null,
          flags.length ? flags.join(', ') : null,
        ].filter(Boolean).join(' · '),
        // CC BY 4.0: name HIBP and link to it; the full card links the breach's HIBP page.
        trust: { level: 'reported', source: 'Have I Been Pwned (CC BY 4.0)', url: b.url || 'https://haveibeenpwned.com/' },
        at, dataDate: `listed ${dayMonthOf(b.addedAt)}`, updatedAt: data.fetchedAt,
        links: { ...links, stories },
      } satisfies Indicator;
    });
}

export function breachFeeds(source: ResourceState<Breaches>, news: readonly LiteItem[], now: number): FeedState[] {
  const data = source.status === 'ready' ? source.data : null;
  const base = feedState({
    id: 'breach', name: 'Data breaches · HIBP', source, seeder: 'seed-breaches',
    cadenceMin: BREACHES_CADENCE_MIN, dataAt: data?.fetchedAt ?? null, fired: null, now,
  });
  if (base.kind !== 'quiet' || !data) return [base];
  const fired = breachIndicators(data, news, now);
  if (fired.length) return fired.map((indicator) => ({ kind: 'fired' as const, id: indicator.id, name: indicator.name, indicator }));
  const recent = data.breaches.filter((b) => !b.fabricated && !b.spamList && b.addedAt <= now + HOUR_MS && now - b.addedAt <= BREACH_NEW_DAYS * DAY_MS);
  const latest = data.breaches.find((b) => !b.fabricated && !b.spamList);
  return [{
    ...base,
    detail: [
      recent.length
        ? `Live · ${recent.length} breach${recent.length === 1 ? '' : 'es'} listed in ${BREACH_NEW_DAYS} days, none with ${accountsText(BREACH_MIN_ACCOUNTS)}+ accounts or at a starter-list vendor`
        : `Live · no breach listed in ${BREACH_NEW_DAYS} days`,
      latest ? `latest ${latest.title}, ${accountsText(latest.pwnCount)} accounts, listed ${dayMonthOf(latest.addedAt)}` : null,
      `${data.total.toLocaleString('en-US')} breaches in HIBP`,
    ].filter(Boolean).join(' · '),
  }];
}

// ---- Open-weight model releases (#132) -------------------------------------------

/** "1.6M", "48k", "950". */
const countText = (n: number) => (n >= 1_000_000 ? `${Number((n / 1_000_000).toFixed(1))}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);

/**
 * Names joined while they fit in `max` characters, then "+N more": the full card keeps
 * the change line on one line, and Hub names run long ("DeepSeek-V4.1-Flash-1017").
 */
export function fitNames(names: readonly string[], max: number): string {
  let out = names[0] ?? '';
  let i = 1;
  for (; i < names.length && `${out}, ${names[i]}`.length <= max; i++) out = `${out}, ${names[i]}`;
  return i < names.length ? `${out} +${names.length - i} more` : out;
}

export function openModelPasses(m: OpenModel): boolean {
  return m.likes >= OPEN_MODEL_MIN_LIKES || m.downloads >= OPEN_MODEL_MIN_DOWNLOADS;
}

/** One card per watched lab with open weights first seen in the last OPEN_MODEL_NEW_DAYS that pass the threshold. */
export function openModelIndicators(data: AiModels, news: readonly LiteItem[], now: number): Indicator[] {
  if (!data.open) return [];
  const cutoff = now - OPEN_MODEL_NEW_DAYS * DAY_MS;
  const byLab = new Map<string, OpenModel[]>();
  for (const m of data.open.models) {
    if (m.firstSeenAt < cutoff || m.firstSeenAt > now + HOUR_MS || !openModelPasses(m)) continue;
    byLab.set(m.labName, [...(byLab.get(m.labName) ?? []), m]);
  }
  const out: Indicator[] = [];
  for (const [labName, list] of byLab) {
    const ranked = [...list].sort((a, b) => b.likes - a.likes || b.firstSeenAt - a.firstSeenAt);
    const at = Math.min(now, Math.max(...list.map((m) => m.firstSeenAt)));
    const names = ranked.map((m) => m.name);
    // The card stays up for a week, so the coverage that follows a release counts: search the
    // week up to now, not the hours before it was first seen.
    const links = linkNews({ drivers: [labName, ...names] }, news, now, OPEN_MODEL_NEW_DAYS * 24);
    // A story links only when it names one of the models.
    const stories = links.stories.filter((st) => names.some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(`${st.item.title} ${st.item.snippet ?? ''}`)));
    out.push({
      id: `open-models:${list[0]!.lab}`, domain: 'tech', name: `Open-weight models · ${labName}`,
      value: `${list.length} released`,
      change: fitNames(names, 40),
      rule: `open weights first seen ≤ ${OPEN_MODEL_NEW_DAYS} days, ≥ ${OPEN_MODEL_MIN_LIKES} likes or ≥ ${countText(OPEN_MODEL_MIN_DOWNLOADS)} downloads`,
      detail: ranked.slice(0, 3).map((m) => `${m.name}: ${[m.task, m.license].filter(Boolean).join(', ') || 'task not stated'} · ${countText(m.likes)} likes · ${countText(m.downloads)} downloads`).join(' · '),
      trust: { level: 'reported', source: 'Hugging Face Hub', ...(ranked[0]!.url ? { url: ranked[0]!.url } : {}) },
      at, dataDate: `seen ${new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`,
      updatedAt: data.fetchedAt, links: { ...links, stories },
    });
  }
  return out.sort((a, b) => b.at - a.at);
}

export function openModelFeeds(source: ResourceState<AiModels>, news: readonly LiteItem[], now: number): FeedState[] {
  const data = source.status === 'ready' ? source.data : null;
  // A payload written before #132 has no Hub block: the row says so rather than reading as quiet.
  const open = data?.open ?? null;
  const state: ResourceState<AiModels> = data && !open ? { status: 'empty', data: null, at: source.at } : source;
  const base = feedState({
    id: 'open-models', name: 'Open-weight models · Hugging Face', source: state, seeder: 'seed-ai-models',
    cadenceMin: AI_MODELS_CADENCE_MIN, dataAt: data && open ? Math.min(data.fetchedAt, open.okAt ?? data.fetchedAt) : null, fired: null, now,
  });
  if (base.kind !== 'quiet' || !data || !open) return [base];
  const fired = openModelIndicators(data, news, now);
  if (fired.length) return fired.map((indicator) => ({ kind: 'fired' as const, id: indicator.id, name: indicator.name, indicator }));
  const day = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const newest = open.latest[0];
  const below = open.models.filter((m) => now - m.firstSeenAt <= OPEN_MODEL_NEW_DAYS * DAY_MS && !openModelPasses(m)).length;
  return [{
    ...base,
    detail: [
      below ? `Live · ${below} new open-weight model${below === 1 ? '' : 's'} in ${OPEN_MODEL_NEW_DAYS} days, none over the threshold yet` : `Live · no new open-weight model from a watched lab in ${OPEN_MODEL_NEW_DAYS} days`,
      newest ? `newest ${newest.labName} ${newest.name}, ${day(newest.firstSeenAt)}` : null,
      open.failedLabs.length ? `${open.failedLabs.join(', ')} not read on the last run` : null,
      open.baseline ? null : 'first read: the backlog is dated by repo creation',
    ].filter(Boolean).join(' · '),
  }];
}
