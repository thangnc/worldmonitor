/**
 * The Geopolitics indicator-only feeds (spec "Catalogue", geopolitics rows;
 * step 2c): chokepoint transits (IMF PortWatch, tanker flows), Taiwan Strait
 * activity (Taiwan MND) and US embassy security alerts for the curated
 * hotspots' countries. Pure rules: the screen passes the loaded data.
 */
import { HOTSPOT_COUNTRY_MAP } from '@wm/shared/hotspot-country-map';
import type { ChokepointInfo, GetChokepointStatusResponse } from '@wm/contracts/generated/client/worldmonitor/supply_chain/v1/service_client';
import type { SecurityAdvisoryItem } from '@wm/contracts/generated/client/worldmonitor/intelligence/v1/service_client';
import type { ListSanctionsPressureResponse, SanctionsEntry } from '@wm/contracts/generated/client/worldmonitor/sanctions/v1/service_client';
import type { CrossStraitActivitySnapshot, TaiwanMndActivityObservation } from '@wm/client/types/cross-strait-activity';
import { countryName } from './conflict';
import { feeds, hotspotPlace, hotspotSubject, type Place } from './geo-layers';
import { feedState, type FeedState, type Indicator } from './indicators';
import { LINK_WINDOW_HOURS, linkNews } from './news-link';
import type { ResourceState } from './store';
import type { LiteItem } from './transforms';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const dayMonth = (ts: number) => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
/** The last millisecond of a `YYYY-MM-DD` UTC day, or null. */
const dayEnd = (day: string): number | null => {
  const start = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(start) ? start + DAY_MS - 1 : null;
};

// ---- Chokepoint transits ----------------------------------------------------

/** 7-day transits at or below this share of the year-earlier daily normal fire. */
export const CHOKEPOINT_TRANSIT_SHARE = 0.75;
/** PortWatch publishes days behind; a newest day older than twice this is stale. */
export const PORTWATCH_CADENCE_MIN = 7 * 24 * 60;

/** The 7-day average against the year-earlier normal, when both exist. */
function transitReading(cp: ChokepointInfo): { avg7d: number; normal: number; share: number } | null {
  const t = cp.transitSummary;
  // baselineAvgDaily is 0 when the seeder has no year-earlier window; baselineFrom says whether it has one.
  if (!t || !t.baselineFrom || !(t.baselineAvgDaily > 0) || typeof t.officialAvg7d !== 'number') return null;
  return { avg7d: t.officialAvg7d, normal: t.baselineAvgDaily, share: t.officialAvg7d / t.baselineAvgDaily };
}

/** Chokepoints the rule can read: a year-earlier normal or a tanker-flow estimate. */
export function readableChokepoints(resp: GetChokepointStatusResponse): ChokepointInfo[] {
  return resp.chokepoints.filter((cp) => transitReading(cp) != null || cp.flowEstimate != null);
}

/** The newest PortWatch day across the chokepoints, or null. */
export function portwatchLatestDay(resp: GetChokepointStatusResponse): string | null {
  let latest: string | null = null;
  for (const cp of resp.chokepoints) {
    const day = cp.transitSummary?.officialLatestDate;
    if (day && (!latest || day > latest)) latest = day;
  }
  return latest;
}

/**
 * Fires per chokepoint when its 7-day transits are 25% or more below the
 * year-earlier normal, or when the tanker-flow seeder flags it disrupted
 * (below 85% of its 90-day normal on each of the last 3 days).
 */
