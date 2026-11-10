import { useEffect, useMemo, useState } from 'preact/hooks';
import { CalendarDays, Radio } from 'lucide-preact';
import { INTEL_HOTSPOTS } from '@/config/geo';
import { Topbar, matchesSearch } from '../components/Topbar';
import { BarStrip, StackedBar } from '../components/charts';
import { LayersPopover, type LayerGroup } from '../components/LayersPopover';
import { TimeRangeControl } from '../components/TimeRange';
import { BG, BORDER, Card, ColLabel, DerivedTag, Dot, Panel, SegmentedControl, SourceState, TEXT, cx } from '../components/ui';
import { LiteMap, type CountryFill, type MapMarker, type MapOverlays } from '../map/LiteMap';
import { AggregateMark, EventMark, HatchSwatch, JudgementMark, LineSwatch, RampSwatch, StatusAreaSwatch, SwatchRun } from '../map/marks';
import { LegendRow, MapLegend } from '../map/legend';
import { HealthDots, IndicatorFeed } from '../components/indicator';
import {
  selectIncidents,
  useChokepoints,
  useConflictCounts,
  useCrossStraitActivity,
  useDigest,
  useEarthquakes,
  useEmbassyAlerts,
  useGpsHighCells,
  useGpsInterference,
  useMilitaryFlights,
  useRiskScores,
  useSeaIncidents,
  useUcdpEvents,
  useUnrestEvents,
} from '../data/hooks';
import {
  AIRCRAFT_FULL_AT,
  AIRCRAFT_MIN,
  AIRCRAFT_RADIUS_KM,
  GPS_RADIUS_KM,
  GPS_REGION_RISE,
  SEA_WINDOW_HOURS,
  aircraftFeeds,
  aircraftKind,
  aircraftNearHotspots,
  gpsFeeds,
  gpsHexFills,
  hotspotState,
  kindSplit,
  layerRangeNote,
  seaIncidentFeeds,
  seaIncidentState,
} from '../data/geo-layers';
import { shippingLanes } from '../data/markets-map';
import { ESCALATION_REGIONS, leadCountry } from '../data/regions';
import { ucdpBackgroundLabel, ucdpMarkers, ucdpNewest } from '../data/ucdp';
import {
  VIOLENCE_RULE,
  conflictHistogram,
  countryName,
  countryShading,
  regionStrip,
  violenceFeeds,
  type RegionTile,
} from '../data/conflict';
import { feedCounts, feedsStale, sortFeeds, type FeedState } from '../data/indicators';
import { LINK_WINDOW_HOURS, linkNews } from '../data/news-link';
import { FEED_LABEL, escalationLevel, scoreHotspots } from '../data/escalation';
import { CHOKEPOINT_TRANSIT_SHARE, EMBASSY_WINDOW_HOURS, TAIWAN_MIN, TAIWAN_RATIO, chokepointFeeds, embassyAlertFeeds, taiwanStraitFeeds } from '../data/geo-watch';
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
 * 6h, 24h and 7d (owner's decision, 2026-11-10; 30d dropped). They filter the GDELT shading and
 * histogram, incidents at sea and the digest-driven parts of the screen. UCDP is the verified
 * background and shows at every range. Each layer row in the popover says what it shows at the
 * selected range (`layerRangeNote`).
 */
const RANGE_PURPOSE: Record<TimeRange, string> = {
  '6h': 'Is something spiking now? The last 6 hours against each country\'s 7-day average.',
  '24h': 'What happened today? The last 24 hours against each country\'s 7-day average.',
  '7d': 'A sudden spike or a week-long build-up? The last 7 days against the 22 before.',
};

function inRegion(item: LiteItem, region: GeoRegion): boolean {
  return region === 'all' || regionOfCategory(item.category) === region;
}

export function Geopolitics() {
  const [region, setRegion] = useState<GeoRegion>('all');
  // The named region a strip tile zoomed the map to; the selector clears it.
  const [area, setArea] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [layers, setLayers] = useState<LayerState>(DEFAULT_LAYERS);
  const [range, setRange] = useState<TimeRange>('7d');
  // A marker opened from outside the map (a hotspot tile, an indicator card); closing its card clears it.
  const [focus, setFocus] = useState<string | null>(null);
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
        filter={
          <SegmentedControl
            label="Region"
            options={REGION_OPTIONS}
            value={region}
            onChange={(next) => {
              setRegion(next);
              setArea(null);
            }}
          />
        }
        search={search}
        onSearch={setSearch}
        actionLabel="New watch rule"
      />
      <div class="flex flex-col gap-6 px-4 py-6 wide:flex-row wide:px-7">
        <div class="flex min-w-0 flex-1 flex-col gap-5">
          <ConflictMap
            region={region}
            area={area}
            onArea={(id) => {
              const picked = ESCALATION_REGIONS.find((r) => r.id === id);
              // A tile outside the selected area switches the selector to the tile's area, so its markers show.
              if (picked && region !== 'all' && picked.area !== region) setRegion(picked.area);
              setArea(id);
            }}
            layers={layers} onLayers={setLayers} range={range} onRange={setRange} focus={focus} onFocus={setFocus} />
          <IncidentsCard state={digest} rows={visible.slice(0, 6)} total={visible.length} />
        </div>
        <div class="flex w-full flex-col gap-4 wide:w-[352px] wide:shrink-0">
          <GeoIndicators onOpen={(feed) => setFocus(mapIdForFeed(feed))} />
          <Timeline incidents={inRange} region={region} />
          <EvidenceMix state={digest} region={region} range={range} />
        </div>
      </div>
    </>
  );
}

