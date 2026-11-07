import { useMemo, useState } from 'preact/hooks';
import { Box, Check, CheckCheck, CloudOff, Cpu, Landmark, Quote, Scale, Server, ShieldAlert, Sparkles, type LucideIcon } from 'lucide-preact';
import { getLatestActions, getUpcomingDeadlines } from '@/config/ai-regulations';
import { Topbar, matchesSearch } from '../components/Topbar';
import { Card, ColLabel, DerivedTag, Dot, Panel, SampleBadge, SegmentedControl, SourceState, TEXT, cx } from '../components/ui';
import { selectTechDevelopments, useArxiv, useDigest, useHackerNews } from '../data/hooks';
import { SAMPLE_INFRA_KPIS, SAMPLE_MODELS } from '../data/fixtures';
import {
  TECH_FILTER_CATEGORIES,
  byImportance,
  claimStatus,
  decodeEntities,
  digestItems,
  isPrimarySource,
  relativeTime,
  sourceCount,
  techType,
  topicCounts,
  type LiteItem,
  type TechFilter,
  type Tone,
} from '../data/transforms';

const FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'models', label: 'Models' },
  { value: 'policy', label: 'Policy' },
  { value: 'research', label: 'Research' },
  { value: 'infra', label: 'Infra' },
] as const satisfies ReadonlyArray<{ value: TechFilter; label: string }>;

const TYPE_ICON: Record<string, LucideIcon> = {
  REGULATION: Scale,
  RELEASE: Box,
  INFRA: Server,
  SECURITY: ShieldAlert,
  OUTAGE: CloudOff,
  RESEARCH: Landmark,
  AI: Sparkles,
};

/** The digest snippet without HTML entities, or nothing when it repeats the title. */
function cleanSnippet(item: LiteItem): string {
  const text = decodeEntities(item.snippet ?? '').replace(/\s+/g, ' ').trim();
  const title = item.title.trim().toLowerCase();
  return !text || text.toLowerCase().startsWith(title.slice(0, Math.min(40, title.length))) ? '' : text;
}

/** Status pill from the corroboration rule. */
function evidencePill(item: LiteItem): { label: string; tone: Tone; Icon: LucideIcon } {
  if (isPrimarySource(item.source)) return { label: 'Primary source', tone: 'ok', Icon: Check };
  if (claimStatus(item) !== 'unverified') return { label: 'Corroborated', tone: 'ok', Icon: CheckCheck };
  return { label: 'Single source', tone: 'high', Icon: Quote };
}

/** Topics the owner watches. Counts are title matches in the tech digest. */
const WATCHED_TOPICS = [
  { label: 'Open weights', pattern: /open[- ]weights?|open[- ]source model/i },
  { label: 'Frontier evals', pattern: /benchmark|eval(uation)?s?\b/i },
  { label: 'AI security', pattern: /prompt injection|jailbreak|vulnerab|exploit|CVE-/i },
  { label: 'Compute export', pattern: /export control|chip export|entity list/i },
  { label: 'EU AI Act', pattern: /AI Act|AI Office/i },
  { label: 'Agents', pattern: /\bagent(s|ic)?\b/i },
] as const;

export function Tech() {
  const [filter, setFilter] = useState<TechFilter>('all');
  const [search, setSearch] = useState('');
  const digest = useDigest('tech');
  const all = useMemo(() => (digest.status === 'ready' ? selectTechDevelopments(digest.data) : []), [digest]);
  const rows = all.filter(
    (i) => (filter === 'all' || TECH_FILTER_CATEGORIES[filter].includes(i.category)) && matchesSearch(search, i.title, i.source),
  );

  return (
    <>
      <Topbar
        title="Technology & AI"
        subtitle={<>{digest.status === 'ready' ? `${all.length} developments in the digest` : 'Loading developments'} · primary sources first</>}
        filter={<SegmentedControl label="Development type" options={FILTER_OPTIONS} value={filter} onChange={setFilter} />}
        search={search}
        onSearch={setSearch}
        actionLabel="Add to tracker"
      />
      <div class="flex flex-col gap-6 px-4 py-6 wide:flex-row wide:px-7">
        <div class="flex min-w-0 flex-1 flex-col gap-5">
          <Developments state={digest} rows={rows} total={all.length} />
          <ModelTracker />
        </div>
        <div class="flex w-full flex-col gap-4 wide:w-[352px] wide:shrink-0">
          <Policy />
          <ResearchRadar />
          <InfraBusiness state={digest} />
          <WatchedTopics titles={all.map((i) => i.title)} />
        </div>
      </div>
    </>
  );
}

