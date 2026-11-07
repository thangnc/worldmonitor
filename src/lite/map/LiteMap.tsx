import { type ComponentChild, render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
import { Locate, Minus, Plus } from 'lucide-preact';
import type { Tone } from '../data/transforms';
import { BG, TEXT, cx } from '../components/ui';
import { MAP_CREDITS, buildLiteMapStyle, readLiteMapTokens } from './style';
import { WORLD_BOUNDS, markerBounds } from './view';

/**
 * The Lite conflict map: MapLibre on OpenFreeMap vector tiles, styled from the
 * Lite `@theme` tokens (./style.ts). The canvas cannot take Tailwind classes,
 * but everything drawn over it can: markers, callouts and the zoom buttons
 * are Preact elements with Tailwind classes, placed by MapLibre markers.
 *
 * MapLibre is loaded on first use, so the Briefing, Finance and Tech screens
 * never download it.
 */
export interface MapMarker {
  id: string;
  lat: number;
  lon: number;
  tone: Tone;
  /** Halo radius in pixels. */
  radius: number;
  title: string;
}

export interface MapCallout {
  id: string;
  lat: number;
  lon: number;
  name: string;
  score: number;
  tone: Tone;
  detail: string;
}

type MapLibre = typeof import('maplibre-gl');

// Written out in full: Tailwind only ships classes it can see.
const HALO: Record<Tone, string> = {
  crit: 'border-crit/60 bg-crit/20',
  high: 'border-high/60 bg-high/20',
  elev: 'border-elev/60 bg-elev/20',
  ok: 'border-ok/60 bg-ok/20',
  muted: 'border-muted/60 bg-muted/20',
  dim: 'border-dim/60 bg-dim/20',
};

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

function MarkerDot({ tone, radius }: { tone: Tone; radius: number }) {
  const size = Math.round(radius * 2);
  return (
    <span class="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <span class={cx('absolute inset-0 rounded-full border', HALO[tone])} />
      <span class={cx('relative h-[6px] w-[6px] rounded-full', BG[tone])} />
    </span>
  );
}

function CalloutCard({ callout }: { callout: MapCallout }) {
  return (
    // Hidden on phones: a 156 px card runs off a narrow map.
    <div class="pointer-events-none hidden w-[156px] rounded-[6px] border border-line bg-surface/90 px-2 py-[5px] sm:block">
      <div class="flex items-baseline justify-between gap-2">
        <span class="truncate text-[11.5px] font-semibold text-ink">{callout.name}</span>
        <span class={cx('font-mono text-[11px]', TEXT[callout.tone])}>{callout.score}</span>
      </div>
      <div class="mt-px truncate text-[10px] text-dim">{callout.detail}</div>
    </div>
  );
}

interface Placement {
  lat: number;
  lon: number;
  title?: string;
  callout: boolean;
  node: ComponentChild;
}

export function LiteMap({
  markers,
  callouts,
  fit,
}: {
  markers: readonly MapMarker[];
  callouts: readonly MapCallout[];
  /** `world` shows the whole map; `markers` zooms to the markers (a region filter). */
  fit: 'world' | 'markers';
}) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const libRef = useRef<MapLibre | null>(null);
  const placed = useRef(new Map<string, { marker: MapLibreMarker; el: HTMLElement }>());
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  const bounds = fit === 'markers' ? markerBounds(markers) : WORLD_BOUNDS;
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const boundsKey = bounds.flat().map((v) => v.toFixed(1)).join(',');

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
          maxZoom: 8,
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
        mapRef.current = map;
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

  // Keep one MapLibre marker per id; re-render its Preact content in place.
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (status !== 'ready' || !map || !lib) return;
    const want = new Map<string, Placement>();
    for (const m of markers) {
      want.set(m.id, { lat: m.lat, lon: m.lon, title: m.title, callout: false, node: <MarkerDot tone={m.tone} radius={m.radius} /> });
    }
    for (const c of callouts) {
      want.set(`callout:${c.id}`, { lat: c.lat, lon: c.lon, callout: true, node: <CalloutCard callout={c} /> });
    }
    const onMap = placed.current;
    for (const [id, { marker, el }] of onMap) {
      if (want.has(id)) continue;
      render(null, el);
      marker.remove();
      onMap.delete(id);
    }
    for (const [id, p] of want) {
      let entry = onMap.get(id);
      if (!entry) {
        const el = document.createElement('div');
        if (p.callout) el.className = 'z-[1]';
        else el.dataset.marker = id;
        const marker = new lib.Marker(p.callout ? { element: el, anchor: 'top-left', offset: [10, 8] } : { element: el })
          .setLngLat([p.lon, p.lat])
          .addTo(map);
        entry = { marker, el };
        onMap.set(id, entry);
      } else {
        entry.marker.setLngLat([p.lon, p.lat]);
      }
      if (p.title) entry.el.title = p.title;
      render(p.node, entry.el);
    }
  }, [status, markers, callouts]);

  // Refit when the region filter changes the area of interest.
  useEffect(() => {
    if (status !== 'ready') return;
    mapRef.current?.fitBounds(boundsRef.current, { padding: 16, duration: 600 });
  }, [status, boundsKey]);

  const button = 'flex h-7 w-7 items-center justify-center text-muted hover:text-ink';
  return (
    <>
      {/* maplibre-gl.css sets the container to position: relative, so it fills a positioned wrapper. */}
      <div class="absolute inset-0">
        <div ref={box} class="h-full w-full" data-map-status={status} />
      </div>
      {status === 'ready' ? (
        // Top right: the 72-hour histogram covers the bottom edge.
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
    </>
  );
}
