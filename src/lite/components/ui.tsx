import type { ComponentChildren } from 'preact';
import type { Tone } from '../data/transforms';
import type { ResourceState } from '../data/store';

// Static class maps: Tailwind only ships classes it can see written out.
export const TEXT: Record<Tone, string> = {
  crit: 'text-crit', high: 'text-high', elev: 'text-elev', ok: 'text-ok', muted: 'text-muted', dim: 'text-dim',
};
export const BG: Record<Tone, string> = {
  crit: 'bg-crit', high: 'bg-high', elev: 'bg-elev', ok: 'bg-ok', muted: 'bg-muted', dim: 'bg-dim',
};
export const BORDER: Record<Tone, string> = {
  crit: 'border-crit', high: 'border-high', elev: 'border-elev', ok: 'border-ok', muted: 'border-muted', dim: 'border-dim',
};

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function Dot({ tone, size = 6 }: { tone: Tone; size?: number }) {
  return <span class={cx('inline-block shrink-0 rounded-full', BG[tone])} style={{ width: size, height: size }} aria-hidden="true" />;
}

/** Marks a widget, or part of one, that shows the design's sample data. */
export function SampleBadge({ title = 'No data source yet. These are the design sample values.' }: { title?: string }) {
  return (
    <span
      class="inline-flex items-center rounded-[3px] border border-elev/50 bg-elev/10 px-[5px] py-px font-mono text-[9px] font-semibold tracking-[0.6px] text-elev"
      title={title}
      data-sample="true"
    >
      SAMPLE
    </span>
  );
}

/** Marks a value computed by a stated rule rather than read from a source. */
export function DerivedTag({ how }: { how: string }) {
  return (
    <span class="font-mono text-[9.5px] tracking-[0.4px] text-dim" title={how} data-derived="true">
      DERIVED
    </span>
  );
}

/** Main-column card: 15/600 title, header 14/20. */
export function Card({
  title, sub, right, children, class: className, testId,
}: { title: string; sub?: ComponentChildren; right?: ComponentChildren; children: ComponentChildren; class?: string; testId?: string }) {
  return (
    <section class={cx('overflow-hidden rounded-[10px] border border-line bg-surface', className)} data-testid={testId}>
      <header class="flex min-h-[47px] flex-wrap items-center gap-x-[10px] gap-y-1 px-5 py-[14px]">
        <h2 class="text-[15px] font-semibold text-ink">{title}</h2>
        {sub ? <span class="text-[12px] text-dim">{sub}</span> : null}
        {right ? <div class="ml-auto flex items-center gap-3">{right}</div> : null}
      </header>
      {children}
    </section>
  );
}

/** Right-column panel: 13/600 title, padding 14/16/16. */
export function Panel({
  title, sub, right, children, testId,
}: { title: string; sub?: ComponentChildren; right?: ComponentChildren; children: ComponentChildren; testId?: string }) {
  return (
    <section class="flex flex-col gap-3 rounded-[10px] border border-line bg-surface px-4 pb-4 pt-[14px]" data-testid={testId}>
      <header class="flex items-center gap-2">
        <h2 class="text-[13px] font-semibold text-ink">{title}</h2>
        {sub ? <span class="font-mono text-[11px] text-dim">{sub}</span> : null}
        {right ? <div class="ml-auto flex items-center gap-2">{right}</div> : null}
      </header>
      {children}
    </section>
  );
}

/** Loading, empty and error states for a real source. Never falls back to samples. */
export function SourceState({ state, source, pad = true }: { state: ResourceState<unknown>; source: string; pad?: boolean }) {
  const text =
    state.status === 'loading' ? 'Loading…'
    : state.status === 'empty' ? `No data yet. Source: ${source}.`
    : state.status === 'error' ? `Source unavailable: ${source}.`
    : '';
  return (
    <p
      class={cx('text-[12px]', state.status === 'error' ? 'text-high' : 'text-dim', pad && 'px-5 py-4')}
      data-source-state={state.status}
      title={state.status === 'error' ? state.error : undefined}
    >
      {text}
    </p>
  );
}

export function SegmentedControl<T extends string>({
  options, value, onChange, mono = false, label,
}: {
  options: ReadonlyArray<{ value: T; label: string; disabled?: boolean; title?: string }>;
  value: T;
  onChange: (value: T) => void;
  mono?: boolean;
  label: string;
}) {
  return (
    <fieldset aria-label={label} class="m-0 flex min-w-0 shrink-0 gap-[2px] rounded-[7px] border border-line bg-surface p-[3px]">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            type="button"
            aria-pressed={active}
            disabled={o.disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
            class={cx(
              'rounded-[5px] py-[6px] text-[12px] whitespace-nowrap',
              mono ? 'px-[10px] font-mono' : 'px-3',
              active ? 'bg-surface-2 font-medium text-ink' : 'text-muted hover:text-ink',
              o.disabled && 'cursor-not-allowed opacity-40 hover:text-muted',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </fieldset>
  );
}

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange?: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!on)}
      class={cx(
        'flex h-4 w-7 shrink-0 items-center rounded-full p-[2px]',
        on ? 'justify-end bg-ink' : 'justify-start border border-line bg-surface-2',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <span class={cx('h-3 w-3 rounded-full', on ? 'bg-bg' : 'bg-dim')} />
    </button>
  );
}

/** Small-caps column label (Mono 10, letter-spacing 0.8). */
export function ColLabel({ children, class: className }: { children: ComponentChildren; class?: string }) {
  return <span class={cx('font-mono text-[10px] tracking-[0.8px] text-dim', className)}>{children}</span>;
}
