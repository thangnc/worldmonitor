import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { CloudLightning, Crosshair, Flame, Layers, Radio, Ship } from 'lucide-preact';
import { INTEL_HOTSPOTS } from '@/config/geo';
import { Topbar, matchesSearch } from '../components/Topbar';
import { BarStrip, StackedBar } from '../components/charts';
import { BG, BORDER, Card, ColLabel, DerivedTag, Dot, Panel, SampleBadge, SegmentedControl, SourceState, Switch, TEXT, cx } from '../components/ui';
import { Diamond, LiteMap, type CountryFill, type MapMarker } from '../map/LiteMap';
import { HealthDots, IndicatorFeed } from '../components/indicator';
import {
  selectIncidents,
  useConflictCounts,
  useDigest,
  useEarthquakes,
  useMilitaryFlights,
  useRiskScores,
  useUcdpEvents,
  useUnrestEvents,
} from '../data/hooks';
import { ESCALATION_REGIONS, leadCountry } from '../data/regions';
import { ucdpBackgroundLabel, ucdpMarkers, ucdpNewest } from '../data/ucdp';
import {
  SHADING_RULE,
  VIOLENCE_RULE,
  conflictHistogram,
  countryName,
  countryShading,
  hotspotStrip,
  violenceFeeds,
  type HotspotTile,
} from '../data/conflict';
import { feedCounts } from '../data/indicators';
import { LINK_WINDOW_HOURS, linkNews } from '../data/news-link';
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
  evidenceMix,
  inTimeRange,
  isPrimarySource,
  phaseLabel,
  publisherCount,
  regionOfCategory,
  regionOfPoint,
  relativeTime,
  threatTone,
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
 * 6h, 24h, 7d and 30d (owner's design, 2026-11-08). They filter the GDELT shading and histogram and
 * the digest-driven parts of the screen. UCDP is the verified background and shows at every range.
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
  const [layers, setLayers] = useState<LayerState>({ violence: true, conflicts: true, hotspots: true });
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
          <GeoIndicators />
          <Timeline incidents={inRange} region={region} />
          <Watchlist />
          <EvidenceMix state={digest} region={region} range={range} />
          <MapLayers layers={layers} onChange={setLayers} />
        </div>
      </div>
    </>
  );
}

interface LayerState {
  violence: boolean;
  conflicts: boolean;
  hotspots: boolean;
}

