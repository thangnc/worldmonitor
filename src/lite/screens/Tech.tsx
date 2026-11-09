import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Box, Check, CheckCheck, CloudOff, Cpu, Landmark, Quote, Scale, Server, ShieldAlert, Sparkles, Waypoints, type LucideIcon } from 'lucide-preact';
import { getLatestActions, getUpcomingDeadlines } from '@/config/ai-regulations';
import { Topbar, matchesSearch } from '../components/Topbar';
import { Card, ColLabel, DerivedTag, Dot, Panel, SampleBadge, SegmentedControl, SourceState, TEXT, cx } from '../components/ui';
import { HealthDots, IndicatorFeed } from '../components/indicator';
import { LayersPopover, type LayerGroup } from '../components/LayersPopover';
import { LiteMap, type MapMarker, type MapOverlays } from '../map/LiteMap';
import { AggregateMark, AssetMark, EventMark, LineSwatch, RampSwatch, SwatchRun } from '../map/marks';
import { LegendRow, MapLegend } from '../map/legend';
import {
  selectTechDevelopments,
  useArxiv,
  useCableHealth,
  useCountryShapes,
  useCyberThreats,
  useDdosAttacks,
  useDigest,
  useTechGeo,
  useHackerNews,
  useInternetOutages,
  useRecentKev,
  useServiceStatuses,
  useThreatHistory,
} from '../data/hooks';
import { SAMPLE_MODELS } from '../data/fixtures';
import { MINUS } from '../format';
import { feedCounts, type FeedState } from '../data/indicators';
import {
  DATACENTER_MIN_CHIPS,
  MAP_OUTAGE_DAYS,
  attackHexes,
  cableLayer,
  cloudRegionMarkers,
  datacenterMarkers,
  ddosLayer,
  outageMarkers,
  type TechLayer,
} from '../data/tech-map';
import type { ResourceState } from '../data/store';
import {
  SPIKE_BASELINE_DAYS,
  TECH_RULES,
  WATCHED_PROVIDERS,
  isOutageLive,
  isWatchedOutage,
  kevWeekCounts,
  techFeeds,
  threatBaseline,
} from '../data/tech-indicators';
import {
  CORROBORATION_VIEW,
  TECH_FILTER_CATEGORIES,
  byImportance,
  cleanSnippet,
  corroborationOf,
  digestItems,
  isPrimarySource,
  relativeTime,
  sourceCount,
  techType,
  topicCounts,
  type LiteItem,
  type TechFilter,
  type Tone,
} from '../data/transforms';

const FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'models', label: 'Models' },
  { value: 'policy', label: 'Policy' },
  { value: 'research', label: 'Research' },
  { value: 'infra', label: 'Infra' },
] as const satisfies ReadonlyArray<{ value: TechFilter; label: string }>;

const TYPE_ICON: Record<string, LucideIcon> = {
  REGULATION: Scale,
  RELEASE: Box,
  INFRA: Server,
  SECURITY: ShieldAlert,
  OUTAGE: CloudOff,
  RESEARCH: Landmark,
  AI: Sparkles,
};

/** The digest snippet without HTML entities, or nothing when it repeats the title. */
/**
 * Status pill from the dashboard's corroboration verdict. A tier-1 outlet
 * reporting alone reads "Primary source"; tier 1 never upgrades the verdict.
 */
function evidencePill(item: LiteItem): { label: string; tone: Tone; Icon: LucideIcon } {
  const verdict = corroborationOf(item);
  if (verdict.state === 'corroborated') return { label: 'Corroborated', tone: 'ok', Icon: CheckCheck };
  if (verdict.state !== 'tier4-only' && isPrimarySource(item.source)) return { label: 'Primary source', tone: 'ok', Icon: Check };
  const view = CORROBORATION_VIEW[verdict.state];
  return { label: view.label, tone: view.tone, Icon: Quote };
}

