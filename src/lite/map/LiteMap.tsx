import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Map as MapLibreMap, Marker as MapLibreMarker, Popup as MapLibrePopup } from 'maplibre-gl';
import { Locate, Minus, Plus, X } from 'lucide-preact';
import type { Tone } from '../data/transforms';
import { BG, TEXT, cx } from '../components/ui';
import { MAP_CREDITS, buildLiteMapStyle, readLiteMapTokens } from './style';
import { WORLD_BOUNDS, markerBounds } from './view';

/**
 * The Lite conflict map: MapLibre on OpenFreeMap vector tiles, styled from the
 * Lite `@theme` tokens (./style.ts). The canvas cannot take Tailwind classes,
 * but everything drawn over it can: markers, the popup and the zoom buttons
 * are Preact elements with Tailwind classes, placed by MapLibre.
 *
 * Clicking a marker opens its popup; clicking the map, the close button or
 * pressing Escape closes it. MapLibre is loaded on first use, so the
 * Briefing, Finance and Tech screens never download it.
 */
export interface MapMarker {
  id: string;
  lat: number;
  lon: number;
  tone: Tone;
  /** Halo radius in pixels. */
  radius: number;
  /** Hover text and the marker button's accessible name. */
  title: string;
  /** What the popup shows when the marker is clicked. */
  popup: {
    kind: string;
    name: string;
    /** The headline figure, in the marker's tone. */
    value: string;
    lines: readonly string[];
  };
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

function MarkerButton({ marker, selected, onSelect }: { marker: MapMarker; selected: boolean; onSelect: () => void }) {
  const size = Math.round(marker.radius * 2);
  return (
    <button
      type="button"
      aria-label={marker.title}
      aria-expanded={selected}
      title={marker.title}
      class="relative flex cursor-pointer items-center justify-center rounded-full"
      style={{ width: size, height: size }}
      onClick={(e) => {
        // Keep the click off the map, which would close the popup again.
        e.stopPropagation();
        onSelect();
      }}
    >
      <span class={cx('absolute inset-0 rounded-full border', HALO[marker.tone], selected && 'ring-1 ring-ink/70')} />
      <span class={cx('relative h-[6px] w-[6px] rounded-full', BG[marker.tone])} />
    </button>
  );
}

function PopupCard({ marker, onClose }: { marker: MapMarker; onClose: () => void }) {
  const { kind, name, value, lines } = marker.popup;
  return (
    <div class="w-[224px] rounded-[6px] border border-line bg-surface/95 px-3 py-[9px] text-left" data-map-popup={marker.id}>
      <div class="flex items-start justify-between gap-2">
        <span class="font-mono text-[9.5px] tracking-[0.4px] text-dim uppercase">{kind}</span>
        <button type="button" aria-label="Close" class="-mr-1 -mt-px text-dim hover:text-ink" onClick={onClose}>
          <X size={12} strokeWidth={1.5} />
        </button>
      </div>
      <div class="mt-[3px] flex items-baseline justify-between gap-2">
        <span class="text-[12.5px] leading-[17px] font-semibold text-ink">{name}</span>
        <span class={cx('shrink-0 font-mono text-[11.5px]', TEXT[marker.tone])}>{value}</span>
      </div>
      {lines.map((line) => (
        <p key={line} class="mt-1 line-clamp-3 text-[11px] leading-[15px] text-muted">
          {line}
        </p>
      ))}
    </div>
  );
}

export function LiteMap({
  markers,
  fit,
}: {
  markers: readonly MapMarker[];
  /** `world` shows the whole map; `markers` zooms to the markers (a region filter). */
  fit: 'world' | 'markers';
}) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const libRef = useRef<MapLibre | null>(null);
  const placed = useRef(new Map<string, { marker: MapLibreMarker; el: HTMLElement }>());
  const popupRef = useRef<{ popup: MapLibrePopup; el: HTMLElement } | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [selected, setSelected] = useState<string | null>(null);

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
    const onMap = placed.current;
    const ids = new Set(markers.map((m) => m.id));
    for (const [id, { marker, el }] of onMap) {
      if (ids.has(id)) continue;
      render(null, el);
      marker.remove();
      onMap.delete(id);
    }
    for (const m of markers) {
      let entry = onMap.get(m.id);
      if (!entry) {
        const el = document.createElement('div');
        el.dataset.marker = m.id;
        entry = { marker: new lib.Marker({ element: el }).setLngLat([m.lon, m.lat]).addTo(map), el };
        onMap.set(m.id, entry);
      } else {
        entry.marker.setLngLat([m.lon, m.lat]);
      }
      const id = m.id;
      render(<MarkerButton marker={m} selected={selected === id} onSelect={() => setSelected((s) => (s === id ? null : id))} />, entry.el);
    }
  }, [status, markers, selected]);

  // One popup, for the selected marker. MapLibre places it so it stays on screen.
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (status !== 'ready' || !map || !lib) return;
    const marker = markers.find((m) => m.id === selected);
    if (!marker) {
      if (popupRef.current?.popup.isOpen()) popupRef.current.popup.remove();
      if (selected) setSelected(null);
      return;
    }
    if (!popupRef.current) {
      const el = document.createElement('div');
      const popup = new lib.Popup({ closeButton: false, closeOnClick: true, focusAfterOpen: false, maxWidth: 'none', className: 'lite-map-popup' });
      popup.setDOMContent(el);
      // Map clicks and the close button both end here.
      popup.on('close', () => setSelected(null));
      popupRef.current = { popup, el };
    }
    const { popup, el } = popupRef.current;
    popup.setOffset(marker.radius + 4).setLngLat([marker.lon, marker.lat]);
    render(<PopupCard marker={marker} onClose={() => popup.remove()} />, el);
    if (!popup.isOpen()) popup.addTo(map);
  }, [status, markers, selected]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected]);

  useEffect(
    () => () => {
      if (!popupRef.current) return;
      render(null, popupRef.current.el);
      popupRef.current.popup.remove();
      popupRef.current = null;
    },
    [],
  );

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
