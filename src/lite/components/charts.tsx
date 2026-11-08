import { cx } from './ui';

/**
 * Bottom-aligned bars (time scrubber, 14-day strips, volume). Heights scale to
 * the max, or with `relative` to the min–max range (price sparkbars).
 */
export function BarStrip({
  values, height, barWidth, gap = 2, colorFor, label, relative = false,
}: {
  relative?: boolean;
  values: readonly number[];
  height: number;
  barWidth?: number;
  gap?: number;
  colorFor: (index: number, value: number) => string;
  label: string;
}) {
  const max = relative ? Math.max(...values) : Math.max(1, ...values);
  const min = relative ? Math.min(...values) : 0;
  const span = max - min || 1;
  return (
    <div class="flex items-end" style={{ height, gap }} role="img" aria-label={label}>
      {values.map((v, i) => (
        <span
          key={i}
          class={cx('rounded-[1px]', barWidth ? 'shrink-0' : 'min-w-[2px] flex-1', colorFor(i, v))}
          style={{ height: Math.max(2, Math.round(relative ? (0.25 + (0.75 * (v - min)) / span) * height : ((v - min) / span) * height)), width: barWidth }}
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
