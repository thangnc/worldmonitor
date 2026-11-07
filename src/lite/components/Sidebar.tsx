import type { ComponentChildren } from 'preact';
import { Bell, Database, ExternalLink, Globe, LayoutDashboard, Settings, SlidersHorizontal, Star } from 'lucide-preact';
import type { LiteScreen } from '@/config/lite-route';
import { LITE_SCREEN_PATHS } from '@/config/lite-route';
import { navigate } from '../router';
import { useDigest, useDomainCounts, useHealth } from '../data/hooks';
import { utcClock } from '../format';
import { cx } from './ui';

const ICON = { size: 15, strokeWidth: 1.5 } as const;

function SectionLabel({ children }: { children: ComponentChildren }) {
  return <div class="mb-[6px] px-[10px] font-mono text-[10px] tracking-[1px] text-dim">{children}</div>;
}

/** A nav item that is planned but not built: visible, not interactive. */
function SoonItem({ icon, label }: { icon: ComponentChildren; label: string }) {
  return (
    <span
      class="flex w-full cursor-not-allowed items-center gap-[10px] rounded-[6px] px-[10px] py-2 text-[13px] text-dim"
      aria-disabled="true"
      data-soon="true"
      title={`${label}: not built yet`}
    >
      <span class="text-dim">{icon}</span>
      <span>{label}</span>
      <span class="ml-auto rounded-[3px] border border-line px-1 font-mono text-[9px] tracking-[0.6px] text-dim">SOON</span>
    </span>
  );
}

function DomainItem({ screen, active, color, label, count }: { screen: LiteScreen; active: boolean; color: string; label: string; count?: number }) {
  return (
    <a
      href={LITE_SCREEN_PATHS[screen]}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(screen);
      }}
      aria-current={active ? 'page' : undefined}
      data-nav={screen}
      class={cx(
        'flex w-full items-center gap-[10px] rounded-[6px] px-[10px] py-2 text-[13px]',
        active ? 'bg-surface-2 font-medium text-ink' : 'text-muted hover:bg-surface-2/60 hover:text-ink',
      )}
    >
      <span class={cx('h-[7px] w-[7px] shrink-0 rounded-full', color)} aria-hidden="true" />
      <span>{label}</span>
      {count != null ? <span class="ml-auto font-mono text-[11px] text-dim">{count}</span> : null}
    </a>
  );
}

function HealthCard() {
  const health = useHealth();
  const digest = useDigest('full');
  const coverage = digest.status === 'ready' ? digest.data.coverage : undefined;
  const summary = health.status === 'ready' ? health.data.summary : undefined;
  const degraded = summary ? (summary.warn ?? 0) + (summary.stale ?? 0) + (summary.empty ?? 0) + (summary.error ?? 0) : undefined;
  const healthy = health.status === 'ready' && (health.data.status === 'HEALTHY' || health.data.status === 'ok' || degraded === 0);
  const title =
    health.status === 'ready' ? (healthy ? 'Ingestion healthy' : `Ingestion ${health.data.status.toLowerCase()}`)
    : health.status === 'loading' ? 'Checking ingestion…'
    : 'Health endpoint unavailable';
  const row = (key: string, value: string, warn = false) => (
    <div class="flex justify-between text-[11px]">
      <span class="text-dim">{key}</span>
      <span class={cx('font-mono', warn ? 'text-high' : 'text-muted')}>{value}</span>
    </div>
  );
  return (
    <div class="hidden flex-col gap-[10px] rounded-[8px] border border-line p-3 wide:flex" data-testid="health-card">
      <div class="flex items-center gap-2">
        <span class={cx('h-[7px] w-[7px] rounded-full', healthy ? 'bg-ok' : health.status === 'ready' ? 'bg-high' : 'bg-dim')} />
        <span class="text-[12px] font-medium text-ink">{title}</span>
      </div>
      {row('Data keys ok', summary ? `${summary.ok ?? 0} / ${summary.total ?? 0}` : '—')}
      {row('Degraded', degraded != null ? String(degraded) : '—', (degraded ?? 0) > 0)}
      {row('Last check', health.status === 'ready' ? utcClock(health.data.checkedAt) : '—')}
      {row('News feeds', coverage ? `${coverage.feedCompleted} / ${coverage.feedTotal}` : '—')}
    </div>
  );
}

export function Sidebar({ screen }: { screen: LiteScreen }) {
  const counts = useDomainCounts();
  return (
    <nav
      aria-label="Lite navigation"
      class="flex w-full flex-col justify-between gap-4 px-[14px] py-4 wide:sticky wide:gap-7 wide:py-5 wide:top-0 wide:h-screen wide:overflow-y-auto"
    >
      <div class="flex flex-col gap-4 wide:gap-7">
        <div class="flex items-center gap-[10px] px-[6px]">
          <span class="flex h-[26px] w-[26px] items-center justify-center rounded-[6px] outline-[1.5px] outline-ink outline -outline-offset-[0.75px]">
            <Globe size={14} strokeWidth={1.5} />
          </span>
          <span class="flex flex-col gap-px">
            <span class="text-[14px] font-semibold text-ink">World Monitor</span>
            <span class="font-mono text-[9.5px] tracking-[1px] text-dim">LITE · SELF-HOSTED</span>
          </span>
        </div>

        <div class="hidden flex-col gap-[2px] wide:flex">
          <SectionLabel>OVERVIEW</SectionLabel>
          <SoonItem icon={<LayoutDashboard {...ICON} />} label="Briefing" />
          <SoonItem icon={<Bell {...ICON} />} label="Alerts" />
          <SoonItem icon={<Star {...ICON} />} label="Watchlists" />
        </div>

        <div class="flex flex-col gap-[2px]">
          <SectionLabel>DOMAINS</SectionLabel>
          <DomainItem screen="geopolitics" active={screen === 'geopolitics'} color="bg-geo" label="Geopolitics" count={counts.geopolitics} />
          <DomainItem screen="finance" active={screen === 'finance'} color="bg-fin" label="Finance & Crypto" count={counts.finance} />
          <DomainItem screen="tech" active={screen === 'tech'} color="bg-tech" label="Technology & AI" count={counts.tech} />
        </div>

        <div class="hidden flex-col gap-[2px] wide:flex">
          <SectionLabel>SYSTEM</SectionLabel>
          <SoonItem icon={<Database {...ICON} />} label="Sources" />
          <SoonItem icon={<SlidersHorizontal {...ICON} />} label="Scoring rules" />
          <SoonItem icon={<Settings {...ICON} />} label="Settings" />
        </div>
        <div class="flex flex-col gap-[2px]">
          <a
            href="/dashboard?full=1"
            class="mt-1 flex w-full items-center gap-[10px] rounded-[6px] px-[10px] py-2 text-[13px] text-muted hover:bg-surface-2/60 hover:text-ink"
            data-testid="open-full-dashboard"
          >
            <ExternalLink {...ICON} />
            <span>Full dashboard</span>
          </a>
        </div>
      </div>
      <HealthCard />
    </nav>
  );
}