/** The layers popover's switches (owner's design, 2026-11-08). Shipping lanes are optional context, off by default. */
interface LayerState {
  violence: boolean;
  aircraft: boolean;
  sea: boolean;
  gps: boolean;
  conflicts: boolean;
  hotspots: boolean;
  lanes: boolean;
}

const DEFAULT_LAYERS: LayerState = { violence: true, aircraft: true, sea: true, gps: true, conflicts: true, hotspots: true, lanes: false };

/**
 * The map marker an indicator card opens: its hotspot or its incident (Taiwan
 * Strait opens Taipei). Country spikes, regions and chokepoints have none.
 */
function mapIdForFeed(feed: FeedState): string | null {
  if (feed.id === 'taiwan') return 'hotspot:taipei';
  const [kind, key] = feed.id.split(':');
  if (!key) return null;
  if (kind === 'aircraft' || kind === 'gps' || kind === 'embassy') return `hotspot:${key}`;
  if (kind === 'sea') return feed.id;
  return null;
}

const HOUR_MS = 3_600_000;
const MAX_AIRCRAFT_PINS = 150;
type CellBoundary = (h3: string) => number[][];

function ConflictMap({
  region, area, onArea, layers, onLayers, range, onRange, focus, onFocus,
}: {
  region: GeoRegion;
  /** The named region a strip tile zoomed to, or null. */
  area: string | null;
  /** A strip tile was clicked: zoom to its region, or back out when it was the zoomed one. */
  onArea: (id: string | null) => void;
  layers: LayerState;
  onLayers: (next: LayerState) => void;
  range: TimeRange;
  onRange: (range: TimeRange) => void;
  focus: string | null;
  onFocus: (id: string | null) => void;
}) {
  const ucdp = useUcdpEvents();
  const digest = useDigest('full');
  const risk = useRiskScores();
  const unrest = useUnrestEvents();
  const earthquakes = useEarthquakes();
  const flights = useMilitaryFlights();
  const conflict = useConflictCounts();
  const sea = useSeaIncidents();
  const gps = useGpsInterference(layers.gps);
  // h3-js draws the GPS hexagons; it loads with the layer, never with the other screens.
  const [boundary, setBoundary] = useState<CellBoundary | null>(null);
  useEffect(() => {
    if (!layers.gps || boundary) return;
    let live = true;
    import('h3-js')
      .then((h3) => {
        if (live) setBoundary(() => (cell: string) => h3.cellToBoundary(cell, true));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [layers.gps, boundary]);

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
  const inView = (lat: number, lon: number) => region === 'all' || regionOfPoint(lat, lon) === region;

  // Military aircraft near the curated hotspots; 5 or more near one collapse into an aggregate with the count.
  const clusters = useMemo(() => (flights.status === 'ready' ? aircraftNearHotspots(flights.data, INTEL_HOTSPOTS) : []), [flights]);
  // A late feed draws its markers at 45% opacity (spec grammar: stale).
  const stale = useMemo(() => {
    const now = Date.now();
    return { aircraft: feedsStale(aircraftFeeds(flights, INTEL_HOTSPOTS, [], now)), sea: feedsStale(seaIncidentFeeds(sea, [], now)) };
  }, [flights, sea]);

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
          kind: 'judgement',
          id: `hotspot:${h.id}`,
          lat: h.lat,
          lon: h.lon,
          state: hotspotState(level.tone),
          // Below 3/5 the diamond stays grey, under the aggregates; from 3/5 it is drawn on top.
          named: level.named,
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
    if (layers.aircraft) {
      const seen = new Set<string>();
      // A hotspot with AIRCRAFT_MIN or more nearby: one aggregate at their centre, carrying them all.
      for (const c of clusters) {
        if (c.flights.length < AIRCRAFT_MIN || !inView(c.hotspot.lat, c.hotspot.lon)) continue;
        const fresh = c.flights.filter((f) => !seen.has(f.id));
        for (const f of c.flights) seen.add(f.id);
        const pts = fresh.length ? fresh : c.flights;
        const lat = pts.reduce((t, f) => t + f.location!.latitude, 0) / pts.length;
        const lon = pts.reduce((t, f) => t + f.location!.longitude, 0) / pts.length;
        const names = c.flights.map((f) => f.callsign || f.hexCode).filter(Boolean);
        out.push({
          kind: 'aggregate',
          id: `aircraft-group:${c.hotspot.id}`,
          lat,
          lon,
          count: c.flights.length,
          fullAt: AIRCRAFT_FULL_AT,
          state: 'normal',
          fill: 'reported',
          stale: stale.aircraft,
          title: `${c.flights.length} military aircraft near ${c.hotspot.name}`,
          popup: {
            kind: 'Military aircraft · transponders',
            name: `Near ${c.hotspot.name}`,
            value: `${c.flights.length} aircraft`,
            lines: [
              { text: kindSplit(c.byKind) },
              { text: names.slice(0, 8).join(' · ') + (names.length > 8 ? ` · and ${names.length - 8} more` : ''), style: 'mono' as const },
              { text: `Within ${AIRCRAFT_RADIUS_KM} km of ${c.hotspot.name} · live positions, adsb.lol`, style: 'dim' as const },
            ].filter((line) => line.text),
          },
        });
      }
      let pins = 0;
      for (const c of clusters) {
        for (const f of c.flights) {
          if (seen.has(f.id) || pins >= MAX_AIRCRAFT_PINS || !inView(f.location!.latitude, f.location!.longitude)) continue;
          seen.add(f.id);
          pins += 1;
          const name = f.callsign || f.hexCode || 'Unidentified';
          out.push({
            // A transponder position is reported, not verified: a translucent grey event.
            kind: 'event',
            glyph: 'plane',
            state: 'normal',
            fill: 'reported',
            stale: stale.aircraft,
            id: `aircraft:${f.id}`,
            lat: f.location!.latitude,
            lon: f.location!.longitude,
            title: `${name}: military aircraft near ${c.hotspot.name}`,
            popup: {
              kind: 'Military aircraft · transponder',
              name,
              value: aircraftKind(f.aircraftType),
              lines: [
                { text: [f.aircraftModel, f.operatorCountry].filter(Boolean).join(' · ') },
                { text: `${Math.round(f.altitude).toLocaleString('en-US')} ft · ${Math.round(f.speed)} kt${Number.isFinite(f.heading) ? ` · heading ${Math.round(f.heading)}°` : ''}`, style: 'mono' as const },
                { text: `Within ${AIRCRAFT_RADIUS_KM} km of ${c.hotspot.name} · live position, adsb.lol`, style: 'dim' as const },
              ].filter((line) => line.text),
            },
          });
        }
      }
    }
    if (layers.sea && sea.status === 'ready') {
      const from = Date.now() - TIME_RANGE_HOURS[range] * HOUR_MS;
      for (const i of sea.data.incidents) {
        if (i.occurredAt < from || !inView(i.location!.latitude, i.location!.longitude)) continue;
        const recent = Date.now() - (i.reportedAt || i.occurredAt) <= SEA_WINDOW_HOURS * HOUR_MS;
        out.push({
          // An official notice: solid in its state colour; older than the fire window, the faint background.
          kind: 'event',
          glyph: 'ship',
          state: seaIncidentState(i.incidentType),
          fill: recent ? 'solid' : 'background',
          stale: stale.sea,
          id: `sea:${i.id}`,
          lat: i.location!.latitude,
          lon: i.location!.longitude,
          title: `UKMTO ${i.incidentNumber}: ${i.incidentType}, ${i.place}`,
          popup: {
            kind: 'Incident at sea · UKMTO',
            name: i.incidentType,
            value: `No. ${String(i.incidentNumber).padStart(3, '0')}`,
            lines: [
              { text: i.place },
              { text: i.description },
              { text: `${new Date(i.occurredAt).toISOString().slice(0, 16).replace('T', ' ')} UTC · official notice`, style: 'dim' as const },
            ],
          },
        });
      }
    }
    return out;
  }, [ucdp, escalation, region, layers, clusters, stale, sea, range]);

  // GPS hexagons (the latest gpsjam day) and the optional shipping lanes, drawn under the labels.
  const overlays = useMemo((): MapOverlays | undefined => {
    const hexes = layers.gps && gps.status === 'ready' && boundary
      ? gpsHexFills(gps.data.hexes.filter((h) => inView(h.lat, h.lon)), boundary)
      : undefined;
    const lanes = layers.lanes ? shippingLanes(new Set()) : undefined;
    return hexes || lanes ? { fills: hexes, lines: lanes } : undefined;
  }, [layers.gps, layers.lanes, gps, boundary, region]);

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
      regionStrip(
        ESCALATION_REGIONS,
        escalation.map(({ hotspot, score }) => ({ hotspot, score: score.combinedScore, level: escalationLevel(score.combinedScore) })),
        counts,
        Date.now(),
      ),
    [escalation, counts],
  );
  const zoomed = ESCALATION_REGIONS.find((r) => r.id === area);

  const unavailable = [
    layers.aircraft && (flights.status === 'error' || flights.status === 'empty') ? 'military aircraft (seed-military-flights)' : '',
    layers.sea && (sea.status === 'error' || sea.status === 'empty') ? 'incidents at sea (seed-ukmto-incidents)' : '',
    layers.gps && (gps.status === 'error' || gps.status === 'empty') ? 'GPS interference (fetch-gpsjam)' : '',
  ].filter(Boolean);

  return (
    <Card
      title="Conflict map"
      sub={`Reported violence (GDELT, against each country's normal) · ${ucdpBackgroundLabel(newest)} · hotspots: live score`}
      testId="conflict-map"
      right={
        <LayersPopover
          groups={layerGroups(layers, newest, range)}
          onToggle={(id, on) => onLayers({ ...layers, [id]: on })}
          footer={
            <span class="flex items-center gap-2">
              <CalendarDays size={13} strokeWidth={1.5} aria-hidden="true" />
              Range {range} · UCDP always shown as background
            </span>
          }
        />
      }
    >
      <div class="relative h-[300px] overflow-hidden border-t border-line bg-bg/40 md:h-[380px]">
        <LiteMap
          markers={markers}
          fit={zoomed ? zoomed.bounds : region === 'all' ? 'world' : 'markers'}
          countries={countries}
          overlays={overlays}
          focusId={focus}
          onSelect={(id) => {
            if (id !== focus) onFocus(null);
          }}
        />
        <GeoLegend layers={layers} />
        {unavailable.length ? (
          <span class="absolute right-3 top-3 z-[4] rounded-[4px] bg-surface/90 px-2 py-px text-[10.5px] text-dim" data-testid="layers-unavailable">
            Unavailable: {unavailable.join(', ')}
          </span>
        ) : null}
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
          <TimeRangeControl value={range} onChange={onRange} titles={RANGE_PURPOSE} />
          {histogram ? (
            <>
              <span class="hidden shrink-0 font-mono text-[10.5px] text-dim sm:inline">GDELT reports / {histogram.unit}</span>
              <div class="min-w-0 flex-1" title={`GDELT reports per ${histogram.unit === 'hr' ? 'hour' : 'day'}, last ${range}. Dim bars are incomplete.`} data-testid="gdelt-histogram">
                <BarStrip
                  values={histogram.bars.map((b) => b.value)}
                  height={16}
                  label={`GDELT reports per ${histogram.unit === 'hr' ? 'hour' : 'day'}, last ${range}`}
                  colorFor={(i) => (histogram.bars[i]?.partial ? 'bg-faint' : 'bg-ramp-2')}
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
      <RegionStrip tiles={tiles} region={region} area={area} onSelect={(id) => onArea(id === area ? null : id)} />
    </Card>
  );
}

// The same swatches as the map (src/lite/map/marks.tsx), states in the spec's order.
const UcdpMark = () => <AggregateMark count={0} fullAt={1} state="crit" fill="background" size={12} />;
/** Amber and red H3 cells, as the map draws them (medium 2–10 %, high above 10 %). */
const GpsMark = () => <SwatchRun><StatusAreaSwatch state="elev" shape="hex" /><StatusAreaSwatch state="crit" shape="hex" /></SwatchRun>;

/** The popover's three groups (owner's design): live layers, background and judgement, optional context. */
function layerGroups(layers: LayerState, ucdpNewestAt: number, range: TimeRange): LayerGroup[] {
  const ucdpTo = ucdpNewestAt ? ` (to ${new Date(ucdpNewestAt).toISOString().slice(0, 10)})` : '';
  return [
    {
      title: 'Live layers',
      // Aircraft are a live snapshot and gpsjam publishes one file a day, so only violence and sea follow the range (owner, 2026-11-10).
      note: `at ${range}`,
      rows: [
        { id: 'violence', mark: <RampSwatch steps={[2, 3, 4]} />, name: 'Reported violence · GDELT', sub: "country shading · against each country's normal", range: layerRangeNote('violence', range), on: layers.violence },
        { id: 'aircraft', mark: <EventMark glyph="plane" state="normal" fill="reported" />, name: 'Military aircraft', sub: `transponder · grouped at ${AIRCRAFT_MIN}+ near a hotspot`, range: layerRangeNote('aircraft', range), on: layers.aircraft },
        { id: 'sea', mark: <EventMark glyph="ship" state="crit" />, name: 'Incidents at sea · UKMTO', sub: `official notices · fires on one in ${SEA_WINDOW_HOURS} h`, range: layerRangeNote('sea', range), on: layers.sea },
        { id: 'gps', mark: <StatusAreaSwatch state="crit" shape="hex" />, name: 'GPS interference · gpsjam.org', sub: 'hexagons · amber 2–10%, red above 10%', range: layerRangeNote('gps', range), on: layers.gps },
        { id: 'airspace', mark: <HatchSwatch />, name: 'Airspace closures · NOTAM', sub: 'awaiting FAA access', on: null },
      ],
    },
    {
      title: 'Background & judgement',
      rows: [
        { id: 'conflicts', mark: <UcdpMark />, name: 'Verified · UCDP', sub: `verified background${ucdpTo}`, range: layerRangeNote('conflicts', range), on: layers.conflicts },
        { id: 'hotspots', mark: <JudgementMark state="elev" />, name: 'Curated hotspots', sub: 'live score 1–5', range: layerRangeNote('hotspots', range), on: layers.hotspots },
      ],
    },
    {
      title: 'Context · optional',
      rows: [
        { id: 'lanes', mark: <LineSwatch state="normal" />, name: 'Shipping lanes', sub: 'useful for the Red Sea watch', on: layers.lanes },
        { id: 'osint', mark: <Radio size={14} strokeWidth={1.5} class="text-dim" aria-hidden="true" />, name: 'Social OSINT', sub: 'discovery only · never alerts · no source chosen', on: null },
      ],
    },
  ];
}

/** The in-map legend: the layers that are on, plus airspace as N/A. */
function GeoLegend({ layers }: { layers: LayerState }) {
  return (
    <MapLegend testId="map-legend" place="above-bar" collapsible>
      {layers.violence ? <LegendRow mark={<RampSwatch />} name="Reported violence" note="GDELT" /> : null}
      {layers.conflicts ? <LegendRow mark={<UcdpMark />} name="Verified background" note="UCDP" /> : null}
      {layers.hotspots ? <LegendRow mark={<SwatchRun><JudgementMark state="normal" /><JudgementMark state="elev" /><JudgementMark state="crit" /></SwatchRun>} name="Curated hotspot" note="1–5" /> : null}
      {layers.aircraft ? <LegendRow mark={<SwatchRun><EventMark glyph="plane" state="normal" fill="reported" /><AggregateMark count={AIRCRAFT_MIN} fullAt={AIRCRAFT_FULL_AT} state="normal" size={16} /></SwatchRun>} name="Military aircraft" note={`ADS-B · ${AIRCRAFT_MIN}+ grouped`} /> : null}
      {layers.sea ? <LegendRow mark={<SwatchRun><EventMark glyph="ship" state="normal" /><EventMark glyph="ship" state="elev" /><EventMark glyph="ship" state="crit" /></SwatchRun>} name="Sea incident" note="UKMTO" /> : null}
      {layers.gps ? <LegendRow mark={<GpsMark />} name="GPS interference" note="gpsjam" /> : null}
      <LegendRow mark={<HatchSwatch />} name="Airspace closure" note="N/A" />
    </MapLegend>
  );
}

/**
 * One tile per named region (owner's decision, 2026-11-10). Tiles outside the
 * selected area stay in place but dim; a click zooms the map to the region,
 * and a second click on the zoomed tile zooms back out.
 */
function RegionStrip({ tiles, region, area, onSelect }: { tiles: RegionTile[]; region: GeoRegion; area: string | null; onSelect: (id: string) => void }) {
  return (
    <div class="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-3" data-testid="region-strip">
      {tiles.map((t) => {
        const outside = region !== 'all' && t.area !== region;
        const lead = t.lead ? `Level from the region's highest live hotspot score: ${t.lead.name} ${Math.round(t.lead.score)}/5.` : 'No curated hotspot in this region is scored yet.';
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.id)}
            aria-pressed={area === t.id}
            class={cx(
              'flex flex-col gap-2 px-[14px] py-3 text-left hover:bg-surface-2/60',
              area === t.id ? 'bg-surface-2' : 'bg-surface',
              outside ? 'opacity-50' : '',
            )}
            title={`${lead} Change: GDELT reports for its countries (${t.name}), last 24 complete hours against the 7-day daily average; — while any of those hours is incomplete. Bars: daily reports, 14 days. Click to zoom the map to the region.`}
            data-region-tile={t.id}
            data-area={t.area}
            data-outside={outside ? 'true' : undefined}
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
        );
      })}
    </div>
  );
}

