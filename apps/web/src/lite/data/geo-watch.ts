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

// ---- New restricted parties (#123) -------------------------------------------

/** An addition counts as new for this long after seed-sanctions-pressure first saw it. */
export const RESTRICTED_WINDOW_HOURS = 24;
/** seed-sanctions-pressure runs every 6 h. */
export const RESTRICTED_CADENCE_MIN = 360;
/** Additions for one country on one list that fire without an Entity List addition. */
export const RESTRICTED_COUNTRY_MIN = 5;
const RESTRICTED_MAX_CARDS = 6;
const RESTRICTED_WORDS = /\b(entity list|export (controls?|curbs?|restrictions?|blacklist)|blacklist(ed)?|trade restrictions?|debar(red|ment)|denied persons|Commerce Department|sanction(s|ed)?)\b/i;

/** The screening lists the projection carries: the BIS export-control lists and the State Department lists. */
export const CSL_LISTS: Readonly<Record<string, { name: string; agency: 'BIS' | 'State' }>> = {
  'CSL-EL': { name: 'Entity List', agency: 'BIS' },
  'CSL-DPL': { name: 'Denied Persons List', agency: 'BIS' },
  'CSL-UVL': { name: 'Unverified List', agency: 'BIS' },
  'CSL-MEU': { name: 'Military End User List', agency: 'BIS' },
  'CSL-DTC': { name: 'ITAR Debarred List', agency: 'State' },
  'CSL-ACN': { name: 'Nonproliferation Sanctions', agency: 'State' },
};
const cslName = (list: string) => CSL_LISTS[list]?.name ?? list;

export interface CslAddition {
  /** When the seeder first saw the party (ms). */
  at: number;
  list: string;
  name: string;
  countries: string[];
  programs: string[];
  /** The list's start date (ms), or 0. */
  effectiveAt: number;
  notice: string;
}

export interface CslListState {
  list: string;
  /** ok, retained (the last good download, kept) or unavailable. */
  status: string;
  count: number;
  /** trade.gov's last import of the list (ms), or null. */
  publishedAt: number | null;
}

export interface CslGap {
  list: string;
  from: number;
  to: number;
  /** retained, unavailable, held (a removal surge) or baseline-unavailable. */
  reason: string;
}

export interface CslAdditionsFeed {
  fetchedAt: number;
  windowDays: number;
  lists: CslListState[];
  events: CslAddition[];
  truncated: boolean;
  gaps: CslGap[];
}

/** The seeded projection (`sanctions:csl-additions:v1`), or null when it is not one. No additions is valid. */
export function decodeCslAdditions(value: unknown): CslAdditionsFeed | null {
  const v = value as Partial<Record<keyof CslAdditionsFeed, unknown>> | null;
  if (!v || typeof v !== 'object' || !Number.isFinite(v.fetchedAt) || !Array.isArray(v.lists) || !Array.isArray(v.events)) return null;
  const str = (x: unknown) => (typeof x === 'string' ? x : '');
  const strs = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const lists = (v.lists as Array<Record<string, unknown>>)
    .filter((l) => str(l?.list))
    .map((l) => ({ list: str(l.list), status: str(l.status) || 'unavailable', count: num(l.count) ?? 0, publishedAt: num(l.publishedAt) }));
  const events: CslAddition[] = [];
  for (const raw of v.events as Array<Record<string, unknown>>) {
    const at = num(raw?.at);
    if (at === null || !str(raw.list) || !str(raw.name)) continue;
    const effective = Number(raw.effectiveAt);
    events.push({
      at, list: str(raw.list), name: str(raw.name),
      countries: strs(raw.cc).map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)),
      programs: strs(raw.pr), effectiveAt: Number.isFinite(effective) && effective > 0 ? effective : 0, notice: str(raw.notice),
    });
  }
  events.sort((a, b) => b.at - a.at);
  const gaps = (Array.isArray(v.gaps) ? (v.gaps as Array<Record<string, unknown>>) : [])
    .filter((g) => str(g?.list) && num(g.from) !== null && num(g.to) !== null)
    .map((g) => ({ list: str(g.list), from: num(g.from)!, to: num(g.to)!, reason: str(g.reason) }));
  return { fetchedAt: v.fetchedAt as number, windowDays: Number.isInteger(v.windowDays) ? (v.windowDays as number) : 7, lists, events, truncated: v.truncated === true, gaps };
}

export interface CountryListings {
  /** ISO2, or '' for parties the list gives no country. */
  code: string;
  name: string;
  additions: CslAddition[];
  /** [list, additions], most first. */
  byList: Array<[string, number]>;
  entityList: number;
  at: number;
}

