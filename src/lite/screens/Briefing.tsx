import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { Activity, BellOff, Check, CircleHelp, GitFork, Minus, Pin, Quote, Sparkles, TrendingDown, TrendingUp } from 'lucide-preact';
import type { LiteDomainScreen } from '@/config/lite-route';
import { LITE_SCREEN_PATHS } from '@/config/lite-route';
import { getUpcomingDeadlines } from '@/config/ai-regulations';
import type { ServerInsights } from '@/services/insights-loader';
import { Topbar, matchesSearch } from '../components/Topbar';
import { BarStrip } from '../components/charts';
import { Card, ColLabel, DerivedTag, Panel, SegmentedControl, SourceState, TEXT, cx } from '../components/ui';
import {
  useCommodityQuotes,
  useCountryHistory,
  useCryptoQuotes,
  useDigest,
  useGoldIntelligence,
  useInsights,
  useMacroCalendar,
  useMarketQuotes,
  usePriorityEvents,
  useRiskScores,
  useStablecoins,
} from '../data/hooks';
import { ESCALATION_REGIONS, leadCountry } from '../data/regions';
import {
  DOMAIN_LABEL,
  PRIORITY_THRESHOLD,
  WATCH_RULES,
  domainOfCategory,
  corroborationSentence,
  evaluateWatchRules,
  evidenceLine,
  firstSeen,
  marketRegime,
  momentum,
  sinceStats,
  trendLabel,
  type Domain,
  type PriorityEvent,
} from '../data/briefing';
import {
  CORROBORATION_RULE,
  cleanSnippet,
  confidenceLabel,
  corroborationOf,
  digestItems,
  isPrimarySource,
  pctChange,
  publisherCount,
  relativeTime,
  sourceCount,
  TECH_CATEGORIES,
} from '../data/transforms';
import { navigate } from '../router';
import { MINUS, price, signed } from '../format';

type DomainFilter = 'all' | Domain;

const DOMAIN_BG: Record<Domain, string> = { geo: 'bg-geo', fin: 'bg-fin', tech: 'bg-tech' };
const DOMAIN_TEXT: Record<Domain, string> = { geo: 'text-geo', fin: 'text-fin', tech: 'text-tech' };
const DOMAIN_SCREEN: Record<Domain, LiteDomainScreen> = { geo: 'geopolitics', fin: 'finance', tech: 'tech' };

const DOMAIN_OPTIONS: ReadonlyArray<{ value: DomainFilter; label: ComponentChildren }> = [
  { value: 'all', label: 'All' },
  { value: 'geo', label: <><span class="h-[6px] w-[6px] rounded-full bg-geo" aria-hidden="true" />Geo</> },
  { value: 'fin', label: <><span class="h-[6px] w-[6px] rounded-full bg-fin" aria-hidden="true" />Finance</> },
  { value: 'tech', label: <><span class="h-[6px] w-[6px] rounded-full bg-tech" aria-hidden="true" />AI &amp; Tech</> },
];

const CONF_BORDER: Record<string, string> = { ok: 'border-ok text-ok', high: 'border-high text-high', muted: 'border-line text-muted' };

const hhmm = (ts: number | string) => new Date(ts).toISOString().slice(11, 16);

/** A link to a child screen that stays inside the Lite router. */
function ScreenLink({ screen, children, class: className }: { screen: LiteDomainScreen; children: ComponentChildren; class?: string }) {
  return (
    <a
      href={LITE_SCREEN_PATHS[screen]}
      data-open-screen={screen}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(screen);
      }}
      class={cx('whitespace-nowrap hover:text-ink', className ?? 'font-mono text-[11px] text-dim')}
    >
      {children}
    </a>
  );
}