function Developments({ state, rows, total }: { state: ReturnType<typeof useDigest>; rows: LiteItem[]; total: number }) {
  const now = Date.now();
  return (
    <Card title="Material developments" sub={state.status === 'ready' ? `deduplicated · ${total} stories, ranked by importance` : undefined} right={<span class="text-[12px] text-muted">Sort: Impact</span>} testId="tech-developments">
      <div class="border-t border-line">
        {state.status !== 'ready' ? (
          <SourceState state={state} source="news digest (tech edition)" />
        ) : rows.length === 0 ? (
          <p class="px-5 py-4 text-[12px] text-dim">No developments match this filter.</p>
        ) : (
          rows.slice(0, 5).map((item, index) => {
            const type = techType(item.category);
            const Icon = TYPE_ICON[type] ?? Cpu;
            const pill = evidencePill(item);
            const reports = sourceCount(item);
            return (
              <a
                key={item.link}
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                class={cx('flex gap-4 border-b border-line px-5 py-[14px] last:border-b-0 hover:bg-surface-2/50', index === 0 && 'bg-surface-2')}
                data-development
              >
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] border border-line bg-bg text-muted">
                  <Icon size={15} strokeWidth={1.5} />
                </span>
                <span class="flex min-w-0 flex-1 flex-col gap-[5px]">
                  <span class="flex items-center gap-2">
                    <span class="font-mono text-[10px] font-medium tracking-[0.8px] text-tech">{type}</span>
                    <span class="text-[11px] text-dim">{relativeTime(item.publishedAt, now)}</span>
                  </span>
                  <span class="text-[14px] font-medium leading-5 text-ink">{item.title}</span>
                  {cleanSnippet(item) ? <span class="line-clamp-2 text-[12px] leading-[17px] text-muted">{cleanSnippet(item)}</span> : null}
                  <span class="text-[11.5px] text-dim">{item.source} · {reports} report{reports === 1 ? '' : 's'}</span>
                </span>
                <span class="flex w-[132px] shrink-0 flex-col items-end gap-2">
                  <span class={cx('flex items-center gap-[5px] rounded-[4px] border px-2 py-[3px] text-[11px] font-medium', TEXT[pill.tone], pill.tone === 'ok' ? 'border-ok' : 'border-high')}>
                    <pill.Icon size={11} strokeWidth={2} />
                    {pill.label}
                  </span>
                  <span class="flex items-center gap-[6px]">
                    <span class="text-[11px] text-dim">impact</span>
                    <span class="font-mono text-[14px] font-medium text-ink">{Math.min(100, Math.round(item.importanceScore))}</span>
                  </span>
                </span>
              </a>
            );
          })
        )}
      </div>
    </Card>
  );
}

const EVAL_TONE: Record<string, Tone> = { high: 'high', elev: 'elev', ok: 'ok', muted: 'muted' };

