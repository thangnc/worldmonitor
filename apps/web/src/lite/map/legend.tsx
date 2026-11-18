import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { List } from 'lucide-preact';
import { cx } from '../components/ui';

/**
 * The in-map legend from the owner's designs, at the bottom left.
 * `above-bar` lifts it over a map's bottom control bar (Geopolitics' range).
 *
 * Fixed, it is always shown and hidden on phones. `collapsible` starts closed
 * behind a "Legend" button, so the map opens with nothing over it (Finance,
 * Tech); the panel opens above the button on any width.
 */
export function MapLegend({
  testId,
  children,
  place = 'corner',
  collapsible = false,
}: {
  testId: string;
  children: ComponentChildren;
  place?: 'corner' | 'above-bar';
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const at = place === 'corner' ? 'bottom-3 left-3' : 'bottom-[60px] left-4';
  const panel = 'flex-col gap-[6px] rounded-[8px] border border-line bg-surface/90 px-3 py-[10px]';
  if (!collapsible) {
    return (
      <div class={cx('pointer-events-none absolute z-[4] hidden sm:flex', at, panel)} data-testid={testId}>
        {children}
      </div>
    );
  }
  const id = `${testId}-panel`;
  return (
    <div class={cx('absolute z-[4] flex flex-col items-start gap-2', at)}>
      {open ? (
        <div id={id} class={cx('flex', panel)} data-testid={testId}>
          {children}
        </div>
      ) : null}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        class="flex items-center gap-[6px] rounded-[6px] border border-line bg-surface/90 px-[10px] py-[5px] text-[12px] text-muted hover:text-ink"
        onClick={() => setOpen((o) => !o)}
        data-testid={`${testId}-toggle`}
      >
        <List size={13} strokeWidth={1.5} aria-hidden="true" />
        {open ? 'Hide legend' : 'Legend'}
      </button>
    </div>
  );
}

export function LegendRow({ mark, name, note }: { mark: ComponentChildren; name: string; note: string }) {
  return (
    <span class="flex items-center gap-2" data-legend-row={name}>
      <span class="flex w-[56px] shrink-0 items-center">{mark}</span>
      <span class="text-[11.5px] text-ink">{name}</span>
      <span class="text-[10.5px] text-dim">{note}</span>
    </span>
  );
}
