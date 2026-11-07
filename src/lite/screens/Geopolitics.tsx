import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { CloudLightning, Crosshair, Flame, Layers, Radio, Ship } from 'lucide-preact';
import { INTEL_HOTSPOTS } from '@/config/geo';
import { Topbar, matchesSearch } from '../components/Topbar';
import { BarStrip, StackedBar } from '../components/charts';
import { BG, BORDER, Card, ColLabel, DerivedTag, Dot, Panel, SampleBadge, SegmentedControl, SourceState, Switch, TEXT, cx } from '../components/ui';
import { Diamond, LiteMap, type MapMarker } from '../map/LiteMap';
import {
  selectIncidents,
  useCountryHistory,
  useDigest,
  useEarthquakes,
  useMilitaryFlights,
  useRiskScores,
  useUcdpEvents,
  useUnrestEvents,
} from '../data/hooks';
import { ESCALATION_REGIONS, leadCountry } from '../data/regions';
import { ucdpInRange, ucdpMarkers, ucdpWindowLabel } from '../data/ucdp';
import { FEED_LABEL, escalationLevel, scoreHotspots } from '../data/escalation';
import { SAMPLE_WATCHLIST } from '../data/fixtures';
import {
  CORROBORATION_RULE,
  CORROBORATION_VIEW,
  GEO_CATEGORIES,
  GEO_REGION_LABEL,
  TIME_RANGE_HOURS,
  confidenceLabel,
  corroborationOf,
  digestItems,
  escalationStatus,
  evidenceMix,
  inTimeRange,
  isPrimarySource,
  pctChange,
  phaseLabel,
  publisherCount,
  regionOfCategory,
  regionOfPoint,
  relativeTime,
  threatTone,
  timeBuckets,
  type GeoRegion,
  type LiteItem,
  type TimeRange,
} from '../data/transforms';
import { signed } from '../format';

const REGION_OPTIONS = [
  { value: 'all', label: 'All regions' },
  { value: 'middleeast', label: 'Middle East' },
  { value: 'europe', label: 'Europe' },
  { value: 'africa', label: 'Africa' },
  { value: 'asia', label: 'Asia-Pacific' },
] as const satisfies ReadonlyArray<{ value: GeoRegion; label: string }>;

/**
 * The dashboard's time ranges plus 30 days. They filter the digest-driven parts of the screen and the
 * UCDP events, all counted back from now (see ucdpInRange for UCDP's day-dated events).
 */
const TIME_RANGE_OPTIONS = (Object.keys(TIME_RANGE_HOURS) as TimeRange[]).map((value) => ({ value, label: value }));

/**
 * Escalation regions. The card follows the first listed country that has a
 * CII score; CII covers a tiered country list, not every country.
 */
function inRegion(item: LiteItem, region: GeoRegion): boolean {
  return region === 'all' || regionOfCategory(item.category) === region;
}

export function Geopolitics() {
  const [region, setRegion] = useState<GeoRegion>('all');
  const [search, setSearch] = useState('');
  const [layers, setLayers] = useState({ conflicts: true, hotspots: true });
  const [range, setRange] = useState<TimeRange>('7d');
  const digest = useDigest('full');
  const risk = useRiskScores();

  const incidents = useMemo(
    () => (digest.status === 'ready' ? selectIncidents(digest.data) : []),
    [digest],
  );
  const now = Date.now();
  const inRange = incidents.filter((i) => inTimeRange(i.publishedAt, now, range));
  const visible = inRange.filter((i) => inRegion(i, region) && matchesSearch(search, i.title, i.source, i.locationName));
  const escalating = risk.status === 'ready'
    ? ESCALATION_REGIONS.filter((r) => {
        const { score } = leadCountry(r.countries, risk.data.ciiScores);
        return score != null && score >= 55;
      }).length
    : null;

  return (
    <>
      <Topbar
        title="Geopolitics & Conflicts"
        subtitle={
          <>
            {digest.status === 'ready' ? `${inRange.length} active events in ${range}` : 'Loading events'}
            {escalating != null ? ` · ${escalating} regions at high CII` : ''} · refresh 5 min
          </>
        }
        filter={<SegmentedControl label="Region" options={REGION_OPTIONS} value={region} onChange={setRegion} />}
        search={search}
        onSearch={setSearch}
        actionLabel="New watch rule"
      />
      <div class="flex flex-col gap-6 px-4 py-6 wide:flex-row wide:px-7">
        <div class="flex min-w-0 flex-1 flex-col gap-5">
          <ConflictMap region={region} layers={layers} range={range} onRange={setRange} />
          <IncidentsCard state={digest} rows={visible.slice(0, 6)} total={visible.length} />
        </div>
        <div class="flex w-full flex-col gap-4 wide:w-[352px] wide:shrink-0">
          <Timeline incidents={inRange} region={region} />
          <Watchlist />
          <EvidenceMix state={digest} region={region} range={range} />
          <MapLayers layers={layers} onChange={setLayers} />
        </div>
      </div>
    </>
  );
}

