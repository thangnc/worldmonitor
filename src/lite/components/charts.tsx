import { cx } from './ui';

/** Bottom-aligned bars (time scrubber, 14-day strips, volume). Heights scale to the max. */
export function BarStrip({
  values, height, barWidth, gap = 2, colorFor, label,
}: {
  values: readonly number[];
  height: number;
  barWidth?: number;
  gap?: number;
  colorFor: (index: number, value: number) => string;
  label: string;
}) {
  const max = Math.max(1, ...values);
  return (
    <div class="flex items-end" style={{ height, gap }} role="img" aria-label={label}>
      {values.map((v, i) => (
        <span
          key={i}
          class={cx('rounded-[1px]', barWidth ? 'shrink-0' : 'min-w-[2px] flex-1', colorFor(i, v))}
          style={{ height: Math.max(2, Math.round((v / max) * height)), width: barWidth }}
        />
      ))}
    </div>
  );
}

/** Horizontal stacked share bar (evidence mix). */
export function StackedBar({ parts }: { parts: ReadonlyArray<{ key: string; share: number; color: string }> }) {
  return (
    <div class="flex h-2 w-full gap-[2px]" role="img" aria-label="Share of reports by source class">
      {parts
        .filter((p) => p.share > 0)
        .map((p) => (
          <span key={p.key} class="h-2 rounded-[1px]" style={{ flexGrow: p.share, background: p.color }} />
        ))}
    </div>
  );
}

/** A thin line sparkline, used for the funding and open-interest tabs. */
export function LineChart({ values, height, stroke }: { values: readonly number[]; height: number; stroke: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 100},${(1 - (v - min) / span) * 100}`).join(' ');
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="w-full" style={{ height }} role="img" aria-label="Series chart">
      <polyline points={points} fill="none" stroke={stroke} stroke-width={1.5} vector-effect="non-scaling-stroke" />
    </svg>
  );
}
