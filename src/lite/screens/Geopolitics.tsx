import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { CloudLightning, Crosshair, Flame, Layers, Locate, Minus, Plus, Radio, Ship } from 'lucide-preact';
import { INTEL_HOTSPOTS } from '@/config/geo';
import { Topbar, matchesSearch } from '../components/Topbar';
import { BarStrip, StackedBar } from '../components/charts';
import { BG, BORDER, Card, ColLabel, DerivedTag, Dot, Panel, SampleBadge, SegmentedControl, SourceState, Switch, TEXT, cx } from '../components/ui';
import { DotMap, project, type MapMarker } from '../map/DotMap';
import { selectIncidents, useCountryHistory, useDigest, useRiskScores, useUcdpEvents } from '../data/hooks';
import { ESCALATION_REGIONS, leadCountry } from '../data/regions';
import { SAMPLE_WATCHLIST } from '../data/fixtures';
import {
  CLAIM_LABEL,
  CLAIM_TONE,
  GEO_CATEGORIES,
  GEO_REGION_LABEL,
  INCIDENT_STATUS,
  claimStatus,
  confidenceLabel,
  digestItems,
  escalationStatus,
  evidenceMix,
  isPrimarySource,
  pctChange,
  phaseLabel,
  regionOfCategory,
  regionOfPoint,
  relativeTime,
  severityFromDeaths,
  sourceCount,
  threatTone,
  timeBuckets,
  type GeoRegion,
  type LiteItem,
  type Tone,
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
  const digest = useDigest('full');
  const risk = useRiskScores();

  const incidents = useMemo(
    () => (digest.status === 'ready' ? selectIncidents(digest.data) : []),
    [digest],
  );
  const visible = incidents.filter((i) => inRegion(i, region) && matchesSearch(search, i.title, i.source, i.locationName));
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
            {digest.status === 'ready' ? `${incidents.length} active events` : 'Loading events'}
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
          <ConflictMap region={region} layers={layers} />
          <IncidentsCard state={digest} rows={visible.slice(0, 6)} total={visible.length} />
        </div>
        <div class="flex w-full flex-col gap-4 wide:w-[352px] wide:shrink-0">
          <Timeline incidents={incidents} region={region} />
          <Watchlist />
          <EvidenceMix state={digest} region={region} />
          <MapLayers layers={layers} onChange={setLayers} />
        </div>
      </div>
    </>
  );
}