/**
 * Parties added in the last RESTRICTED_WINDOW_HOURS, by country, for the
 * countries that fire: any Entity List addition, or RESTRICTED_COUNTRY_MIN or
 * more on one list. A party with addresses in several countries counts for
 * each.
 */
export function newRestrictedParties(data: CslAdditionsFeed, now: number): CountryListings[] {
  const byCountry = new Map<string, CountryListings>();
  for (const a of data.events) {
    if (a.at > now + HOUR_MS || now - a.at > RESTRICTED_WINDOW_HOURS * HOUR_MS) continue;
    for (const code of a.countries.length ? a.countries : ['']) {
      const group = byCountry.get(code) ?? { code, name: code ? countryName(code) : 'No country listed', additions: [], byList: [], entityList: 0, at: 0 };
      group.additions.push(a);
      group.at = Math.max(group.at, Math.min(now, a.at));
      byCountry.set(code, group);
    }
  }
  const fired: CountryListings[] = [];
  for (const g of byCountry.values()) {
    const counts = new Map<string, number>();
    for (const a of g.additions) counts.set(a.list, (counts.get(a.list) ?? 0) + 1);
    g.byList = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    g.entityList = counts.get('CSL-EL') ?? 0;
    if (g.entityList > 0 || g.byList.some(([, n]) => n >= RESTRICTED_COUNTRY_MIN)) fired.push(g);
  }
  return fired.sort((a, b) => b.entityList - a.entityList || b.additions.length - a.additions.length || b.at - a.at);
}

export function restrictedPartyIndicators(data: CslAdditionsFeed, news: readonly LiteItem[], now: number): Indicator[] {
  return newRestrictedParties(data, now).slice(0, RESTRICTED_MAX_CARDS).map((g) => {
    const n = g.additions.length;
    const links = linkNews(
      { countries: g.code ? [{ code: g.code, name: g.name }] : undefined, drivers: ['Entity List', 'export controls', 'export blacklist', 'trade blacklist'] },
      news, g.at, LINK_WINDOW_HOURS.geo,
    );
    // A story links only when it is about listings, and names the country (or its adjective) when there is one.
    const names = [g.name, ...(TRADE_COUNTRIES.find((c) => c.code === g.code)?.names ?? [])];
    const stories = links.stories.filter((st) => {
      const text = `${st.item.title} ${st.item.snippet ?? ''}`;
      return RESTRICTED_WORDS.test(text) && (!g.code || names.some((n) => wordRe(n).test(text)));
    });
    const lead = g.additions.find((a) => a.list === 'CSL-EL') ?? g.additions[0];
    const agencies = [...new Set(g.byList.map(([list]) => CSL_LISTS[list]?.agency ?? 'US'))].join(', ');
    return {
      id: `restricted-parties:${g.code || 'none'}`,
      domain: 'geo',
      name: `New restricted parties · ${g.name}`,
      value: `${n}${data.truncated ? '+' : ''} added`,
      change: listMore(g.byList.map(([list, k]) => `${cslName(list)} ${k}`), 3),
      rule: `Entity List addition, or ≥ ${RESTRICTED_COUNTRY_MIN} on one list for a country, ≤ ${RESTRICTED_WINDOW_HOURS} h`,
      detail: [listMore(g.additions.map((a) => a.name), 3), lead?.notice ? lead.notice : null].filter(Boolean).join(' · '),
      trust: { level: 'official', source: `US Consolidated Screening List (${agencies})` },
      at: g.at,
      dataDate: lead?.effectiveAt ? `listed ${dayMonth(lead.effectiveAt)}` : undefined,
      updatedAt: data.fetchedAt,
      links: { ...links, stories },
      place: g.code ? { countries: [g.code] } : undefined,
    } satisfies Indicator;
  });
}

/**
 * What the quiet row says about the comparison: lists the seeder could not
 * compare on its latest run (a failed or held download), or that the first
 * comparison is still to come.
 */
export function cslComparisonNote(data: CslAdditionsFeed): string | null {
  const current = data.gaps.filter((g) => g.to === data.fetchedAt);
  const paused = [...new Set(current.filter((g) => g.reason !== 'baseline-unavailable').map((g) => cslName(g.list)))];
  if (paused.length) return `not compared on the last run: ${paused.join(', ')}`;
  if (current.length) return 'first comparison on the next run';
  return null;
}