export function chokepointIndicators(resp: GetChokepointStatusResponse, news: readonly LiteItem[], now: number): Indicator[] {
  const fetchedAt = Date.parse(resp.fetchedAt);
  const out: Indicator[] = [];
  for (const cp of resp.chokepoints) {
    const transit = transitReading(cp);
    const low = transit != null && transit.share <= CHOKEPOINT_TRANSIT_SHARE;
    const flow = cp.flowEstimate?.disrupted ? cp.flowEstimate : null;
    if (!low && !flow) continue;
    const day = cp.transitSummary?.officialLatestDate || null;
    const end = day ? dayEnd(day) : null;
    // The data covers a PortWatch day; its news window ends with that day.
    const at = Math.min(now, end ?? (Number.isFinite(fetchedAt) ? fetchedAt : now));
    const changes: string[] = [];
    if (low && transit) changes.push(`${Math.round((transit.share - 1) * 100)}% vs year-earlier`.replace('-', '−'));
    if (flow) changes.push(`tanker flow ${Math.round(flow.flowRatio * 100)}% of 90-day normal`);
    const rules: string[] = [];
    if (low) rules.push(`7-day transits ≤ ${Math.round(CHOKEPOINT_TRANSIT_SHARE * 100)}% of year-earlier`);
    if (flow) rules.push('tanker flow < 85% of normal 3 days running');
    const short = cp.name.replace(/^(Strait of|The)\s+/i, '');
    out.push({
      id: `chokepoint:${cp.id}`,
      domain: 'geo',
      name: `Chokepoint · ${cp.name}`,
      value: low && transit ? `${Math.round(transit.avg7d)} transits/day` : `${flow!.currentMbd.toFixed(1)} mb/d`,
      change: changes.join(' · '),
      rule: rules.join(' or '),
      detail: low && transit ? `7-day average ${Math.round(transit.avg7d)} against ${Math.round(transit.normal)} a day a year earlier` : undefined,
      trust: { level: 'estimated', source: 'IMF PortWatch (ship transponders)' },
      at,
      dataDate: day && end ? `data to ${dayMonth(end)}` : undefined,
      updatedAt: Number.isFinite(fetchedAt) ? fetchedAt : undefined,
      links: linkNews({ drivers: [...new Set([cp.name, short])] }, news, at, LINK_WINDOW_HOURS.geo),
      place: Number.isFinite(cp.lat) && Number.isFinite(cp.lon) ? { lat: cp.lat, lon: cp.lon } : undefined,
    });
  }
  return out;
}

export function chokepointFeeds(source: ResourceState<GetChokepointStatusResponse>, news: readonly LiteItem[], now: number): FeedState[] {
  const data = source.data;
  const latest = data ? portwatchLatestDay(data) : null;
  const base = feedState({
    id: 'chokepoints', name: 'Chokepoint transits · IMF PortWatch', source, seeder: 'seed-portwatch',
    cadenceMin: PORTWATCH_CADENCE_MIN, dataAt: latest ? dayEnd(latest) : null, fired: null, now,
  });
  const dataTo = latest ? ` · data to ${dayMonth(dayEnd(latest)!)}` : '';
  if (base.kind === 'stale') return [{ ...base, detail: `Late · PortWatch data to ${dayMonth(dayEnd(latest!)!)}` }];
  if (base.kind !== 'quiet' || !data) return [base];
  const readable = readableChokepoints(data);
  if (data.upstreamUnavailable || readable.length === 0) {
    return [{ kind: 'unavailable', id: base.id, name: base.name, detail: 'No transit baseline yet · seed-portwatch' }];
  }
  return feeds(base, chokepointIndicators(data, news, now), `Live · ${readable.length} chokepoint${readable.length === 1 ? '' : 's'} within normal${dataTo}`);
}

// ---- Taiwan Strait activity -------------------------------------------------

/** Activity at or above this multiple of the 30-day median fires. */
export const TAIWAN_RATIO = 1.5;
/** And at least this many, so a quiet median cannot fire on a handful. */
export const TAIWAN_MIN = { plaAircraftSorties: 10, planShips: 5 } as const;
/** Taiwan MND reports once a day. */
export const TAIWAN_CADENCE_MIN = 24 * 60;

type TaiwanCategory = keyof typeof TAIWAN_MIN;
const TAIWAN_LABEL: Record<TaiwanCategory, string> = { plaAircraftSorties: 'aircraft', planShips: 'ships' };

