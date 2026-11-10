import {
  Activity,
  Anchor,
  Ban,
  Building2,
  Cable,
  ChartCandlestick,
  Cloud,
  CloudAlert,
  Cpu,
  FileText,
  Flame,
  Fuel,
  Landmark,
  Plane,
  Radar,
  ShieldAlert,
  Ship,
  Siren,
  WifiOff,
  Zap,
  type LucideIcon,
} from 'lucide-preact';
import { cx } from '../components/ui';
import { AGGREGATE_LABEL_MIN, aggregateDiameter, compactCount } from './view';

/**
 * One marker grammar for every Lite map (owner's design "Spec — Map markers",
 * 2026-11-10; spec: Owner decisions › Map marker grammar).
 *
 * - Geometry is how we know the place: exact coordinates get a marker, a
 *   country or region an area, routes and cables a line.
 * - Shape is what kind of thing it is: an event (rounded square), an asset
 *   (outlined square), an aggregate (circle with a count) or a judgement
 *   (diamond).
 * - Fill is how sure we are: solid (official or verified), reported
 *   (translucent with an outline) or background (faint: verified, weeks old).
 * - Colour is state, never domain: grey normal, amber elevated, red critical.
 *   Selected adds a 2 px white ring; a late feed draws at 45% opacity.
 *
 * Every class is written out in full so Tailwind ships it (lite-profile rule).
 */

export type MarkState = 'normal' | 'elev' | 'crit';
export type MarkFill = 'solid' | 'reported' | 'background';

/** The glyph catalogue: Lucide only, one glyph per marker. */
export const MARK_GLYPHS = {
  // Events · conflict and security
  ship: Ship,
  plane: Plane,
  flame: Flame,
  siren: Siren,
  radar: Radar,
  ban: Ban,
  // Events · infrastructure and cyber
  zap: Zap,
  cable: Cable,
  'wifi-off': WifiOff,
  'cloud-alert': CloudAlert,
  'shield-alert': ShieldAlert,
  // Events · markets
  landmark: Landmark,
  'chart-candlestick': ChartCandlestick,
  'file-text': FileText,
  activity: Activity,
  // Assets · places we watch
  cloud: Cloud,
  cpu: Cpu,
  anchor: Anchor,
  fuel: Fuel,
  'building-2': Building2,
} as const satisfies Record<string, LucideIcon>;

export type MarkGlyph = keyof typeof MARK_GLYPHS;

/** The states in legend order. */
export const MARK_STATES: readonly MarkState[] = ['normal', 'elev', 'crit'];

export const STATE_TEXT: Readonly<Record<MarkState, string>> = {
  normal: 'text-mark-normal', elev: 'text-mark-elev', crit: 'text-mark-crit',
};
export const STATE_BG: Readonly<Record<MarkState, string>> = {
  normal: 'bg-mark-normal', elev: 'bg-mark-elev', crit: 'bg-mark-crit',
};

/** Event: solid fill; reported 35% fill with the outline; background 10% fill, 30% outline. The glyph is always dark ink. */
export const EVENT_CLASS: Readonly<Record<MarkFill, Readonly<Record<MarkState, string>>>> = {
  solid: {
    normal: 'border-mark-normal bg-mark-normal',
    elev: 'border-mark-elev bg-mark-elev',
    crit: 'border-mark-crit bg-mark-crit',
  },
  reported: {
    normal: 'border-mark-normal bg-mark-normal/35',
    elev: 'border-mark-elev bg-mark-elev/35',
    crit: 'border-mark-crit bg-mark-crit/35',
  },
  background: {
    normal: 'border-mark-normal/30 bg-mark-normal/10',
    elev: 'border-mark-elev/30 bg-mark-elev/10',
    crit: 'border-mark-crit/30 bg-mark-crit/10',
  },
};