function ConflictMap({
  region, layers, range, onRange,
}: {
  region: GeoRegion;
  layers: LayerState;
  range: TimeRange;
  onRange: (range: TimeRange) => void;
}) {
  const ucdp = useUcdpEvents();
  const digest = useDigest('full');
  const risk = useRiskScores();
  const unrest = useUnrestEvents();
  const earthquakes = useEarthquakes();
  const flights = useMilitaryFlights();
  const conflict = useConflictCounts();
  // A hotspot tile opens its card on the map; closing the card clears it, so the same tile can open it again.
  const [focus, setFocus] = useState<string | null>(null);

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

  const counts = conflict.status === 'ready' ? conflict.data : null;
  const shading = useMemo(() => (counts ? countryShading(counts, range, Date.now()) : null), [counts, range]);
  const histogram = useMemo(() => (counts ? conflictHistogram(counts, range, Date.now()) : null), [counts, range]);
  const newest = ucdp.status === 'ready' ? ucdpNewest(ucdp.data) : 0;

  const markers = useMemo(() => {
    const out: MapMarker[] = [];
    if (layers.conflicts && ucdp.status === 'ready') {
      // UCDP is the verified background: every location, whatever the range; the map clusters them by zoom.
      out.push(...ucdpMarkers(ucdp.data, region).markers);
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
  }, [ucdp, escalation, region, layers]);

  const news = useMemo(() => (digest.status === 'ready' ? digestItems(digest.data) : []), [digest]);
  const countries = useMemo((): CountryFill | undefined => {
    if (!layers.violence || !shading) return undefined;
    const steps = new Map([...shading.byCountry].filter(([, c]) => c.step > 0).map(([code, c]) => [code, c.step]));
    return {
      steps,
      card: (code) => {
        const shade = shading.byCountry.get(code);
        if (!shade) return null;
        const name = countryName(code);
        const now = Date.now();
        const stories = linkNews({ countries: [{ name, code }] }, news, now, LINK_WINDOW_HOURS.geo).stories;
        return {
          title: `${name}: ${shade.reports} GDELT reports, ${shading.basis}`,
          popup: {
            kind: 'Reported violence · GDELT',
            name,
            value: `${shade.reports} reports`,
            lines: [
              { text: shade.ratio != null ? `×${shade.ratio.toFixed(1)} the country's normal · ${shading.basis}` : `No normal to compare with yet · ${shading.basis}` },
              ...stories.slice(0, 2).map((st) => ({ text: `${st.item.title} · ${st.item.source}` })),
              { text: stories.length ? '' : 'No linked news found in the last 24 h', style: 'dim' as const },
              { text: shading.partial ? 'Some hours or days in this range are incomplete.' : '', style: 'dim' as const },
              { text: 'Machine-coded news reports, not verified events.', style: 'dim' as const },
            ].filter((line) => line.text),
          },
        };
      },
    };
  }, [layers.violence, shading, news, range]);

  const tiles = useMemo(
    () =>
      hotspotStrip(
        escalation.map(({ hotspot, score }) => ({ hotspot, score: score.combinedScore, level: escalationLevel(score.combinedScore) })),
        counts,
        Date.now(),
      ),
    [escalation, counts],
  );

  return (
    <Card
      title="Conflict map"
      sub={`Reported violence (GDELT, against each country's normal) · ${ucdpBackgroundLabel(newest)} · hotspots: live score`}
      testId="conflict-map"
      right={
        <>
          <div class="hidden items-center gap-[16px] md:flex" data-testid="map-legend">
            <span class="flex items-center gap-[5px] text-[11.5px] text-muted" title={SHADING_RULE}>
              <span class="flex gap-px" aria-hidden="true">
                <span class="h-[9px] w-[7px] rounded-[1px] bg-violence-1" />
                <span class="h-[9px] w-[7px] rounded-[1px] bg-violence-2" />
                <span class="h-[9px] w-[7px] rounded-[1px] bg-violence-3" />
                <span class="h-[9px] w-[7px] rounded-[1px] bg-violence-4" />
              </span>
              <span class="ml-[3px]">Reported violence · GDELT</span>
            </span>
            <span class="flex items-center gap-[5px] text-[11.5px] text-muted" title="UCDP is a delayed release, weeks behind; it shows at every range as the verified background. Size = deaths.">
              <span class="h-[10px] w-[10px] rounded-full border border-crit/80 bg-crit/25" aria-hidden="true" />
              Verified background · UCDP
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
        <LiteMap markers={markers} fit={region === 'all' ? 'world' : 'markers'} countries={countries} focusId={focus} onSelect={(id) => { if (id !== focus) setFocus(null); }} />
        {(ucdp.status !== 'ready' && layers.conflicts) || (conflict.status !== 'ready' && layers.violence) ? (
          <div class="pointer-events-none absolute left-14 right-14 top-4 z-[4] flex flex-col items-start gap-1">
            {conflict.status !== 'ready' && layers.violence ? (
              <div class="rounded-[6px] border border-line bg-surface/90 px-2">
                <SourceState state={conflict} source="GDELT conflict counts (seed-gdelt-bulk-materializer)" pad={false} />
              </div>
            ) : null}
            {ucdp.status !== 'ready' && layers.conflicts ? (
              <div class="rounded-[6px] border border-line bg-surface/90 px-2">
                <SourceState state={ucdp} source="UCDP events (seed-ucdp-events)" pad={false} />
              </div>
            ) : null}
          </div>
        ) : null}
        {/* The time range sits on the map, as on the dashboard, with GDELT reports per hour or day. */}
        <div class="absolute bottom-4 left-4 right-4 z-[4] flex h-9 items-center gap-3 rounded-[6px] border border-line bg-surface/90 pr-3 pl-1">
          <TimeRangeControl value={range} onChange={onRange} />
          {histogram ? (
            <>
              <span class="hidden shrink-0 font-mono text-[10.5px] text-dim sm:inline">GDELT reports / {histogram.unit}</span>
              <div class="min-w-0 flex-1" title={`GDELT reports per ${histogram.unit === 'hr' ? 'hour' : 'day'}, last ${range}. Dim bars are incomplete.`} data-testid="gdelt-histogram">
                <BarStrip
                  values={histogram.bars.map((b) => b.value)}
                  height={16}
                  label={`GDELT reports per ${histogram.unit === 'hr' ? 'hour' : 'day'}, last ${range}`}
                  colorFor={(i) => (histogram.bars[i]?.partial ? 'bg-faint' : 'bg-violence-3')}
                />
              </div>
              <span class="font-mono text-[10.5px] text-muted">now</span>
            </>
          ) : (
            <span class="min-w-0 flex-1" />
          )}
          <span class="hidden shrink-0 font-mono text-[10.5px] text-dim md:inline" data-testid="ucdp-reach">
            {newest ? `UCDP to ${new Date(newest).toISOString().slice(0, 10)}` : 'UCDP'}
          </span>
        </div>
      </div>
      <HotspotStrip tiles={tiles} onSelect={(id) => setFocus(`hotspot:${id}`)} />
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

/** The five curated hotspots with the highest live score; a click opens the hotspot on the map. */
function HotspotStrip({ tiles, onSelect }: { tiles: HotspotTile[]; onSelect: (id: string) => void }) {
  return (
    <div class="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-3 md:grid-cols-5" data-testid="region-strip">
      {tiles.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onSelect(t.id)}
          class="flex flex-col gap-2 bg-surface px-[14px] py-3 text-left hover:bg-surface-2/60"
          title="Level from the live hotspot score. Change: GDELT reports for the hotspot's countries, last 24 complete hours against the 7-day daily average. Bars: daily reports, 14 days."
          data-hotspot-tile={t.id}
        >
          <span class="flex items-center gap-[6px]">
            <Dot tone={t.tone} />
            <span class="truncate text-[12px] font-medium text-ink">{t.name}</span>
          </span>
          <span class="flex items-end justify-between gap-2">
            <span class="flex flex-col gap-px">
              <span class={cx('font-mono text-[16px] font-medium', t.change != null && t.change < 0 ? 'text-muted' : 'text-ink')}>
                {t.change != null ? signed(t.change, 0) : '—'}
              </span>
              <span class={cx('text-[10.5px]', t.tone === 'muted' ? 'text-dim' : TEXT[t.tone])}>{t.level}</span>
            </span>
            {t.bars.length > 1 ? (
              <BarStrip values={t.bars} height={24} barWidth={3} label={`${t.name}: GDELT reports per day, 14 days`} colorFor={(i) => (i >= t.bars.length - 2 ? BG[t.tone === 'muted' ? 'dim' : t.tone] : 'bg-track')} />
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
}

/** The screen's indicator panel: in 2a the GDELT violence feed (spec: Early indicators › Catalogue). */
function GeoIndicators() {
  const conflict = useConflictCounts();
  const digest = useDigest('full');
  const feeds = useMemo(
    () =>
      violenceFeeds(
        conflict.status === 'ready' ? conflict.data : null,
        conflict.status,
        digest.status === 'ready' ? digestItems(digest.data) : [],
        Date.now(),
      ),
    [conflict, digest],
  );
  const counts = feedCounts(feeds);
  return (
    <Panel
      title="Indicators"
      sub={[`${counts.fired} fired`, counts.quiet && `${counts.quiet} quiet`, counts.stale && `${counts.stale} stale`, counts.unavailable && `${counts.unavailable} unavailable`].filter(Boolean).join(' · ')}
      right={<><HealthDots feeds={feeds} /><DerivedTag how={`Reported violence: ${VIOLENCE_RULE}, per country, GDELT material-conflict articles. Linked news: digest stories naming the country, 24 h before to 1 h after.`} /></>}
      testId="geo-indicators"
    >
      <IndicatorFeed feeds={feeds} now={Date.now()} />
    </Panel>
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

function MapLayers({ layers, onChange }: { layers: LayerState; onChange: (next: LayerState) => void }) {
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
      {row(<Radio {...icon} />, 'Reported violence · GDELT', 'country shading against its own normal', <Switch label="Reported violence" on={layers.violence} onChange={(on) => onChange({ ...layers, violence: on })} />, layers.violence)}
      {row(<Crosshair {...icon} />, 'Verified background · UCDP', 'weeks behind, every range', <Switch label="Verified background" on={layers.conflicts} onChange={(on) => onChange({ ...layers, conflicts: on })} />, layers.conflicts)}
      {row(<Flame {...icon} />, 'Curated hotspots', 'live score 1–5', <Switch label="Curated hotspots" on={layers.hotspots} onChange={(on) => onChange({ ...layers, hotspots: on })} />, layers.hotspots)}
      {row(<Ship {...icon} />, 'Shipping lanes', 'soon', <Switch label="Shipping lanes" on={false} disabled />, false)}
      {row(<CloudLightning {...icon} />, 'Aviation, weather & hazards', 'soon', <Switch label="Aviation, weather and hazards" on={false} disabled />, false)}
    </Panel>
  );
}