/** Shape check for the slow-tier bootstrap value (the dashboard's full validator lives in src/components). */
export function isCrossStraitSnapshot(value: unknown): value is CrossStraitActivitySnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const baselines = v.baselines as Record<string, unknown> | undefined;
  return v.schemaVersion === 1
    && Array.isArray(v.observations)
    && typeof baselines === 'object' && baselines !== null
    && typeof baselines.categories === 'object' && baselines.categories !== null;
}

interface CategoryReading {
  key: TaiwanCategory;
  current: number | null;
  median: number | null;
  sufficient: boolean;
  sampleSize: number;
  required: number;
  day: string;
}

function categoryReading(snapshot: CrossStraitActivitySnapshot, key: TaiwanCategory): CategoryReading | null {
  const c = snapshot.baselines.categories[key];
  if (!c) return null;
  const w = c.windows[30];
  return {
    key,
    current: c.current.value,
    median: w.value,
    sufficient: w.state === 'sufficient' && w.value != null,
    sampleSize: w.sampleSize,
    required: w.requiredSampleSize,
    day: c.current.reportingDay,
  };
}

const fires = (r: CategoryReading) =>
  r.sufficient && r.current != null && r.median != null && r.current >= TAIWAN_MIN[r.key] && r.current >= TAIWAN_RATIO * r.median;

function taiwanReadings(snapshot: CrossStraitActivitySnapshot): CategoryReading[] {
  return (['plaAircraftSorties', 'planShips'] as const).map((k) => categoryReading(snapshot, k)).filter((r): r is CategoryReading => r != null);
}

/** The latest MND daily report, if any. */
function latestMnd(snapshot: CrossStraitActivitySnapshot, day: string | null): TaiwanMndActivityObservation | null {
  const mnd = snapshot.observations.filter((o): o is TaiwanMndActivityObservation => o.sourceId === 'taiwan-mnd');
  return mnd.find((o) => o.reportingDay === day) ?? mnd.sort((a, b) => b.reportingDay.localeCompare(a.reportingDay))[0] ?? null;
}

/** Ready when at least one category has a sufficient 30-day window; otherwise says how far the history is. */
export function taiwanHistoryReady(snapshot: CrossStraitActivitySnapshot): { ready: boolean; detail: string } {
  const readings = taiwanReadings(snapshot);
  if (readings.some((r) => r.sufficient)) return { ready: true, detail: '' };
  const best = readings.reduce<CategoryReading | null>((a, r) => (!a || r.sampleSize > a.sampleSize ? r : a), null);
  return {
    ready: false,
    detail: best ? `Building history · ${best.sampleSize} of ${best.required} reporting days` : 'Building history · no MND reports yet',
  };
}

const ratioText = (r: CategoryReading) => (r.median ? `${(r.current! / r.median).toFixed(1)}×` : 'above a zero');

/**
 * Fires when PLA aircraft sorties or PLAN ships reach 1.5× their median over
 * the prior 30 usable reporting days (owner's choice, 2026-11-09), with at
 * least 10 aircraft or 5 ships. A null count is unknown, never zero.
 */
export function taiwanStraitIndicators(snapshot: CrossStraitActivitySnapshot, news: readonly LiteItem[], now: number): Indicator[] {
  const readings = taiwanReadings(snapshot);
  const fired = readings.filter(fires);
  if (fired.length === 0) return [];
  const day = fired[0]!.day;
  const report = latestMnd(snapshot, day);
  const periodEnd = report ? Date.parse(report.reportingPeriod.end) : NaN;
  const at = Math.min(now, Number.isFinite(periodEnd) ? periodEnd : dayEnd(day) ?? now);
  const counts = readings.filter((r) => r.current != null).map((r) => `${r.current} ${TAIWAN_LABEL[r.key]}`);
  const cats = report?.categories;
  const extra = [
    cats?.medianLineCrossings != null ? `${cats.medianLineCrossings} median-line crossings` : null,
    cats?.adizEntries != null ? `${cats.adizEntries} ADIZ entries` : null,
    cats?.officialShips != null ? `${cats.officialShips} official ships` : null,
  ].filter((s): s is string => s != null);
  return [{
    id: 'taiwan',
    domain: 'geo',
    name: 'Taiwan Strait activity',
    value: counts.join(' · '),
    change: fired.map((r) => `${TAIWAN_LABEL[r.key]} ${ratioText(r)} the 30-day median`).join(' · '),
    rule: `≥ ${TAIWAN_RATIO}× the 30-day median`,
    detail: extra.length ? extra.join(' · ') : undefined,
    trust: { level: 'official', source: 'Taiwan MND daily report' },
    at,
    dataDate: `day ${day}`,
    updatedAt: Date.parse(snapshot.generatedAt) || undefined,
    links: linkNews(
      { countries: [{ code: 'TW', name: countryName('TW') }], drivers: ['Taiwan Strait', 'PLA', 'Chinese military'] },
      news, at, LINK_WINDOW_HOURS.geo,
    ),
    place: { countries: ['TW'] },
  }];
}