/** Topics the owner watches. Counts are title matches in the tech digest. */
const WATCHED_TOPICS = [
  { label: 'Open weights', pattern: /open[- ]weights?|open[- ]source model/i },
  { label: 'Frontier evals', pattern: /benchmark|eval(uation)?s?\b/i },
  { label: 'AI security', pattern: /prompt injection|jailbreak|vulnerab|exploit|CVE-/i },
  { label: 'Compute export', pattern: /export control|chip export|entity list/i },
  { label: 'EU AI Act', pattern: /AI Act|AI Office/i },
  { label: 'Agents', pattern: /\bagent(s|ic)?\b/i },
] as const;

export function Tech() {
  const [filter, setFilter] = useState<TechFilter>('all');
  // An indicator card asks the map to open its marker ("outage:cf-1", "provider:aws", "attackers").
  const [focus, setFocus] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const digest = useDigest('tech');
  const all = useMemo(() => (digest.status === 'ready' ? selectTechDevelopments(digest.data) : []), [digest]);
  const rows = all.filter(
    (i) => (filter === 'all' || TECH_FILTER_CATEGORIES[filter].includes(i.category)) && matchesSearch(search, i.title, i.source),
  );

  return (
    <>
      <Topbar
        title="Technology & AI"
        subtitle={<>{digest.status === 'ready' ? `${all.length} developments in the digest` : 'Loading developments'} · primary sources first</>}
        filter={<SegmentedControl label="Development type" options={FILTER_OPTIONS} value={filter} onChange={setFilter} />}
        search={search}
        onSearch={setSearch}
        actionLabel="Add to tracker"
      />
      <div class="flex flex-col gap-6 px-4 py-6 wide:flex-row wide:px-7">
        <div class="flex min-w-0 flex-1 flex-col gap-5">
          <InfraMap focus={focus} onFocus={setFocus} />
          <Developments state={digest} rows={rows} total={all.length} />
          <ModelTracker />
        </div>
        <div class="flex w-full flex-col gap-4 wide:w-[352px] wide:shrink-0">
          <Indicators onOpen={(feed) => setFocus(feed.kind === 'fired' ? feed.indicator.focusId ?? null : null)} />
          <Policy />
          <ResearchRadar />
          <InfraBusiness state={digest} />
          <WatchedTopics titles={all.map((i) => i.title)} />
        </div>
      </div>
    </>
  );
}


const ALL_ON: Record<TechLayer, boolean> = { ddos: true, attackers: true, outages: true, cloud: true, datacenters: true, cables: true };

// The same swatches as the map, states in the spec's order: normal, elevated, critical.
const LEGEND: ReadonlyArray<{ key: TechLayer; mark: preact.JSX.Element; label: string; sub: string }> = [
  { key: 'ddos', mark: <RampSwatch />, label: 'DDoS targets', sub: 'who is attacked' },
  { key: 'attackers', mark: <AggregateMark count={0} fullAt={1} state="normal" size={12} />, label: 'Attack servers', sub: 'where attackers sit' },
  { key: 'outages', mark: <SwatchRun><EventMark glyph="wifi-off" state="elev" /><EventMark glyph="zap" state="crit" /></SwatchRun>, label: 'Outages', sub: 'partial · major, glyph = cause' },
  { key: 'cloud', mark: <SwatchRun><AssetMark glyph="cloud" state="normal" /><AssetMark glyph="cloud" state="elev" /><AssetMark glyph="cloud" state="crit" /></SwatchRun>, label: 'Cloud regions', sub: 'worst status per city' },
  { key: 'datacenters', mark: <SwatchRun><AssetMark glyph="cpu" state="normal" /><AssetMark glyph="cpu" state="elev" /></SwatchRun>, label: 'AI data centres', sub: 'amber = outage in country' },
  { key: 'cables', mark: <SwatchRun><LineSwatch state="normal" /><LineSwatch state="elev" /><LineSwatch state="crit" /></SwatchRun>, label: 'Undersea cables', sub: 'ok · degraded · fault' },
];

/** The popover's one mark per layer. */
const POPOVER_MARK: Record<TechLayer, preact.JSX.Element> = {
  ddos: <RampSwatch steps={[2, 3, 4]} />,
  attackers: <AggregateMark count={0} fullAt={1} state="normal" size={12} />,
  outages: <EventMark glyph="wifi-off" state="crit" />,
  cloud: <AssetMark glyph="cloud" state="normal" />,
  datacenters: <AssetMark glyph="cpu" state="normal" />,
  cables: <LineSwatch state="normal" />,
};


