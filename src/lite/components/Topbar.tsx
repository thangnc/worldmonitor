import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Plus, Search } from 'lucide-preact';

/**
 * Page header: title and computed subtitle, the screen's filter, a search box
 * that filters the current screen, and the primary action (not built yet).
 */
export function Topbar({
  title, subtitle, filter, search, onSearch, searchWidth = 200, actionLabel,
}: {
  title: string;
  subtitle: ComponentChildren;
  filter?: ComponentChildren;
  search: string;
  onSearch: (value: string) => void;
  searchWidth?: number;
  actionLabel: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header class="flex flex-wrap items-center gap-4 border-b border-line px-4 py-3 wide:min-h-[68px] wide:flex-nowrap wide:px-7 wide:py-0">
      <div class="flex min-w-0 flex-1 flex-col gap-[3px]">
        <h1 class="text-[18px] font-semibold text-ink">{title}</h1>
        <p class="text-[12px] text-dim">{subtitle}</p>
      </div>
      {filter ? <div class="max-w-full overflow-x-auto">{filter}</div> : null}
      <label
        class="flex items-center gap-2 rounded-[7px] border border-line bg-surface px-3 py-2 text-dim focus-within:border-muted"
        style={{ width: searchWidth }}
      >
        <Search size={14} strokeWidth={1.5} />
        <input
          ref={input}
          type="search"
          value={search}
          onInput={(e) => onSearch((e.currentTarget as HTMLInputElement).value)}
          placeholder="Search events, entities, assets"
          aria-label="Search this screen"
          class="min-w-0 flex-1 bg-transparent text-[12px] text-ink placeholder:text-dim focus:outline-none"
        />
        <kbd class="font-mono text-[11px] text-dim">⌘K</kbd>
      </label>
      <button
        type="button"
        disabled
        title={`${actionLabel}: not built yet`}
        class="flex cursor-not-allowed items-center gap-2 rounded-[7px] bg-ink px-[14px] py-[9px] text-[12.5px] font-semibold text-bg opacity-60"
        data-soon="true"
      >
        <Plus size={14} strokeWidth={2} />
        {actionLabel}
        <span class="font-mono text-[9px] font-semibold tracking-[0.6px]">SOON</span>
      </button>
    </header>
  );
}

/** Case-insensitive match of a search box against any of the given strings. */
export function matchesSearch(query: string, ...fields: Array<string | undefined>): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => f?.toLowerCase().includes(q));
}