export function taiwanStraitFeeds(source: ResourceState<CrossStraitActivitySnapshot>, news: readonly LiteItem[], now: number): FeedState[] {
  const data = source.data;
  const report = data ? latestMnd(data, data.coverage?.latestMndReportingDay ?? null) : null;
  const periodEnd = report ? Date.parse(report.reportingPeriod.end) : NaN;
  const base = feedState({
    id: 'taiwan', name: 'Taiwan Strait · Taiwan MND', source, seeder: 'seed-cross-strait-activity',
    cadenceMin: TAIWAN_CADENCE_MIN, dataAt: Number.isFinite(periodEnd) ? periodEnd : null, fired: null, now,
  });
  if (base.kind === 'stale') return [{ ...base, detail: `Late · latest MND report day ${report!.reportingDay}` }];
  if (base.kind !== 'quiet' || !data) return [base];
  if (!report) return [{ kind: 'unavailable', id: base.id, name: base.name, detail: 'No MND report yet · seed-cross-strait-activity' }];
  const ready = taiwanHistoryReady(data);
  if (!ready.ready) return [{ kind: 'unavailable', id: base.id, name: base.name, detail: ready.detail }];
  const counts = taiwanReadings(data).filter((r) => r.current != null).map((r) => `${r.current} ${TAIWAN_LABEL[r.key]}`);
  return feeds(
    base,
    taiwanStraitIndicators(data, news, now),
    `Live · day ${report.reportingDay}: ${counts.join(' · ') || 'counts not stated'}, under ${TAIWAN_RATIO}× the 30-day median`,
  );
}

// ---- Embassy security alerts ------------------------------------------------

export const EMBASSY_WINDOW_HOURS = 24;
/** seed-security-advisories runs hourly. */
export const EMBASSY_CADENCE_MIN = 60;
const EMBASSY_PREFIX = 'US Embassy ';

export interface EmbassyAlerts {
  advisories: SecurityAdvisoryItem[];
  /** When the seeder fetched the feeds (only the bootstrap value carries it). */
  fetchedAt: number | null;
}

const isEmbassy = (a: SecurityAdvisoryItem) => a.source.startsWith(EMBASSY_PREFIX);

/** Each curated hotspot country's first hotspot (the watchlist stand-in; spec Owner decisions). */
function hotspotByCountry(hotspots: readonly Place[]): Map<string, Place> {
  const out = new Map<string, Place>();
  for (const h of hotspots) {
    const mapped = HOTSPOT_COUNTRY_MAP[h.id];
    const codes = mapped == null ? [] : typeof mapped === 'string' ? [mapped] : [...mapped];
    for (const code of codes) if (!out.has(code)) out.set(code, h);
  }
  return out;
}

/** Hotspot countries an embassy feed covered in this data, sorted. */
export function embassyCoverage(data: EmbassyAlerts, hotspots: readonly Place[]): string[] {
  const byCountry = hotspotByCountry(hotspots);
  return [...new Set(data.advisories.filter((a) => isEmbassy(a) && byCountry.has(a.country)).map((a) => a.country))].sort();
}

