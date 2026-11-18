/**
 * The map layers popover from the owner's design: a "Layers · N" chip that
 * opens grouped rows, each with a mark, a name, one line of context and a
 * switch (or N/A when the layer has no source yet). Escape or the close
 * button closes it and returns focus to the chip. The map card clips its
 * children, so the popover caps its height to the room left in the card and
 * scrolls its rows there.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Layers, X } from 'lucide-preact';
import { OverlayScroll } from './scroll';
import { Switch, cx } from './ui';

export interface LayerRow {
  id: string;
  mark: ComponentChildren;
  name: string;
  sub: string;
  /** What the layer shows at the map's selected time range, when the map has one. */
  range?: string;
  /** Null: no source yet, shown as N/A. */
  on: boolean | null;
}

export interface LayerGroup {
  title: string;
  note?: string;
  rows: readonly LayerRow[];
}

/** Px from the popover's top to the bottom of the nearest clipping ancestor, less a gap; null when unmeasurable. */
function roomBelow(el: HTMLElement): number | null {
  const top = el.getBoundingClientRect().top;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    if (getComputedStyle(p).overflowY === 'visible') continue;
    const bottom = p.getBoundingClientRect().bottom;
    return bottom > top ? Math.max(160, Math.floor(bottom - top - 8)) : null;
  }
  return null;
}

export function LayersPopover({
  groups,
  onToggle,
  footer,
}: {
  groups: readonly LayerGroup[];
  onToggle: (id: string, on: boolean) => void;
  footer?: ComponentChildren;
}) {
  const [open, setOpen] = useState(false);
  const [maxHeight, setMaxHeight] = useState<number | null>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const count = groups.reduce((n, g) => n + g.rows.filter((r) => r.on === true).length, 0);

  const close = () => {
    setOpen(false);
    chip.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => setMaxHeight(panel.current ? roomBelow(panel.current) : null);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('button, [role="switch"]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node) && !chip.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  return (
    <div class="relative">
      <button
        ref={chip}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        class="flex items-center gap-[6px] rounded-[6px] border border-line bg-surface-2 px-[10px] py-[5px] text-[12px] text-muted hover:text-ink"
        onClick={() => (open ? close() : setOpen(true))}
        data-testid="layers-chip"
      >
        <Layers size={13} strokeWidth={1.5} aria-hidden="true" />
        Layers · {count}
      </button>
      {open ? (
        <div
          ref={panel}
          role="dialog"
          aria-label="Map layers"
          class="absolute right-0 top-[calc(100%+6px)] z-20 flex w-[320px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-[10px] border border-line bg-surface shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
          style={maxHeight ? { maxHeight: `${maxHeight}px` } : undefined}
          data-testid="layers-popover"
        >
          <div class="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
            <span class="text-[14px] font-semibold text-ink">Map layers</span>
            <button type="button" aria-label="Close" class="text-dim hover:text-ink" onClick={close}>
              <X size={14} strokeWidth={1.5} />
            </button>
          </div>
          <OverlayScroll class="min-h-0 flex-1 overflow-y-auto">
            {groups.map((g) => (
              <div key={g.title} class="flex flex-col gap-3 border-b border-line px-4 py-3 last:border-b-0">
                <div class="flex items-center justify-between">
                  <span class="font-mono text-[10px] tracking-[1px] text-dim">{g.title.toUpperCase()}</span>
                  {g.note ? <span class="font-mono text-[10px] text-dim">{g.note}</span> : null}
                </div>
                {g.rows.map((r) => (
                  <div key={r.id} class={cx('flex items-center gap-3', r.on === null && 'opacity-60')} data-layer-row={r.id}>
                    <span class="flex w-5 shrink-0 justify-center">{r.mark}</span>
                    <span class="flex min-w-0 flex-1 flex-col">
                      <span class="text-[13px] font-medium text-ink">{r.name}</span>
                      <span class="text-[11.5px] text-dim">{r.sub}</span>
                      {r.range ? <span class="text-[11.5px] text-muted" data-range-note>{r.range}</span> : null}
                    </span>
                    {r.on === null ? (
                      <span class="rounded-[4px] border border-line px-[6px] py-px font-mono text-[10px] text-dim">N/A</span>
                    ) : (
                      <Switch on={r.on} label={r.name} onChange={(on) => onToggle(r.id, on)} />
                    )}
                  </div>
                ))}
              </div>
            ))}
          </OverlayScroll>
          {footer ? <div class="shrink-0 border-t border-line bg-bg px-4 py-[10px] text-[11.5px] text-muted">{footer}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
