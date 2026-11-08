import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { Check, CircleAlert, CircleCheck, TriangleAlert, X } from 'lucide-preact';
import { Topbar, matchesSearch } from '../components/Topbar';
import { BORDER, Card, ColLabel, Dot, Panel, SegmentedControl, TEXT, cx } from '../components/ui';
import { useConnectorRows, useHealth } from '../data/hooks';
import {
  CONNECTORS,
  licenceTally,
  minutesLabel,
  needsAttention,
  tierRows,
  type ConnectorDomain,
  type ConnectorRow,
  type ConnectorStatus,
  type ConnectorStatusKind,
  type Licence,
} from '../data/connectors';
import type { Tone } from '../data/transforms';
import { utcClock } from '../format';

type Filter = 'all' | 'attention';

const STATUS_TONE: Readonly<Record<ConnectorStatusKind, Tone>> = { failing: 'crit', degraded: 'high', unknown: 'dim', loading: 'dim', live: 'ok' };
const STATUS_LABEL: Readonly<Record<ConnectorStatusKind, string>> = {
  failing: 'Failing', degraded: 'Degraded', unknown: 'Unknown', loading: 'Checking', live: 'Live',
};
const DOMAIN_LABEL: Readonly<Record<ConnectorDomain, string>> = { geo: 'GEO', fin: 'FIN', tech: 'AI', all: 'ALL' };
const DOMAIN_DOT: Readonly<Record<ConnectorDomain, string>> = { geo: 'bg-geo', fin: 'bg-fin', tech: 'bg-tech', all: 'bg-muted' };
const ROW_TINT: Readonly<Partial<Record<ConnectorStatusKind, string>>> = { failing: 'bg-crit/5', degraded: 'bg-high/5' };
const LICENCE_LABEL: Readonly<Record<Licence, string>> = { reviewed: 'Reviewed', 'terms-review': 'Terms review', excluded: 'Excluded' };
const LICENCE_TONE: Readonly<Record<Licence, Tone>> = { reviewed: 'ok', 'terms-review': 'elev', excluded: 'dim' };

