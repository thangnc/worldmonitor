import { render } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
import Supercluster from 'supercluster';
import { Locate, Minus, Plus, X } from 'lucide-preact';
import type { Tone } from '../data/transforms';
import { BG, BORDER, TEXT, cx } from '../components/ui';
import { MAP_CREDITS, buildLiteMapStyle, readLiteMapTokens } from './style';
import { LABEL_MIN_RADIUS, WORLD_BOUNDS, compactCount, markerBounds, placeCard, ucdpRadius } from './view';

/**
 * The Lite conflict map: MapLibre on OpenFreeMap vector tiles, styled from the
 * Lite `@theme` tokens (./style.ts). The canvas cannot take Tailwind classes,
 * but everything drawn over it can: markers, the detail card and the controls
 * are Preact elements with Tailwind classes.
 *
 * UCDP locations cluster by zoom (supercluster), sized by deaths; clicking a
 * cluster zooms in until it splits. Curated hotspots are diamonds with a name.
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
}

export type MapMarker = UcdpMarker | HotspotMarker;

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
      {/* Names are hidden on phones, where they would cover the small map. */}
      {marker.label ? (
        <span class={cx('hidden rounded-[4px] bg-bg/85 px-[6px] py-px text-[11px] leading-4 sm:inline', TEXT[marker.tone])}>{marker.label}</span>
      ) : null}
    </div>
  );
}

const LINE_CLASS: Record<NonNullable<CardLine['style']> | 'text', string> = {
  text: 'text-[11.5px] leading-[16px] text-muted',
  mono: 'font-mono text-[11px] leading-[16px] text-ink',
  dim: 'text-[11px] leading-[15px] text-dim',
};

function MapCardView({ marker, onClose }: { marker: MapMarker; onClose: () => void }) {
  const { kind, name, value, lines, score } = marker.popup;
  const tone: Tone = marker.kind === 'hotspot' ? marker.tone : 'crit';
  return (
    <div
      class="w-[272px] rounded-[8px] border border-line bg-surface/95 px-[14px] py-3 text-left shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
      data-map-popup={marker.id}
    >
      <div class="flex items-center justify-between gap-2">
        <span class={cx('flex min-w-0 items-center gap-[7px] font-mono text-[10px] font-semibold tracking-[1px] uppercase', TEXT[tone])}>
          {marker.kind === 'hotspot' ? <Diamond tone={tone} filled={false} size={8} /> : <span class={cx('h-[7px] w-[7px] shrink-0 rounded-full', BG[tone])} />}
          <span class="truncate">{kind}</span>
        </span>
        <button type="button" aria-label="Close" class="-mr-1 text-dim hover:text-ink" onClick={onClose}>
          <X size={12} strokeWidth={1.5} />
        </button>
      </div>
      <div class="mt-[6px] flex items-baseline justify-between gap-3">
        <span class="text-[14px] leading-[19px] font-semibold text-ink">{name}</span>
        <span class={cx('flex shrink-0 items-center gap-[6px] font-mono text-[12px]', TEXT[tone])}>
          {score != null ? (
            <span class="flex gap-[2px]" aria-hidden="true">
              {[1, 2, 3, 4, 5].map((i) => (
                <span key={i} class={cx('h-[11px] w-[6px] rounded-[1px]', i <= Math.round(score) ? BG[tone] : 'bg-track')} />
              ))}
            </span>
          ) : null}
          {value}
        </span>
      </div>
      {/* No scroll area: cards hold a few clamped lines; a point with several events gets a summary (src/lite/data/ucdp.ts). */}
      {lines.map((line, i) => (
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
}: {
  markers: readonly MapMarker[];
  /** `world` shows the whole map; `markers` zooms to the markers (a region filter). */
  fit: 'world' | 'markers';
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

  const bounds = fit === 'markers' ? markerBounds(markers) : WORLD_BOUNDS;
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const boundsKey = bounds.flat().map((v) => v.toFixed(1)).join(',');

  const ucdp = useMemo(() => markers.filter((m): m is UcdpMarker => m.kind === 'ucdp'), [markers]);
  const hotspots = useMemo(() => markers.filter((m): m is HotspotMarker => m.kind === 'hotspot'), [markers]);
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
        map.on('click', () => setSelected(null));
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
      const hotspot = s.type === 'marker' && s.marker.kind === 'hotspot';
      let entry = onMap.get(id);
      if (!entry) {
        const el = document.createElement('div');
        // The diamond, not its name, sits on the point (anchor left, offset by half the 18 px box).
        if (s.type === 'cluster') el.dataset.cluster = String(s.count);
        else el.dataset.marker = id;
        const options = hotspot ? { element: el, anchor: 'left' as const, offset: [-9, 0] as [number, number] } : { element: el };
        entry = { marker: new lib.Marker(options).setLngLat(lngLat).addTo(map), el };
        onMap.set(id, entry);
      } else {
        entry.marker.setLngLat(lngLat);
      }
      // Set on every render: a hotspot's level, and so its layer, can change on refresh.
      // Named hotspots draw above UCDP circles; grey unnamed ones below, so they never cover a death count.
      // A hotspot's element spans its name too, so only the diamond button inside takes clicks.
      const named = s.type === 'marker' && s.marker.kind === 'hotspot' && Boolean(s.marker.label);
      entry.el.classList.remove('z-0', 'z-[1]', 'z-[2]', 'pointer-events-none');
      entry.el.classList.add(!hotspot ? 'z-[1]' : named ? 'z-[2]' : 'z-0');
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
          ) : (
            <UcdpCircle deaths={m.deaths} label={m.title} selected={selected === m.id} onClick={toggle} />
          ),
          entry.el,
        );
      }
    }
  }, [status, shown, selected, index]);

  const selectedMarker = selected ? byId.get(selected) ?? null : null;

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
          <svg class="pointer-events-none absolute inset-0 z-[3] h-full w-full" aria-hidden="true">
            <line x1={point.x} y1={point.y} x2={place.attach.x} y2={place.attach.y} stroke="var(--color-muted)" stroke-opacity="0.7" stroke-width="1" />
          </svg>
          <div ref={cardRef} class="absolute z-[3]" style={{ left: place.left, top: place.top }}>
            <MapCardView marker={selectedMarker} onClose={() => setSelected(null)} />
          </div>
        </>
      ) : null}
    </div>
  );
}