/** Asset: dark square, outline in the state colour; a normal asset keeps a light glyph. */
export const ASSET_CLASS: Readonly<Record<MarkState, string>> = {
  normal: 'border-mark-normal text-ink',
  elev: 'border-mark-elev text-mark-elev',
  crit: 'border-mark-crit text-mark-crit',
};

/** Aggregate: a circle whose area grows with the count; reported 20% fill, or background. */
export const AGGREGATE_CLASS: Readonly<Record<Exclude<MarkFill, 'solid'>, Readonly<Record<MarkState, string>>>> = {
  reported: {
    normal: 'border-mark-normal bg-mark-normal/20',
    elev: 'border-mark-elev bg-mark-elev/20',
    crit: 'border-mark-crit bg-mark-crit/20',
  },
  background: {
    normal: 'border-mark-normal/30 bg-mark-normal/10',
    elev: 'border-mark-elev/30 bg-mark-elev/10',
    crit: 'border-mark-crit/30 bg-mark-crit/10',
  },
};

export const JUDGEMENT_BORDER: Readonly<Record<MarkState, string>> = {
  normal: 'border-mark-normal', elev: 'border-mark-elev', crit: 'border-mark-crit',
};

/** The selected marker's ring, and a late feed's opacity. */
export const SELECTED_RING = 'ring-2 ring-mark-ring';
export const STALE = 'opacity-45';

interface MarkProps {
  selected?: boolean;
  stale?: boolean;
}

/** 16 px rounded square with a 10 px glyph: one thing happened here. */
export function EventMark({ glyph, state, fill = 'solid', selected, stale }: MarkProps & { glyph: MarkGlyph; state: MarkState; fill?: MarkFill }) {
  const Icon = MARK_GLYPHS[glyph];
  return (
    <span
      class={cx('flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border text-mark-ink', EVENT_CLASS[fill][state], selected && SELECTED_RING, stale && STALE)}
      data-mark-kind="event"
      data-mark-state={state}
      data-mark-fill={fill}
      data-mark-glyph={glyph}
      aria-hidden="true"
    >
      <Icon size={10} strokeWidth={2.25} />
    </span>
  );
}

/** 14 px outlined square with a 9 px glyph: a place we watch. */
export function AssetMark({ glyph, state, selected, stale }: MarkProps & { glyph: MarkGlyph; state: MarkState }) {
  const Icon = MARK_GLYPHS[glyph];
  return (
    <span
      class={cx('flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[3px] border-[1.5px] bg-mark-ink', ASSET_CLASS[state], selected && SELECTED_RING, stale && STALE)}
      data-mark-kind="asset"
      data-mark-state={state}
      data-mark-glyph={glyph}
      aria-hidden="true"
    >
      <Icon size={9} strokeWidth={2.25} />
    </span>
  );
}

/** A circle for many things, area ∝ count; the count is printed once the circle holds it. */
export function AggregateMark({
  count,
  fullAt,
  state,
  fill = 'reported',
  size,
  selected,
  stale,
}: MarkProps & { count: number; fullAt: number; state: MarkState; fill?: Exclude<MarkFill, 'solid'>; size?: number }) {
  const d = size ?? aggregateDiameter(count, fullAt);
  return (
    <span
      class={cx(
        'flex shrink-0 items-center justify-center rounded-full border-[1.5px] font-mono font-semibold leading-none text-mark-ring',
        AGGREGATE_CLASS[fill][state],
        selected && SELECTED_RING,
        stale && STALE,
      )}
      style={{ width: d, height: d, fontSize: d >= 30 ? 11 : 10 }}
      data-mark-kind="aggregate"
      data-mark-state={state}
      data-mark-fill={fill}
      aria-hidden="true"
    >
      {d >= AGGREGATE_LABEL_MIN ? compactCount(count) : null}
    </span>
  );
}