function ConflictMap({
  region, layers, range, onRange,
}: {
  region: GeoRegion;
  layers: { conflicts: boolean; hotspots: boolean };
  range: TimeRange;
  onRange: (range: TimeRange) => void;
}) {
  const ucdp = useUcdpEvents();
  const digest = useDigest('full');
  const risk = useRiskScores();
  const unrest = useUnrestEvents();
  const earthquakes = useEarthquakes();
  const flights = useMilitaryFlights();

  // The dashboard's live hotspot score, from whichever of its inputs have loaded.
  const escalation = useMemo(
    () =>
      scoreHotspots(
        INTEL_HOTSPOTS,
        {
          news: digest.status === 'ready' ? digestItems(digest.data) : null,
          ciiScores: risk.status === 'ready' ? risk.data.ciiScores : null,
          unrest: unrest.status === 'ready' ? unrest.data : null,
          earthquakes: earthquakes.status === 'ready' ? earthquakes.data : null,
          flights: flights.status === 'ready' ? flights.data : null,
        },
        Date.now(),
      ),
    [digest, risk, unrest, earthquakes, flights],
  );

  const ucdpRange = useMemo(() => (ucdp.status === 'ready' ? ucdpInRange(ucdp.data, range, Date.now()) : null), [ucdp, range]);

  const markers = useMemo(() => {
    const out: MapMarker[] = [];
    if (layers.conflicts && ucdpRange) {
      // One marker per exact UCDP event location; the map clusters them by zoom.
      out.push(...ucdpMarkers(ucdpRange.events, region).markers);
    }
    if (layers.hotspots) {
      for (const { hotspot: h, score, missing } of escalation) {
        const level = escalationLevel(score.combinedScore);
        if (region !== 'all' && regionOfPoint(h.lat, h.lon) !== region) continue;
        const live = score.combinedScore.toFixed(1);
        const c = score.components;
        out.push({
          kind: 'hotspot',
          id: `hotspot:${h.id}`,
          lat: h.lat,
          lon: h.lon,
          tone: level.tone,
          // Below 3/5 the diamond stays, small and grey, without a name, so 29 names do not crowd the map.
          label: level.named ? h.name : '',
          title: `${h.name}: live escalation ${live}/5, ${level.label.toLowerCase()} (curated hotspot)`,
          popup: {
            kind: 'Curated hotspot',
            name: h.name,
            value: `${live}/5`,
            score: score.combinedScore,
            lines: [
              { text: h.location ?? h.subtext ?? '' },
              { text: h.description ?? '' },
              {
                text: `${level.label} · live score, baseline ${score.staticBaseline}/5 · news ${Math.round(c.newsActivity)} · country risk ${Math.round(c.ciiContribution)} · convergence ${Math.round(c.geoConvergence)} · military ${Math.round(c.militaryActivity)}`,
                style: 'dim' as const,
              },
              { text: missing.length ? `Not available: ${missing.map((f) => FEED_LABEL[f]).join(', ')}` : '', style: 'dim' as const },
            ].filter((line) => line.text),
          },
        });
      }
    }
    return out;
  }, [ucdpRange, escalation, region, layers]);

  const scrub = useMemo(() => {
    if (digest.status !== 'ready') return null;
    const stamps = digestItems(digest.data, GEO_CATEGORIES).map((i) => i.publishedAt);
    return timeBuckets(stamps, Date.now(), TIME_RANGE_HOURS[range], 42);
  }, [digest, range]);

  return (
    <Card
      title="Conflict map"
      sub={
        ucdpRange?.newest
          ? `${ucdpWindowLabel(range, ucdpRange.events.length, ucdpRange.newest)} · curated hotspots: live score`
          : 'UCDP events and curated hotspots (live score)'
      }
      testId="conflict-map"
      right={
        <>
          <div class="hidden items-center gap-[16px] md:flex" data-testid="map-legend">
            <span class="flex items-center gap-[5px] text-[11.5px] text-muted" title="UCDP is a delayed release, weeks behind, so short time ranges may hold no events">
              {[7, 10, 13].map((size) => (
                <span key={size} class="rounded-full border border-crit/80 bg-crit/25" style={{ width: size, height: size }} />
              ))}
              <span class="ml-[3px]">UCDP events · size = deaths</span>
            </span>
            <span class="flex items-center gap-[4px] text-[11.5px] text-muted" title="All curated hotspots, coloured by the live escalation score: red critical, orange high, yellow elevated, grey watch or stable">
              <Diamond tone="elev" filled={false} size={9} />
              Curated hotspot
            </span>
          </div>
          <span class="flex items-center gap-[6px] rounded-[6px] border border-line px-[10px] py-[5px] text-[11.5px] text-muted">
            <Layers size={13} strokeWidth={1.5} />
            Layers
          </span>
        </>
      }
    >
      <div class="relative h-[300px] overflow-hidden bg-bg/40 md:h-[380px]">
        <LiteMap markers={markers} fit={region === 'all' ? 'world' : 'markers'} />
        {ucdp.status !== 'ready' && layers.conflicts ? (
          <div class="absolute left-14 right-14 top-4 flex justify-start">
            <div class="rounded-[6px] border border-line bg-surface/90 px-2">
            <SourceState state={ucdp} source="UCDP events (seed-ucdp-events)" pad={false} />
            </div>
          </div>
        ) : null}
        {/* The time range sits on the map, as on the dashboard, and filters the screen's digest-driven parts. */}
        <div class="absolute bottom-4 left-4 right-4 flex h-9 items-center gap-3 rounded-[6px] border border-line bg-surface/90 pr-3 pl-1">
          <TimeRangeControl value={range} onChange={onRange} />
          {scrub ? (
            <>
              <div class="min-w-0 flex-1" title={`Reports per time slice, last ${range}`}>
                <BarStrip values={scrub} height={16} label={`Reports over the last ${range}`} colorFor={(i) => (i >= scrub.length - 6 ? 'bg-geo' : 'bg-track')} />
              </div>
              <span class="font-mono text-[10.5px] text-muted">now</span>
            </>
          ) : null}
        </div>
      </div>
      <RegionStrip />
    </Card>
  );
}

