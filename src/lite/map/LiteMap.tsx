import { render, type ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { GeoJSONSource, Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
import Supercluster from 'supercluster';
import { Locate, Minus, Plus, X } from 'lucide-preact';
import { OverlayScroll } from '../components/scroll';
import { cx } from '../components/ui';
import { COUNTRY_CODE_PROPERTY, COUNTRY_FILL_LAYER, COUNTRY_FILL_SOURCE, MAP_CREDITS, buildLiteMapStyle, countryFillLayer, readLiteMapTokens } from './style';
import { getCountriesGeoJson } from '@/services/country-geometry';
import { type Bounds, WORLD_BOUNDS, markerBounds, placeCard } from './view';
import {
  AggregateMark,
  AssetMark,
  EventMark,
  JudgementMark,
  SELECTED_RING,
  STALE,
  STATE_BG,
  STATE_TEXT,
  type MarkFill,
  type MarkGlyph,
  type MarkState,
} from './marks';

/**
 * The Lite map: MapLibre on OpenFreeMap vector tiles, styled from the Lite
 * `@theme` tokens (./style.ts). The canvas cannot take Tailwind classes, but
 * everything drawn over it can: markers, the detail card and the controls are
 * Preact elements with Tailwind classes. Context geometry (lane lines, country
 * fills) is drawn as MapLibre layers under the labels, coloured from the same
 * tokens.
 *
 * Every marker uses the one grammar in ./marks.tsx: events, assets,
 * aggregates and judgements, coloured by state. Aggregates marked `cluster`
 * (UCDP locations) merge by zoom (supercluster), summing their count; clicking
 * a merged circle zooms in until it splits. Nothing else is clustered.
 * Clicking a marker opens one card beside it, joined by a leader
 * line; clicking the map, the close button or Escape closes it. MapLibre is
 * loaded on first use, so the other Lite screens never download it.
 */
export interface CardLine {
  text: string;
  /** `mono` for dates and coordinates, `dim` for small print. */
  style?: 'mono' | 'dim';
}

export interface MapCard {
  /** Header, e.g. "UCDP · State-based violence" or "Curated hotspot". */
  kind: string;
  name: string;
  /** The headline figure: deaths, or the hotspot score. */
  value: string;
  lines: readonly CardLine[];
  /** Hotspot score on the 1–5 scale, drawn as five segments. */
  score?: number;
}

interface MarkerBase {
  id: string;
  lat: number;
  lon: number;
  /** Hover text and the marker button's accessible name. */
  title: string;
  popup: MapCard;
  /** The layer's feed is late: the marker draws at 45% opacity. */
  stale?: boolean;
  /** Pixel nudge for a marker that would sit on a neighbour at world zoom (Fed and NYSE). */
  nudge?: [number, number];
}

/** One thing happened here: a sea incident, an outage, a fired signal (spec grammar: event). */
export interface EventMarker extends MarkerBase {
  kind: 'event';
  glyph: MarkGlyph;
  state: MarkState;
  fill: MarkFill;
}

/** A place we watch: a cloud region, a data centre, a chokepoint, a bank (spec grammar: asset). */
export interface AssetMarker extends MarkerBase {
  kind: 'asset';
  glyph: MarkGlyph;
  state: MarkState;
  /** Other keys an indicator may focus this marker by, e.g. each cloud provider in a city. */
  keys?: readonly string[];
}

/** Many things: a count in a circle, area ∝ count (spec grammar: aggregate). */
export interface AggregateMarker extends MarkerBase {
  kind: 'aggregate';
  count: number;
  /** The count at which the circle reaches its 40 px maximum. */
  fullAt: number;
  state: MarkState;
  fill: 'reported' | 'background';
  /** Nearby ones merge by zoom, summing `count` (UCDP locations); a click on a merged circle zooms in. */
  cluster?: { noun: string; unit: string };
}

/** An analyst's call: a curated hotspot (spec grammar: judgement). */
export interface JudgementMarker extends MarkerBase {
  kind: 'judgement';
  state: MarkState;
  /** 3/5 or more: drawn above aggregates; below it the grey diamond sits under them. */
  named: boolean;
}

/** A short label for one of the top few by impact (DDoS share). */
export interface LabelMarker extends MarkerBase {
  kind: 'label';
  text: string;
}

/** A shaded country the user clicked; its card sits at the click point. */
export interface CountryMarker extends MarkerBase {
  kind: 'country';
}

type ShownMarker = MapMarker | CountryMarker;

export type MapMarker = EventMarker | AssetMarker | AggregateMarker | JudgementMarker | LabelMarker;

/**
 * Lines and fills drawn under the labels, coloured by each feature's `tone`:
 * a state (elev, crit; anything else is the track grey) or a step of the
 * shared blue ramp (ramp-1 to ramp-4) for an intensity area. A fill feature
 * may set `opacity` (default 0.14), as the DDoS ramp does.
 */
export interface MapOverlays {
  lines?: { type: 'FeatureCollection'; features: unknown[] };
  fills?: { type: 'FeatureCollection'; features: unknown[] };
}

/** Country shading: ISO2 → step 1–4 (0 or absent is unshaded), and each shaded country's card. */
export interface CountryFill {
  steps: ReadonlyMap<string, number>;
  card: (code: string) => { title: string; popup: MapCard } | null;
}

type MapLibre = typeof import('maplibre-gl');

const MAP_MAX_ZOOM = 8;
/** Clustering stops one level below the map's maximum, so every cluster splits by the last zoom step. */
const CLUSTER_MAX_ZOOM = MAP_MAX_ZOOM - 1;
const CARD_FALLBACK = { w: 272, h: 140 };

let libPromise: Promise<MapLibre> | null = null;

function loadMapLibre(): Promise<MapLibre> {
  libPromise ??= Promise.all([
    import('maplibre-gl'),
    import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'),
    import('maplibre-gl/dist/maplibre-gl.css'),
  ])
    .then(([lib, worker]) => {
      lib.setWorkerUrl(worker.default);
      return lib;
    })
    .catch((err: unknown) => {
      libPromise = null;
      throw err;
    });
  return libPromise;
}

function MarkButton({ title, selected, onClick, children }: { title: string; selected: boolean; onClick: () => void; children: ComponentChildren }) {
  // No name chip beside the mark: what it stands for opens in its card on click.
  return (
    <button
      type="button"
      aria-label={title}
      aria-expanded={selected}
      title={title}
      class="pointer-events-auto flex cursor-pointer"
      onClick={(e) => {
        // Keep the click off the map, which would close the card again.
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

/** The mark alone, in the shared grammar (./marks.tsx). */
function MarkerMark({ marker, selected }: { marker: MapMarker; selected: boolean }) {
  const stale = marker.stale;
  switch (marker.kind) {
    case 'event':
      return <EventMark glyph={marker.glyph} state={marker.state} fill={marker.fill} selected={selected} stale={stale} />;
    case 'asset':
      return <AssetMark glyph={marker.glyph} state={marker.state} selected={selected} stale={stale} />;
    case 'aggregate':
      return <AggregateMark count={marker.count} fullAt={marker.fullAt} state={marker.state} fill={marker.fill} selected={selected} stale={stale} />;
    case 'judgement':
      return <JudgementMark state={marker.state} selected={selected} stale={stale} />;
    case 'label':
      return (
        <span class={cx('whitespace-nowrap rounded-[3px] border border-line bg-bg/85 px-[5px] py-px font-mono text-[10px] leading-[14px] text-ink', selected && SELECTED_RING, stale && STALE)}>
          {marker.text}
        </span>
      );
  }
}

/**
 * Events on top, then signalled assets and named hotspots, aggregates, and
 * the background at the bottom (grey hotspots, and assets in their normal
 * state: a quiet cloud region or data centre sits under everything until a
 * signal turns it amber or red); labels above all.
 */
export function markerLayer(m: MapMarker): string {
  switch (m.kind) {
    case 'label':
      return 'z-[4]';
    case 'event':
      return 'z-[3]';
    case 'asset':
      return m.state === 'normal' ? 'z-0' : 'z-[2]';
    case 'judgement':
      return m.named ? 'z-[2]' : 'z-0';
    case 'aggregate':
      return 'z-[1]';
  }
}

const LINE_CLASS: Record<NonNullable<CardLine['style']> | 'text', string> = {
  text: 'text-[11.5px] leading-[16px] text-muted',
  mono: 'font-mono text-[11px] leading-[16px] text-ink',
  dim: 'text-[11px] leading-[15px] text-dim',
};

function MapCardView({ marker, onClose }: { marker: ShownMarker; onClose: () => void }) {
  const { kind, name, value, lines, score } = marker.popup;
  const state: MarkState = marker.kind === 'country' || marker.kind === 'label' ? 'normal' : marker.state;
  const country = marker.kind === 'country';
  const text = country ? 'text-reported' : STATE_TEXT[state];
  const content = (
    <>
      <div class="flex items-center justify-between gap-2">
        <span class={cx('flex min-w-0 items-center gap-[7px] font-mono text-[10px] font-semibold tracking-[1px] uppercase', text)}>
          {marker.kind === 'judgement' ? (
            <JudgementMark state={state} size={11} />
          ) : (
            <span class={cx('h-[7px] w-[7px] shrink-0', country ? 'rounded-[2px] bg-ramp-2' : cx('rounded-full', STATE_BG[state]))} />
          )}
          <span class="truncate">{kind}</span>
        </span>
        <button type="button" aria-label="Close" class="-mr-1 text-dim hover:text-ink" onClick={onClose}>
          <X size={12} strokeWidth={1.5} />
        </button>
      </div>
      <div class="mt-[6px] flex items-baseline justify-between gap-3">
        <span class="text-[14px] leading-[19px] font-semibold text-ink">{name}</span>
        <span class={cx('flex shrink-0 items-center gap-[6px] font-mono text-[12px]', text)}>
          {score != null ? (
            <span class="flex gap-[2px]" aria-hidden="true">
              {[1, 2, 3, 4, 5].map((i) => (
                <span key={i} class={cx('h-[11px] w-[6px] rounded-[1px]', i <= Math.round(score) ? STATE_BG[state] : 'bg-track')} />
              ))}
            </span>
          ) : null}
          {value}
        </span>
      </div>
      {/* Lines show in full, never clamped: a long one scrolls with the card. */}
      {lines.map((line, i) => (
        // Lines can repeat, so key by position.
        <p key={i} class={cx('mt-[5px]', LINE_CLASS[line.style ?? 'text'])}>
          {line.text}
        </p>
      ))}
    </>
  );
  const frame = 'rounded-[8px] border border-line bg-surface/95 text-left shadow-[0_8px_24px_rgba(0,0,0,0.35)]';
  // A long card scrolls past 340px under an overlay scrollbar.
  return (
    <div class={cx(frame, 'flex max-h-[340px] w-[272px] max-w-[calc(100vw-56px)] flex-col')} data-map-popup={marker.id}>
      <OverlayScroll class="min-h-0 flex-1 overflow-y-auto" contentClass="px-[14px] py-3">
        {content}
      </OverlayScroll>
    </div>
  );
}

type Shown =
  | { type: 'marker'; marker: MapMarker }
  | { type: 'cluster'; id: string; clusterId: number; lat: number; lon: number; total: number; count: number; like: AggregateMarker };

export function LiteMap({
  markers,
  fit,
  countries,
  overlays,
  focusId,
  onSelect,
}: {
  markers: readonly MapMarker[];
  /** `world` shows the whole map; `markers` zooms to the markers (a region filter); bounds zoom to that area (a region tile). */
  fit: 'world' | 'markers' | Bounds;
  /** Country shading (the reported-violence layer); omitted draws none. */
  countries?: CountryFill;
  overlays?: MapOverlays;
  /** Selects this marker and pans to it (a card elsewhere on the screen was opened). */
  focusId?: string | null;
  /** Told when the open marker changes, including closing it. */
  onSelect?: (id: string | null) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const libRef = useRef<MapLibre | null>(null);
  const placed = useRef(new Map<string, { marker: MapLibreMarker; el: HTMLElement }>());
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState({ zoom: 0, west: -180, south: -85, east: 180, north: 85 });
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [cardSize, setCardSize] = useState(CARD_FALLBACK);
  const [picked, setPicked] = useState<{ code: string; lat: number; lon: number } | null>(null);
  const [fillReady, setFillReady] = useState(false);
  const countriesRef = useRef(countries);
  countriesRef.current = countries;
  const shadedRef = useRef(new Set<string>());

  const bounds = Array.isArray(fit) ? fit : fit === 'markers' ? markerBounds(markers) : WORLD_BOUNDS;
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const boundsKey = bounds.flat().map((v) => v.toFixed(1)).join(',');

  const clustered = useMemo(() => markers.filter((m): m is AggregateMarker => m.kind === 'aggregate' && Boolean(m.cluster)), [markers]);
  const single = useMemo(() => markers.filter((m) => !(m.kind === 'aggregate' && m.cluster)), [markers]);
  const byId = useMemo(() => new Map(markers.map((m) => [m.id, m])), [markers]);

  const index = useMemo(() => {
    const cluster = new Supercluster<{ id: string; total: number }, { total: number }>({
      radius: 52,
      maxZoom: CLUSTER_MAX_ZOOM,
      map: (p) => ({ total: p.total }),
      reduce: (acc, p) => {
        acc.total += p.total;
      },
    });
    cluster.load(
      clustered.map((m) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [m.lon, m.lat] }, properties: { id: m.id, total: m.count } })),
    );
    return cluster;
  }, [clustered]);

  const shown = useMemo((): Shown[] => {
    const out: Shown[] = [];
    const z = Math.max(0, Math.floor(view.zoom));
    const like = clustered[0];
    if (like) {
      for (const f of index.getClusters([view.west, view.south, view.east, view.north], z)) {
        const [lon = 0, lat = 0] = f.geometry.coordinates;
        const p = f.properties as { cluster?: boolean; cluster_id?: number; point_count?: number; total: number; id?: string };
        if (p.cluster && p.cluster_id != null) {
          out.push({ type: 'cluster', id: `cluster:${p.cluster_id}`, clusterId: p.cluster_id, lat, lon, total: p.total, count: p.point_count ?? 0, like });
        } else if (p.id) {
          const marker = byId.get(p.id);
          if (marker) out.push({ type: 'marker', marker });
        }
      }
    }
    for (const m of single) out.push({ type: 'marker', marker: m });
    return out;
  }, [index, view, clustered, single, byId]);

  useEffect(() => {
    let cancelled = false;
    const markersOnMap = placed.current;
    loadMapLibre()
      .then((lib) => {
        if (cancelled || !box.current) return;
        libRef.current = lib;
        const map = new lib.Map({
          container: box.current,
          style: buildLiteMapStyle(readLiteMapTokens()),
          bounds: boundsRef.current,
          fitBoundsOptions: { padding: 16 },
          // Below 0 so the whole world fits a phone-width card.
          minZoom: -1,
          maxZoom: MAP_MAX_ZOOM,
          renderWorldCopies: false,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          // Page scroll and one-finger swipes keep scrolling the page;
          // Ctrl/⌘ + scroll zooms and two fingers pan.
          cooperativeGestures: true,
          // The credit is drawn below as a Tailwind label in the Lite palette.
          attributionControl: false,
        });
        map.touchZoomRotate.disableRotation();
        const syncView = () => {
          const b = map.getBounds();
          setView({
            zoom: map.getZoom(),
            west: Math.max(-180, b.getWest()),
            south: Math.max(-85, b.getSouth()),
            east: Math.min(180, b.getEast()),
            north: Math.min(85, b.getNorth()),
          });
        };
        map.on('moveend', syncView);
        // A click on a shaded country opens its card; anywhere else closes the card.
        map.on('click', (e: { point: { x: number; y: number }; lngLat: { lng: number; lat: number } }) => {
          const hit = map.getLayer(COUNTRY_FILL_LAYER)
            ? map.queryRenderedFeatures([e.point.x, e.point.y], { layers: [COUNTRY_FILL_LAYER] })
            : [];
          const code = hit.map((f) => String(f.id ?? f.properties?.[COUNTRY_CODE_PROPERTY] ?? '')).find((c) => (countriesRef.current?.steps.get(c) ?? 0) > 0);
          if (code) {
            setPicked({ code, lat: e.lngLat.lat, lon: e.lngLat.lng });
            setSelected(`country:${code}`);
          } else {
            setSelected(null);
          }
        });
        mapRef.current = map;
        syncView();
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.warn('[lite-map] map unavailable', err);
        setStatus('failed');
      });
    return () => {
      cancelled = true;
      for (const { marker, el } of markersOnMap.values()) {
        render(null, el);
        marker.remove();
      }
      markersOnMap.clear();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // The country polygons load once the map is ready and a fill is wanted.
  const wantsFill = Boolean(countries);
  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map || !wantsFill || fillReady) return;
    let cancelled = false;
    const setup = (geo: Awaited<ReturnType<typeof getCountriesGeoJson>>) => {
      if (cancelled || !geo || mapRef.current !== map) return;
      if (!map.getSource(COUNTRY_FILL_SOURCE)) {
        map.addSource(COUNTRY_FILL_SOURCE, { type: 'geojson', data: geo, promoteId: COUNTRY_CODE_PROPERTY });
        map.addLayer(countryFillLayer(readLiteMapTokens()), 'country-border');
      }
      setFillReady(true);
    };
    getCountriesGeoJson()
      .then((geo) => {
        if (cancelled) return;
        if (map.isStyleLoaded()) setup(geo);
        else map.once('load', () => setup(geo));
      })
      .catch((err: unknown) => console.warn('[lite-map] country shapes unavailable', err));
    return () => {
      cancelled = true;
    };
  }, [status, wantsFill, fillReady]);

  // Shading follows the steps through feature state, without reloading the shapes.
  useEffect(() => {
    const map = mapRef.current;
    if (!fillReady || !map) return;
    const steps = countries?.steps ?? new Map<string, number>();
    const shaded = shadedRef.current;
    for (const code of shaded) {
      if ((steps.get(code) ?? 0) > 0) continue;
      map.setFeatureState({ source: COUNTRY_FILL_SOURCE, id: code }, { step: 0 });
      shaded.delete(code);
    }
    for (const [code, step] of steps) {
      if (step <= 0) continue;
      map.setFeatureState({ source: COUNTRY_FILL_SOURCE, id: code }, { step });
      shaded.add(code);
    }
  }, [fillReady, countries]);

  // One MapLibre marker per shown id; its Preact content re-renders in place.
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (status !== 'ready' || !map || !lib) return;
    const onMap = placed.current;
    const ids = new Set(shown.map((s) => (s.type === 'cluster' ? s.id : s.marker.id)));
    for (const [id, { marker, el }] of onMap) {
      if (ids.has(id)) continue;
      render(null, el);
      marker.remove();
      onMap.delete(id);
    }
    for (const s of shown) {
      const id = s.type === 'cluster' ? s.id : s.marker.id;
      const lngLat: [number, number] = s.type === 'cluster' ? [s.lon, s.lat] : [s.marker.lon, s.marker.lat];
      let entry = onMap.get(id);
      if (!entry) {
        const el = document.createElement('div');
        if (s.type === 'cluster') el.dataset.cluster = String(s.count);
        else el.dataset.marker = id;
        // Every mark is centred on its point; a label sits just above it, so it never hides the mark there.
        const options = s.type === 'marker' && s.marker.kind === 'label'
          ? { element: el, anchor: 'bottom' as const, offset: [0, -10] as [number, number] }
          : { element: el, offset: s.type === 'marker' ? s.marker.nudge : undefined };
        entry = { marker: new lib.Marker(options).setLngLat(lngLat).addTo(map), el };
        onMap.set(id, entry);
      } else {
        entry.marker.setLngLat(lngLat);
      }
      // Set on every render: a hotspot's level, and so its layer, can change on refresh.
      entry.el.classList.remove('z-0', 'z-[1]', 'z-[2]', 'z-[3]', 'z-[4]');
      entry.el.classList.add(s.type === 'cluster' ? 'z-[1]' : markerLayer(s.marker));
      if (s.type === 'marker' && s.marker.kind === 'judgement') entry.el.dataset.named = String(s.marker.named);
      if (s.type === 'cluster') {
        const zoomIn = () => {
          const zoom = Math.min(MAP_MAX_ZOOM, index.getClusterExpansionZoom(s.clusterId));
          map.easeTo({ center: [s.lon, s.lat], zoom });
        };
        const { noun, unit } = s.like.cluster!;
        const label = `${s.count} ${noun}, ${s.total.toLocaleString('en-US')} ${unit}. Zoom in`;
        render(
          <MarkButton title={label} selected={false} onClick={zoomIn}>
            <AggregateMark count={s.total} fullAt={s.like.fullAt} state={s.like.state} fill={s.like.fill} stale={s.like.stale} />
          </MarkButton>,
          entry.el,
        );
      } else {
        const m = s.marker;
        const isSelected = selected === m.id;
        const mark = <MarkerMark marker={m} selected={isSelected} />;
        render(
          <MarkButton title={m.title} selected={isSelected} onClick={() => setSelected((cur) => (cur === m.id ? null : m.id))}>
            {mark}
          </MarkButton>,
          entry.el,
        );
      }
    }
  }, [status, shown, selected, index]);

  const selectedMarker = useMemo((): ShownMarker | null => {
    if (!selected) return null;
    if (selected.startsWith('country:')) {
      if (!picked || `country:${picked.code}` !== selected) return null;
      const card = (countries?.steps.get(picked.code) ?? 0) > 0 ? countries?.card(picked.code) : null;
      return card ? { kind: 'country', id: selected, lat: picked.lat, lon: picked.lon, title: card.title, popup: card.popup } : null;
    }
    return byId.get(selected) ?? null;
  }, [selected, picked, countries, byId]);

  // Another part of the screen asks for a marker: open it and bring it into view.
  useEffect(() => {
    if (!focusId) return;
    const marker = byId.get(focusId);
    if (!marker) return;
    setSelected(focusId);
    const map = mapRef.current;
    if (status === 'ready' && map) map.easeTo({ center: [marker.lon, marker.lat], duration: 500 });
  }, [focusId, status]);

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  useEffect(() => {
    onSelectRef.current?.(selected);
  }, [selected]);

  // Context geometry: one GeoJSON source per kind, drawn under the labels.
  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map) return;
    const tokens = readLiteMapTokens();
    const [r1, r2, r3, r4] = tokens.ramp;
    const toneColor = ['match', ['get', 'tone'], 'elev', tokens.elev, 'crit', tokens.crit, 'ramp-1', r1, 'ramp-2', r2, 'ramp-3', r3, 'ramp-4', r4, tokens.track] as unknown as string;
    const empty = { type: 'FeatureCollection' as const, features: [] };
    const sync = () => {
      const fills = (overlays?.fills ?? empty) as GeoJSON.FeatureCollection;
      const lines = (overlays?.lines ?? empty) as GeoJSON.FeatureCollection;
      const fillSource = map.getSource('lite-fills') as GeoJSONSource | undefined;
      if (fillSource) fillSource.setData(fills);
      else {
        map.addSource('lite-fills', { type: 'geojson', data: fills });
        map.addLayer({ id: 'lite-fills', type: 'fill', source: 'lite-fills', paint: { 'fill-color': toneColor, 'fill-opacity': ['coalesce', ['get', 'opacity'], 0.14] as unknown as number } }, 'country-label');
        map.addLayer({ id: 'lite-fills-outline', type: 'line', source: 'lite-fills', paint: { 'line-color': toneColor, 'line-width': 1, 'line-opacity': 0.8 } }, 'country-label');
      }
      const lineSource = map.getSource('lite-lines') as GeoJSONSource | undefined;
      if (lineSource) lineSource.setData(lines);
      else {
        map.addSource('lite-lines', { type: 'geojson', data: lines });
        // Normal lines stay faint; toned ones (amber, red) stand out.
        const toned = ['!=', ['get', 'tone'], 'dim'] as unknown as boolean;
        map.addLayer({
          id: 'lite-lines', type: 'line', source: 'lite-lines',
          paint: { 'line-color': toneColor, 'line-width': ['case', toned, 1.4, 0.8] as unknown as number, 'line-opacity': ['case', toned, 0.85, 0.45] as unknown as number },
        }, 'country-label');
      }
    };
    if (map.isStyleLoaded()) sync();
    else map.once('load', sync);
  }, [status, overlays]);

  // A selection whose marker is gone (layer off, region changed) closes.
  useEffect(() => {
    if (selected && !selectedMarker) setSelected(null);
  }, [selected, selectedMarker]);

  // The card follows its marker as the map moves.
  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map || !selectedMarker) {
      setPoint(null);
      return;
    }
    const project = () => {
      const p = map.project([selectedMarker.lon, selectedMarker.lat]);
      setPoint({ x: p.x, y: p.y });
    };
    project();
    map.on('move', project);
    return () => {
      map.off('move', project);
    };
  }, [status, selectedMarker]);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el || !el.offsetWidth) return;
    if (el.offsetWidth !== cardSize.w || el.offsetHeight !== cardSize.h) setCardSize({ w: el.offsetWidth, h: el.offsetHeight });
  });

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected]);

  // Refit when the region filter changes the area of interest.
  useEffect(() => {
    if (status !== 'ready') return;
    mapRef.current?.fitBounds(boundsRef.current, { padding: 16, duration: 600 });
  }, [status, boundsKey]);

  const mapSize = { w: wrap.current?.clientWidth ?? 0, h: wrap.current?.clientHeight ?? 0 };
  const place = point ? placeCard(point, cardSize, mapSize) : null;
  const button = 'flex h-7 w-7 items-center justify-center text-muted hover:text-ink';
  return (
    <div ref={wrap} class="absolute inset-0">
      {/* maplibre-gl.css sets the container to position: relative, so it fills a positioned wrapper. */}
      <div ref={box} class="h-full w-full" data-map-status={status} />
      {status === 'ready' ? (
        // Top right: the time histogram covers the bottom edge.
        <div class="absolute right-3 top-3 flex gap-1 rounded-[4px] bg-surface/85 px-[6px] text-[10px] leading-4 text-dim" data-map-credits>
          {MAP_CREDITS.map((c) => (
            <a key={c.href} href={c.href} target="_blank" rel="noopener" class="hover:text-muted">
              {c.label}
            </a>
          ))}
        </div>
      ) : null}
      {status === 'failed' ? (
        <div class="absolute inset-0 flex items-center justify-center text-[12px] text-dim">
          Map unavailable: this browser could not start WebGL.
        </div>
      ) : null}
      <div class="absolute left-4 top-4 flex flex-col overflow-hidden rounded-[6px] border border-line bg-surface">
        <button type="button" aria-label="Zoom in" class={cx(button, 'border-b border-line')} onClick={() => mapRef.current?.zoomIn()}>
          <Plus size={13} strokeWidth={1.5} />
        </button>
        <button type="button" aria-label="Zoom out" class={cx(button, 'border-b border-line')} onClick={() => mapRef.current?.zoomOut()}>
          <Minus size={13} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          aria-label="Reset view"
          class={button}
          onClick={() => mapRef.current?.fitBounds(boundsRef.current, { padding: 16, duration: 600 })}
        >
          <Locate size={13} strokeWidth={1.5} />
        </button>
      </div>
      {selectedMarker && point && place ? (
        <>
          <svg class="pointer-events-none absolute inset-0 z-[5] h-full w-full" aria-hidden="true">
            <line x1={point.x} y1={point.y} x2={place.attach.x} y2={place.attach.y} stroke="var(--color-muted)" stroke-opacity="0.7" stroke-width="1" />
          </svg>
          <div ref={cardRef} class="absolute z-[5]" style={{ left: place.left, top: place.top }}>
            <MapCardView marker={selectedMarker} onClose={() => setSelected(null)} />
          </div>
        </>
      ) : null}
    </div>
  );
}