/** 16 px diamond with a centre dot: an analyst's call, not data. */
export function JudgementMark({ state, selected, stale, size = 16 }: MarkProps & { state: MarkState; size?: number }) {
  // A rotated square of side s spans s·√2, so the diamond fills the `size` box.
  const side = Math.round(size / Math.SQRT2);
  return (
    <span class={cx('relative flex shrink-0 items-center justify-center', stale && STALE)} style={{ width: size, height: size }} data-mark-kind="judgement" data-mark-state={state} aria-hidden="true">
      <span class={cx('absolute rotate-45 border-[1.5px] bg-mark-ink', JUDGEMENT_BORDER[state], selected && SELECTED_RING)} style={{ width: side, height: side }} />
      <span class={cx('relative h-[4px] w-[4px] rounded-full', STATE_BG[state])} />
    </span>
  );
}

/** Legend and popover swatches for areas and lines. */
export const RAMP_BG = ['bg-ramp-1', 'bg-ramp-2', 'bg-ramp-3', 'bg-ramp-4'] as const;

/** The shared blue intensity ramp, light to strong. */
export function RampSwatch({ steps = [1, 2, 3, 4] }: { steps?: ReadonlyArray<1 | 2 | 3 | 4> }) {
  return (
    <span class="flex gap-px" aria-hidden="true" data-mark-kind="area">
      {steps.map((s) => <span key={s} class={cx('h-[9px] w-[6px] rounded-[1px]', RAMP_BG[s - 1])} />)}
    </span>
  );
}

const STATUS_AREA: Readonly<Record<MarkState, string>> = {
  normal: 'border-mark-normal bg-mark-normal/15',
  elev: 'border-mark-elev bg-mark-elev/15',
  crit: 'border-mark-crit bg-mark-crit/15',
};

const STATUS_HEX: Readonly<Record<MarkState, string>> = {
  normal: 'fill-mark-normal/15 stroke-mark-normal',
  elev: 'fill-mark-elev/15 stroke-mark-elev',
  crit: 'fill-mark-crit/15 stroke-mark-crit',
};

/**
 * A status area: state-colour outline over a faint fill. `box` for country
 * areas (sanctions); `hex` for layers the map draws as H3 cells (GPS), so the
 * swatch has the shape the map shows.
 */
export function StatusAreaSwatch({ state, shape = 'box' }: { state: MarkState; shape?: 'box' | 'hex' }) {
  if (shape === 'hex') {
    return (
      <svg class={cx('block shrink-0', STATUS_HEX[state])} width="14" height="12" viewBox="0 0 14 12" aria-hidden="true" data-mark-kind="area" data-mark-state={state} data-mark-shape="hex">
        <polygon points="3.5,0.5 10.5,0.5 13.5,6 10.5,11.5 3.5,11.5 0.5,6" stroke-width="1" stroke-linejoin="round" />
      </svg>
    );
  }
  return <span class={cx('block h-[10px] w-[14px] rounded-[2px] border', STATUS_AREA[state])} aria-hidden="true" data-mark-kind="area" data-mark-state={state} data-mark-shape="box" />;
}

/** A hatched outline: an area layer with no data (airspace closures). */
export function HatchSwatch() {
  return (
    <span
      class="block h-[10px] w-[14px] rounded-[2px] border border-dim bg-[repeating-linear-gradient(135deg,var(--color-dim)_0_1px,transparent_1px_4px)]"
      aria-hidden="true"
      data-mark-kind="area"
    />
  );
}

const LINE_BG: Readonly<Record<MarkState, string>> = { normal: 'bg-dim', elev: 'bg-mark-elev', crit: 'bg-mark-crit' };

/** A line in its state colour (cables, lanes); a normal line is faint grey. */
export function LineSwatch({ state }: { state: MarkState }) {
  return <span class={cx('block h-[2px] w-[10px]', LINE_BG[state])} aria-hidden="true" data-mark-kind="line" data-mark-state={state} />;
}

/** Several swatches in the spec's order (normal, elevated, critical). */
export function SwatchRun({ children }: { children: preact.ComponentChildren }) {
  return <span class="flex items-center gap-[3px]">{children}</span>;
}