export function Briefing() {
  const [domain, setDomain] = useState<DomainFilter>('all');
  const [search, setSearch] = useState('');
  const events = usePriorityEvents();
  const now = Date.now();
  const dayAgo = now - 86_400_000;
  const recent = [...events.ranked, ...events.below].filter((e) => firstSeen(e) >= dayAgo);
  const reports = recent.reduce((sum, e) => sum + sourceCount(e), 0);
  const date = new Date(now).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(',', '');

  return (
    <>
      <Topbar
        title="Cross-domain briefing"
        subtitle={
          <>
            {date} · {hhmm(now)} UTC ·{' '}
            {!events.ready ? 'Loading events' : events.failed ? 'News digests unavailable' : `${events.ranked.length} events ranked from ${reports.toLocaleString('en-US')} reports in 24h`}
          </>
        }
        filter={<SegmentedControl label="Domain" options={DOMAIN_OPTIONS} value={domain} onChange={setDomain} />}
        search={search}
        onSearch={setSearch}
        searchWidth={240}
        actionLabel="Generate brief"
        actionIcon={<Sparkles size={14} strokeWidth={2} />}
      />
      <div class="flex flex-col gap-6 px-4 py-6 wide:flex-row wide:px-7">
        <div class="flex min-w-0 flex-1 flex-col gap-5">
          <HourlyBrief domain={domain} />
          <PriorityEvents domain={domain} search={search} />
        </div>
        <div class="flex w-full flex-col gap-4 wide:w-[352px] wide:shrink-0">
          <MarketPulse />
          <EscalationTracker />
          <Catalysts />
          <WatchAlerts />
        </div>
      </div>
    </>
  );
}

// ---- Hourly brief -------------------------------------------------------------

/** One brief line: its text without the trailing citation, its story's domain, and its citation. */
function briefLines(insights: ServerInsights): Array<{ n: number; text: string; domain: Domain }> {
  return (insights.briefStoryLines ?? []).map((line) => ({
    n: line.n,
    text: line.text.replace(/\s*\[\d{1,3}\]\s*$/, '').trim(),
    domain: domainOfCategory(insights.topStories[line.n - 1]?.category ?? ''),
  }));
}

function HourlyBrief({ domain }: { domain: DomainFilter }) {
  const insights = useInsights();
  const events = usePriorityEvents();
  const alerts = useWatchAlerts();
  const [all, setAll] = useState(false);

  if (insights.status !== 'ready') {
    return (
      <Card title="Hourly brief" testId="hourly-brief">
        <SourceState state={insights} source="AI insights (seed-insights)" />
      </Card>
    );
  }
  const data = insights.data;
  const lines = briefLines(data).filter((l) => domain === 'all' || l.domain === domain);
  const shown = all ? lines : lines.slice(0, 3);
  const sources = data.worldBriefSources ?? [];
  const since = Date.parse(data.generatedAt);
  const stats = sinceStats([...events.ranked, ...events.below], since);

  return (
    <section class="overflow-hidden rounded-[10px] border border-line bg-surface" data-testid="hourly-brief">
      <header class="flex flex-wrap items-center gap-x-[10px] gap-y-1 border-b border-line px-5 py-[14px]">
        <Sparkles size={14} strokeWidth={1.5} class="text-muted" />
        <h2 class="font-mono text-[11px] font-medium tracking-[1px] text-ink">HOURLY BRIEF · {hhmm(data.generatedAt)} UTC</h2>
        <span class="text-[11.5px] text-dim">
          AI summary · grounded in {sources.length} cited source{sources.length === 1 ? '' : 's'} · not independently verified
          {data.status === 'degraded' ? ' · degraded run' : ''}
        </span>
        {lines.length > 3 ? (
          <button type="button" class="ml-auto text-[12px] font-medium text-ink hover:opacity-80" onClick={() => setAll(!all)} data-testid="brief-toggle">
            {all ? 'Show fewer' : `Show all ${lines.length} lines →`}
          </button>
        ) : null}
      </header>
      <div class="flex flex-col gap-6 px-5 pb-5 pt-[18px] md:flex-row md:gap-7">
        <div class="flex min-w-0 flex-1 flex-col gap-[14px]">
          <p class="text-[19px] font-semibold leading-[26px] text-ink" data-testid="brief-lead">{data.worldBrief || 'No lead paragraph in this run.'}</p>
          {shown.length === 0 ? (
            <p class="text-[12.5px] text-dim">No brief lines in this domain.</p>
          ) : (
            shown.map((line) => {
              const src = sources[line.n - 1];
              return (
                <div key={line.n} class="flex gap-[10px]" data-brief-line={line.domain}>
                  <span class="pt-[6px]">
                    <span class={cx('block h-[10px] w-[3px] rounded-[1px]', DOMAIN_BG[line.domain])} aria-hidden="true" />
                  </span>
                  <p class="min-w-0 flex-1 text-[13.5px] leading-5 text-muted">{line.text}</p>
                  {src?.url ? (
                    <a href={src.url} target="_blank" rel="noopener noreferrer" class="font-mono text-[11px] text-dim hover:text-ink" title={`${src.source}: ${src.title}`}>
                      [{line.n}]
                    </a>
                  ) : (
                    <span class="font-mono text-[11px] text-dim">[{line.n}]</span>
                  )}
                </div>
              );
            })
          )}
        </div>
        <div class="flex shrink-0 flex-row flex-wrap gap-x-6 gap-y-3 border-line md:w-[180px] md:flex-col md:flex-nowrap md:gap-[14px] md:border-l md:pl-5" data-testid="since-brief">
          <div class="flex w-full items-center justify-between">
            <ColLabel>SINCE {Number.isFinite(since) ? hhmm(since) : '—'}</ColLabel>
            <DerivedTag how="New = first seen after the brief was generated. Breaking and fading = story phase in the digests. Alerts = the built-in watch rules below." />
          </div>
          <SinceStat value={`+${stats.fresh}`} label="new events" />
          <SinceStat value={String(stats.breaking)} label="breaking" tone={stats.breaking > 0 ? 'high' : undefined} />
          <SinceStat value={String(stats.fading)} label="fading" />
          <SinceStat value={String(alerts.length)} label="alerts fired" />
        </div>
      </div>
    </section>
  );
}

