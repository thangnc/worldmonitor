import { render, type ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { GeoJSONSource, Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
import Supercluster from 'supercluster';
import { Locate, Minus, Plane, Plus, Ship, X } from 'lucide-preact';
import type { Tone } from '../data/transforms';
import { BG, BORDER, TEXT, cx } from '../components/ui';
import { COUNTRY_CODE_PROPERTY, COUNTRY_FILL_LAYER, COUNTRY_FILL_SOURCE, MAP_CREDITS, buildLiteMapStyle, countryFillLayer, readLiteMapTokens } from './style';
import { getCountriesGeoJson } from '@/services/country-geometry';
import { LABEL_MIN_RADIUS, WORLD_BOUNDS, compactCount, markerBounds, placeCard, ucdpRadius } from './view';

/**
 * The Lite map: MapLibre on OpenFreeMap vector tiles, styled from the Lite
 * `@theme` tokens (./style.ts). The canvas cannot take Tailwind classes, but
 * everything drawn over it can: markers, the detail card and the controls are
 * Preact elements with Tailwind classes. Context geometry (lane lines, country
 * fills) is drawn as MapLibre layers under the labels, coloured from the same
 * tokens.
 *
 * UCDP locations cluster by zoom (supercluster), sized by deaths; clicking a
 * cluster zooms in until it splits. Curated hotspots are diamonds with a name.
 * Pins (Finance signals, chokepoints, financial centres) are never clustered.
 * Clicking a location or hotspot opens one card beside it, joined by a leader
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
  /** Replaces the value and lines, e.g. the indicator cards a pin carries. */
  body?: ComponentChildren;
}

interface MarkerBase {
  id: string;
  lat: number;
  lon: number;
  /** Hover text and the marker button's accessible name. */
  title: string;
  popup: MapCard;
}

export interface UcdpMarker extends MarkerBase {
  kind: 'ucdp';
  /** Best-estimate deaths at this location; sizes the circle. */
  deaths: number;
}

export interface HotspotMarker extends MarkerBase {
  kind: 'hotspot';
  tone: Tone;
  /** Name shown beside the diamond; empty draws a smaller diamond without one. */
  label: string;
  /** Military aircraft near the hotspot, drawn as a "✈ N" chip when the indicator fired. */
  badge?: number;
}

export interface PinMarker extends MarkerBase {
  kind: 'pin';
  /**
   * `signal`: a dot, filled when fired; `chokepoint`: a ring; `centre`: a small
   * square, context only; `aircraft`: a plane turned to its heading; `sea`: a
   * ship (an incident at sea).
   */
  shape: 'signal' | 'chokepoint' | 'centre' | 'aircraft' | 'sea';
  /** Degrees from north, for `aircraft`. */
  heading?: number;
  tone: Tone;
  fired: boolean;
  /** Name chip beside the mark, and its second line. Hidden on phones. */
  label?: string;
  sub?: string;
  /** Pixel nudge for a pin that would sit on a neighbour at world zoom (Fed and NYSE). */
  nudge?: [number, number];
}

/** Technology layer marks: attack-server hexagons, outage dots, cloud-region squares, data-centre sites, tags. */
export interface GlyphMarker extends MarkerBase {
  kind: 'glyph';
  shape: 'hex' | 'dot' | 'square' | 'site' | 'tag';
  tone: GlyphTone;
  /** Inside the glyph: a count on a hexagon, the text of a tag. */
  text?: string;
  /** Beside the glyph, hidden on phones. */
  label?: string;
  /** Outline only: an ended outage, a quiet region. */
  hollow?: boolean;
}

/** A shaded country the user clicked; its card sits at the click point. */
export interface CountryMarker extends MarkerBase {
  kind: 'country';
}

type ShownMarker = MapMarker | CountryMarker;

export type GlyphTone = Tone | 'tech';

export type MapMarker = UcdpMarker | HotspotMarker | PinMarker | GlyphMarker;

/**
 * Lines and fills drawn under the labels, coloured by each feature's `tone`
 * (elev, crit, tech; anything else is the track grey). A fill feature may set
 * `opacity` (default 0.14), as the DDoS shading does by share of traffic.
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

/** A UCDP location or cluster: red, sized by deaths, the toll printed once it fits. */
function UcdpCircle({ deaths, label, selected, onClick }: { deaths: number; label: string; selected: boolean; onClick: () => void }) {
  const r = ucdpRadius(deaths);
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={selected}
      title={label}
      class={cx(
        'flex cursor-pointer items-center justify-center rounded-full font-mono font-semibold text-ink',
        selected ? 'border-2 border-ink/80 bg-crit' : 'border border-crit/80 bg-crit/25 hover:bg-crit/40',
      )}
      style={{ width: r * 2, height: r * 2, fontSize: r >= 18 ? 11 : 10 }}
      onClick={(e) => {
        // Keep the click off the map, which would close the card again.
        e.stopPropagation();
        onClick();
      }}
    >
      {r >= LABEL_MIN_RADIUS ? compactCount(deaths) : null}
    </button>
  );
}