export function restrictedPartyFeeds(source: ResourceState<CslAdditionsFeed>, news: readonly LiteItem[], now: number): FeedState[] {
  const base = feedState({
    id: 'restricted-parties', name: 'New restricted parties · BIS and State lists', source, seeder: 'seed-sanctions-pressure',
    cadenceMin: RESTRICTED_CADENCE_MIN, dataAt: source.data?.fetchedAt ?? null, fired: null, now,
  });
  if (base.kind !== 'quiet' || !source.data) return [base];
  const el = source.data.lists.find((l) => l.list === 'CSL-EL');
  const elNote = el && el.count ? `Entity List ${el.count.toLocaleString('en-US')} parties${el.publishedAt ? `, updated ${dayMonth(el.publishedAt)}` : ''}` : null;
  const quiet = ['Live · no new BIS or State listing in 24 h', elNote, cslComparisonNote(source.data)].filter(Boolean).join(' · ');
  return feeds(base, restrictedPartyIndicators(source.data, news, now), quiet);
}

// ---- Travel advisory level changes (#124) ------------------------------------

/** A level change counts as new for this long after seed-travel-advisories first saw it. */
export const TRAVEL_WINDOW_HOURS = 24;
/** seed-travel-advisories runs every 2 h. */
export const TRAVEL_CADENCE_MIN = 120;
const TRAVEL_WORDS = /\b(travel (advisory|advisories|advice|warning|ban)|do not travel|leave (the country|immediately)|evacuat\w*|FCDO|Foreign Office|State Department)\b/i;

/** The US State Department's level names. */
export const US_LEVEL_TEXT: Readonly<Record<number, string>> = {
  1: 'Exercise normal precautions', 2: 'Exercise increased caution', 3: 'Reconsider travel', 4: 'Do not travel',
};
/** The UK FCDO's `alert_status` flags, most severe first. */
export const UK_FLAG_TEXT: Readonly<Record<string, string>> = {
  avoid_all_travel_to_whole_country: 'against all travel',
  avoid_all_travel_to_parts: 'against all travel to parts',
  avoid_all_but_essential_travel_to_whole_country: 'against all but essential travel',
  avoid_all_but_essential_travel_to_parts: 'against all but essential travel to parts',
};
const UK_FLAGS = Object.keys(UK_FLAG_TEXT);
/** Short forms for the card's value line. */
const UK_FLAG_SHORT: Readonly<Record<string, string>> = {
  avoid_all_travel_to_whole_country: 'no travel',
  avoid_all_travel_to_parts: 'no travel to parts',
  avoid_all_but_essential_travel_to_whole_country: 'essential travel only',
  avoid_all_but_essential_travel_to_parts: 'essential travel only, parts',
};

interface ChangeBase {
  /** When the seeder first saw the change (ms). */
  at: number;
  country: string;
  name: string;
  url: string;
  /** The advisory's own issue date (ms), or null. */
  updatedAt: number | null;
}
export interface UsLevelChange extends ChangeBase {
  source: 'US';
  /** Null when the country is new to the register. */
  from: number | null;
  to: number;
}
export interface UkAdviceChange extends ChangeBase {
  source: 'UK';
  from: string[];
  to: string[];
  /** GOV.UK's change description. */
  note: string;
}
export type TravelChange = UsLevelChange | UkAdviceChange;

export interface TravelLevelsFeed {
  fetchedAt: number;
  keepDays: number;
  /** okAt: the source's last good read (ms), or null. */
  us: { ok: boolean; okAt: number | null; countries: number; level4: number; level3: number; baseline: boolean };
  uk: { ok: boolean; okAt: number | null; indexed: number; known: number; pending: number };
  changes: TravelChange[];
}

/** The seeded payload (`intelligence:travel-levels:v1`), or null when it is not one. No changes is valid. */
export function decodeTravelLevels(value: unknown): TravelLevelsFeed | null {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== 'object' || !Number.isFinite(v.fetchedAt) || !Array.isArray(v.changes) || !v.us || !v.uk) return null;
  const str = (x: unknown) => (typeof x === 'string' ? x : '');
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const flags = (x: unknown) => (Array.isArray(x) ? UK_FLAGS.filter((f) => x.includes(f)) : []);
  const level = (x: unknown) => (Number.isInteger(x) && (x as number) >= 1 && (x as number) <= 4 ? (x as number) : null);
  const us = v.us as Record<string, unknown>;
  const uk = v.uk as Record<string, unknown>;
  const changes: TravelChange[] = [];
  for (const raw of v.changes as Array<Record<string, unknown>>) {
    const at = num(raw?.at);
    const country = str(raw?.country).toUpperCase();
    if (at === null || !/^[A-Z]{2}$/.test(country)) continue;
    const base = { at, country, name: str(raw.name), url: /^https:\/\/(travel\.state\.gov|www\.gov\.uk)\//.test(str(raw.url)) ? str(raw.url) : '', updatedAt: num(raw.updatedAt) };
    if (raw.source === 'US' && level(raw.to) !== null) changes.push({ ...base, source: 'US', from: level(raw.from), to: level(raw.to)! });
    else if (raw.source === 'UK' && Array.isArray(raw.to)) changes.push({ ...base, source: 'UK', from: flags(raw.from), to: flags(raw.to), note: str(raw.note) });
  }
  changes.sort((a, b) => b.at - a.at);
  return {
    fetchedAt: v.fetchedAt as number,
    keepDays: Number.isInteger(v.keepDays) ? (v.keepDays as number) : 14,
    us: { ok: us.ok === true, okAt: num(us.okAt), countries: num(us.countries) ?? 0, level4: num(us.level4) ?? 0, level3: num(us.level3) ?? 0, baseline: us.baseline === true },
    uk: { ok: uk.ok === true, okAt: num(uk.okAt), indexed: num(uk.indexed) ?? 0, known: num(uk.known) ?? 0, pending: num(uk.pending) ?? 0 },
    changes,
  };
}

