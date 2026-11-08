import type { ComponentChildren } from 'preact';
import { cx } from '../components/ui';

/**
 * The in-map legend from the owner's designs: bottom left, hidden on phones.
 * `above-bar` lifts it over a map's bottom control bar (Geopolitics' range).
 */
export function MapLegend({ testId, children, place = 'corner' }: { testId: string; children: ComponentChildren; place?: 'corner' | 'above-bar' }) {
  return (
    <div
      class={cx(
        'pointer-events-none absolute z-[4] hidden flex-col gap-[6px] rounded-[8px] border border-line bg-surface/90 px-3 py-[10px] sm:flex',
        place === 'corner' ? 'bottom-3 left-3' : 'bottom-[60px] left-4',
      )}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

export function LegendRow({ mark, name, note }: { mark: ComponentChildren; name: string; note: string }) {
  return (
    <span class="flex items-center gap-2" data-legend-row={name}>
      <span class="flex w-[30px] items-center">{mark}</span>
      <span class="text-[11.5px] text-ink">{name}</span>
      <span class="text-[10.5px] text-dim">{note}</span>
    </span>
  );
}
