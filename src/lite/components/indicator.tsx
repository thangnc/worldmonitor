/**
 * The indicator card from the owner's design system (spec: Early indicators ›
 * Screen design): a full form for detail views, a compact form for feeds, and
 * one-line rows for quiet, stale, unavailable and loading feeds. Every screen
 * renders its indicators through these components.
 */
import { ChartLine, CircleCheck, Landmark, Newspaper, Radio, Receipt, Ruler, SearchX, Sparkles, type LucideIcon } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Domain } from '../data/briefing';
import { TRUST_LABEL, TRUST_MEANING, updatedLabel, type FeedState, type Indicator, type Trust } from '../data/indicators';
import { offsetLabel, type NewsLinks } from '../data/news-link';
import { cx } from './ui';

const DOMAIN_FULL: Readonly<Record<Domain, string>> = { geo: 'GEOPOLITICS', fin: 'FINANCE', tech: 'TECH & AI' };
const DOMAIN_SHORT: Readonly<Record<Domain, string>> = { geo: 'GEO', fin: 'FIN', tech: 'AI' };
const DOMAIN_TEXT: Readonly<Record<Domain, string>> = { geo: 'text-geo', fin: 'text-fin', tech: 'text-tech' };
const DOMAIN_BG: Readonly<Record<Domain, string>> = { geo: 'bg-geo', fin: 'bg-fin', tech: 'bg-tech' };

const TRUST_ICON: Readonly<Record<Trust, LucideIcon>> = {
  official: Landmark,
  verified: CircleCheck,
  reported: Radio,
  estimated: Receipt,
  market: ChartLine,
};
const TRUST_TEXT: Readonly<Record<Trust, string>> = {
  official: 'text-ok',
  verified: 'text-ok',
  reported: 'text-reported',
  estimated: 'text-elev',
  market: 'text-muted',
};
const TRUST_BORDER: Readonly<Record<Trust, string>> = {
  official: 'border-ok/35',
  verified: 'border-ok/35',
  reported: 'border-reported/35',
  estimated: 'border-elev/35',
  market: 'border-line',
};

export function DomainChip({ domain, compact = false }: { domain: Domain; compact?: boolean }) {
  return (
    <span class={cx('flex shrink-0 items-center rounded-[4px] bg-bg', compact ? 'gap-1 px-[6px] py-[2px]' : 'gap-[5px] px-[7px] py-[3px]')}>
      <span class={cx('shrink-0 rounded-full', DOMAIN_BG[domain], compact ? 'h-[5px] w-[5px]' : 'h-[6px] w-[6px]')} aria-hidden="true" />
      <span class={cx('font-mono font-semibold', DOMAIN_TEXT[domain], compact ? 'text-[9px] tracking-[0.5px]' : 'text-[9.5px] tracking-[0.6px]')}>
        {compact ? DOMAIN_SHORT[domain] : DOMAIN_FULL[domain]}
      </span>
    </span>
  );
}

export function TrustChip({ trust, compact = false }: { trust: Indicator['trust']; compact?: boolean }) {
  const Icon = TRUST_ICON[trust.level];
  const label = (
    <>
      <Icon size={compact ? 11 : 12} class={cx('shrink-0', TRUST_TEXT[trust.level])} aria-hidden="true" />
      <span class={cx('whitespace-nowrap font-mono font-semibold', TRUST_TEXT[trust.level], compact ? 'text-[9px] tracking-[0.5px]' : 'text-[10px] tracking-[0.6px]')}>
        {TRUST_LABEL[trust.level]}
      </span>
      <span class={cx('truncate', compact ? 'text-[10.5px] text-dim' : 'text-[11.5px] text-muted')}>{trust.source}</span>
    </>
  );
  return compact ? (
    <span class="flex min-w-0 items-center gap-[5px]" title={TRUST_MEANING[trust.level]} data-trust={trust.level}>{label}</span>
  ) : (
    <span class={cx('flex min-w-0 items-center gap-[6px] rounded-[4px] border px-2 py-[3px]', TRUST_BORDER[trust.level])} title={TRUST_MEANING[trust.level]} data-trust={trust.level}>
      {label}
    </span>
  );
}

function hhmm(ts: number): string {
  return new Date(ts).toISOString().slice(11, 16);
}

function timeLine(indicator: Indicator, now: number): string {
  const when = indicator.dataDate ?? `${hhmm(indicator.at)} UTC`;
  const updated = updatedLabel(indicator.updatedAt, now);
  return updated ? `${when} · ${updated}` : when;
}

function searchedText(links: NewsLinks): string {
  return `Searched ${links.searched.toLocaleString('en-US')} ${links.searched === 1 ? 'story' : 'stories'} from ${links.windowHours} h before to 1 h after, by ticker, country, entity and driver.`;
}