/** The dashboard's time buttons, compact enough for the map's bottom bar. */
function TimeRangeControl({ value, onChange }: { value: TimeRange; onChange: (range: TimeRange) => void }) {
  return (
    <fieldset aria-label="Time range" class="m-0 flex shrink-0 gap-px border-0 p-0" data-testid="time-range">
      {TIME_RANGE_OPTIONS.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            class={cx('rounded-[4px] px-[7px] py-[3px] font-mono text-[10.5px]', active ? 'bg-surface-2 text-ink' : 'text-dim hover:text-muted')}
          >
            {o.label}
          </button>
        );
      })}
    </fieldset>
  );
}

function RegionStrip() {
  const risk = useRiskScores();
  return (
    <div class="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-3 md:grid-cols-5" data-testid="region-strip">
      {ESCALATION_REGIONS.map((r) => {
        const lead = risk.status === 'ready' ? leadCountry(r.countries, risk.data.ciiScores) : { country: r.countries[0], score: undefined };
        return <RegionCard key={r.name} name={r.name} country={lead.country} score={lead.score} />;
      })}
    </div>
  );
}

function RegionCard({ name, country, score }: { name: string; country: string; score: number | null | undefined }) {
  const history = useCountryHistory(country);
  const series = history.status === 'ready' ? history.data.points.map((p) => p.cii?.score ?? 0).filter((v) => v > 0) : [];
  const change = series.length >= 2 ? pctChange(series[series.length - 2] ?? 0, series[series.length - 1] ?? 0) : null;
  const status = escalationStatus(score);
  return (
    <div class="flex flex-col gap-2 bg-surface px-[14px] py-3" title={`CII for ${country}. Change between the last two daily snapshots.`}>
      <div class="flex items-center gap-[6px]">
        <Dot tone={status.tone} />
        <span class="truncate text-[12px] font-medium text-ink">{name}</span>
      </div>
      <div class="flex items-end justify-between gap-2">
        <div class="flex flex-col gap-px">
          <span class={cx('font-mono text-[16px] font-medium', change != null && change < 0 ? 'text-muted' : 'text-ink')}>
            {change != null ? signed(change, 0) : score != null ? score.toFixed(0) : '—'}
          </span>
          <span class="text-[10.5px] text-dim">
            {change != null ? '1d' : 'CII'} · {score === undefined ? 'loading' : status.label}
          </span>
        </div>
        {series.length > 1 ? (
          <BarStrip values={series} height={24} barWidth={3} label={`${name} CII, last ${series.length} days`} colorFor={(i) => (i >= series.length - 2 ? BG[status.tone] : 'bg-track')} />
        ) : null}
      </div>
    </div>
  );
}