/** The curated-hotspot mark, shared with the map legend. */
export function Diamond({ tone, filled, size = 12 }: { tone: Tone; filled: boolean; size?: number }) {
  return (
    <span class="relative flex shrink-0 items-center justify-center" style={{ width: size * 1.5, height: size * 1.5 }} aria-hidden="true">
      <span class={cx('absolute rotate-45 border-2', BORDER[tone], filled ? BG[tone] : 'bg-bg/70')} style={{ width: size, height: size }} />
      {filled ? null : <span class={cx('relative h-[4px] w-[4px] rounded-full', BG[tone])} />}
    </span>
  );
}

function HotspotPin({ marker, selected, onClick }: { marker: HotspotMarker; selected: boolean; onClick: () => void }) {
  // Only the diamond takes clicks. The name beside it lets clicks through, so a
  // UCDP circle under a name stays clickable.
  return (
    <div class="pointer-events-none flex items-center gap-[5px]">
      <button
        type="button"
        aria-label={marker.title}
        aria-expanded={selected}
        title={marker.title}
        class="pointer-events-auto flex cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        {/* A fixed 18 px box, so the marker's offset puts every diamond's centre on its point. */}
        <span class="flex h-[18px] w-[18px] items-center justify-center">
          <Diamond tone={marker.tone} filled={selected} size={marker.label ? 12 : 9} />
        </span>
      </button>
      {marker.badge ? (
        <span class="flex items-center gap-[3px] rounded-[5px] bg-ink px-[5px] py-px font-mono text-[10.5px] font-semibold leading-4 text-bg" data-aircraft-badge={marker.badge}>
          <Plane size={10} strokeWidth={2} aria-hidden="true" />
          {marker.badge}
        </span>
      ) : null}
      {/* Names are hidden on phones, where they would cover the small map. */}
      {marker.label ? (
        <span class={cx('hidden rounded-[4px] bg-bg/85 px-[6px] py-px text-[11px] leading-4 sm:inline', TEXT[marker.tone])}>{marker.label}</span>
      ) : null}
    </div>
  );
}

const PIN_DOT: Readonly<Record<Tone, string>> = {
  crit: 'border-crit', high: 'border-high', elev: 'border-elev', ok: 'border-ok', muted: 'border-muted', dim: 'border-dim',
};