/** The airspace row stays unavailable until the FAA grants NOTAM access (spec: Owner decisions). */
const AIRSPACE_FEED: FeedState = { kind: 'unavailable', id: 'airspace', name: 'Airspace closures · NOTAM', detail: 'Awaiting FAA access' };

/** The screen's indicator panel (spec: Early indicators › Catalogue, geopolitics rows). A card opens its marker on the map. */
function GeoIndicators({ onOpen }: { onOpen: (feed: FeedState) => void }) {
  const conflict = useConflictCounts();
  const digest = useDigest('full');
  const flights = useMilitaryFlights();
  const sea = useSeaIncidents();
  const gpsCells = useGpsHighCells();
  const chokepoints = useChokepoints();
  const strait = useCrossStraitActivity();
  const embassy = useEmbassyAlerts();
  const feeds = useMemo(() => {
    const now = Date.now();
    const news = digest.status === 'ready' ? digestItems(digest.data) : [];
    return sortFeeds([
      ...violenceFeeds(conflict.status === 'ready' ? conflict.data : null, conflict.status, news, now),
      ...aircraftFeeds(flights, INTEL_HOTSPOTS, news, now),
      ...seaIncidentFeeds(sea, news, now),
      ...gpsFeeds(gpsCells, INTEL_HOTSPOTS, news, now),
      ...chokepointFeeds(chokepoints, news, now),
      ...taiwanStraitFeeds(strait, news, now),
      ...embassyAlertFeeds(embassy, INTEL_HOTSPOTS, news, now),
      AIRSPACE_FEED,
    ]);
  }, [conflict, digest, flights, sea, gpsCells, chokepoints, strait, embassy]);
  const counts = feedCounts(feeds);
  const rules = [
    `Reported violence: ${VIOLENCE_RULE}, per country, GDELT material-conflict articles.`,
    `Military aircraft: ${AIRCRAFT_MIN} or more airborne within ${AIRCRAFT_RADIUS_KM} km of a curated hotspot.`,
    `Incidents at sea: any UKMTO notice in the last ${SEA_WINDOW_HOURS} h.`,
    `GPS interference: a high cell within ${GPS_RADIUS_KM} km of a hotspot that had none the day before, or a region's high cells up ${Math.round((GPS_REGION_RISE - 1) * 100)}% on the day.`,
    `Chokepoint transits: 7-day transits at or below ${Math.round(CHOKEPOINT_TRANSIT_SHARE * 100)}% of the year-earlier normal, or tanker flow below 85% of its 90-day normal 3 days running (IMF PortWatch, days behind).`,
    `Taiwan Strait: PLA aircraft or PLAN ships at ${TAIWAN_RATIO}× their 30-day median or more (at least ${TAIWAN_MIN.plaAircraftSorties} aircraft or ${TAIWAN_MIN.planShips} ships), Taiwan MND.`,
    `Embassy alerts: a US embassy alert in the last ${EMBASSY_WINDOW_HOURS} h for a curated hotspot's country (the watchlist stand-in).`,
    'Linked news: digest stories naming the country, place or sea area, 24 h before to 1 h after.',
  ].join(' ');
  return (
    <Panel title="Indicators" right={<><HealthDots feeds={feeds} /><DerivedTag how={rules} /></>} testId="geo-indicators">
      {/* The counts sit under the title, as on Finance: beside it they wrap in the narrow column. */}
      <p class="-mt-1 text-[11.5px] text-dim" data-testid="indicator-counts">
        {[`${counts.fired} fired`, counts.quiet && `${counts.quiet} quiet`, counts.stale && `${counts.stale} stale`, counts.unavailable && `${counts.unavailable} unavailable`, 'newest first'].filter(Boolean).join(' · ')}
      </p>
      <IndicatorFeed feeds={feeds} now={Date.now()} onOpen={onOpen} />
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
