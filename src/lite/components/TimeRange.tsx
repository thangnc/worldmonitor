/**
 * The 6h/24h/7d buttons a Lite map carries (owner's decision, 2026-11-10).
 * Each screen passes what each range is for; the button's title says it.
 */
import { TIME_RANGE_HOURS, type TimeRange } from '../data/transforms';
import { cx } from './ui';

const RANGES = Object.keys(TIME_RANGE_HOURS) as TimeRange[];

/** The dashboard's time buttons, compact enough for a map's bottom bar. */
export function TimeRangeControl({ value, onChange, titles }: { value: TimeRange; onChange: (range: TimeRange) => void; titles: Readonly<Record<TimeRange, string>> }) {
  return (
    <fieldset aria-label="Time range" class="m-0 flex shrink-0 gap-px border-0 p-0" data-testid="time-range">
      {RANGES.map((range) => {
        const active = range === value;
        return (
          <button
            key={range}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(range)}
            title={titles[range]}
            class={cx('rounded-[4px] px-[7px] py-[3px] font-mono text-[10.5px]', active ? 'bg-surface-2 text-ink' : 'text-dim hover:text-muted')}
          >
            {range}
          </button>
        );
      })}
    </fieldset>
  );
}