/** The signal, chokepoint and centre marks, shared with the map legend. */
export function PinMark({ shape, tone, fired, heading }: { shape: PinMarker['shape']; tone: Tone; fired: boolean; heading?: number }) {
  if (shape === 'centre') return <span class="block h-[5px] w-[5px] bg-dim" aria-hidden="true" />;
  // lucide's plane points north-east, so a heading of 45° draws it as is.
  if (shape === 'aircraft') {
    return <Plane size={12} strokeWidth={1.75} class="block text-ink/80" style={{ transform: `rotate(${(heading ?? 45) - 45}deg)` }} aria-hidden="true" />;
  }
  if (shape === 'sea') {
    return (
      <span class={cx('flex h-[16px] w-[16px] items-center justify-center rounded-[4px] border bg-bg', fired ? 'border-ok text-ok' : 'border-dim text-dim')} aria-hidden="true">
        <Ship size={11} strokeWidth={1.75} />
      </span>
    );
  }
  if (shape === 'chokepoint') {
    return <span class={cx('block h-[11px] w-[11px] rounded-full border-2', PIN_DOT[tone], tone === 'dim' ? 'bg-bg/70' : 'bg-bg')} aria-hidden="true" />;
  }
  // Finance signals always take the Finance domain colour.
  return fired ? (
    <span class="block h-[11px] w-[11px] rounded-full border-2 border-ink/80 bg-fin" aria-hidden="true" />
  ) : (
    <span class="block h-[11px] w-[11px] rounded-full border-2 border-fin bg-bg" aria-hidden="true" />
  );
}

function Pin({ marker, selected, onClick }: { marker: PinMarker; selected: boolean; onClick: () => void }) {
  if (marker.shape === 'centre') {
    return <span class="flex h-[16px] w-[16px] items-center justify-center" title={marker.title}><PinMark shape="centre" tone="dim" fired={false} /></span>;
  }
  const chip = marker.shape === 'signal' ? (marker.fired ? 'text-fin' : 'text-muted') : marker.tone === 'dim' ? 'text-muted' : TEXT[marker.tone];
  return (
    <div class="pointer-events-none flex items-center gap-[5px]">
      <button
        type="button"
        aria-label={marker.title}
        aria-expanded={selected}
        title={marker.title}
        class={cx('pointer-events-auto flex h-[16px] w-[16px] cursor-pointer items-center justify-center rounded-full', selected && 'ring-2 ring-ink/60')}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        <PinMark shape={marker.shape} tone={marker.tone} fired={marker.fired} heading={marker.heading} />
      </button>
      {marker.label ? (
        <span class={cx('hidden flex-col rounded-[4px] border bg-bg/85 px-[6px] py-[2px] sm:flex', marker.fired ? 'border-line' : 'border-transparent')}>
          <span class={cx('whitespace-nowrap text-[11px] font-medium leading-4', chip)}>{marker.label}</span>
          {marker.sub ? <span class="whitespace-nowrap font-mono text-[10px] leading-[14px] text-muted">{marker.sub}</span> : null}
        </span>
      ) : null}
    </div>
  );
}

// Written out in full so Tailwind sees every class (rule: lite-profile.md).
const TONE_TEXT: Record<GlyphTone, string> = { ...TEXT, tech: 'text-tech' };
const TONE_BG: Record<GlyphTone, string> = { ...BG, tech: 'bg-tech' };
const TONE_BORDER: Record<GlyphTone, string> = { ...BORDER, tech: 'border-tech' };
const TONE_FILL: Record<GlyphTone, string> = {
  crit: 'bg-crit/30', high: 'bg-high/30', elev: 'bg-elev/30', ok: 'bg-ok/30', muted: 'bg-muted/20', dim: 'bg-dim/20', tech: 'bg-tech/30',
};

/** The glyph box width, so the mark (not its label) sits on the point. */
export function glyphWidth(shape: GlyphMarker['shape']): number {
  return shape === 'hex' ? 24 : shape === 'tag' ? 0 : 18;
}