/** 52 → "52m ago", 130 → "2h ago", 4000 → "3d ago". */
function ageLabel(min: number): string {
  if (min < 1) return 'just now';
  if (min < 60) return `${Math.round(min)}m ago`;
  const hours = Math.round(min / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

/** The "Last update" cell: the data's age when known, else what the health gate guarantees. */
function lastUpdate(row: ConnectorRow): { text: string; tone: Tone } {
  const { status, connector } = row;
  if (status.ageMin != null) {
    return { text: ageLabel(status.ageMin), tone: status.kind === 'failing' ? 'crit' : status.kind === 'degraded' ? 'high' : 'muted' };
  }
  if (status.kind === 'live' && connector.maxStaleMin != null) return { text: `within ${minutesLabel(connector.maxStaleMin)}`, tone: 'dim' };
  return { text: '—', tone: 'dim' };
}

export function Sources() {
  const rows = useConnectorRows();
  const health = useHealth();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const attention = rows.filter((r) => needsAttention(r.status)).length;
  const live = rows.filter((r) => r.status.kind === 'live').length;
  const visible = rows.filter(
    (r) =>
      (filter === 'all' || needsAttention(r.status))
      && matchesSearch(search, r.connector.name, r.connector.kind, r.connector.producer, r.connector.method, DOMAIN_LABEL[r.connector.domain], ...r.connector.hosts.map((h) => h.host)),
  );
  // The detail panel shows the clicked row, else the first row: a failing one when there is one.
  const selected = rows.find((r) => r.connector.id === selectedId) ?? rows[0];
  const checked = health.status === 'ready' ? utcClock(health.data.checkedAt).slice(0, 5) : null;

  return (
    <>
      <Topbar
        title="Sources & ingestion"
        subtitle={
          <>
            {CONNECTORS.length} connectors · {live} live · {attention} degraded
            {checked ? ` · health checked ${checked} UTC` : health.status === 'loading' ? ' · checking health' : ' · health check unavailable'}
          </>
        }
        filter={
          <SegmentedControl
            label="Connector filter"
            options={[
              { value: 'all', label: <>All <span class="font-mono text-dim">{rows.length}</span></> },
              {
                value: 'attention',
                label: (
                  <>
                    <Dot tone={attention > 0 ? 'high' : 'dim'} />
                    Degraded <span class="font-mono text-dim">{attention}</span>
                  </>
                ),
              },
            ]}
            value={filter}
            onChange={setFilter}
          />
        }
        search={search}
        onSearch={setSearch}
        searchWidth={240}
        searchPlaceholder="Search sources, hosts, seeders"
      />
      {/* Phone order: connectors, the selected connector, licensing, tiers. Wide: tiers under connectors. */}
      <div class="flex flex-col gap-5 px-4 py-6 wide:grid wide:grid-cols-[minmax(0,1fr)_352px] wide:items-start wide:gap-x-6 wide:px-7">
        <div class="min-w-0 wide:col-start-1 wide:row-start-1">
          <Connectors rows={visible} total={rows.length} selectedId={selected?.connector.id} onSelect={setSelectedId} />
        </div>
        <div class="flex flex-col gap-4 wide:col-start-2 wide:row-span-2 wide:row-start-1">
          {selected ? <ConnectorDetail row={selected} /> : null}
          <Licensing />
        </div>
        <div class="min-w-0 wide:col-start-1 wide:row-start-2">
          <TierPolicy />
        </div>
      </div>
    </>
  );
}

function StatusCell({ status }: { status: ConnectorStatus }) {
  const tone = STATUS_TONE[status.kind];
  return (
    <span class={cx('flex items-center gap-[6px] text-[12.5px]', status.kind === 'live' ? 'text-ok' : TEXT[tone])} title={status.detail}>
      <Dot tone={tone} />
      {STATUS_LABEL[status.kind]}
    </span>
  );
}

function Connectors({
  rows, total, selectedId, onSelect,
}: { rows: ConnectorRow[]; total: number; selectedId?: string; onSelect: (id: string) => void }) {
  return (
    <Card
      title="Connectors"
      sub="sorted by status, then domain"
      right={<span class="font-mono text-[11px] text-dim">Showing {rows.length} of {total}</span>}
      testId="connectors"
    >
      <div class="overflow-x-auto border-t border-line">
        <table class="w-full border-collapse text-left sm:min-w-[640px]">
          <thead>
            <tr class="border-b border-line">
              <th class="px-4 py-[10px] font-normal sm:px-5"><ColLabel>SOURCE</ColLabel></th>
              <th class="hidden px-3 py-[10px] font-normal sm:table-cell"><ColLabel>METHOD</ColLabel></th>
              <th class="hidden px-3 py-[10px] font-normal sm:table-cell" title="The health check fails data older than this."><ColLabel>MAX AGE</ColLabel></th>
              <th class="whitespace-nowrap px-3 py-[10px] font-normal"><ColLabel>LAST UPDATE</ColLabel></th>
              <th class="px-5 py-[10px] font-normal"><ColLabel>STATUS</ColLabel></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const { connector, status } = row;
              const update = lastUpdate(row);
              const selected = connector.id === selectedId;
              return (
                <tr
                  key={connector.id}
                  class={cx('cursor-pointer border-b border-line last:border-b-0', selected ? 'bg-surface-2' : ROW_TINT[status.kind], 'hover:bg-surface-2')}
                  onClick={() => onSelect(connector.id)}
                  data-connector={connector.id}
                  data-status={status.kind}
                  aria-selected={selected}
                >
                  <td class="px-4 py-3 sm:px-5">
                    <button type="button" class="flex flex-col items-start gap-[3px] text-left" onClick={() => onSelect(connector.id)}>
                      <span class="flex items-center gap-2 text-[13.5px] text-ink">
                        <span class={cx('h-[6px] w-[6px] shrink-0 rounded-full', DOMAIN_DOT[connector.domain])} aria-hidden="true" />
                        {connector.name}
                      </span>
                      <span class="pl-[14px] text-[11.5px] text-dim">
                        {DOMAIN_LABEL[connector.domain]} · {connector.kind}
                      </span>
                    </button>
                  </td>
                  <td class="hidden px-3 py-3 font-mono text-[12px] text-muted sm:table-cell">{connector.method}</td>
                  <td class="hidden px-3 py-3 font-mono text-[12px] text-muted sm:table-cell">
                    {connector.maxStaleMin != null ? minutesLabel(connector.maxStaleMin) : 'on load'}
                  </td>
                  <td class={cx('px-3 py-3 font-mono text-[12px]', TEXT[update.tone])}>{update.text}</td>
                  <td class="px-5 py-3">
                    <StatusCell status={status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? <p class="px-5 py-4 text-[12px] text-dim">No connector matches.</p> : null}
      </div>
    </Card>
  );
}

function Stat({ label, value, tone = 'muted' }: { label: string; value: string; tone?: Tone }) {
  return (
    <div class="flex min-w-0 flex-col gap-1">
      <span class="text-[11px] text-dim">{label}</span>
      <span class={cx('truncate font-mono text-[14px]', tone === 'muted' ? 'text-ink' : TEXT[tone])}>{value}</span>
    </div>
  );
}

function ConnectorDetail({ row }: { row: ConnectorRow }) {
  const { connector, status } = row;
  const tone = STATUS_TONE[status.kind];
  const alert = needsAttention(status);
  const third =
    status.feeds ? <Stat label="Feeds" value={`${status.feeds.completed} / ${status.feeds.total}`} />
    : status.records != null ? <Stat label="Records" value={String(status.records)} />
    : <Stat label="Health" value={status.kind === 'live' ? 'OK' : '—'} tone={status.kind === 'live' ? 'ok' : 'muted'} />;
  return (
    <section
      class={cx('flex flex-col gap-4 rounded-[10px] border bg-surface px-4 pb-4 pt-[14px]', alert ? BORDER[tone] : 'border-line')}
      data-testid="connector-detail"
      data-connector={connector.id}
    >
      <header class="flex items-start gap-2">
        <span class={cx('mt-[2px]', TEXT[tone])}>{alert ? <CircleAlert size={15} strokeWidth={1.8} /> : <CircleCheck size={15} strokeWidth={1.8} />}</span>
        <h2 class="text-[13px] font-semibold text-ink">{connector.name}</h2>
        <span class={cx('ml-auto shrink-0 font-mono text-[11px]', TEXT[tone])}>
          {STATUS_LABEL[status.kind].toLowerCase()}
          {status.ageMin != null && alert ? ` ${ageLabel(status.ageMin).replace(' ago', '')}` : ''}
        </span>
      </header>
      <div class="grid grid-cols-3 gap-3">
        <Stat label="Last update" value={status.updatedAt ? utcClock(status.updatedAt).slice(0, 5) : '—'} />
        <Stat label="Max age" value={connector.maxStaleMin != null ? minutesLabel(connector.maxStaleMin) : 'on load'} />
        {third}
      </div>
      <div class="flex flex-col gap-[6px] rounded-[6px] bg-bg px-3 py-[10px] font-mono text-[11.5px] leading-[18px] text-muted">
        <div class="flex justify-between gap-3">
          <span class="text-dim">health</span>
          <span class={TEXT[tone]}>{status.detail}</span>
        </div>
        {status.errorCode ? (
          <div class="flex justify-between gap-3">
            <span class="text-dim">error</span>
            <span class="break-all text-right text-crit">{status.errorCode}</span>
          </div>
        ) : null}
        {status.consecutiveFailures ? (
          <div class="flex justify-between gap-3">
            <span class="text-dim">failed attempts</span>
            <span class="text-high">{status.consecutiveFailures} in a row</span>
          </div>
        ) : null}
        <div class="flex justify-between gap-3">
          <span class="text-dim">producer</span>
          <span class="truncate">{connector.producer}</span>
        </div>
        <div class="flex justify-between gap-3">
          <span class="text-dim">method</span>
          <span>{connector.method}</span>
        </div>
      </div>
      <div class="flex flex-col gap-[6px]">
        <span class="text-[11px] text-dim">{alert ? 'These widgets may show partial or old data' : 'Used by'}</span>
        <div class="flex flex-wrap gap-[6px]">
          {connector.usedBy.map((use) => (
            <span key={use} class="rounded-[4px] border border-line px-[6px] py-[2px] text-[11.5px] text-muted">{use}</span>
          ))}
        </div>
      </div>
      <div class="flex flex-col gap-[6px]">
        <span class="text-[11px] text-dim">Upstream</span>
        {connector.hosts.length ? (
          <ul class="flex flex-col gap-1">
            {connector.hosts.map((h) => (
              <li key={h.host} class="flex items-center justify-between gap-3 text-[12px]">
                <span class="truncate font-mono text-muted">{h.host}</span>
                <span class={cx('shrink-0 text-[11px]', TEXT[LICENCE_TONE[h.licence]])}>{LICENCE_LABEL[h.licence]}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="text-[12px] text-dim">
            {connector.digest ? 'The digest’s RSS publishers; see the tier policy.' : 'Computed server-side from other datasets.'}
          </p>
        )}
      </div>
    </section>
  );
}

function Licensing() {
  const tally = licenceTally();
  const total = tally.reviewed.length + tally['terms-review'].length + tally.excluded.length;
  const rows: Array<{ licence: Licence; icon: ComponentChildren; title: string; sub: string }> = [
    { licence: 'reviewed', icon: <Check size={15} strokeWidth={1.8} />, title: 'Reviewed', sub: tally.reviewed.join(', ') || 'none' },
    { licence: 'terms-review', icon: <TriangleAlert size={15} strokeWidth={1.8} />, title: 'Terms under review', sub: 'Verify the provider’s terms before redistributing' },
    { licence: 'excluded', icon: <X size={15} strokeWidth={1.8} />, title: 'Excluded from the provider count', sub: `Infrastructure, not a data source: ${tally.excluded.join(', ') || 'none'}` },
  ];
  return (
    <Panel title="Licensing & terms" sub={`${total} upstream hosts`} testId="licensing">
      <ul class="flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.licence} class="flex gap-3" data-licence={r.licence}>
            <span class={cx('mt-[2px]', TEXT[LICENCE_TONE[r.licence]])}>{r.icon}</span>
            <span class="flex min-w-0 flex-col gap-[2px]">
              <span class="text-[13px] text-ink">
                {r.title} <span class="font-mono text-[12px] text-muted">{tally[r.licence].length}</span>
              </span>
              <span class="text-[11.5px] text-dim">{r.sub}</span>
            </span>
          </li>
        ))}
      </ul>
      <p class="text-[11px] leading-[16px] text-dim">
        Status per host from shared/source-attribution-manifest.json. The news digests’ publishers are not counted here.
      </p>
    </Panel>
  );
}

const TIER_TONE: Readonly<Record<1 | 2 | 3 | 4, Tone>> = { 1: 'ok', 2: 'muted', 3: 'elev', 4: 'dim' };

function TierPolicy() {
  const tiers = useMemo(() => tierRows(), []);
  const outlets = tiers.reduce((sum, t) => sum + t.outlets, 0);
  return (
    <Card title="Source tier policy" sub={`${outlets} news outlets · shared/source-tiers.json`} testId="tier-policy">
      <div class="grid grid-cols-1 border-t border-line sm:grid-cols-2 wide:grid-cols-4">
        {tiers.map((t) => (
          <div key={t.tier} class="flex gap-3 border-b border-line px-5 py-4 last:border-b-0 sm:border-r wide:border-b-0" data-tier={t.tier}>
            <span
              class={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] border font-mono text-[12px]', BORDER[TIER_TONE[t.tier]], TEXT[TIER_TONE[t.tier]])}
            >
              {t.tier}
            </span>
            <span class="flex min-w-0 flex-col gap-1">
              <span class="text-[13px] font-medium text-ink">
                Tier {t.tier} <span class="font-mono text-[11.5px] font-normal text-dim">{t.outlets}</span>
              </span>
              <span class="text-[12px] leading-[17px] text-muted">{t.meaning}</span>
              <span class="text-[11.5px] leading-[16px] text-dim">{t.inLite}</span>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