/** One indicator per US embassy alert in the last 24 h for a curated hotspot's country. */
export function embassyAlertIndicators(data: EmbassyAlerts, hotspots: readonly Place[], news: readonly LiteItem[], now: number): Indicator[] {
  const byCountry = hotspotByCountry(hotspots);
  const seen = new Set<string>();
  const out: Indicator[] = [];
  for (const a of data.advisories) {
    const hotspot = isEmbassy(a) ? byCountry.get(a.country) : undefined;
    const at = Date.parse(a.pubDate);
    if (!hotspot || !Number.isFinite(at) || at > now + HOUR_MS || now - at > EMBASSY_WINDOW_HOURS * HOUR_MS) continue;
    const key = a.link || `${a.source}|${a.title}|${a.pubDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `embassy:${hotspot.id}:${key}`,
      domain: 'geo',
      name: `Embassy alert · ${countryName(a.country)}`,
      value: a.source,
      rule: `new alert ≤ ${EMBASSY_WINDOW_HOURS} h, hotspot country`,
      detail: a.title,
      trust: { level: 'official', source: 'US embassy notice' },
      at: Math.min(at, now),
      updatedAt: data.fetchedAt ?? undefined,
      links: linkNews({ ...hotspotSubject(hotspot), drivers: [hotspot.name, 'embassy'] }, news, Math.min(at, now), LINK_WINDOW_HOURS.geo),
      place: { ...hotspotPlace(hotspot), countries: [a.country] },
    });
  }
  return out.sort((x, y) => y.at - x.at);
}

export function embassyAlertFeeds(source: ResourceState<EmbassyAlerts>, hotspots: readonly Place[], news: readonly LiteItem[], now: number): FeedState[] {
  const base = feedState({
    id: 'embassy', name: 'Embassy alerts · US embassies', source, seeder: 'seed-security-advisories',
    cadenceMin: EMBASSY_CADENCE_MIN, dataAt: source.data?.fetchedAt ?? null, fired: null, now,
  });
  if (base.kind !== 'quiet' || !source.data) return [base];
  const covered = embassyCoverage(source.data, hotspots);
  const coverage = covered.length
    ? `embassy feeds cover ${covered.join(', ')} of the hotspot countries`
    : 'no embassy feed covers a hotspot country';
  return feeds(base, embassyAlertIndicators(source.data, hotspots, news, now), `Live · no alert in ${EMBASSY_WINDOW_HOURS} h · ${coverage}`);
}

// ---- New OFAC sanctions (#118) ----------------------------------------------

/** A designation counts as new for this long after its date. */
export const SANCTIONS_WINDOW_HOURS = 24;
/** seed-sanctions-pressure runs every 6 h. */
export const SANCTIONS_CADENCE_MIN = 360;
/** The feed carries this many entries, newest first (the seeder's DEFAULT_RECENT_LIMIT). */
export const SANCTIONS_ENTRY_LIMIT = 60;
const OFAC_LISTS = new Set(['SDN', 'CONSOLIDATED']);
const SANCTIONS_WORDS = /\b(sanction(s|ed|ing)?|OFAC|designat(ed|es|ion|ions)|blacklist(ed)?|asset freeze)\b/i;

const msOf = (v: string | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : Date.parse(v ?? '') || 0;
};

export interface CountryDesignations {
  code: string;
  name: string;
  entries: SanctionsEntry[];
  /** Programmes, most entries first. */
  programs: string[];
  at: number;
}

/**
 * New OFAC designations (SDN and Consolidated lists) by country: an entry the
 * seeder saw for the first time on its latest run, or whose newest date is in
 * the last 24 h. An entry listing several countries counts for each.
 */
export function newOfacDesignations(data: ListSanctionsPressureResponse, now: number): CountryDesignations[] {
  const fetchedAt = msOf(data.fetchedAt) || now;
  const byCountry = new Map<string, CountryDesignations>();
  for (const e of data.entries) {
    if (!e.sourceLists.some((l) => OFAC_LISTS.has(l))) continue;
    const effective = msOf(e.effectiveAt);
    const recent = effective > 0 && effective <= now + HOUR_MS && now - effective <= SANCTIONS_WINDOW_HOURS * HOUR_MS;
    if (!e.isNew && !recent) continue;
    const at = Math.min(now, e.isNew ? fetchedAt : effective);
    e.countryCodes.forEach((raw, i) => {
      const code = raw.toUpperCase();
      if (!/^[A-Z]{2}$/.test(code)) return;
      const group = byCountry.get(code) ?? { code, name: e.countryNames[i] || countryName(code), entries: [], programs: [], at: 0 };
      group.entries.push(e);
      group.at = Math.max(group.at, at);
      byCountry.set(code, group);
    });
  }
  for (const g of byCountry.values()) {
    const counts = new Map<string, number>();
    for (const e of g.entries) for (const p of e.programs) counts.set(p, (counts.get(p) ?? 0) + 1);
    g.programs = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([p]) => p);
  }
  return [...byCountry.values()].sort((a, b) => b.entries.length - a.entries.length || b.at - a.at);
}

const listMore = (items: readonly string[], shown: number) =>
  items.length > shown ? `${items.slice(0, shown).join(', ')} +${items.length - shown} more` : items.join(', ');

export function newSanctionsIndicators(data: ListSanctionsPressureResponse, news: readonly LiteItem[], now: number): Indicator[] {
  const fetchedAt = msOf(data.fetchedAt) || undefined;
  // The feed carries the newest entries only; a batch larger than that is cut short.
  const truncated = data.entries.length >= SANCTIONS_ENTRY_LIMIT && data.entries.every((e) => e.isNew);
  return newOfacDesignations(data, now).map((g) => {
    const n = g.entries.length;
    const links = linkNews({ countries: [{ code: g.code, name: g.name }] }, news, g.at, LINK_WINDOW_HOURS.geo);
    // A story about the country links only when it is about sanctions.
    const stories = links.stories.filter((st) => SANCTIONS_WORDS.test(`${st.item.title} ${st.item.snippet ?? ''}`));
    return {
      id: `sanctions:${g.code}`,
      domain: 'geo',
      name: `New sanctions · ${g.name}`,
      value: `${n}${truncated ? '+' : ''} designation${n === 1 ? '' : 's'}`,
      change: g.programs.length ? listMore(g.programs, 3) : undefined,
      rule: `new OFAC listing ≤ ${SANCTIONS_WINDOW_HOURS} h`,
      detail: [listMore(g.entries.map((e) => e.name), 3), truncated ? `the feed carries the ${SANCTIONS_ENTRY_LIMIT} newest entries` : null].filter(Boolean).join(' · '),
      trust: { level: 'official', source: 'US Treasury OFAC (SDN, Consolidated)' },
      at: g.at,
      updatedAt: fetchedAt,
      links: { ...links, stories },
      place: { countries: [g.code] },
    } satisfies Indicator;
  });
}

export function newSanctionsFeeds(source: ResourceState<ListSanctionsPressureResponse>, news: readonly LiteItem[], now: number): FeedState[] {
  const base = feedState({
    id: 'sanctions', name: 'New sanctions · OFAC', source, seeder: 'seed-sanctions-pressure',
    cadenceMin: SANCTIONS_CADENCE_MIN, dataAt: source.data ? msOf(source.data.fetchedAt) || null : null, fired: null, now,
  });
  if (base.kind !== 'quiet' || !source.data) return [base];
  const listed = source.data.sdnCount + source.data.consolidatedCount;
  return feeds(base, newSanctionsIndicators(source.data, news, now), `Live · no new OFAC designation in ${SANCTIONS_WINDOW_HOURS} h · ${listed.toLocaleString('en-US')} listed`);
}

// ---- Export controls and tariffs (#122) --------------------------------------

/** A Federal Register document counts as new for this many days: the source is dated, not timed, and this covers a weekend. */
export const FED_REG_NEW_DAYS = 3;
/** seed-federal-register runs every 2 h. */
export const FED_REG_CADENCE_MIN = 120;
const FED_REG_MAX_CARDS = 4;

export interface FederalRegisterDoc {
  id: string;
  title: string;
  type: string;
  action: string;
  agency: 'BIS' | 'USTR';
  kind: 'export-control' | 'tariff';
  /** YYYY-MM-DD. */
  publishedAt: string;
  effectiveOn: string;
  url: string;
  abstract: string;
  aiRelated: boolean;
}

export interface FederalRegisterFeed {
  fetchedAt: number;
  windowDays: number;
  items: FederalRegisterDoc[];
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** The seeded payload (`policy:federal-register:v1`), or null when it is not one. An empty list is valid. */
export function decodeFederalRegister(value: unknown): FederalRegisterFeed | null {
  const v = value as Partial<FederalRegisterFeed> | null;
  if (!v || typeof v !== 'object' || !Number.isFinite(v.fetchedAt) || !Array.isArray(v.items)) return null;
  const str = (x: unknown) => (typeof x === 'string' ? x : '');
  const items: FederalRegisterDoc[] = [];
  for (const raw of v.items as unknown[]) {
    const i = raw as Record<string, unknown>;
    const agency = i?.agency === 'BIS' || i?.agency === 'USTR' ? i.agency : null;
    const kind = i?.kind === 'export-control' || i?.kind === 'tariff' ? i.kind : null;
    if (!agency || !kind || !str(i.id) || !str(i.title) || !DATE_ONLY.test(str(i.publishedAt))) continue;
    items.push({
      id: str(i.id), title: str(i.title), type: str(i.type), action: str(i.action), agency, kind, publishedAt: str(i.publishedAt),
      effectiveOn: DATE_ONLY.test(str(i.effectiveOn)) ? str(i.effectiveOn) : '', url: str(i.url).startsWith('https://www.federalregister.gov/') ? str(i.url) : '',
      abstract: str(i.abstract), aiRelated: i.aiRelated === true,
    });
  }
  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.id.localeCompare(a.id));
  return { fetchedAt: v.fetchedAt as number, windowDays: Number.isInteger(v.windowDays) ? (v.windowDays as number) : 30, items };
}

/** Countries trade and export-control documents name most often, with the adjective headlines use. */
const TRADE_COUNTRIES: ReadonlyArray<{ code: string; names: readonly string[] }> = [
  { code: 'CN', names: ['China', 'Chinese', "People's Republic of China", 'PRC'] },
  { code: 'RU', names: ['Russia', 'Russian'] },
  { code: 'IR', names: ['Iran', 'Iranian'] },
  { code: 'VN', names: ['Vietnam', 'Vietnamese'] },
  { code: 'MX', names: ['Mexico', 'Mexican'] },
  { code: 'CA', names: ['Canada', 'Canadian'] },
  { code: 'IN', names: ['India', 'Indian'] },
  { code: 'JP', names: ['Japan', 'Japanese'] },
  // "Korea" alone is ambiguous; North Korea has its own row.
  { code: 'KR', names: ['South Korea', 'South Korean', 'Republic of Korea'] },
  { code: 'TW', names: ['Taiwan', 'Taiwanese'] },
  { code: 'BR', names: ['Brazil', 'Brazilian'] },
  { code: 'TR', names: ['Turkey', 'Türkiye', 'Turkish'] },
  { code: 'BY', names: ['Belarus', 'Belarusian'] },
  { code: 'KP', names: ['North Korea', 'North Korean'] },
];
const wordRe = (w: string) => new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'iu');

/** ISO2 codes of the countries a text names, in list order. */
export function tradeCountries(text: string): string[] {
  return TRADE_COUNTRIES.filter((c) => c.names.some((n) => wordRe(n).test(text))).map((c) => c.code);
}

const KIND_WORDS: Readonly<Record<FederalRegisterDoc['kind'], RegExp>> = {
  'export-control': /\b(export controls?|entity list|chip curbs?|blacklist(ed)?|semiconductors?|chips?|Commerce Department|BIS)\b/i,
  tariff: /\b(tariffs?|Section (301|232)|duties|trade (war|deal|talks)|USTR|trade representative|exclusions?)\b/i,
};
const KIND_DRIVERS: Readonly<Record<FederalRegisterDoc['kind'], readonly string[]>> = {
  'export-control': ['export controls', 'export control', 'Entity List', 'chip curbs', 'Commerce Department'],
  tariff: ['tariff', 'tariffs', 'Section 301', 'Section 232', 'USTR', 'trade representative'],
};

const daysSinceDate = (date: string, now: number) =>
  Math.floor((Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / (24 * HOUR_MS));
const docLabel = (d: FederalRegisterDoc) => (d.action && d.action.length <= 40 ? d.action.replace(/\.$/, '') : d.type);

/**
 * One card per BIS or USTR document published in the last FED_REG_NEW_DAYS
 * days (rules, proposed rules, and notices that change controls or tariffs;
 * the seeder drops routine notices). News links when a story uses the
 * document's trade or export-control words and, when the title names a
 * country, names that country too.
 */
export function exportControlIndicators(data: FederalRegisterFeed, news: readonly LiteItem[], now: number): Indicator[] {
  return data.items
    .filter((d) => { const age = daysSinceDate(d.publishedAt, now); return age >= 0 && age < FED_REG_NEW_DAYS; })
    .slice(0, FED_REG_MAX_CARDS)
    .map((d) => {
      // Published around 08:45 New York time; the news window ends an hour after.
      const at = Math.min(now, Date.parse(`${d.publishedAt}T14:00:00Z`));
      const codes = tradeCountries(d.title);
      const names = TRADE_COUNTRIES.filter((c) => codes.includes(c.code)).flatMap((c) => c.names);
      const links = linkNews({ countries: codes.map((code) => ({ code, name: countryName(code) })), drivers: [...KIND_DRIVERS[d.kind], ...names] }, news, at, LINK_WINDOW_HOURS.geo);
      const stories = links.stories.filter((st) => {
        const text = `${st.item.title} ${st.item.snippet ?? ''}`;
        return KIND_WORDS[d.kind].test(text) && (!names.length || names.some((n) => wordRe(n).test(text)));
      });
      return {
        id: `export-controls:${d.id}`,
        domain: 'geo',
        name: `${d.kind === 'export-control' ? 'Export controls' : 'Tariffs'} · ${d.agency} ${d.type.toLowerCase()}`,
        value: docLabel(d),
        change: d.effectiveOn ? `effective ${dayMonth(Date.parse(`${d.effectiveOn}T00:00:00Z`))}` : undefined,
        rule: `new ${d.agency} rule or action ≤ ${FED_REG_NEW_DAYS} days`,
        detail: d.title,
        trust: { level: 'official', source: `Federal Register (${d.agency})` },
        at,
        dataDate: `published ${dayMonth(Date.parse(`${d.publishedAt}T00:00:00Z`))}`,
        updatedAt: data.fetchedAt,
        links: { ...links, stories },
        place: codes.length ? { countries: codes } : undefined,
      } satisfies Indicator;
    });
}

export function exportControlFeeds(source: ResourceState<FederalRegisterFeed>, news: readonly LiteItem[], now: number): FeedState[] {
  const base = feedState({
    id: 'export-controls', name: 'Export controls and tariffs · Federal Register', source, seeder: 'seed-federal-register',
    cadenceMin: FED_REG_CADENCE_MIN, dataAt: source.data?.fetchedAt ?? null, fired: null, now,
  });
  if (base.kind !== 'quiet' || !source.data) return [base];
  const latest = source.data.items[0];
  return feeds(base, exportControlIndicators(source.data, news, now), latest
    ? `Live · no BIS or USTR action in ${FED_REG_NEW_DAYS} days · latest ${latest.agency} ${latest.type.toLowerCase()}, ${dayMonth(Date.parse(`${latest.publishedAt}T00:00:00Z`))}`
    : `Live · no BIS or USTR action in ${source.data.windowDays} days`);
}