function ModelTracker() {
  return (
    <Card title="Model & product tracker" sub="claims vs. independent evaluation" right={<SampleBadge title="No model-release source yet. These are the design sample rows." />} testId="model-tracker">
      <div class="hidden h-7 items-center gap-[14px] border-y border-line bg-bg px-5 md:flex">
        <ColLabel class="flex-1">MODEL</ColLabel>
        <ColLabel class="w-[72px]">RELEASED</ColLabel>
        <ColLabel class="w-24">ACCESS</ColLabel>
        <ColLabel class="w-[150px]">CLAIMED</ColLabel>
        <ColLabel class="w-32">INDEPENDENT EVAL</ColLabel>
      </div>
      {SAMPLE_MODELS.map((m) => (
        <div key={m.name} class="flex flex-wrap items-center gap-x-[14px] gap-y-1 border-b border-line px-5 py-[11px] last:border-b-0" data-sample-row>
          <span class="flex min-w-0 flex-1 basis-full flex-col gap-[2px] md:basis-0">
            <span class="flex items-center gap-2">
              <span class="text-[13px] font-medium text-ink">{m.name}</span>
              {m.isNew ? <span class="rounded-[3px] bg-tech/15 px-[5px] py-px font-mono text-[9px] font-semibold text-tech">NEW</span> : null}
            </span>
            <span class="text-[11.5px] text-dim">{m.org}</span>
          </span>
          <span class="font-mono text-[12px] text-muted md:w-[72px]">{m.released}</span>
          <span class="text-[12px] text-muted md:w-24">{m.access}</span>
          <span class="text-[12px] text-muted md:w-[150px]">{m.claimed}</span>
          <span class="flex items-center gap-[6px] md:w-32">
            <Dot tone={EVAL_TONE[m.evalTone] ?? 'muted'} />
            <span class={cx('text-[12px] font-medium', TEXT[EVAL_TONE[m.evalTone] ?? 'muted'])}>{m.evalLabel}</span>
          </span>
        </div>
      ))}
    </Card>
  );
}

const ACTION_STATUS: Record<string, { label: string; tone: Tone }> = {
  'law-passed': { label: 'Law passed', tone: 'ok' },
  'executive-order': { label: 'Executive order', tone: 'high' },
  guideline: { label: 'Guidance', tone: 'ok' },
  enforcement: { label: 'Enforcement', tone: 'crit' },
  consultation: { label: 'Consultation', tone: 'elev' },
};

function jurisdiction(country: string): string {
  const map: Record<string, string> = { 'European Union': 'EU', 'United States': 'US', 'United Kingdom': 'UK', China: 'CN', Japan: 'JP', Canada: 'CA', India: 'IN', 'South Korea': 'KR', Brazil: 'BR', Singapore: 'SG' };
  return map[country] ?? country.slice(0, 2).toUpperCase();
}