/** The mark alone, shared with the map legend. */
export function GlyphMark({ shape, tone, text, hollow, selected = false }: Pick<GlyphMarker, 'shape' | 'tone' | 'text' | 'hollow'> & { selected?: boolean }) {
  if (shape === 'hex') {
    return (
      <span class="relative flex h-[26px] w-[24px] items-center justify-center">
        <svg viewBox="0 0 24 26" class={cx('absolute inset-0 h-full w-full', TONE_TEXT[tone])} aria-hidden="true">
          <polygon points="12,1 23,7 23,19 12,25 1,19 1,7" fill="var(--color-bg)" fill-opacity="0.9" stroke="currentColor" stroke-width={selected ? 2.5 : 1.5} />
        </svg>
        <span class="relative font-mono text-[9.5px] font-semibold text-ink">{text}</span>
      </span>
    );
  }
  if (shape === 'tag') {
    return <span class={cx('whitespace-nowrap rounded-[3px] border bg-bg/85 px-[5px] py-px font-mono text-[10px] leading-[14px]', TONE_BORDER[tone], TONE_TEXT[tone], selected && 'bg-surface-2')}>{text}</span>;
  }
  const inner = shape === 'site'
    ? <span class={cx('flex h-[14px] w-[14px] items-center justify-center rounded-[3px] border bg-bg/85', TONE_BORDER[tone], selected && 'border-2')}><span class={cx('h-[6px] w-[6px] rounded-[1px]', TONE_BG[tone])} /></span>
    : <span class={cx('border', shape === 'dot' ? 'h-[12px] w-[12px] rounded-full' : 'h-[9px] w-[9px] rounded-[2px]', TONE_BORDER[tone], hollow ? 'bg-bg/70' : shape === 'dot' ? TONE_BG[tone] : TONE_FILL[tone], selected && 'border-2 border-ink')} />;
  return <span class="flex h-[18px] w-[18px] items-center justify-center" aria-hidden="true">{inner}</span>;
}

function Glyph({ marker, selected, onClick }: { marker: GlyphMarker; selected: boolean; onClick: () => void }) {
  return (
    <div class="pointer-events-none flex items-center gap-[5px]">
      <button
        type="button"
        aria-label={marker.title}
        aria-expanded={selected}
        title={marker.title}
        class="pointer-events-auto flex cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        <GlyphMark shape={marker.shape} tone={marker.tone} text={marker.text} hollow={marker.hollow} selected={selected} />
      </button>
      {marker.label ? <span class={cx('hidden whitespace-nowrap rounded-[3px] bg-bg/85 px-[5px] py-px text-[10.5px] leading-4 sm:inline', TONE_TEXT[marker.tone])}>{marker.label}</span> : null}
    </div>
  );
}

const LINE_CLASS: Record<NonNullable<CardLine['style']> | 'text', string> = {
  text: 'text-[11.5px] leading-[16px] text-muted',
  mono: 'font-mono text-[11px] leading-[16px] text-ink',
  dim: 'text-[11px] leading-[15px] text-dim',
};

function MapCardView({ marker, onClose }: { marker: ShownMarker; onClose: () => void }) {
  const { kind, name, value, lines, score, body } = marker.popup;
  const tone: GlyphTone = marker.kind === 'ucdp' || marker.kind === 'country' ? 'crit' : marker.tone;
  const country = marker.kind === 'country';
  const text = country ? 'text-reported' : TONE_TEXT[tone];
  return (
    <div
      class={cx(
        'rounded-[8px] border border-line bg-surface/95 px-[14px] py-3 text-left shadow-[0_8px_24px_rgba(0,0,0,0.35)]',
        body ? 'max-h-[340px] w-[330px] max-w-[calc(100vw-56px)] overflow-y-auto' : 'w-[272px]',
      )}
      data-map-popup={marker.id}
    >
      <div class="flex items-center justify-between gap-2">
        <span class={cx('flex min-w-0 items-center gap-[7px] font-mono text-[10px] font-semibold tracking-[1px] uppercase', text)}>
          {marker.kind === 'hotspot' ? (
            <Diamond tone={marker.tone} filled={false} size={8} />
          ) : (
            <span class={cx('h-[7px] w-[7px] shrink-0', country ? 'rounded-[2px] bg-violence-3' : cx('rounded-full', TONE_BG[tone]))} />
          )}
          <span class="truncate">{kind}</span>
        </span>
        <button type="button" aria-label="Close" class="-mr-1 text-dim hover:text-ink" onClick={onClose}>
          <X size={12} strokeWidth={1.5} />
        </button>
      </div>
      {body ? <div class="mt-[8px] flex flex-col gap-[10px]">{body}</div> : null}
      {body ? null : (
      <div class="mt-[6px] flex items-baseline justify-between gap-3">
        <span class="text-[14px] leading-[19px] font-semibold text-ink">{name}</span>
        <span class={cx('flex shrink-0 items-center gap-[6px] font-mono text-[12px]', text)}>
          {score != null ? (
            <span class="flex gap-[2px]" aria-hidden="true">
              {[1, 2, 3, 4, 5].map((i) => (
                <span key={i} class={cx('h-[11px] w-[6px] rounded-[1px]', i <= Math.round(score) ? TONE_BG[tone] : 'bg-track')} />
              ))}
            </span>
          ) : null}
          {value}
        </span>
      </div>
      )}
      {/* No scroll area: cards hold a few clamped lines; a point with several events gets a summary (src/lite/data/ucdp.ts). */}
      {(body ? [] : lines).map((line, i) => (
        // Lines can repeat, so key by position.
        <p key={i} class={cx('mt-[5px] line-clamp-3', LINE_CLASS[line.style ?? 'text'])}>
          {line.text}
        </p>
      ))}
    </div>
  );
}