function LinkedNews({ links }: { links: NewsLinks }) {
  return (
    <div class="flex flex-col gap-[9px]" data-testid="linked-news">
      <span class="font-mono text-[9.5px] tracking-[0.8px] text-dim">LINKED NEWS · {links.stories.length} · REPORTED AROUND THE MOVE</span>
      {links.stories.map((s, i) => (
        <div key={s.item.link || s.item.title} class="flex gap-[9px]">
          <span class="font-mono text-[10.5px] leading-4 text-dim">[{i + 1}]</span>
          <div class="flex min-w-0 flex-col gap-[3px]">
            <a
              href={s.item.link}
              target="_blank"
              rel="noopener noreferrer"
              class="text-[12.5px] leading-[17px] text-ink hover:underline"
            >
              {s.item.title}
            </a>
            <span class="flex flex-wrap items-center gap-2">
              <span class="text-[11px] text-muted">{s.item.source}</span>
              <span class="font-mono text-[11px] text-dim">{offsetLabel(s.offsetMs)}</span>
              <span class="rounded-[3px] bg-bg px-[6px] py-px font-mono text-[10px] text-muted" data-match={s.reason.kind}>{s.reason.label}</span>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function NoLinkBox({ links }: { links: NewsLinks }) {
  return (
    <div class="flex gap-[10px] rounded-[7px] border border-nolink/40 bg-nolink/[0.08] px-3 py-[10px]" data-testid="no-linked-news">
      <SearchX size={15} class="mt-px shrink-0 text-nolink" aria-hidden="true" />
      <span class="flex flex-col gap-[2px]">
        <span class="text-[12.5px] font-semibold text-nolink">No linked news found</span>
        <span class="text-[11px] leading-[15px] text-muted">{searchedText(links)}</span>
      </span>
    </div>
  );
}

/** Full form, for detail views. */
export function IndicatorCard({ indicator, now, onCollapse }: { indicator: Indicator; now: number; onCollapse?: () => void }) {
  const linked = indicator.links.stories.length > 0;
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (onCollapse) toggle.current?.focus();
  }, [onCollapse !== undefined]);
  return (
    <article
      class={cx('flex flex-col gap-3 rounded-[10px] border bg-surface p-4', linked ? 'border-line' : 'border-nolink/40')}
      data-indicator={indicator.id}
      data-linked={linked ? 'true' : 'false'}
      onKeyDown={onCollapse ? (e) => { if (e.key === 'Escape') onCollapse(); } : undefined}
    >
      <header class="flex items-center gap-[10px]">
        <DomainChip domain={indicator.domain} />
        <h3 class="min-w-0 flex-1 text-[14px] font-semibold text-ink">
          {onCollapse ? (
            <button ref={toggle} type="button" class="text-left hover:underline" aria-expanded="true" onClick={onCollapse}>{indicator.name}</button>
          ) : indicator.name}
        </h3>
        <span class="rounded-[3px] bg-ink px-[6px] py-[2px] font-mono text-[9px] font-bold tracking-[0.6px] text-bg">FIRED</span>
      </header>
      <div class="flex flex-wrap items-end gap-[10px]">
        <span class="whitespace-nowrap font-mono text-[26px] font-medium leading-[26px] text-ink">{indicator.value}</span>
        {indicator.change ? <span class="whitespace-nowrap font-mono text-[13px] font-semibold leading-[17px] text-ink">{indicator.change}</span> : null}
        <span class="ml-auto flex items-center gap-[5px] rounded-[4px] border border-line px-2 py-[3px]">
          <Ruler size={11} class="shrink-0 text-muted" aria-hidden="true" />
          <span class="font-mono text-[11px] text-muted">rule: {indicator.rule}</span>
        </span>
      </div>
      {indicator.detail ? <p class="text-[12px] leading-[17px] text-muted" data-indicator-detail>{indicator.detail}</p> : null}
      <div class="flex flex-wrap items-center gap-[10px]">
        <TrustChip trust={indicator.trust} />
        <span class="text-[11px] text-dim">{timeLine(indicator, now)}</span>
      </div>
      <div class="h-px bg-line" aria-hidden="true" />
      {linked ? <LinkedNews links={indicator.links} /> : <NoLinkBox links={indicator.links} />}
      {linked && indicator.why ? (
        <div class="flex gap-2 rounded-[6px] bg-bg px-[10px] py-2">
          <Sparkles size={12} class="mt-[2px] shrink-0 text-muted" aria-hidden="true" />
          <span class="text-[11.5px] leading-4 text-muted">Model inference: {indicator.why}</span>
        </div>
      ) : null}
    </article>
  );
}

/** Compact form, for feeds. A click expands it in place to the full form. */
export function IndicatorCardCompact({ indicator, onExpand }: { indicator: Indicator; onExpand?: () => void }) {
  const linked = indicator.links.stories.length > 0;
  const time = indicator.dataDate ?? hhmm(indicator.at);
  return (
    <button
      type="button"
      onClick={onExpand}
      aria-expanded="false"
      class={cx(
        'relative flex w-full flex-col gap-[7px] overflow-hidden rounded-[8px] border px-[14px] py-[11px] text-left',
        linked ? 'border-line bg-surface hover:border-track' : 'border-nolink/35 bg-nolink/[0.05] hover:border-nolink/60',
      )}
      data-indicator={indicator.id}
      data-linked={linked ? 'true' : 'false'}
    >
      {linked ? null : <span class="absolute inset-y-0 left-0 w-[3px] bg-nolink" aria-hidden="true" />}
      <span class="flex w-full items-center gap-2">
        <DomainChip domain={indicator.domain} compact />
        <span class="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{indicator.name}</span>
        <span class="font-mono text-[10.5px] text-dim">{time}</span>
      </span>
      <span class="flex w-full flex-wrap items-end gap-x-2 gap-y-1">
        <span class="whitespace-nowrap font-mono text-[16px] font-medium leading-[18px] text-ink">{indicator.value}</span>
        {indicator.change ? <span class="whitespace-nowrap font-mono text-[11.5px] font-semibold leading-4 text-ink">{indicator.change}</span> : null}
        <span class="ml-auto whitespace-nowrap font-mono text-[10px] leading-[15px] text-dim">rule {indicator.rule}</span>
      </span>
      {indicator.detail ? <span class="line-clamp-2 w-full text-[11.5px] leading-4 text-muted" data-indicator-detail>{indicator.detail}</span> : null}
      <span class="flex w-full items-center gap-2">
        <TrustChip trust={indicator.trust} compact />
        {linked ? (
          <span class="ml-auto flex shrink-0 items-center gap-[5px] rounded-[4px] bg-bg px-[7px] py-[2px]">
            <Newspaper size={11} class="text-muted" aria-hidden="true" />
            <span class="text-[10.5px] text-muted">{indicator.links.stories.length} linked</span>
          </span>
        ) : (
          <span class="ml-auto flex shrink-0 items-center gap-[5px] rounded-[4px] border border-nolink/40 bg-nolink/[0.12] px-[7px] py-[2px]">
            <SearchX size={11} class="text-nolink" aria-hidden="true" />
            <span class="text-[10.5px] font-semibold text-nolink">No linked news found</span>
          </span>
        )}
      </span>
    </button>
  );
}

const STATE_DOT: Readonly<Record<Exclude<FeedState['kind'], 'fired'>, string>> = {
  quiet: 'bg-ok/50',
  stale: 'bg-elev',
  unavailable: 'border-[1.5px] border-dim',
  loading: 'border-[1.5px] border-faint',
};
const STATE_BADGE: Readonly<Record<Exclude<FeedState['kind'], 'fired'>, string>> = {
  quiet: 'text-dim',
  stale: 'text-elev',
  unavailable: 'text-dim',
  loading: 'text-faint',
};

/** One line for a feed with nothing fired. */
export function FeedStateRow({ feed }: { feed: Exclude<FeedState, { kind: 'fired' }> }) {
  const dim = feed.kind === 'unavailable' || feed.kind === 'loading';
  return (
    <div class={cx('flex items-center gap-[10px] rounded-[8px] border border-line px-3 py-[9px]', dim ? 'bg-bg' : 'bg-surface')} data-feed={feed.id} data-feed-state={feed.kind}>
      <span class={cx('h-2 w-2 shrink-0 rounded-full', STATE_DOT[feed.kind])} aria-hidden="true" />
      <span class="flex min-w-0 flex-1 flex-col gap-px">
        <span class={cx('text-[12.5px] font-medium', dim ? 'text-muted' : 'text-ink')}>{feed.name}</span>
        <span class="text-[10.5px] text-dim">{feed.detail}</span>
      </span>
      <span class={cx('font-mono text-[9px] font-semibold tracking-[0.6px]', STATE_BADGE[feed.kind])}>{feed.kind.toUpperCase()}</span>
    </div>
  );
}

const HEALTH_DOT: Readonly<Record<FeedState['kind'], string>> = {
  fired: 'bg-ink',
  quiet: 'bg-ok/50',
  stale: 'bg-elev',
  unavailable: 'border-[1.5px] border-dim',
  loading: 'border-[1.5px] border-faint',
};

/** One dot per feed, in the order given. */
export function HealthDots({ feeds }: { feeds: readonly FeedState[] }) {
  return (
    <span class="flex items-center gap-[5px]" aria-label="Feed health" role="img" title={feeds.map((f) => `${f.name}: ${f.kind}`).join(' · ')}>
      {feeds.map((f) => <span key={f.id} class={cx('h-2 w-2 rounded-full', HEALTH_DOT[f.kind])} aria-hidden="true" />)}
    </span>
  );
}

/** A feed list: fired feeds as compact cards that expand in place, the rest as state rows. */
export function IndicatorFeed({ feeds, now, onFocus }: { feeds: readonly FeedState[]; now: number; onFocus?: (indicator: Indicator) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div class="flex flex-col gap-[10px]" data-testid="indicator-feed">
      {feeds.map((f) => {
        if (f.kind !== 'fired') return <FeedStateRow key={f.id} feed={f} />;
        return open === f.id
          ? <IndicatorCard key={f.id} indicator={f.indicator} now={now} onCollapse={() => setOpen(null)} />
          : <IndicatorCardCompact key={f.id} indicator={f.indicator} onExpand={() => { setOpen(f.id); if (f.indicator.focusId) onFocus?.(f.indicator); }} />;
      })}
    </div>
  );
}