function InfraMap({ focus, onFocus }: { focus: string | null; onFocus: (key: string | null) => void }) {
  const [layers, setLayers] = useState<Record<TechLayer, boolean>>(ALL_ON);
  const ddos = useDdosAttacks();
  const shapes = useCountryShapes(layers.ddos);
  const threats = useCyberThreats();
  const outages = useInternetOutages();
  const services = useServiceStatuses();
  const cables = useCableHealth();
  const geo = useTechGeo();
  const card = useRef<HTMLDivElement>(null);

  const built = useMemo(() => {
    const now = Date.now();
    const markers: MapMarker[] = [];
    const overlays: MapOverlays = {};
    if (layers.ddos && ddos.status === 'ready') {
      const d = ddosLayer(ddos.data, shapes.status === 'ready' ? shapes.data : null);
      overlays.fills = d.fills;
      markers.push(...d.tags);
    }
    if (layers.cables && geo.status === 'ready') {
      const c = cableLayer(geo.data.cables, cables.status === 'ready' ? cables.data : null);
      overlays.lines = c.lines;
      markers.push(...c.markers);
    }
    if (layers.cloud && geo.status === 'ready') markers.push(...cloudRegionMarkers(geo.data.regions, services.status === 'ready' ? services.data.statuses : []));
    if (layers.datacenters && geo.status === 'ready') markers.push(...datacenterMarkers(geo.data.datacenters, outages.status === 'ready' ? outages.data.outages : [], now));
    if (layers.outages && outages.status === 'ready') markers.push(...outageMarkers(outages.data.outages, now));
    if (layers.attackers && threats.status === 'ready') markers.push(...attackHexes(threats.data));
    return { markers, overlays };
  }, [layers, ddos, shapes, threats, outages, services, cables, geo]);

  // Resolve an indicator's focus key against the markers on the map.
  const focusId = useMemo(() => {
    if (!focus) return null;
    if (focus.startsWith('provider:')) {
      // The provider's worst city: red before amber before grey.
      const rank = { crit: 0, elev: 1, normal: 2 } as const;
      const cities = built.markers.filter((m) => m.kind === 'asset' && m.keys?.includes(focus));
      return cities.sort((a, b) => (a.kind === 'asset' && b.kind === 'asset' ? rank[a.state] - rank[b.state] : 0))[0]?.id ?? null;
    }
    if (focus === 'attackers') return built.markers.find((m) => m.id.startsWith('attack:'))?.id ?? null;
    return built.markers.find((m) => m.id === focus)?.id ?? null;
  }, [focus, built]);
  useEffect(() => {
    if (focusId) card.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [focusId]);

  const failed = [
    { state: ddos, name: 'DDoS targets', source: 'seed-internet-outages' },
    { state: threats, name: 'Attack servers', source: 'seed-cyber-threats' },
    { state: outages, name: 'Outages', source: 'seed-internet-outages' },
    { state: services, name: 'Cloud status', source: 'list-service-statuses' },
    { state: cables, name: 'Cable health', source: 'get-cable-health' },
  ].filter((f) => f.state.status === 'error');

  const located = threats.status === 'ready' ? threats.data.filter((t) => t.location).length : null;
  const groups: LayerGroup[] = [
    {
      title: 'Cyber',
      note: 'targets vs attackers',
      rows: [
        { id: 'ddos', mark: POPOVER_MARK.ddos, name: 'DDoS targets · Cloudflare Radar', sub: 'country shading by share of attack traffic, 7 days', on: layers.ddos },
        { id: 'attackers', mark: POPOVER_MARK.attackers, name: 'Attack servers · threat feeds', sub: `${located != null ? `${located.toLocaleString('en-US')} located indicators · ` : ''}8° cells`, on: layers.attackers },
      ],
    },
    {
      title: 'Infrastructure',
      rows: [
        { id: 'outages', mark: POPOVER_MARK.outages, name: 'Internet outages · Cloudflare Radar', sub: `last ${MAP_OUTAGE_DAYS} days; faint once ended over 24 h ago`, on: layers.outages },
        { id: 'cloud', mark: POPOVER_MARK.cloud, name: 'Cloud regions', sub: 'one per city · red only when the incident names a region there', on: layers.cloud },
        { id: 'datacenters', mark: POPOVER_MARK.datacenters, name: 'AI data centres · Epoch AI', sub: `existing, ${DATACENTER_MIN_CHIPS.toLocaleString('en-US')}+ chips`, on: layers.datacenters },
        { id: 'cables', mark: POPOVER_MARK.cables, name: 'Undersea cables · NGA warnings', sub: 'health: ok, degraded, fault', on: layers.cables },
      ],
    },
  ];

  return (
    <div ref={card}>
      <Card
        title="Infrastructure & cyber map"
        sub="live · Cloudflare Radar every 30 min · threat feeds every 2 h"
        testId="infra-map"
        right={<LayersPopover groups={groups} onToggle={(id, on) => setLayers((cur) => ({ ...cur, [id]: on }))} footer="DDoS shading shows who is attacked; grey circles show where attackers' servers are." />}
      >
        <div class="relative h-[320px] overflow-hidden border-t border-line bg-bg/40 md:h-[440px]">
          <LiteMap markers={built.markers} overlays={built.overlays} fit="world" focusId={focusId} onSelect={(id) => { if (!id) onFocus(null); }} />
          {failed.length ? (
            <div class="absolute left-14 right-14 top-4 z-[4] flex flex-wrap gap-2">
              {failed.map((f) => (
                <span key={f.name} class="rounded-[6px] border border-line bg-surface/90 px-2 py-1 text-[11px] text-high" data-source-state="error">
                  {f.name}: source unavailable · {f.source}
                </span>
              ))}
            </div>
          ) : null}
          <MapLegend testId="infra-map-legend" collapsible>
            {LEGEND.filter((l) => layers[l.key]).map((l) => <LegendRow key={l.key} mark={l.mark} name={l.label} note={l.sub} />)}
          </MapLegend>
        </div>
        <div class="grid grid-cols-1 border-t border-line md:grid-cols-2">
          <div class="flex gap-[10px] px-5 py-3 md:border-r md:border-line">
            <Waypoints size={14} strokeWidth={1.5} class="mt-[2px] shrink-0 text-muted" />
            <span class="flex flex-col gap-[2px]">
              <span class="text-[12.5px] font-medium text-ink">Targets vs attackers</span>
              <span class="text-[11.5px] leading-4 text-dim">Blue countries are where DDoS traffic lands. Grey circles are where attacking servers are hosted, not who they hit.</span>
            </span>
          </div>
          <div class="flex gap-[10px] border-t border-line px-5 py-3 md:border-t-0">
            <Server size={14} strokeWidth={1.5} class="mt-[2px] shrink-0 text-muted" />
            <span class="flex flex-col gap-[2px]">
              <span class="text-[12.5px] font-medium text-ink">Cloud outages are usually company-wide</span>
              <span class="text-[11.5px] leading-4 text-dim">A city turns red only when the incident names a region there. Otherwise every city of that provider shows amber. Status pages rarely name one.</span>
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Developments({ state, rows, total }: { state: ReturnType<typeof useDigest>; rows: LiteItem[]; total: number }) {
  const now = Date.now();
  return (
    <Card title="Material developments" sub={state.status === 'ready' ? `deduplicated · ${total} stories, ranked by importance` : undefined} right={<span class="text-[12px] text-muted">Sort: Impact</span>} testId="tech-developments">
      <div class="border-t border-line">
        {state.status !== 'ready' ? (
          <SourceState state={state} source="news digest (tech edition)" />
        ) : rows.length === 0 ? (
          <p class="px-5 py-4 text-[12px] text-dim">No developments match this filter.</p>
        ) : (
          rows.slice(0, 5).map((item, index) => {
            const type = techType(item.category);
            const Icon = TYPE_ICON[type] ?? Cpu;
            const pill = evidencePill(item);
            const reports = sourceCount(item);
            return (
              <a
                key={item.link}
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                class={cx('flex gap-4 border-b border-line px-5 py-[14px] last:border-b-0 hover:bg-surface-2/50', index === 0 && 'bg-surface-2')}
                data-development
              >
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] border border-line bg-bg text-muted">
                  <Icon size={15} strokeWidth={1.5} />
                </span>
                <span class="flex min-w-0 flex-1 flex-col gap-[5px]">
                  <span class="flex items-center gap-2">
                    <span class="font-mono text-[10px] font-medium tracking-[0.8px] text-tech">{type}</span>
                    <span class="text-[11px] text-dim">{relativeTime(item.publishedAt, now)}</span>
                  </span>
                  <span class="text-[14px] font-medium leading-5 text-ink">{item.title}</span>
                  {cleanSnippet(item) ? <span class="line-clamp-2 text-[12px] leading-[17px] text-muted">{cleanSnippet(item)}</span> : null}
                  <span class="text-[11.5px] text-dim">{item.source} · {reports} report{reports === 1 ? '' : 's'}</span>
                </span>
                <span class="flex w-[132px] shrink-0 flex-col items-end gap-2">
                  <span class={cx('flex items-center gap-[5px] rounded-[4px] border px-2 py-[3px] text-[11px] font-medium', TEXT[pill.tone], pill.tone === 'ok' ? 'border-ok' : 'border-high')}>
                    <pill.Icon size={11} strokeWidth={2} />
                    {pill.label}
                  </span>
                  <span class="flex items-center gap-[6px]">
                    <span class="text-[11px] text-dim">impact</span>
                    <span class="font-mono text-[14px] font-medium text-ink">{Math.min(100, Math.round(item.importanceScore))}</span>
                  </span>
                </span>
              </a>
            );
          })
        )}
      </div>
    </Card>
  );
}

const EVAL_TONE: Record<string, Tone> = { high: 'high', elev: 'elev', ok: 'ok', muted: 'muted' };

function ModelTracker() {
  return (
    <Card title="Model & product tracker" sub="claims vs. independent evaluation" right={<SampleBadge title="No model-release source yet. These are the design sample rows." />} testId="model-tracker">
      <div class="hidden h-7 items-center gap-[14px] border-y border-line bg-bg px-5 md:flex">
        <ColLabel class="flex-1">MODEL</ColLabel>
        <ColLabel class="w-[72px]">RELEASED</ColLabel>
        <ColLabel class="w-24">ACCESS</ColLabel>
        <ColLabel class="w-[150px]">CLAIMED</ColLabel>
        <ColLabel class="w-32">INDEPENDENT EVAL</ColLabel>
      </div>
      {SAMPLE_MODELS.map((m) => (
        <div key={m.name} class="flex flex-wrap items-center gap-x-[14px] gap-y-1 border-b border-line px-5 py-[11px] last:border-b-0" data-sample-row>
          <span class="flex min-w-0 flex-1 basis-full flex-col gap-[2px] md:basis-0">
            <span class="flex items-center gap-2">
              <span class="text-[13px] font-medium text-ink">{m.name}</span>
              {m.isNew ? <span class="rounded-[3px] bg-tech/15 px-[5px] py-px font-mono text-[9px] font-semibold text-tech">NEW</span> : null}
            </span>
            <span class="text-[11.5px] text-dim">{m.org}</span>
          </span>
          <span class="font-mono text-[12px] text-muted md:w-[72px]">{m.released}</span>
          <span class="text-[12px] text-muted md:w-24">{m.access}</span>
          <span class="text-[12px] text-muted md:w-[150px]">{m.claimed}</span>
          <span class="flex items-center gap-[6px] md:w-32">
            <Dot tone={EVAL_TONE[m.evalTone] ?? 'muted'} />
            <span class={cx('text-[12px] font-medium', TEXT[EVAL_TONE[m.evalTone] ?? 'muted'])}>{m.evalLabel}</span>
          </span>
        </div>
      ))}
    </Card>
  );
}

const ACTION_STATUS: Record<string, { label: string; tone: Tone }> = {
  'law-passed': { label: 'Law passed', tone: 'ok' },
  'executive-order': { label: 'Executive order', tone: 'high' },
  guideline: { label: 'Guidance', tone: 'ok' },
  enforcement: { label: 'Enforcement', tone: 'crit' },
  consultation: { label: 'Consultation', tone: 'elev' },
};

function jurisdiction(country: string): string {
  const map: Record<string, string> = { 'European Union': 'EU', 'United States': 'US', 'United Kingdom': 'UK', China: 'CN', Japan: 'JP', Canada: 'CA', India: 'IN', 'South Korea': 'KR', Brazil: 'BR', Singapore: 'SG' };
  return map[country] ?? country.slice(0, 2).toUpperCase();
}

function Policy() {
  const actions = getLatestActions(4);
  const next = getUpcomingDeadlines()[0];
  return (
    <Panel title="Policy & governance" sub="curated" right={<span class="font-mono text-[10px] text-dim" title="From src/config/ai-regulations.ts, a hand-maintained list.">STATIC LIST</span>} testId="policy">
      {actions.map((a) => {
        const status = ACTION_STATUS[a.type] ?? { label: a.type, tone: 'muted' as Tone };
        return (
          <a key={a.id} href={a.sourceUrl} target="_blank" rel="noopener noreferrer" class="flex items-center gap-[10px] hover:opacity-90">
            <span class="flex h-[22px] w-[30px] shrink-0 items-center justify-center rounded-[4px] border border-line font-mono text-[10.5px] font-semibold text-muted">{jurisdiction(a.country)}</span>
            <span class="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span class="truncate text-[12.5px] font-medium text-ink">{a.title}</span>
              <span class="font-mono text-[11px] text-dim">{new Date(`${a.date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}</span>
            </span>
            <span class="flex items-center gap-[5px]">
              <Dot tone={status.tone} />
              <span class={cx('text-[11px]', TEXT[status.tone])}>{status.label}</span>
            </span>
          </a>
        );
      })}
      {next ? (
        <p class="text-[11px] text-dim">
          Next deadline: {next.regulation.shortName}, {next.deadline.date}
        </p>
      ) : null}
    </Panel>
  );
}

function ResearchRadar() {
  const arxiv = useArxiv();
  const hn = useHackerNews();
  const hnTitles = hn.status === 'ready' ? hn.data.map((i) => i.title.toLowerCase()) : [];
  const papers = arxiv.status === 'ready' ? [...arxiv.data].sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 3) : [];
  return (
    <Panel title="Research radar" sub="arXiv cs.AI" right={<DerivedTag how="Signal: 1 bar for a new preprint, 3 when its title also appears on the Hacker News front page." />} testId="research-radar">
      {arxiv.status !== 'ready' ? (
        <SourceState state={arxiv} source="arXiv (seed-research)" pad={false} />
      ) : (
        papers.map((p) => {
          const discussed = hnTitles.some((t) => t.includes(p.title.toLowerCase().slice(0, 40)));
          const bars = discussed ? 3 : 1;
          return (
            <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" class="flex gap-[10px] hover:opacity-90">
              <span class="flex h-4 items-end gap-[2px] pt-[3px]" role="img" aria-label={`signal ${bars} of 3`}>
                {[6, 10, 14].map((h, i) => (
                  <span key={h} class={cx('w-[3px] rounded-[1px]', i < bars ? 'bg-tech' : 'bg-track')} style={{ height: h }} />
                ))}
              </span>
              <span class="flex min-w-0 flex-col gap-[2px]">
                <span class="line-clamp-2 text-[12.5px] leading-[18px] text-ink">{p.title}</span>
                <span class={cx('text-[11px]', discussed ? 'text-ok' : 'text-dim')}>
                  {discussed ? 'discussed on Hacker News' : 'preprint · no replication tracked'} · {relativeTime(p.publishedAt, Date.now())}
                </span>
              </span>
            </a>
          );
        })
      )}
    </Panel>
  );
}

function Indicators({ onOpen }: { onOpen: (feed: FeedState) => void }) {
  const outages = useInternetOutages();
  const services = useServiceStatuses();
  const kev = useRecentKev();
  const history = useThreatHistory();
  const digest = useDigest('tech');
  const feeds = useMemo(
    () => techFeeds({ outages, services, kev, history, news: digest.status === 'ready' ? digestItems(digest.data) : [], now: Date.now() }),
    [outages, services, kev, history, digest],
  );
  const counts = feedCounts(feeds);
  return (
    <Panel
      title="Indicators"
      sub={[`${counts.fired} fired`, counts.quiet && `${counts.quiet} quiet`, counts.stale && `${counts.stale} stale`, counts.unavailable && `${counts.unavailable} unavailable`].filter(Boolean).join(' · ')}
      right={<><HealthDots feeds={feeds} /><DerivedTag how={`${TECH_RULES} Nothing is delivered yet.`} /></>}
      testId="tech-indicators"
    >
      <IndicatorFeed feeds={feeds} now={Date.now()} onOpen={onOpen} />
    </Panel>
  );
}

interface Tile {
  key: string;
  value: string;
  delta: string;
  source: string;
  tone: Tone;
}

/** A tile for a source that failed or has not loaded: its state, never a number. */
function stateTile(key: string, state: ResourceState<unknown>, source: string): Tile {
  const value = state.status === 'loading' ? '…' : '—';
  const delta = state.status === 'loading' ? 'loading' : state.status === 'error' ? 'source unavailable' : 'no data yet';
  return { key, value, delta, source, tone: 'muted' };
}

function infraTiles(now: number, outages: ReturnType<typeof useInternetOutages>, services: ReturnType<typeof useServiceStatuses>, kev: ReturnType<typeof useRecentKev>, history: ReturnType<typeof useThreatHistory>): Tile[] {
  const tiles: Tile[] = [];

  if (outages.status === 'ready') {
    const live = outages.data.outages.filter((o) => !o.endedAt);
    const by = (sev: string) => live.filter((o) => o.severity === sev).length;
    const parts = [
      by('OUTAGE_SEVERITY_TOTAL') && `${by('OUTAGE_SEVERITY_TOTAL')} nationwide`,
      by('OUTAGE_SEVERITY_MAJOR') && `${by('OUTAGE_SEVERITY_MAJOR')} regional`,
      by('OUTAGE_SEVERITY_PARTIAL') && `${by('OUTAGE_SEVERITY_PARTIAL')} network`,
    ].filter(Boolean);
    const recent = outages.data.outages.filter((o) => isOutageLive(o, now)).length;
    tiles.push({ key: 'Active outages', value: String(live.length), delta: parts.length ? parts.join(' · ') : `${recent} in the last 24 h`, source: 'Cloudflare Radar', tone: live.length ? 'high' : 'muted' });
  } else tiles.push(stateTile('Active outages', outages, 'Cloudflare Radar'));

  if (services.status === 'ready') {
    const watched = services.data.statuses.filter((s) => s.id in WATCHED_PROVIDERS);
    const down = watched.filter((s) => isWatchedOutage(s) || s.status === 'SERVICE_OPERATIONAL_STATUS_DEGRADED');
    tiles.push({
      key: 'Providers degraded',
      value: `${down.length} / ${watched.length}`,
      delta: down.length ? down.map((s) => s.name).join(' · ') : 'all operational',
      source: 'status pages',
      tone: down.some(isWatchedOutage) ? 'high' : down.length ? 'elev' : 'muted',
    });
  } else tiles.push(stateTile('Providers degraded', services, 'status pages'));

  if (kev.status === 'ready') {
    const { thisWeek, lastWeek } = kevWeekCounts(kev.data.items, now);
    const diff = thisWeek - lastWeek;
    tiles.push({
      key: 'Exploited CVEs · week',
      value: String(thisWeek),
      delta: `${diff > 0 ? '+' : diff < 0 ? MINUS : '±'}${Math.abs(diff)} vs last week`,
      source: 'CISA KEV',
      tone: diff > 0 ? 'high' : 'muted',
    });
  } else tiles.push(stateTile('Exploited CVEs · week', kev, 'CISA KEV'));

  if (history.status === 'ready') {
    const base = threatBaseline(history.data);
    const feeds = Object.keys(history.data.latest.bySource).length;
    tiles.push(base.ratio != null && base.average != null
      ? {
          key: 'Threat indicators',
          value: `×${base.ratio.toFixed(1)}`,
          delta: `${base.latest.toLocaleString('en-US')} vs ${Math.round(base.average).toLocaleString('en-US')} avg`,
          source: `${feeds} feeds`,
          tone: base.ratio >= 2 ? 'high' : 'muted',
        }
      : {
          key: 'Threat indicators',
          value: base.latest.toLocaleString('en-US'),
          delta: `baseline ${base.days} of ${SPIKE_BASELINE_DAYS} days`,
          source: `${feeds} feeds`,
          tone: 'muted',
        });
  } else tiles.push(stateTile('Threat indicators', history, 'threat feeds'));

  return tiles;
}

function InfraBusiness({ state }: { state: ReturnType<typeof useDigest> }) {
  const outages = useInternetOutages();
  const services = useServiceStatuses();
  const kev = useRecentKev();
  const history = useThreatHistory();
  const tiles = infraTiles(Date.now(), outages, services, kev, history);
  const deals = state.status === 'ready' ? digestItems(state.data, ['funding', 'hardware', 'cloud']).sort(byImportance).slice(0, 3) : [];
  return (
    <Panel
      title="Infrastructure & business"
      right={<DerivedTag how="Counts from the indicator feeds: outages Cloudflare lists as not ended; watched cloud and AI providers not operational; CVEs CISA added to KEV in the last 7 days against the 7 before; the latest threat-indicator count against its 7-day average. The stories below are from the tech digest." />}
      testId="infra-business"
    >
      <div class="grid grid-cols-2 gap-px overflow-hidden rounded-[7px] border border-line bg-line">
        {tiles.map((k) => (
          <div key={k.key} class="flex flex-col gap-[2px] bg-bg p-[10px]" data-infra-tile={k.key}>
            <span class="text-[10.5px] text-dim">{k.key}</span>
            <span class="font-mono text-[17px] font-medium text-ink">{k.value}</span>
            <span class={cx('font-mono text-[10.5px] leading-[14px]', TEXT[k.tone])}>{k.delta}</span>
            <span class="text-[10px] text-dim">{k.source}</span>
          </div>
        ))}
      </div>
      {state.status !== 'ready' ? (
        <SourceState state={state} source="news digest (tech edition)" pad={false} />
      ) : (
        deals.map((d) => (
          <a key={d.link} href={d.link} target="_blank" rel="noopener noreferrer" class="flex flex-col gap-[2px] hover:opacity-90">
            <span class="text-[12px] text-ink">{d.title}</span>
            <span class="text-[11px] text-dim">{relativeTime(d.publishedAt, Date.now())} · {d.source} · {CORROBORATION_VIEW[corroborationOf(d).state].label.toLowerCase()}</span>
          </a>
        ))
      )}
    </Panel>
  );
}

function WatchedTopics({ titles }: { titles: string[] }) {
  const counts = topicCounts(WATCHED_TOPICS, titles);
  return (
    <Panel title="Watched topics" right={<DerivedTag how="Title matches in the tech digest. Editing topics arrives with watchlists." />} testId="watched-topics">
      <div class="flex flex-wrap gap-[6px]">
        {WATCHED_TOPICS.map((t, i) => {
          const n = counts[i] ?? 0;
          const hot = n >= 2;
          return (
            <span key={t.label} class={cx('flex items-center gap-[6px] rounded-[5px] border bg-bg px-[9px] py-[5px]', hot ? 'border-tech/40' : 'border-line')}>
              <span class={cx('text-[11.5px]', hot ? 'text-ink' : 'text-muted')}>{t.label}</span>
              <span class={cx('font-mono text-[10.5px]', hot ? 'text-tech' : 'text-dim')}>{n}</span>
            </span>
          );
        })}
      </div>
      <p class="text-[11px] text-dim">Highlighted topics appear in two or more stories in the current digest.</p>
    </Panel>
  );
}