function ConflictMap({ region, layers }: { region: GeoRegion; layers: { conflicts: boolean; hotspots: boolean } }) {
  const ucdp = useUcdpEvents();
  const digest = useDigest('full');
  const [zoom, setZoom] = useState(1);

  const { markers, callouts } = useMemo(() => {
    const out: MapMarker[] = [];
    const callouts: Array<{ id: string; lat: number; lon: number; name: string; score: number; tone: Tone; detail: string }> = [];
    if (layers.conflicts && ucdp.status === 'ready') {
      // Cluster UCDP events on a 2° grid so dense theatres read as one marker.
      const cells = new Map<string, { lat: number; lon: number; deaths: number; events: number; country: string; latest: number }>();
      for (const e of ucdp.data) {
        const lat = e.location?.latitude ?? 0;
        const lon = e.location?.longitude ?? 0;
        if (region !== 'all' && regionOfPoint(lat, lon) !== region) continue;
        const key = `${Math.round(lat / 2)},${Math.round(lon / 2)}`;
        const cell = cells.get(key) ?? { lat, lon, deaths: 0, events: 0, country: e.country, latest: 0 };
        cell.deaths += e.deathsBest || 0;
        cell.events += 1;
        cell.latest = Math.max(cell.latest, e.dateStart || 0);
        cells.set(key, cell);
      }
      const ranked = [...cells.entries()].sort((a, b) => b[1].deaths - a[1].deaths).slice(0, 40);
      for (const [key, c] of ranked) {
        const tone = severityFromDeaths(c.deaths);
        out.push({ id: `ucdp:${key}`, lat: c.lat, lon: c.lon, tone, radius: 4 + Math.min(8, Math.sqrt(c.deaths)), title: `${c.country}: ${c.deaths} deaths, ${c.events} UCDP events` });
      }
      for (const [key, c] of ranked.slice(0, 2)) {
        callouts.push({ id: `ucdp:${key}`, lat: c.lat, lon: c.lon, name: c.country, score: c.deaths, tone: severityFromDeaths(c.deaths), detail: `UCDP · ${c.events} events · ${c.deaths} deaths` });
      }
    }
    if (layers.hotspots) {
      for (const h of INTEL_HOTSPOTS) {
        const score = h.escalationScore ?? 0;
        if (score < 3) continue;
        if (region !== 'all' && regionOfPoint(h.lat, h.lon) !== region) continue;
        const tone: Tone = score >= 5 ? 'crit' : score >= 4 ? 'high' : 'elev';
        out.push({ id: `hotspot:${h.id}`, lat: h.lat, lon: h.lon, tone, radius: 3 + score, title: `${h.name}: escalation ${score}/5 (curated hotspot)` });
      }
    }
    return { markers: out, callouts };
  }, [ucdp, region, layers]);

  const scrub = useMemo(() => {
    if (digest.status !== 'ready') return null;
    const stamps = digestItems(digest.data, GEO_CATEGORIES).map((i) => i.publishedAt);
    return timeBuckets(stamps, Date.now(), 72, 42);
  }, [digest]);

  const activeLayers = Number(layers.conflicts) + Number(layers.hotspots);

  return (
    <Card
      title="Conflict map"
      sub="UCDP events and curated hotspots"
      testId="conflict-map"
      right={
        <>
          <div class="hidden items-center gap-[14px] md:flex">
            {(['crit', 'high', 'elev'] as const).map((tone) => (
              <span key={tone} class="flex items-center gap-[6px] text-[11.5px] text-muted">
                <Dot tone={tone} size={8} />
                {tone === 'crit' ? 'Critical' : tone === 'high' ? 'High' : 'Elevated'}
              </span>
            ))}
          </div>
          <span class="flex items-center gap-[6px] rounded-[6px] border border-line px-[10px] py-[5px] text-[11.5px] text-muted">
            <Layers size={13} strokeWidth={1.5} />
            Layers · {activeLayers} of 5
          </span>
        </>
      }
    >
      <div class="relative h-[300px] overflow-hidden bg-bg/40 md:h-[380px]">
        <DotMap markers={markers} zoom={zoom}>
          {callouts.map((c) => {
            const [x, y] = project(c.lat, c.lon);
            return (
              <g key={c.id} transform={`translate(${x + 8} ${y + 6})`} class="pointer-events-none">
                <rect width={112} height={26} rx={4} fill="#111419e6" stroke="var(--color-line)" stroke-width={0.6} />
                <text x={6} y={11} font-size={7.5} font-weight={600} fill="var(--color-ink)">{c.name}</text>
                <text x={106} y={11} font-size={7} text-anchor="end" font-family="var(--font-mono)" fill={`var(--color-${c.tone})`}>{c.score}</text>
                <text x={6} y={21} font-size={6.5} fill="var(--color-dim)">{c.detail}</text>
              </g>
            );
          })}
        </DotMap>
        {ucdp.status !== 'ready' && layers.conflicts ? (
          <div class="absolute left-14 right-4 top-4 flex justify-end">
            <div class="rounded-[6px] border border-line bg-surface/90 px-2">
            <SourceState state={ucdp} source="UCDP events (seed-ucdp-events)" pad={false} />
            </div>
          </div>
        ) : null}
        <div class="absolute left-4 top-4 flex flex-col overflow-hidden rounded-[6px] border border-line bg-surface">
          <button type="button" aria-label="Zoom in" class="flex h-7 w-7 items-center justify-center border-b border-line text-muted hover:text-ink" onClick={() => setZoom((z) => Math.min(4, z * 1.5))}>
            <Plus size={13} strokeWidth={1.5} />
          </button>
          <button type="button" aria-label="Zoom out" class="flex h-7 w-7 items-center justify-center border-b border-line text-muted hover:text-ink" onClick={() => setZoom((z) => Math.max(1, z / 1.5))}>
            <Minus size={13} strokeWidth={1.5} />
          </button>
          <button type="button" aria-label="Reset view" class="flex h-7 w-7 items-center justify-center text-muted hover:text-ink" onClick={() => setZoom(1)}>
            <Locate size={13} strokeWidth={1.5} />
          </button>
        </div>
        {scrub ? (
          <div class="absolute bottom-4 left-4 right-4 flex h-8 items-center gap-3 rounded-[6px] border border-line bg-surface/90 px-3" title="Reports per time slice, last 72 hours">
            <span class="font-mono text-[10.5px] text-dim">−72h</span>
            <div class="min-w-0 flex-1">
              <BarStrip values={scrub} height={16} label="Reports over the last 72 hours" colorFor={(i) => (i >= scrub.length - 6 ? 'bg-geo' : 'bg-track')} />
            </div>
            <span class="font-mono text-[10.5px] text-muted">now</span>
          </div>
        ) : null}
      </div>
      <RegionStrip />
    </Card>
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
          const status = INCIDENT_STATUS[claimStatus(item)];
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
                {sourceCount(item)} · {isPrimarySource(item.source) ? 1 : 0}P
              </span>
              <span class="font-mono text-[13px] font-medium text-ink md:w-[56px]">{Math.min(100, Math.round(item.importanceScore))}</span>
              <span class="font-mono text-[12px] text-dim md:w-[64px]">{relativeTime(item.publishedAt, now)}</span>
            </a>
          );
        })
      )}
      <footer class="border-t border-line bg-bg px-5 py-[10px] text-[11.5px] text-dim">
        P = tier-1 source (wire service or official body). Status is a corroboration rule, not severity: Confirmed = 2+ sources with a tier-1 one; Developing = 2+ sources; Claimed = one source.
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
    <Panel title="Regional timeline" sub={focus ? GEO_REGION_LABEL[focus] : undefined} right={<DerivedTag how="Tags from the corroboration rule: confirmed = 2+ sources with a tier-1 one; attributed = 2+ sources; unverified = one source." />} testId="regional-timeline">
      {entries.length === 0 ? (
        <p class="text-[12px] text-dim">No recent incidents.</p>
      ) : (
        <ol class="flex flex-col">
          {entries.map((item, index) => {
            const claim = claimStatus(item);
            const tone = CLAIM_TONE[claim];
            return (
              <li key={item.link} class="flex gap-3">
                <span class="w-9 shrink-0 font-mono text-[11px] leading-[17px] text-dim">{new Date(item.publishedAt).toISOString().slice(11, 16)}</span>
                <span class="flex flex-col items-center gap-1 pt-1">
                  <span class={cx('h-[7px] w-[7px] rounded-full border-[1.5px]', BORDER[tone], index === 0 ? BG[tone] : 'bg-surface')} />
                  {index < entries.length - 1 ? <span class="w-px flex-1 bg-track" /> : null}
                </span>
                <span class="flex min-w-0 flex-col gap-[3px] pb-[10px]">
                  <a href={item.link} target="_blank" rel="noopener noreferrer" class="text-[12.5px] leading-[18px] text-ink hover:underline">{item.title}</a>
                  <span class={cx('font-mono text-[9.5px] font-medium tracking-[0.6px]', TEXT[tone])}>{CLAIM_LABEL[claim]}</span>
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

function EvidenceMix({ state, region }: { state: ReturnType<typeof useDigest>; region: GeoRegion }) {
  const items = state.status === 'ready' ? digestItems(state.data, GEO_CATEGORIES).filter((i) => inRegion(i, region)) : [];
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