function Policy() {
  const actions = getLatestActions(4);
  const next = getUpcomingDeadlines()[0];
  return (
    <Panel title="Policy & governance" sub="curated" right={<span class="font-mono text-[10px] text-dim" title="From src/config/ai-regulations.ts, a hand-maintained list.">STATIC LIST</span>} testId="policy">
      {actions.map((a) => {
        const status = ACTION_STATUS[a.type] ?? { label: a.type, tone: 'muted' as Tone };
        return (
          <a key={a.id} href={a.sourceUrl} target="_blank" rel="noopener noreferrer" class="flex items-center gap-[10px] hover:opacity-90">
            <span class="flex h-[22px] w-[30px] shrink-0 items-center justify-center rounded-[4px] border border-line font-mono text-[10.5px] font-semibold text-muted">{jurisdiction(a.country)}</span>
            <span class="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span class="truncate text-[12.5px] font-medium text-ink">{a.title}</span>
              <span class="font-mono text-[11px] text-dim">{new Date(`${a.date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}</span>
            </span>
            <span class="flex items-center gap-[5px]">
              <Dot tone={status.tone} />
              <span class={cx('text-[11px]', TEXT[status.tone])}>{status.label}</span>
            </span>
          </a>
        );
      })}
      {next ? (
        <p class="text-[11px] text-dim">
          Next deadline: {next.regulation.shortName}, {next.deadline.date}
        </p>
      ) : null}
    </Panel>
  );
}

function ResearchRadar() {
  const arxiv = useArxiv();
  const hn = useHackerNews();
  const hnTitles = hn.status === 'ready' ? hn.data.map((i) => i.title.toLowerCase()) : [];
  const papers = arxiv.status === 'ready' ? [...arxiv.data].sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 3) : [];
  return (
    <Panel title="Research radar" sub="arXiv cs.AI" right={<DerivedTag how="Signal: 1 bar for a new preprint, 3 when its title also appears on the Hacker News front page." />} testId="research-radar">
      {arxiv.status !== 'ready' ? (
        <SourceState state={arxiv} source="arXiv (seed-research)" pad={false} />
      ) : (
        papers.map((p) => {
          const discussed = hnTitles.some((t) => t.includes(p.title.toLowerCase().slice(0, 40)));
          const bars = discussed ? 3 : 1;
          return (
            <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" class="flex gap-[10px] hover:opacity-90">
              <span class="flex h-4 items-end gap-[2px] pt-[3px]" role="img" aria-label={`signal ${bars} of 3`}>
                {[6, 10, 14].map((h, i) => (
                  <span key={h} class={cx('w-[3px] rounded-[1px]', i < bars ? 'bg-tech' : 'bg-track')} style={{ height: h }} />
                ))}
              </span>
              <span class="flex min-w-0 flex-col gap-[2px]">
                <span class="line-clamp-2 text-[12.5px] leading-[18px] text-ink">{p.title}</span>
                <span class={cx('text-[11px]', discussed ? 'text-ok' : 'text-dim')}>
                  {discussed ? 'discussed on Hacker News' : 'preprint · no replication tracked'} · {relativeTime(p.publishedAt, Date.now())}
                </span>
              </span>
            </a>
          );
        })
      )}
    </Panel>
  );
}

function InfraBusiness({ state }: { state: ReturnType<typeof useDigest> }) {
  const deals = state.status === 'ready' ? digestItems(state.data, ['funding', 'hardware', 'cloud']).sort(byImportance).slice(0, 3) : [];
  return (
    <Panel title="Infrastructure & business" right={<SampleBadge title="The KPI tiles have no source yet: design sample values. The stories below are live." />} testId="infra-business">
      <div>
        <div class="grid grid-cols-3 gap-px overflow-hidden rounded-[7px] border border-line bg-line">
          {SAMPLE_INFRA_KPIS.map((k) => (
            <div key={k.key} class="flex flex-col gap-[2px] bg-bg p-[10px]">
              <span class="text-[10.5px] text-dim">{k.key}</span>
              <span class="font-mono text-[17px] font-medium text-ink">{k.value}</span>
              <span class={cx('font-mono text-[10.5px]', k.tone === 'ok' ? 'text-ok' : 'text-muted')}>{k.delta}</span>
            </div>
          ))}
        </div>
      </div>
      {state.status !== 'ready' ? (
        <SourceState state={state} source="news digest (tech edition)" pad={false} />
      ) : (
        deals.map((d) => (
          <a key={d.link} href={d.link} target="_blank" rel="noopener noreferrer" class="flex flex-col gap-[2px] hover:opacity-90">
            <span class="text-[12px] text-ink">{d.title}</span>
            <span class="text-[11px] text-dim">{relativeTime(d.publishedAt, Date.now())} · {d.source} · {claimStatus(d) === 'unverified' ? 'single source' : 'corroborated'}</span>
          </a>
        ))
      )}
    </Panel>
  );
}

function WatchedTopics({ titles }: { titles: string[] }) {
  const counts = topicCounts(WATCHED_TOPICS, titles);
  return (
    <Panel title="Watched topics" right={<DerivedTag how="Title matches in the tech digest. Editing topics arrives with watchlists." />} testId="watched-topics">
      <div class="flex flex-wrap gap-[6px]">
        {WATCHED_TOPICS.map((t, i) => {
          const n = counts[i] ?? 0;
          const hot = n >= 2;
          return (
            <span key={t.label} class={cx('flex items-center gap-[6px] rounded-[5px] border bg-bg px-[9px] py-[5px]', hot ? 'border-tech/40' : 'border-line')}>
              <span class={cx('text-[11.5px]', hot ? 'text-ink' : 'text-muted')}>{t.label}</span>
              <span class={cx('font-mono text-[10.5px]', hot ? 'text-tech' : 'text-dim')}>{n}</span>
            </span>
          );
        })}
      </div>
      <p class="text-[11px] text-dim">Highlighted topics appear in two or more stories in the current digest.</p>
    </Panel>
  );
}