/**
 * Whether a change fires: a US level that rises (or a country new to the
 * register at Level 3 or 4), or UK advice that adds a flag against travel.
 */
export function travelChangeFires(c: TravelChange): boolean {
  if (c.source === 'US') return c.from === null ? c.to >= 3 : c.to > c.from;
  return c.to.some((f) => !c.from.includes(f));
}

/** One card per source and hotspot country whose advice tightened in the last TRAVEL_WINDOW_HOURS (the newest change). */
export function travelAdvisoryIndicators(data: TravelLevelsFeed, hotspots: readonly Place[], news: readonly LiteItem[], now: number): Indicator[] {
  const byCountry = hotspotByCountry(hotspots);
  const seen = new Set<string>();
  const out: Indicator[] = [];
  for (const c of data.changes) {
    const hotspot = byCountry.get(c.country);
    if (!hotspot || c.at > now + HOUR_MS || now - c.at > TRAVEL_WINDOW_HOURS * HOUR_MS || !travelChangeFires(c)) continue;
    const id = `travel-advisory:${c.source}:${c.country}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const at = Math.min(c.at, now);
    const subject = hotspotSubject(hotspot);
    const links = linkNews({ ...subject, countries: [{ code: c.country, name: countryName(c.country) }], drivers: ['travel advisory', 'do not travel', 'travel warning'] }, news, at, LINK_WINDOW_HOURS.geo);
    // A story links only when it is about travel advice.
    const stories = links.stories.filter((st) => TRAVEL_WORDS.test(`${st.item.title} ${st.item.snippet ?? ''}`));
    const us = c.source === 'US';
    out.push({
      id,
      domain: 'geo',
      name: `Travel advisory · ${countryName(c.country)}`,
      value: us ? `US Level ${c.to}` : `UK: ${UK_FLAG_SHORT[c.to[0]!] ?? 'advice changed'}`,
      change: us
        ? (c.from === null ? 'newly listed' : `from Level ${c.from}`)
        : (c.from.length ? `was ${UK_FLAG_SHORT[c.from[0]!]}` : 'was no warning'),
      rule: `US level rises, or new at Level 3–4; UK adds advice against travel; ≤ ${TRAVEL_WINDOW_HOURS} h, hotspot country`,
      detail: us ? US_LEVEL_TEXT[c.to] : [`FCDO advises ${c.to.map((f) => UK_FLAG_TEXT[f]).join('; ')}`, c.note].filter(Boolean).join(' · '),
      trust: { level: 'official', source: us ? 'US State Department' : 'UK FCDO (GOV.UK)' },
      at,
      dataDate: c.updatedAt ? `issued ${dayMonth(c.updatedAt)}` : undefined,
      updatedAt: data.fetchedAt,
      links: { ...links, stories },
      place: { ...hotspotPlace(hotspot), countries: [c.country] },
    });
  }
  return out.sort((x, y) => y.at - x.at);
}

/** What the quiet row says about coverage: a source that failed, a baseline still being set. */
export function travelCoverageNote(data: TravelLevelsFeed): string {
  const parts: string[] = [];
  if (!data.us.ok) parts.push(data.us.okAt ? `US register last read ${dayMonth(data.us.okAt)} ${new Date(data.us.okAt).toISOString().slice(11, 16)} UTC` : 'US register not read yet');
  else if (!data.us.baseline) parts.push('US baseline set; changes count from the next run');
  else parts.push(`US Level 4 in ${data.us.level4} countries`);
  if (!data.uk.ok) parts.push(data.uk.okAt ? `GOV.UK last read ${dayMonth(data.uk.okAt)} ${new Date(data.uk.okAt).toISOString().slice(11, 16)} UTC` : 'GOV.UK not read yet');
  else if (data.uk.pending > 0) parts.push(`UK baseline ${data.uk.known} of ${data.uk.indexed} countries`);
  return parts.join(' · ');
}

/** The feed is as fresh as its older source: the older last good read, else the fetch time. */
export function travelDataAt(data: TravelLevelsFeed | null): number | null {
  if (!data) return null;
  const reads = [data.us.okAt, data.uk.okAt].filter((t): t is number => t !== null);
  return reads.length ? Math.min(data.fetchedAt, ...reads) : data.fetchedAt;
}

export function travelAdvisoryFeeds(source: ResourceState<TravelLevelsFeed>, hotspots: readonly Place[], news: readonly LiteItem[], now: number): FeedState[] {
  const base = feedState({
    id: 'travel-advisory', name: 'Travel advisories · US and UK', source, seeder: 'seed-travel-advisories',
    cadenceMin: TRAVEL_CADENCE_MIN, dataAt: travelDataAt(source.data), fired: null, now,
  });
  if (base.kind !== 'quiet' || !source.data) return [base];
  return feeds(base, travelAdvisoryIndicators(source.data, hotspots, news, now), `Live · no tighter advice for a hotspot country in ${TRAVEL_WINDOW_HOURS} h · ${travelCoverageNote(source.data)}`);
}

// ---- New EU (#129) and UK (#140) sanctions -----------------------------------
// One reader for both lists: seed-eu-sanctions and seed-uk-sanctions compare each run's ids with the last run's
// and publish the same shape, so only the labels, the source and the allowed link differ.

/** A listing counts as new for this long after its seeder first saw it. */
export const EU_SANCTIONS_WINDOW_HOURS = 24;
/** seed-eu-sanctions and seed-uk-sanctions run every 6 h. */
export const EU_SANCTIONS_CADENCE_MIN = 360;
/** New listings in the window that fire for every country, not only hotspot countries. */
export const EU_SANCTIONS_DAY_MIN = 5;
const EU_SANCTIONS_MAX_CARDS = 6;
const EU_SANCTIONS_WORDS = /\b(sanction(s|ed|ing)?|asset freeze|frozen|restrictive measures|blacklist(ed)?|designat(ed|es|ion|ions))\b/i;

export interface EuListing {
  /** When the seeder first saw the entity (ms). */
  at: number;
  id: string;
  /** EU reference number (e.g. EU.1234.56), or the UK list's UniqueID (e.g. RUS1000). */
  ref: string;
  name: string;
  /** person, entity, ship (UK) or the list's own subject code. */
  type: string;
  /** Regime codes, e.g. RUS, IRN, BLR. */
  programmes: string[];
  countries: string[];
  /** The designation date, else the earliest act's publication date (YYYY-MM-DD), or ''. */
  listedOn: string;
  /** The act (EU) or the regime's regulations (UK). */
  regulation: string;
  url: string;
}

/** The labels, source and allowed link of one sanctions list. */
interface SanctionsList {
  /** Feed id, and the prefix of each card's id. */
  id: string;
  /** EU or UK, as the cards name it. */
  label: string;
  seeder: string;
  trust: string;
  drivers: string[];
  /** The only links kept: '' keeps none. */
  urlPrefix: string;
}

const EU_LIST: SanctionsList = {
  id: 'eu-sanctions', label: 'EU', seeder: 'seed-eu-sanctions', trust: 'European Commission (EU financial sanctions list)',
  drivers: ['EU sanctions', 'restrictive measures', 'asset freeze'], urlPrefix: 'https://eur-lex.europa.eu/',
};
const UK_LIST: SanctionsList = {
  id: 'uk-sanctions', label: 'UK', seeder: 'seed-uk-sanctions', trust: 'FCDO (UK Sanctions List)',
  drivers: ['UK sanctions', 'asset freeze', 'OFSI'], urlPrefix: '',
};

export interface EuSanctionsFeed {
  fetchedAt: number;
  generatedAt: number | null;
  entityCount: number;
  /** When the seeder first read the list: nothing before it can show as new. */
  baselineAt: number;
  windowDays: number;
  additions: EuListing[];
}

/** The seeded payload (`sanctions:eu-additions:v1`), or null when it is not one. No new listing is valid. */
export const decodeEuSanctions = (value: unknown): EuSanctionsFeed | null => decodeSanctionsList(value, EU_LIST);
/** The seeded payload (`sanctions:uk-additions:v1`, the EU shape), or null when it is not one. */
export const decodeUkSanctions = (value: unknown): EuSanctionsFeed | null => decodeSanctionsList(value, UK_LIST);

function decodeSanctionsList(value: unknown, list: SanctionsList): EuSanctionsFeed | null {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== 'object' || !Number.isFinite(v.fetchedAt) || !Array.isArray(v.additions) || !Number.isFinite(v.entityCount)) return null;
  const str = (x: unknown) => (typeof x === 'string' ? x : '');
  const strs = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const additions: EuListing[] = [];
  for (const raw of v.additions as Array<Record<string, unknown>>) {
    const at = num(raw?.at);
    if (at === null || !str(raw.id) || !str(raw.name)) continue;
    additions.push({
      at, id: str(raw.id), ref: str(raw.ref), name: str(raw.name), type: str(raw.type), programmes: strs(raw.programmes),
      countries: strs(raw.countries).map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)),
      listedOn: /^\d{4}-\d{2}-\d{2}$/.test(str(raw.listedOn)) ? str(raw.listedOn) : '', regulation: str(raw.regulation),
      url: list.urlPrefix && str(raw.url).startsWith(list.urlPrefix) ? str(raw.url) : '',
    });
  }
  additions.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  return {
    fetchedAt: v.fetchedAt as number, generatedAt: num(v.generatedAt), entityCount: v.entityCount as number,
    baselineAt: num(v.baselineAt) ?? (v.fetchedAt as number), windowDays: Number.isInteger(v.windowDays) ? (v.windowDays as number) : 14, additions,
  };
}

export interface EuCountryListings {
  /** ISO2, or '' for listings with no country. */
  code: string;
  name: string;
  listings: EuListing[];
  /** Regimes, most listings first. */
  programmes: string[];
  hotspot: boolean;
  at: number;
}

/**
 * Listings first seen in the last EU_SANCTIONS_WINDOW_HOURS, by country,
 * for the countries that fire: any listing for a curated hotspot's country,
 * or every country once EU_SANCTIONS_DAY_MIN or more listings arrived. A
 * listing with several countries counts for each.
 */
export function newEuListings(data: EuSanctionsFeed, hotspots: readonly Place[], now: number): { groups: EuCountryListings[]; total: number } {
  const hotspotCodes = hotspotByCountry(hotspots);
  const recent = data.additions.filter((a) => a.at <= now + HOUR_MS && now - a.at <= EU_SANCTIONS_WINDOW_HOURS * HOUR_MS);
  const byCountry = new Map<string, EuCountryListings>();
  for (const a of recent) {
    for (const code of a.countries.length ? a.countries : ['']) {
      const group = byCountry.get(code) ?? { code, name: code ? countryName(code) : 'No country listed', listings: [], programmes: [], hotspot: hotspotCodes.has(code), at: 0 };
      group.listings.push(a);
      group.at = Math.max(group.at, Math.min(now, a.at));
      byCountry.set(code, group);
    }
  }
  for (const g of byCountry.values()) {
    const counts = new Map<string, number>();
    for (const a of g.listings) for (const p of a.programmes) counts.set(p, (counts.get(p) ?? 0) + 1);
    g.programmes = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([p]) => p);
  }
  const busy = recent.length >= EU_SANCTIONS_DAY_MIN;
  const groups = [...byCountry.values()]
    .filter((g) => g.hotspot || busy)
    .sort((a, b) => Number(b.hotspot) - Number(a.hotspot) || b.listings.length - a.listings.length || b.at - a.at);
  return { groups, total: recent.length };
}

function sanctionsListIndicators(list: SanctionsList, data: EuSanctionsFeed, hotspots: readonly Place[], news: readonly LiteItem[], now: number): Indicator[] {
  const { groups, total } = newEuListings(data, hotspots, now);
  return groups.slice(0, EU_SANCTIONS_MAX_CARDS).map((g) => {
    const n = g.listings.length;
    const links = linkNews({ countries: g.code ? [{ code: g.code, name: g.name }] : undefined, drivers: list.drivers }, news, g.at, LINK_WINDOW_HOURS.geo);
    // A story links only when it is about sanctions.
    const stories = links.stories.filter((st) => EU_SANCTIONS_WORDS.test(`${st.item.title} ${st.item.snippet ?? ''}`));
    const regulation = g.listings.find((a) => a.regulation)?.regulation;
    return {
      id: `${list.id}:${g.code || 'none'}`,
      domain: 'geo',
      name: `New ${list.label} sanctions · ${g.name}`,
      value: `${n} listing${n === 1 ? '' : 's'}`,
      change: g.programmes.length ? listMore(g.programmes, 3) : undefined,
      rule: g.hotspot ? `new ${list.label} listing ≤ ${EU_SANCTIONS_WINDOW_HOURS} h, hotspot country` : `${EU_SANCTIONS_DAY_MIN}+ ${list.label} listings ≤ ${EU_SANCTIONS_WINDOW_HOURS} h (${total} today)`,
      detail: [listMore(g.listings.map((a) => a.name), 3), regulation ? `under ${regulation}` : null].filter(Boolean).join(' · '),
      trust: { level: 'official', source: list.trust },
      at: g.at,
      updatedAt: data.fetchedAt,
      links: { ...links, stories },
      ...(g.code ? { place: { countries: [g.code] } } : {}),
    } satisfies Indicator;
  });
}

export const euSanctionsIndicators = (data: EuSanctionsFeed, hotspots: readonly Place[], news: readonly LiteItem[], now: number): Indicator[] =>
  sanctionsListIndicators(EU_LIST, data, hotspots, news, now);

export const euSanctionsFeeds = (source: ResourceState<EuSanctionsFeed>, hotspots: readonly Place[], news: readonly LiteItem[], now: number): FeedState[] =>
  sanctionsListFeeds(EU_LIST, source, hotspots, news, now);
export const ukSanctionsFeeds = (source: ResourceState<EuSanctionsFeed>, hotspots: readonly Place[], news: readonly LiteItem[], now: number): FeedState[] =>
  sanctionsListFeeds(UK_LIST, source, hotspots, news, now);

function sanctionsListFeeds(list: SanctionsList, source: ResourceState<EuSanctionsFeed>, hotspots: readonly Place[], news: readonly LiteItem[], now: number): FeedState[] {
  const base = feedState({
    id: list.id, name: `New sanctions · ${list.label}`, source, seeder: list.seeder,
    cadenceMin: EU_SANCTIONS_CADENCE_MIN, dataAt: source.data?.fetchedAt ?? null, fired: null, now,
  });
  if (base.kind !== 'quiet' || !source.data) return [base];
  const d = source.data;
  const { total } = newEuListings(d, hotspots, now);
  const listed = `${d.entityCount.toLocaleString('en-US')} listed`;
  const quiet = now - d.baselineAt < EU_SANCTIONS_WINDOW_HOURS * HOUR_MS
    ? `Live · first read of the list ${dayMonth(d.baselineAt)}; new listings show from the next change · ${listed}`
    : total
      ? `Live · ${total} new ${list.label} listing${total === 1 ? '' : 's'} in ${EU_SANCTIONS_WINDOW_HOURS} h, none for a hotspot country · ${listed}`
      : `Live · no new ${list.label} listing in ${EU_SANCTIONS_WINDOW_HOURS} h · ${listed}`;
  return feeds(base, sanctionsListIndicators(list, d, hotspots, news, now), quiet);
}

// ---- Elections (#141) ---------------------------------------------------------

/** An election this close fires for a hotspot country. */
export const ELECTION_WINDOW_DAYS = 30;
/** seed-elections runs every 12 h. */
export const ELECTIONS_CADENCE_MIN = 720;
const ELECTIONS_MAX_CARDS = 6;
const ELECTION_WORDS = /\b(elections?|electoral|vote[sd]?|voting|voters?|ballots?|polls?|referend(um|a|ums)|campaign(s|ing)?|candidates?)\b/i;

export interface Election {
  /** First voting day (YYYY-MM-DD). */
  date: string;
  /** Last voting day of a multi-day vote, else null. */
  endDate: string | null;
  /** ISO2. */
  country: string;
  countryName: string;
  /** The office or chamber: "President (1st round)", "Senate and Congress of Deputies". */
  body: string;
  /** The election's Wikipedia article, or ''. */
  url: string;
}

export interface ElectionsFeed {
  fetchedAt: number;
  /** The calendar pages read: last year's, this year's and next year's. */
  pages: { year: number; found: boolean; entries: number }[];
  elections: Election[];
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** The seeded payload (`intelligence:elections:v1`), or null when it is not one. */
export function decodeElections(value: unknown): ElectionsFeed | null {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== 'object' || !Number.isFinite(v.fetchedAt) || !Array.isArray(v.elections) || !Array.isArray(v.pages)) return null;
  const str = (x: unknown) => (typeof x === 'string' ? x : '');
  const pages = (v.pages as Array<Record<string, unknown>>)
    .filter((p) => p && Number.isInteger(p.year))
    .map((p) => ({ year: p.year as number, found: p.found === true, entries: Number.isFinite(p.entries) ? (p.entries as number) : 0 }));
  const elections: Election[] = [];
  for (const raw of v.elections as Array<Record<string, unknown>>) {
    const date = str(raw?.date);
    const country = str(raw?.country).toUpperCase();
    if (!YMD.test(date) || !/^[A-Z]{2}$/.test(country)) continue;
    elections.push({
      date, endDate: YMD.test(str(raw.endDate)) ? str(raw.endDate) : null, country, countryName: str(raw.countryName) || countryName(country),
      body: str(raw.body), url: str(raw.url).startsWith('https://en.wikipedia.org/wiki/') ? str(raw.url) : '',
    });
  }
  elections.sort((a, b) => a.date.localeCompare(b.date) || a.country.localeCompare(b.country));
  return { fetchedAt: v.fetchedAt as number, pages, elections };
}

const ymdMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
/** Whole UTC days from now's day to the vote's first day. */
const daysUntil = (e: Election, now: number) => Math.round((ymdMs(e.date) - ymdMs(new Date(now).toISOString().slice(0, 10))) / (24 * HOUR_MS));
const inDays = (n: number) => (n <= 0 ? 'voting now' : n === 1 ? 'tomorrow' : `in ${n} days`);
/** "29 Nov", "18–20 Sept", or "30 Nov–1 Dec" across a month end. */
const voteDate = (e: Election) => {
  if (!e.endDate || e.endDate === e.date) return dayMonth(ymdMs(e.date));
  const end = dayMonth(ymdMs(e.endDate));
  return e.date.slice(0, 7) === e.endDate.slice(0, 7) ? `${Number(e.date.slice(8))}–${end}` : `${dayMonth(ymdMs(e.date))}–${end}`;
};

/** Elections not over yet (by their last voting day) that start within ELECTION_WINDOW_DAYS, soonest first. */
export function upcomingElections(data: ElectionsFeed, now: number): Election[] {
  const today = new Date(now).toISOString().slice(0, 10);
  return data.elections.filter((e) => (e.endDate ?? e.date) >= today && daysUntil(e, now) <= ELECTION_WINDOW_DAYS);
}

/** One card per upcoming election in a curated hotspot's country (the watchlist stand-in). */
export function electionIndicators(data: ElectionsFeed, hotspots: readonly Place[], news: readonly LiteItem[], now: number): Indicator[] {
  const byCountry = hotspotByCountry(hotspots);
  return upcomingElections(data, now).filter((e) => byCountry.has(e.country)).slice(0, ELECTIONS_MAX_CARDS).map((e) => {
    const links = linkNews({ countries: [{ code: e.country, name: e.countryName }], drivers: ['election', 'referendum', 'vote'] }, news, data.fetchedAt, LINK_WINDOW_HOURS.geo);
    // A story links only when it is about the vote.
    const stories = links.stories.filter((st) => ELECTION_WORDS.test(`${st.item.title} ${st.item.snippet ?? ''}`));
    return {
      id: `elections:${e.country}:${e.date}`,
      domain: 'geo',
      name: `Election · ${e.countryName}`,
      // The voting days show once, in place of the clock time (dataDate).
      value: inDays(daysUntil(e, now)),
      rule: `national election ≤ ${ELECTION_WINDOW_DAYS} days, hotspot country`,
      detail: e.body || undefined,
      trust: { level: 'reported', source: 'Wikipedia (national electoral calendar)', ...(e.url ? { url: e.url } : {}) },
      at: data.fetchedAt,
      dataDate: `vote ${voteDate(e)}`,
      updatedAt: data.fetchedAt,
      links: { ...links, stories },
      place: { countries: [e.country] },
    } satisfies Indicator;
  });
}

export function electionFeeds(source: ResourceState<ElectionsFeed>, hotspots: readonly Place[], news: readonly LiteItem[], now: number): FeedState[] {
  const base = feedState({
    id: 'elections', name: 'Elections · national', source, seeder: 'seed-elections',
    cadenceMin: ELECTIONS_CADENCE_MIN, dataAt: source.data?.fetchedAt ?? null, fired: null, now,
  });
  if (base.kind !== 'quiet' || !source.data) return [base];
  const d = source.data;
  const byCountry = hotspotByCountry(hotspots);
  const soon = upcomingElections(d, now);
  const today = new Date(now).toISOString().slice(0, 10);
  const nextHot = d.elections.find((e) => (e.endDate ?? e.date) >= today && byCountry.has(e.country));
  // This year's or next year's page that is missing, or found but with nothing dated read from it (a layout change):
  // either hides part of the 30-day window, so the quiet line says so.
  const year = new Date(now).getUTCFullYear();
  const missing = d.pages.filter((p) => p.year >= year && !p.found).map((p) => p.year);
  const unreadable = d.pages.filter((p) => p.year >= year && p.found && p.entries === 0).map((p) => p.year);
  const quiet = [
    `Live · no national election within ${ELECTION_WINDOW_DAYS} days in a hotspot country`,
    soon.length ? `${soon.length} elsewhere, first ${soon[0]!.countryName} ${voteDate(soon[0]!)}` : null,
    nextHot ? `next hotspot vote ${nextHot.countryName} ${voteDate(nextHot)}` : null,
    missing.length ? `no ${missing.join(', ')} calendar yet` : null,
    unreadable.length ? `${unreadable.join(', ')} calendar unreadable` : null,
  ].filter(Boolean).join(' · ');
  return feeds(base, electionIndicators(d, hotspots, news, now), quiet);
}