type Shown =
  | { type: 'marker'; marker: MapMarker }
  | { type: 'cluster'; id: string; clusterId: number; lat: number; lon: number; deaths: number; count: number };

export function LiteMap({
  markers,
  fit,
  countries,
  overlays,
  focusId,
  onSelect,
}: {
  markers: readonly MapMarker[];
  /** `world` shows the whole map; `markers` zooms to the markers (a region filter). */
  fit: 'world' | 'markers';
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

  const bounds = fit === 'markers' ? markerBounds(markers) : WORLD_BOUNDS;
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const boundsKey = bounds.flat().map((v) => v.toFixed(1)).join(',');

  const ucdp = useMemo(() => markers.filter((m): m is UcdpMarker => m.kind === 'ucdp'), [markers]);
  const hotspots = useMemo(() => markers.filter((m): m is HotspotMarker | PinMarker | GlyphMarker => m.kind !== 'ucdp'), [markers]);
  const byId = useMemo(() => new Map(markers.map((m) => [m.id, m])), [markers]);

  const index = useMemo(() => {
    const cluster = new Supercluster<{ id: string; deaths: number }, { deaths: number }>({
      radius: 52,
      maxZoom: CLUSTER_MAX_ZOOM,
      map: (p) => ({ deaths: p.deaths }),
      reduce: (acc, p) => {
        acc.deaths += p.deaths;
      },
    });
    cluster.load(
      ucdp.map((m) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [m.lon, m.lat] }, properties: { id: m.id, deaths: m.deaths } })),
    );
    return cluster;
  }, [ucdp]);

  const shown = useMemo((): Shown[] => {
    const out: Shown[] = [];
    const z = Math.max(0, Math.floor(view.zoom));
    for (const f of index.getClusters([view.west, view.south, view.east, view.north], z)) {
      const [lon = 0, lat = 0] = f.geometry.coordinates;
      const p = f.properties as { cluster?: boolean; cluster_id?: number; point_count?: number; deaths: number; id?: string };
      if (p.cluster && p.cluster_id != null) {
        out.push({ type: 'cluster', id: `ucdp-cluster:${p.cluster_id}`, clusterId: p.cluster_id, lat, lon, deaths: p.deaths, count: p.point_count ?? 0 });
      } else if (p.id) {
        const marker = byId.get(p.id);
        if (marker) out.push({ type: 'marker', marker });
      }
    }
    for (const h of hotspots) out.push({ type: 'marker', marker: h });
    return out;
  }, [index, view, hotspots, byId]);

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
      const hotspot = s.type === 'marker' && s.marker.kind !== 'ucdp';
      let entry = onMap.get(id);
      if (!entry) {
        const el = document.createElement('div');
        // The diamond, not its name, sits on the point (anchor left, offset by half the 18 px box).
        if (s.type === 'cluster') el.dataset.cluster = String(s.count);
        else el.dataset.marker = id;
        const pin = s.type === 'marker' && s.marker.kind === 'pin' ? s.marker : null;
        const [dx, dy] = pin?.nudge ?? [0, 0];
        const glyph = s.type === 'marker' && s.marker.kind === 'glyph' ? s.marker : null;
        const offset: [number, number] = [(glyph ? -glyphWidth(glyph.shape) / 2 : pin ? -8 : -9) + dx, dy];
        // A tag sits just above its point, so it never hides the mark there.
        const options = glyph?.shape === 'tag'
          ? { element: el, anchor: 'bottom' as const, offset: [0, -10] as [number, number] }
          : hotspot ? { element: el, anchor: 'left' as const, offset } : { element: el };
        entry = { marker: new lib.Marker(options).setLngLat(lngLat).addTo(map), el };
        onMap.set(id, entry);
      } else {
        entry.marker.setLngLat(lngLat);
      }
      // Set on every render: a hotspot's level, and so its layer, can change on refresh.
      // Named hotspots draw above UCDP circles; grey unnamed ones below, so they never cover a death count.
      // A hotspot's element spans its name too, so only the diamond button inside takes clicks.
      // Pins: signals and sea incidents on top, chokepoints over lanes, centres and aircraft at the bottom.
      const named = s.type === 'marker' && s.marker.kind !== 'ucdp' && Boolean(s.marker.label);
      // Glyphs: tags on top (they are small and sit above their point), then attack hexagons.
      const pinLayer = s.type === 'marker' && s.marker.kind === 'pin'
        ? s.marker.shape === 'signal' ? (s.marker.fired ? 'z-[3]' : 'z-[2]')
          : s.marker.shape === 'sea' ? 'z-[3]'
          : s.marker.shape === 'chokepoint' ? 'z-[1]' : 'z-0'
        : s.type === 'marker' && s.marker.kind === 'glyph'
          ? s.marker.shape === 'tag' ? 'z-[3]' : s.marker.shape === 'hex' ? 'z-[2]' : 'z-[1]'
          : null;
      entry.el.classList.remove('z-0', 'z-[1]', 'z-[2]', 'z-[3]', 'pointer-events-none');
      entry.el.classList.add(pinLayer ?? (!hotspot ? 'z-[1]' : named ? 'z-[2]' : 'z-0'));
      if (hotspot) entry.el.classList.add('pointer-events-none');
      if (s.type === 'cluster') {
        const zoomIn = () => {
          const zoom = Math.min(MAP_MAX_ZOOM, index.getClusterExpansionZoom(s.clusterId));
          map.easeTo({ center: [s.lon, s.lat], zoom });
        };
        const label = `${s.count} UCDP locations, ${s.deaths.toLocaleString('en-US')} deaths. Zoom in`;
        render(<UcdpCircle deaths={s.deaths} label={label} selected={false} onClick={zoomIn} />, entry.el);
      } else {
        const m = s.marker;
        const toggle = () => setSelected((cur) => (cur === m.id ? null : m.id));
        render(
          m.kind === 'hotspot' ? (
            <HotspotPin marker={m} selected={selected === m.id} onClick={toggle} />
          ) : m.kind === 'pin' ? (
            <Pin marker={m} selected={selected === m.id} onClick={toggle} />
          ) : m.kind === 'glyph' ? (
            <Glyph marker={m} selected={selected === m.id} onClick={toggle} />
          ) : (
            <UcdpCircle deaths={m.deaths} label={m.title} selected={selected === m.id} onClick={toggle} />
          ),
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
    const toneColor = ['match', ['get', 'tone'], 'elev', tokens.elev, 'crit', tokens.crit, 'tech', tokens.tech, tokens.track] as unknown as string;
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