function SinceStat({ value, label, tone }: { value: string; label: string; tone?: 'high' }) {
  return (
    <div class="flex items-baseline gap-2">
      <span class={cx('font-mono text-[20px] font-medium', tone ? TEXT[tone] : 'text-ink')}>{value}</span>
      <span class="text-[12px] text-dim">{label}</span>
    </div>
  );
}

// ---- Priority events ------------------------------------------------------------

type View = 'ranked' | 'timeline';

function PriorityEvents({ domain, search }: { domain: DomainFilter; search: string }) {
  const events = usePriorityEvents();
  const insights = useInsights();
  const [view, setView] = useState<View>('ranked');
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  const rows = useMemo(() => {
    const list = events.ranked.filter((e) => (domain === 'all' || e.domain === domain) && matchesSearch(search, e.title, e.source, e.locationName));
    return view === 'timeline' ? [...list].sort((a, b) => firstSeen(b) - firstSeen(a)) : list;
  }, [events.ranked, domain, search, view]);
  const shown = all ? rows : rows.slice(0, 5);
  const expanded = open ?? shown[0]?.title ?? null;
  const merged = [...events.ranked, ...events.below].reduce((sum, e) => sum + sourceCount(e), 0);
  const topStories = insights.status === 'ready' ? insights.data.topStories : [];

  const toggle = (label: string, value: View) => (
    <button type="button" aria-pressed={view === value} onClick={() => setView(value)} class={cx('text-[12px]', view === value ? 'font-medium text-ink' : 'text-dim hover:text-ink')}>
      {label}
    </button>
  );

  return (
    <Card
      title="Priority events"
      sub={<>ranked by impact × confidence · threshold {PRIORITY_THRESHOLD}</>}
      right={
        <>
          <DerivedTag how={`Each domain screen's main list, merged. Shown when importance ≥ ${PRIORITY_THRESHOLD}; ranked by importance × credibility ÷ 100.`} />
          {toggle('Ranked', 'ranked')}
          {toggle('Timeline', 'timeline')}
          <ScreenLink screen="geopolitics" class="text-[12px] text-dim">Map</ScreenLink>
        </>
      }
      testId="priority-events"
    >
      <div class="hidden gap-4 border-y border-line bg-bg px-5 py-2 md:flex">
        <ColLabel class="w-[22px]">#</ColLabel>
        <ColLabel class="flex-1">EVENT</ColLabel>
        <ColLabel class="w-[128px]">EVIDENCE</ColLabel>
        <ColLabel class="w-[112px]">IMPACT</ColLabel>
      </div>
      {!events.ready ? (
        <SourceState state={{ status: 'loading', data: null, at: 0 }} source="news digests" />
      ) : events.failed ? (
        <SourceState state={{ status: 'error', data: null, at: 0, error: 'all three digests failed' }} source="news digests (list-feed-digest)" />
      ) : shown.length === 0 ? (
        <p class="px-5 py-4 text-[12.5px] text-dim">No events above the threshold{domain !== 'all' || search ? ' for this filter' : ''}.</p>
      ) : (
        shown.map((e, i) => (
          <EventRow
            key={e.title}
            event={e}
            rank={i + 1}
            expanded={expanded === e.title}
            onToggle={() => setOpen(expanded === e.title ? '' : e.title)}
            clusterSources={topStories.find((s) => s.primaryTitle.trim().toLowerCase() === e.title.trim().toLowerCase())?.sources}
          />
        ))
      )}
      {events.ready && !events.failed ? (
        <div class="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3">
          <span class="text-[12px] text-dim">
            {events.below.length} more events below threshold · {merged.toLocaleString('en-US')} reports merged into clusters
          </span>
          {rows.length > 5 ? (
            <button type="button" class="ml-auto text-[12px] font-medium text-ink hover:opacity-80" onClick={() => setAll(!all)} data-testid="events-toggle">
              {all ? 'Show top 5' : `Show all ${rows.length} →`}
            </button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function EventRow({
  event: e, rank, expanded, onToggle, clusterSources,
}: { event: PriorityEvent; rank: number; expanded: boolean; onToggle: () => void; clusterSources?: string[] }) {
  const conf = confidenceLabel(e.credibilityScore || 0);
  const mom = momentum(e.storyMeta?.phase);
  const MomIcon = mom.label === 'rising' ? TrendingUp : mom.label === 'fading' ? TrendingDown : Minus;
  const impact = Math.min(100, Math.max(0, e.importanceScore || 0));
  const mentions = e.storyMeta?.mentionCount ?? 0;
  const meta = [e.locationName, `${relativeTime(firstSeen(e), Date.now())} ago`, mentions > 1 ? `seen ${mentions}×` : ''].filter(Boolean).join(' · ');

  return (
    <div class={cx('flex flex-col gap-[14px] border-b border-line px-5 py-[14px] last:border-b-0', expanded && 'bg-surface-2')} data-event-domain={e.domain} data-expanded={expanded ? 'true' : undefined}>
      <div class="flex flex-wrap gap-x-4 gap-y-2 md:flex-nowrap">
        <span class="w-[22px] pt-px font-mono text-[12px] text-dim">{String(rank).padStart(2, '0')}</span>
        <div class="flex min-w-0 flex-1 basis-[calc(100%-38px)] flex-col gap-[5px] md:basis-0">
          <button type="button" onClick={onToggle} aria-expanded={expanded} class="text-left text-[14px] font-semibold leading-5 text-ink hover:opacity-90">
            {e.title}
          </button>
          <div class="flex flex-wrap items-center gap-2">
            <ScreenLink screen={DOMAIN_SCREEN[e.domain]} class="flex items-center gap-[5px]">
              <span class={cx('h-[6px] w-[6px] rounded-full', DOMAIN_BG[e.domain])} aria-hidden="true" />
              <span class={cx('font-mono text-[10.5px] font-semibold tracking-[0.5px]', DOMAIN_TEXT[e.domain])}>{DOMAIN_LABEL[e.domain]}</span>
            </ScreenLink>
            <span class="text-[12px] text-dim">{meta}</span>
          </div>
        </div>
        <div class="flex w-[128px] flex-col gap-[5px] pl-[38px] md:pl-0">
          <span class={cx('w-fit rounded-[4px] border px-2 py-px text-[11.5px] font-medium', CONF_BORDER[conf.tone] ?? CONF_BORDER.muted)} title={`Source credibility ${e.credibilityScore}/100`}>
            {conf.label}
          </span>
          <span class="text-[11.5px] text-dim">{evidenceLine(e)}</span>
        </div>
        <div class="flex w-[112px] flex-col gap-[7px]">
          <div class="flex items-center justify-between">
            <span class="font-mono text-[16px] font-medium text-ink" title={`Importance ${impact}; rank key ${e.priority}`}>{impact}</span>
            <span class={cx('flex items-center gap-[3px] text-[11px]', TEXT[mom.tone])}>
              <MomIcon size={12} strokeWidth={1.5} />
              {mom.label}
            </span>
          </div>
          <span class="block h-[3px] w-full rounded-[2px] bg-track">
            <span class={cx('block h-[3px] rounded-[2px]', DOMAIN_BG[e.domain])} style={{ width: `${impact}%` }} />
          </span>
        </div>
      </div>
      {expanded ? <EventDetail event={e} clusterSources={clusterSources} /> : null}
    </div>
  );
}

function EventDetail({ event: e, clusterSources }: { event: PriorityEvent; clusterSources?: string[] }) {
  const verdict = corroborationOf(e);
  const publishers = publisherCount(verdict);
  const summary = cleanSnippet(e);
  const others = (clusterSources ?? []).filter((s) => s !== e.source).slice(0, 4);
  const column = (icon: ComponentChildren, head: string, tone: string, items: ComponentChildren[]) => (
    <div class="flex flex-col gap-2 bg-surface p-3">
      <div class={cx('flex items-center gap-[6px] font-mono text-[10px] font-medium tracking-[0.8px]', tone)}>
        {icon}
        {head}
      </div>
      {items.map((item, i) => (
        <p key={i} class="text-[12.5px] leading-[18px] text-muted">{item}</p>
      ))}
    </div>
  );
  return (
    <div class="flex flex-col gap-[14px] pb-1 md:pl-[38px]" data-testid="event-detail">
      {summary ? (
        <p class="text-[12.5px] leading-[18px] text-muted">
          <span class="mr-2 font-semibold text-ink">Summary</span>
          {summary}
        </p>
      ) : null}
      <div>
        <div class="grid gap-px overflow-hidden rounded-[8px] border border-line bg-line md:grid-cols-3">
          {column(<Check size={12} strokeWidth={2} />, 'CORROBORATION', 'text-ok', [
            corroborationSentence(verdict),
          ])}
          {column(<Quote size={12} strokeWidth={2} />, 'ATTRIBUTED CLAIMS', 'text-high', [
            `${e.source} reports the headline${isPrimarySource(e.source) ? ' (tier-1 outlet)' : ''}`,
            ...(publishers !== null && publishers > 1 ? [`${publishers - 1} other publisher${publishers === 2 ? '' : 's'} carry the story`] : []),
          ])}
          {column(<CircleHelp size={12} strokeWidth={2} />, 'OPEN QUESTIONS', 'text-dim', [
            <>Needs event analysis <span class="ml-1 rounded-[3px] border border-line px-1 font-mono text-[9px] tracking-[0.6px] text-dim">SOON</span></>,
          ])}
        </div>
        <div class="mt-1 flex justify-end">
          <DerivedTag how={`Columns follow the dashboard's corroboration rule, not extracted claims, so none says the claim is true. ${CORROBORATION_RULE} Open questions need the event-analysis phase.`} />
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-[6px]">
        <a href={e.link} target="_blank" rel="noopener noreferrer" class="flex items-center gap-[5px] rounded-[4px] border border-line bg-bg px-2 py-1 text-[11.5px] text-muted hover:text-ink">
          {isPrimarySource(e.source) ? <span class="h-[5px] w-[5px] rounded-full bg-ok" aria-hidden="true" /> : null}
          {e.source} ↗
        </a>
        {others.map((s) => (
          <span key={s} class="flex items-center gap-[5px] rounded-[4px] border border-line bg-bg px-2 py-1 text-[11.5px] text-muted">
            {isPrimarySource(s) ? <span class="h-[5px] w-[5px] rounded-full bg-ok" aria-hidden="true" /> : null}
            {s}
          </span>
        ))}
        {!others.length && publishers !== null && publishers > 1 ? <span class="rounded-[4px] border border-line bg-bg px-2 py-1 text-[11.5px] text-muted">+{publishers - 1} more</span> : null}
        <span class="flex-1" />
        {[
          { Icon: Pin, label: 'Pin' },
          { Icon: GitFork, label: 'Split cluster' },
          { Icon: BellOff, label: 'Mute' },
        ].map(({ Icon, label }) => (
          <span key={label} class="flex cursor-not-allowed items-center gap-[5px] px-2 py-1 text-[12px] text-dim" aria-disabled="true" data-soon="true" title={`${label}: not built yet`}>
            <Icon size={12} strokeWidth={1.5} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---- Market pulse ---------------------------------------------------------------

interface PulseRow {
  symbol: string;
  value: string;
  change: string;
  move: number | null;
  spark: number[];
}

function MarketPulse() {
  const crypto = useCryptoQuotes();
  const equities = useMarketQuotes();
  const commodities = useCommodityQuotes();
  const gold = useGoldIntelligence();
  const pick = <T extends { symbol: string }>(state: { status: string; data: T[] | null }, symbol: string) =>
    state.status === 'ready' ? state.data?.find((q) => q.symbol.toUpperCase() === symbol.toUpperCase()) : undefined;

  const btc = pick(crypto, 'BTC');
  const eth = pick(crypto, 'ETH');
  const spx = pick(equities, '^GSPC');
  const tnx = pick(equities, '^TNX');
  const brent = pick(commodities, 'BZ=F');
  const goldQ = pick(commodities, 'GC=F');
  const dxy = gold.status === 'ready' ? gold.data.drivers.find((d) => /dxy|dollar/i.test(d.label) || d.symbol.startsWith('DX')) : undefined;

  const row = (symbol: string, q: { price: number; change: number; sparkline: number[] } | undefined): PulseRow => ({
    symbol,
    value: q ? price(q.price) : '—',
    change: q ? signed(q.change) : '—',
    move: q ? q.change : null,
    spark: (q?.sparkline ?? []).slice(-12),
  });
  let tenYear: PulseRow = { symbol: 'US 10Y', value: '—', change: '—', move: null, spark: [] };
  if (tnx) {
    const bp = (tnx.price - tnx.price / (1 + tnx.change / 100)) * 100;
    tenYear = { symbol: 'US 10Y', value: `${tnx.price.toFixed(2)}%`, change: `${bp < 0 ? MINUS : '+'}${Math.abs(bp).toFixed(0)}bp`, move: bp, spark: tnx.sparkline.slice(-12) };
  }
  const rows: PulseRow[] = [
    row('BTC', btc),
    row('ETH', eth),
    row('S&P 500', spx),
    row('Brent', brent),
    row('Gold', goldQ),
    dxy ? { symbol: 'DXY', value: dxy.value.toFixed(1), change: signed(dxy.changePct), move: dxy.changePct, spark: [] } : { symbol: 'DXY', value: '—', change: '—', move: null, spark: [] },
    tenYear,
  ];
  const regime = marketRegime({ btc: btc?.change, oil: brent?.change, usd: dxy?.changePct, spx: spx?.change, gold: goldQ?.change });
  const latest = Math.max(crypto.at, equities.at, commodities.at);
  const sources = [crypto, equities, commodities];
  const noQuotes = sources.every((q) => q.status === 'empty' || q.status === 'error') ? (sources.find((q) => q.status === 'error') ?? crypto) : null;

  return (
    <Panel title="Market pulse" sub={latest ? `live · ${hhmm(latest)}` : 'loading'} right={<ScreenLink screen="finance">Finance →</ScreenLink>} testId="market-pulse">
      {regime ? (
        <div class="flex flex-wrap items-center gap-2 rounded-[6px] border border-line bg-bg px-[10px] py-[7px]" data-testid="market-regime">
          <Activity size={13} strokeWidth={1.5} class={TEXT[regime.tone]} />
          <span class={cx('text-[12.5px] font-semibold', TEXT[regime.tone])}>{regime.label}</span>
          <span class="text-[12px] text-muted">{regime.why}</span>
          <span class="ml-auto">
            <DerivedTag how="Risk-off signals: oil > +1%, BTC < −2%, DXY > +0.2%, S&P < −0.5%, gold > +0.5% (24h). Risk-on is the mirror, oil excluded. A tilt needs a lead of two." />
          </span>
        </div>
      ) : null}
      {noQuotes ? <SourceState state={noQuotes} source="market quotes (seed-crypto-quotes, seed-market-quotes, seed-commodity-quotes)" pad={false} /> : null}
      <div class="flex flex-col">
        {rows.map((r) => {
          const up = (r.move ?? 0) >= 0;
          return (
            <div key={r.symbol} class="flex items-center gap-3 border-b border-line py-[9px] last:border-b-0" data-ticker={r.symbol}>
              <span class="w-[60px] text-[12.5px] font-semibold text-ink">{r.symbol}</span>
              <span class="flex flex-1 justify-center">
                {r.spark.length > 1 ? (
                  <BarStrip values={r.spark} height={16} barWidth={3} gap={1} relative label={`${r.symbol}, last ${r.spark.length} closes`} colorFor={() => (up ? 'bg-ok/80' : 'bg-crit/80')} />
                ) : null}
              </span>
              <span class="w-[64px] text-right font-mono text-[12.5px] text-ink">{r.value}</span>
              <span class={cx('w-[56px] text-right font-mono text-[11.5px]', r.move == null ? 'text-dim' : up ? 'text-ok' : 'text-crit')}>{r.change}</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ---- Escalation tracker ---------------------------------------------------------

const TRACKED_REGIONS = ESCALATION_REGIONS.filter((r) => r.name !== 'Levant');

function EscalationTracker() {
  const risk = useRiskScores();
  return (
    <Panel title="Escalation tracker" sub="7d · CII" right={<ScreenLink screen="geopolitics">Geopolitics →</ScreenLink>} testId="escalation-tracker">
      {risk.status === 'error' ? <SourceState state={risk} source="country risk scores (CII)" pad={false} /> : null}
      {TRACKED_REGIONS.map((r) => {
        if (risk.status === 'error' || risk.status === 'empty') {
          return (
            <div key={r.name} class="flex flex-col gap-[2px]" data-region={r.name}>
              <span class="text-[12.5px] font-semibold text-ink">{r.name}</span>
              <span class="text-[11.5px] text-dim">unavailable</span>
            </div>
          );
        }
        const lead = risk.status === 'ready' ? leadCountry(r.countries, risk.data.ciiScores) : { country: r.countries[0] ?? '', score: undefined };
        return <TrackerRow key={r.name} name={r.name} country={lead.country} score={lead.score} />;
      })}
    </Panel>
  );
}

function TrackerRow({ name, country, score }: { name: string; country: string; score: number | null | undefined }) {
  const history = useCountryHistory(country);
  const series = history.status === 'ready' ? history.data.points.map((p) => p.cii?.score ?? 0).filter((v) => v > 0) : [];
  const change = series.length >= 2 ? pctChange(series[series.length - 2] ?? 0, series[series.length - 1] ?? 0) : null;
  const trend = trendLabel(change);
  const detail =
    score === undefined ? 'loading'
    : score === null ? 'Not in CII'
    : trend ? `${trend.label} · 24h ${signed(change ?? 0, 0)}`
    : `CII ${score.toFixed(0)}`;
  return (
    <div class="flex items-center gap-3" data-region={name} title={`CII for ${country}, daily snapshots. Trend: change between the last two, ±10% is stable.`}>
      <div class="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span class="truncate text-[12.5px] font-semibold text-ink">{name}</span>
        <span class={cx('text-[11.5px]', trend ? TEXT[trend.tone] : 'text-dim')}>{detail}</span>
      </div>
      {series.length > 1 ? (
        <BarStrip values={series} height={20} barWidth={4} relative label={`${name} CII, last ${series.length} days`} colorFor={(i) => (i === series.length - 1 && trend?.label === 'escalating' ? 'bg-high' : 'bg-track')} />
      ) : null}
    </div>
  );
}

// ---- Upcoming catalysts ---------------------------------------------------------

interface Catalyst {
  date: string;
  title: string;
  sub: string;
  domain: Domain;
}

function Catalysts() {
  const cal = useMacroCalendar();
  const horizon = Date.now() + 7 * 86_400_000;
  const today = new Date().toISOString().slice(0, 10);
  const lastDay = new Date(horizon).toISOString().slice(0, 10);
  const macro: Catalyst[] = cal.status === 'ready'
    ? cal.data.events
        .filter((e) => /high/i.test(e.impact) && e.date.slice(0, 10) >= today && e.date.slice(0, 10) <= lastDay)
        .map((e) => ({
          date: e.date.slice(0, 10),
          title: `${e.country ? `${e.country} ` : ''}${e.event}`,
          sub: [e.estimate ? `Consensus ${e.estimate}${e.unit ?? ''}` : '', e.previous ? `prior ${e.previous}${e.unit ?? ''}` : '', 'high impact'].filter(Boolean).join(' · '),
          domain: 'fin' as const,
        }))
    : [];
  const ai: Catalyst[] = getUpcomingDeadlines()
    .filter((d) => Date.parse(d.deadline.date) <= horizon)
    .map((d) => ({ date: d.deadline.date.slice(0, 10), title: `${d.regulation.shortName}: ${d.deadline.label}`, sub: 'AI regulation deadline · curated', domain: 'tech' as const }));
  const rows = [...macro, ...ai].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);

  return (
    <Panel title="Upcoming catalysts" sub="next 7 days" testId="catalysts">
      {cal.status === 'loading' ? <SourceState state={cal} source="economic calendar" pad={false} /> : null}
      {cal.status === 'error' ? <SourceState state={cal} source="economic calendar (seed-economic-calendar)" pad={false} /> : null}
      {(cal.status === 'ready' || cal.status === 'empty') && rows.length === 0 ? <p class="text-[12px] text-dim">No high-impact releases or AI deadlines in the next 7 days.</p> : null}
      {rows.map((c) => {
        const d = new Date(`${c.date}T12:00:00Z`);
        return (
          <div key={`${c.date}${c.title}`} class="flex gap-3" data-catalyst={c.domain}>
            <div class="flex w-[44px] shrink-0 flex-col font-mono">
              <span class="text-[9.5px] tracking-[0.6px] text-dim">{d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }).toUpperCase()}</span>
              <span class="text-[11px] font-medium text-muted">{d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }).toUpperCase()}</span>
            </div>
            <div class="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span class="flex items-center gap-[6px]">
                <span class={cx('h-[6px] w-[6px] shrink-0 rounded-full', DOMAIN_BG[c.domain])} aria-hidden="true" />
                <span class="truncate text-[12.5px] font-semibold text-ink" title={c.title}>{c.title}</span>
              </span>
              <span class="truncate text-[11.5px] text-dim">{c.sub}</span>
            </div>
          </div>
        );
      })}
    </Panel>
  );
}

// ---- Watch alerts ---------------------------------------------------------------

function useWatchAlerts() {
  const events = usePriorityEvents();
  const crypto = useCryptoQuotes();
  const tech = useDigest('tech');
  const btc = crypto.status === 'ready' ? crypto.data.find((q) => q.symbol.toUpperCase() === 'BTC') : undefined;
  return useMemo(
    () =>
      evaluateWatchRules({
        events: events.ranked,
        btcCloses: btc?.sparkline ?? [],
        techItems: tech.status === 'ready' ? digestItems(tech.data, TECH_CATEGORIES) : [],
        now: Date.now(),
      }),
    [events.ranked, btc, tech],
  );
}

function WatchAlerts() {
  const alerts = useWatchAlerts();
  const events = usePriorityEvents();
  const stables = useStablecoins();
  const depegged = stables.status === 'ready' ? stables.data.summary?.depeggedCount ?? 0 : null;
  return (
    <Panel
      title="Watchlist alerts"
      sub={`${alerts.length} fired · 24h`}
      right={<DerivedTag how={`Built-in rules until watchlists ship: ${WATCH_RULES.impact.rule}; BTC ${WATCH_RULES.btcVol.rule}; ${WATCH_RULES.aiPrimary.rule}. Nothing is delivered.`} />}
      testId="watch-alerts"
    >
      {alerts.length === 0 ? (
        <p class="text-[12px] text-dim">
          {!events.ready ? 'Evaluating rules…' : events.failed ? 'News digests unavailable: event rules not evaluated.' : 'No rule fired in the last 24 hours.'}
        </p>
      ) : null}
      {alerts.slice(0, 4).map((a) => (
        <div key={a.id} class="flex gap-[10px]" data-alert={a.domain}>
          <span class={cx('w-[2px] shrink-0 rounded-[1px]', DOMAIN_BG[a.domain])} aria-hidden="true" />
          <div class="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span class="truncate text-[12.5px] font-semibold text-ink" title={a.title}>{a.title}</span>
            <span class="text-[11.5px] text-dim">{a.rule}</span>
          </div>
          <span class="font-mono text-[11px] text-dim">{hhmm(a.at)}</span>
        </div>
      ))}
      <div class="flex items-center gap-2 rounded-[6px] border border-line px-[10px] py-2 text-[12px] text-dim" data-testid="depeg-watch">
        {depegged == null
          ? 'Stablecoin depeg watch — data unavailable'
          : depegged > 0
            ? <span class="text-crit">Stablecoin depeg watch — {depegged} off peg now</span>
            : 'Stablecoin depeg watch — quiet, all on peg'}
      </div>
      <div class="flex items-center justify-between text-[11.5px] text-dim">
        <span>Optional layers off: weather, maritime, social</span>
        <span class="cursor-not-allowed font-mono text-[9px] tracking-[0.6px]" aria-disabled="true" data-soon="true" title="Manage layers: not built yet">MANAGE · SOON</span>
      </div>
    </Panel>
  );
}