function IncidentsCard({ state, rows, total }: { state: ReturnType<typeof useDigest>; rows: LiteItem[]; total: number }) {
  const now = Date.now();
  return (
    <Card title="Priority incidents" sub={state.status === 'ready' ? `${total} medium-or-higher threat stories in the digest` : undefined} testId="priority-incidents">
      <div class="hidden h-7 items-center gap-[14px] border-y border-line bg-bg px-5 md:flex">
        <ColLabel class="flex-1">INCIDENT</ColLabel>
        <ColLabel class="w-[104px]">STATUS</ColLabel>
        <ColLabel class="w-[92px]">CONFIDENCE</ColLabel>
        <ColLabel class="w-[70px]">SOURCES</ColLabel>
        <ColLabel class="w-[56px]">IMPACT</ColLabel>
        <ColLabel class="w-[64px]">UPDATED</ColLabel>
      </div>
      {state.status !== 'ready' ? (
        <SourceState state={state} source="news digest (full edition)" />
      ) : rows.length === 0 ? (
        <p class="px-5 py-4 text-[12px] text-dim">No incidents match this filter.</p>
      ) : (
        rows.map((item) => {
          const verdict = corroborationOf(item);
          const status = CORROBORATION_VIEW[verdict.state];
          const publishers = publisherCount(verdict);
          const confidence = confidenceLabel(item.credibilityScore);
          const region = regionOfCategory(item.category);
          const where = [region ? GEO_REGION_LABEL[region] : item.locationName || item.category, phaseLabel(item.storyMeta?.phase)].filter(Boolean).join(' · ');
          return (
            <a
              key={item.link}
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              class="flex flex-wrap items-center gap-x-[14px] gap-y-2 border-b border-line px-5 py-3 last:border-b-0 hover:bg-surface-2/50"
              data-incident
            >
              <div class="flex min-w-0 flex-1 basis-full items-center gap-[10px] md:basis-0">
                <span class={cx('h-8 w-[3px] shrink-0 rounded-[1px]', BG[threatTone(item.threat?.level)])} />
                <div class="flex min-w-0 flex-col gap-[3px]">
                  <span class="text-[13px] font-medium text-ink">{item.title}</span>
                  <span class="truncate text-[11.5px] text-dim">{where} · {item.source}</span>
                </div>
              </div>
              <span class="flex items-center gap-[6px] text-[12px] text-muted md:w-[104px]">
                <Dot tone={status.tone} />
                {status.label}
              </span>
              <span class={cx('text-[12px] font-medium md:w-[92px]', TEXT[confidence.tone])}>{confidence.label}</span>
              <span class="font-mono text-[12px] text-muted md:w-[70px]">
                {publishers ?? '–'}{isPrimarySource(item.source) ? ' · T1' : ''}
              </span>
              <span class="font-mono text-[13px] font-medium text-ink md:w-[56px]">{Math.min(100, Math.round(item.importanceScore))}</span>
              <span class="font-mono text-[12px] text-dim md:w-[64px]">{relativeTime(item.publishedAt, now)}</span>
            </a>
          );
        })
      )}
      <footer class="border-t border-line bg-bg px-5 py-[10px] text-[11.5px] text-dim">
        Sources = publishers carrying the story. T1 = reported by a tier-1 outlet. Status is the dashboard's corroboration rule, not severity: {CORROBORATION_RULE}
      </footer>
    </Card>
  );
}

