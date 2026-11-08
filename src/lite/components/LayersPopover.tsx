import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ChevronDown, Layers, X } from 'lucide-preact';
import { Switch, cx } from './ui';

/**
 * The map's layers popover (spec: Screen design, the owner's layers popover):
 * a "Layers · N" button that opens grouped switches. Escape, the close button
 * or a click outside closes it. Geopolitics can reuse it in step 2.
 */
export interface LayerRow {
  key: string;
  label: string;
  sub: string;
  icon: ComponentChildren;
  on: boolean;
  /** A layer whose source is not available: shown greyed, with this badge. */
  unavailable?: string;
}

export interface LayerGroup {
  title: string;
  note?: string;
  rows: LayerRow[];
}

export function LayersPopover({ groups, onToggle, footer }: { groups: readonly LayerGroup[]; onToggle: (key: string, on: boolean) => void; footer?: ComponentChildren }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const count = groups.reduce((n, g) => n + g.rows.filter((r) => r.on && !r.unavailable).length, 0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  return (
    <div ref={wrap} class="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        class="flex items-center gap-[6px] rounded-[6px] border border-line px-[10px] py-[5px] text-[11.5px] text-muted hover:text-ink"
        data-testid="layers-button"
      >
        <Layers size={13} strokeWidth={1.5} />
        Layers · {count}
        <ChevronDown size={12} strokeWidth={1.5} />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Map layers"
          class="absolute right-0 top-[calc(100%+6px)] z-10 w-[320px] max-w-[calc(100vw-32px)] overflow-hidden rounded-[10px] border border-line bg-surface shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
          data-testid="layers-popover"
        >
          <header class="flex items-center justify-between border-b border-line px-4 py-3">
            <h3 class="text-[13px] font-semibold text-ink">Map layers</h3>
            <button type="button" aria-label="Close" class="text-dim hover:text-ink" onClick={() => setOpen(false)}>
              <X size={13} strokeWidth={1.5} />
            </button>
          </header>
          {groups.map((g) => (
            <section key={g.title} class="flex flex-col gap-3 border-b border-line px-4 py-3 last:border-b-0">
              <div class="flex items-center justify-between">
                <span class="font-mono text-[9.5px] tracking-[1px] text-dim uppercase">{g.title}</span>
                {g.note ? <span class="font-mono text-[9.5px] text-dim">{g.note}</span> : null}
              </div>
              {g.rows.map((r) => (
                <div key={r.key} class="flex items-center gap-3" data-layer-row={r.key}>
                  <span class={cx('flex w-5 shrink-0 justify-center', r.unavailable && 'opacity-50')}>{r.icon}</span>
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class={cx('text-[12.5px]', r.unavailable ? 'text-dim' : 'text-ink')}>{r.label}</span>
                    <span class="text-[11px] text-dim">{r.sub}</span>
                  </span>
                  {r.unavailable ? (
                    <span class="rounded-[4px] border border-line px-[6px] py-px font-mono text-[9.5px] text-dim" title={r.unavailable}>N/A</span>
                  ) : (
                    <Switch label={r.label} on={r.on} onChange={(on) => onToggle(r.key, on)} />
                  )}
                </div>
              ))}
            </section>
          ))}
          {footer ? <footer class="border-t border-line bg-bg/50 px-4 py-[10px] text-[11px] text-muted">{footer}</footer> : null}
        </div>
      ) : null}
    </div>
  );
}