function Timeline({ incidents, region }: { incidents: LiteItem[]; region: GeoRegion }) {
  const focus = region !== 'all' ? region : regionOfCategory(incidents.find((i) => regionOfCategory(i.category))?.category ?? '') ?? null;
  const entries = incidents
    .filter((i) => (focus ? regionOfCategory(i.category) === focus : true))
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, 4);
  return (
    <Panel title="Regional timeline" sub={focus ? GEO_REGION_LABEL[focus] : undefined} right={<DerivedTag how={`Tags from the dashboard's corroboration rule. ${CORROBORATION_RULE}`} />} testId="regional-timeline">
      {entries.length === 0 ? (
        <p class="text-[12px] text-dim">No recent incidents.</p>
      ) : (
        <ol class="flex flex-col">
          {entries.map((item, index) => {
            const view = CORROBORATION_VIEW[corroborationOf(item).state];
            const tone = view.tone;
            return (
              <li key={item.link} class="flex gap-3">
                <span class="w-9 shrink-0 font-mono text-[11px] leading-[17px] text-dim">{new Date(item.publishedAt).toISOString().slice(11, 16)}</span>
                <span class="flex flex-col items-center gap-1 pt-1">
                  <span class={cx('h-[7px] w-[7px] rounded-full border-[1.5px]', BORDER[tone], index === 0 ? BG[tone] : 'bg-surface')} />
                  {index < entries.length - 1 ? <span class="w-px flex-1 bg-track" /> : null}
                </span>
                <span class="flex min-w-0 flex-col gap-[3px] pb-[10px]">
                  <a href={item.link} target="_blank" rel="noopener noreferrer" class="text-[12.5px] leading-[18px] text-ink hover:underline">{item.title}</a>
                  <span class={cx('font-mono text-[9.5px] font-medium tracking-[0.6px]', TEXT[tone])}>{view.tag}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

function Watchlist() {
  const count = SAMPLE_WATCHLIST.reduce((n, g) => n + g.items.length, 0);
  return (
    <Panel title="Watchlist" sub={`${count} items`} right={<SampleBadge title="Watch rules arrive with the alerts phase. These are the design sample items." />} testId="watchlist">
      {SAMPLE_WATCHLIST.map((group) => (
        <div key={group.group} class="flex flex-col gap-2">
          <ColLabel>{group.group}</ColLabel>
          {group.items.map((item) => (
            <div key={item.name} class="flex items-center gap-2">
              <Dot tone={item.tone} />
              <span class="text-[12.5px] text-ink">{item.name}</span>
              <span class={cx('ml-auto text-[11px]', item.state === 'alerting' ? 'text-crit' : 'text-dim')}>{item.state}</span>
            </div>
          ))}
        </div>
      ))}
    </Panel>
  );
}

function EvidenceMix({ state, region, range }: { state: ReturnType<typeof useDigest>; region: GeoRegion; range: TimeRange }) {
  const now = Date.now();
  const items = state.status === 'ready'
    ? digestItems(state.data, GEO_CATEGORIES).filter((i) => inRegion(i, region) && inTimeRange(i.publishedAt, now, range))
    : [];
  const mix = evidenceMix(items);
  return (
    <Panel title="Evidence mix" sub={state.status === 'ready' ? `${items.length} reports` : undefined} right={<DerivedTag how="Source classes from shared/source-provenance.ts types and shared/source-tiers.json." />} testId="evidence-mix">
      {state.status !== 'ready' ? (
        <SourceState state={state} source="news digest (full edition)" pad={false} />
      ) : (
        <>
          <StackedBar parts={mix} />
          {mix.map((c) => (
            <div key={c.key} class="flex items-center gap-2">
              <span class="h-2 w-2 rounded-[2px]" style={{ background: c.color }} />
              <span class="text-[12px] text-muted">{c.label}</span>
              <span class="ml-auto font-mono text-[11.5px] text-muted">{Math.round(c.share * 100)}%</span>
            </div>
          ))}
        </>
      )}
    </Panel>
  );
}

function MapLayers({ layers, onChange }: { layers: { conflicts: boolean; hotspots: boolean }; onChange: (next: { conflicts: boolean; hotspots: boolean }) => void }) {
  const row = (icon: ComponentChildren, name: string, hint: string, control: ComponentChildren, active: boolean) => (
    <div class="flex items-center gap-[10px]">
      <span class={active ? 'text-ink' : 'text-dim'}>{icon}</span>
      <span class="flex min-w-0 flex-1 flex-col gap-px">
        <span class={cx('text-[12.5px]', active ? 'text-ink' : 'text-muted')}>{name}</span>
        <span class="text-[11px] text-dim">{hint}</span>
      </span>
      {control}
    </div>
  );
  const icon = { size: 14, strokeWidth: 1.5 } as const;
  return (
    <Panel title="Map layers" sub="optional" testId="map-layers">
      {row(<Crosshair {...icon} />, 'Active events', 'UCDP georeferenced events', <Switch label="Active events" on={layers.conflicts} onChange={(on) => onChange({ ...layers, conflicts: on })} />, layers.conflicts)}
      {row(<Flame {...icon} />, 'Escalation hotspots', 'curated, escalation 3/5 and up', <Switch label="Escalation hotspots" on={layers.hotspots} onChange={(on) => onChange({ ...layers, hotspots: on })} />, layers.hotspots)}
      {row(<Ship {...icon} />, 'Shipping lanes', 'soon', <Switch label="Shipping lanes" on={false} disabled />, false)}
      {row(<CloudLightning {...icon} />, 'Aviation, weather & hazards', 'soon', <Switch label="Aviation, weather and hazards" on={false} disabled />, false)}
      {row(<Radio {...icon} />, 'Social OSINT', 'soon · discovery only', <Switch label="Social OSINT" on={false} disabled />, false)}
    </Panel>
  );
}
