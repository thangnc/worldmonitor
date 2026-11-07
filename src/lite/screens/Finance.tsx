import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import type { CryptoQuote } from '@/generated/client/worldmonitor/market/v1/service_client';
import { Topbar, matchesSearch } from '../components/Topbar';
import { BarStrip, LineChart } from '../components/charts';
import { Card, ColLabel, DerivedTag, Dot, Panel, SampleBadge, SegmentedControl, SourceState, TEXT, cx } from '../components/ui';
import {
  selectMarketEvents,
  useCommodityQuotes,
  useCorrelationSeries,
  useCryptoQuotes,
  useDigest,
  useEtfFlows,
  useFearGreed,
  useGoldIntelligence,
  useHyperliquid,
  useMacroCalendar,
  useMarketQuotes,
  useStablecoins,
} from '../data/hooks';
import { SAMPLE_BTC_VOLUME, SAMPLE_LIQUIDATIONS } from '../data/fixtures';
import {
  closeToCloseBars,
  fearGreedState,
  marketTag,
  pctChange,
  realizedVolatility,
  relativeTime,
  returnCorrelation,
  sourceCount,
  thresholdState,
  type AlertState,
  type Tone,
} from '../data/transforms';
import { MINUS, price, signed, usdCompact } from '../format';

type Range = '1D' | '2D';
const RANGE_OPTIONS = [
  { value: '1D', label: '1D' },
  { value: '2D', label: '2D' },
  { value: '1W', label: '1W', disabled: true, title: 'No hourly history beyond 48h in this build' },
  { value: '1M', label: '1M', disabled: true, title: 'No hourly history beyond 48h in this build' },
  { value: '1Y', label: '1Y', disabled: true, title: 'No hourly history beyond 48h in this build' },
] as const;

const changeTone = (v: number | null | undefined): string => (v == null ? 'text-dim' : v < 0 ? 'text-crit' : 'text-ok');

export function Finance() {
  const [range, setRange] = useState<Range>('1D');
  const [search, setSearch] = useState('');
  const digest = useDigest('finance');
  const events = useMemo(() => (digest.status === 'ready' ? selectMarketEvents(digest.data) : []), [digest]);

  return (
    <>
      <Topbar
        title="Finance & Crypto"
        subtitle={<>Seeded quotes · {digest.status === 'ready' ? `${events.length} market-moving stories` : 'loading stories'} · not investment advice</>}
        filter={
          <SegmentedControl
            label="Chart range"
            mono
            options={RANGE_OPTIONS}
            value={range}
            onChange={(v) => (v === '1D' || v === '2D') && setRange(v)}
          />
        }
        search={search}
        onSearch={setSearch}
        searchWidth={240}
        actionLabel="New alert rule"
      />
      <div class="flex flex-col gap-6 px-4 py-6 wide:flex-row wide:px-7">
        <div class="flex min-w-0 flex-1 flex-col gap-5">
          <Tickers />
          <BtcDetail range={range} />
          <MarketEvents state={digest} events={events.filter((e) => matchesSearch(search, e.title, e.source, e.tickers.join(' ')))} />
        </div>
        <div class="flex w-full flex-col gap-4 wide:w-[352px] wide:shrink-0">
          <RiskAlerts />
          <MacroCalendar search={search} />
          <Correlation />
          <p class="text-[11px] leading-[17px] text-dim">
            Market data shown for monitoring and context only. Analysis, not investment advice. Prices are the latest seeded quotes and may lag their providers.
          </p>
        </div>
      </div>
    </>
  );
}

interface Ticker {
  symbol: string;
  cls: string;
  value: string;
  change: string;
  changeValue: number | null;
}

function Tickers() {
  const crypto = useCryptoQuotes();
  const equities = useMarketQuotes();
  const commodities = useCommodityQuotes();
  const gold = useGoldIntelligence();

  const find = (list: ReadonlyArray<{ symbol: string; price: number; change: number }> | null, symbol: string) =>
    list?.find((q) => q.symbol.toUpperCase() === symbol.toUpperCase());
  const cryptoList = crypto.status === 'ready' ? crypto.data : null;
  const equityList = equities.status === 'ready' ? equities.data : null;
  const commodityList = commodities.status === 'ready' ? commodities.data : null;
  const dxy = gold.status === 'ready' ? gold.data.drivers.find((d) => /dxy|dollar/i.test(d.label) || d.symbol.startsWith('DX')) : undefined;
  const tnx = find(equityList, '^TNX');

  const tile = (symbol: string, cls: string, q: { price: number; change: number } | undefined, fmt = price): Ticker => ({
    symbol,
    cls,
    value: q ? fmt(q.price) : '—',
    change: q ? `${signed(q.change)} 24h` : '—',
    changeValue: q ? q.change : null,
  });

  let tenYear: Ticker = { symbol: 'US 10Y', cls: 'Rates', value: '—', change: '—', changeValue: null };
  if (tnx) {
    const prev = tnx.price / (1 + tnx.change / 100);
    const bp = (tnx.price - prev) * 100;
    tenYear = { symbol: 'US 10Y', cls: 'Rates', value: `${tnx.price.toFixed(2)}%`, change: `${bp < 0 ? MINUS : '+'}${Math.abs(bp).toFixed(0)}bp 24h`, changeValue: bp };
  }

  const tickers: Ticker[] = [
    tile('BTC', 'Crypto', find(cryptoList, 'BTC')),
    tile('ETH', 'Crypto', find(cryptoList, 'ETH')),
    tile('S&P 500', 'Equities', find(equityList, '^GSPC')),
    tile('Brent', 'Commodities', find(commodityList, 'BZ=F')),
    dxy ? { symbol: 'DXY', cls: 'FX', value: dxy.value.toFixed(1), change: `${signed(dxy.changePct)} 24h`, changeValue: dxy.changePct } : { symbol: 'DXY', cls: 'FX', value: '—', change: '—', changeValue: null },
    tenYear,
  ];

  return (
    <div class="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-line bg-line sm:grid-cols-3 md:grid-cols-6" data-testid="ticker-strip">
      {tickers.map((t, i) => (
        <div key={t.symbol} class={cx('flex flex-col gap-1 px-[14px] py-3', i === 0 ? 'border-b-2 border-ink bg-surface-2' : 'bg-surface')}>
          <div class="flex items-center justify-between">
            <span class="text-[12px] font-semibold text-ink">{t.symbol}</span>
            <span class="font-mono text-[10px] text-dim">{t.cls}</span>
          </div>
          <span class="font-mono text-[19px] font-medium text-ink">{t.value}</span>
          <span class={cx('font-mono text-[11.5px] font-medium', changeTone(t.changeValue))}>{t.change}</span>
        </div>
      ))}
    </div>
  );
}

type ChartTab = 'price' | 'funding' | 'oi';

function BtcDetail({ range }: { range: Range }) {
  const crypto = useCryptoQuotes();
  const flow = useHyperliquid();
  const [tab, setTab] = useState<ChartTab>('price');
  const btc: CryptoQuote | undefined = crypto.status === 'ready' ? crypto.data.find((q) => q.symbol.toUpperCase() === 'BTC') : undefined;
  const hlBtc = flow.status === 'ready' ? flow.data.assets.find((a) => a.symbol.toUpperCase() === 'BTC') : undefined;
  const closes = (btc?.sparkline ?? []).slice(range === '1D' ? -25 : -49);
  const bars = closeToCloseBars(closes);
  const lo = closes.length ? Math.min(...closes) : 0;
  const hi = closes.length ? Math.max(...closes) : 0;
  const span = hi - lo || 1;
  const move = closes.length > 1 ? (closes[closes.length - 1] ?? 0) - (closes[0] ?? 0) : null;
  const movePct = closes.length > 1 ? pctChange(closes[0] ?? 0, closes[closes.length - 1] ?? 0) : null;
  const vol = realizedVolatility(btc?.sparkline ?? []);
  const breadth = crypto.status === 'ready' ? { down: crypto.data.filter((q) => q.change < 0).length, total: crypto.data.length } : null;
  const funding = hlBtc ? Number(hlBtc.funding) : null;
  const oiUsd = hlBtc ? Number(hlBtc.openInterest) * Number(hlBtc.markPx) : null;
  const oiSpark = hlBtc?.sparkOi ?? [];
  const oiChange = oiSpark.length > 1 ? pctChange(oiSpark[0] ?? 0, oiSpark[oiSpark.length - 1] ?? 0) : null;
  const tabs: Array<{ key: ChartTab; label: string }> = [
    { key: 'price', label: 'Price' },
    { key: 'funding', label: 'Funding' },
    { key: 'oi', label: 'Open interest' },
  ];

  return (
    <section class="flex flex-col overflow-hidden rounded-[10px] border border-line bg-surface md:flex-row" data-testid="btc-detail">
      <div class="flex min-w-0 flex-1 flex-col gap-3 px-5 pb-[14px] pt-4">
        <div class="flex flex-wrap items-end gap-3">
          <div class="flex flex-col gap-[2px]">
            <span class="text-[11.5px] text-dim">BTC / USD · hourly close-to-close · {range === '1D' ? '24h' : '48h'}</span>
            <div class="flex items-end gap-[10px]">
              <span class="font-mono text-[28px] font-medium leading-[31px] text-ink">{btc ? price(btc.price) : '—'}</span>
              {move != null && movePct != null ? (
                <span class={cx('font-mono text-[13px] font-medium leading-[21px]', changeTone(move))}>
                  {move < 0 ? MINUS : '+'}{price(Math.abs(move))} ({signed(movePct)}) in {range === '1D' ? '24h' : '48h'}
                </span>
              ) : null}
            </div>
          </div>
          <div class="ml-auto flex gap-[14px]" role="tablist" aria-label="BTC chart">
            {tabs.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} class={cx('text-[12px]', tab === t.key ? 'font-medium text-ink' : 'text-dim hover:text-muted')}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {tab === 'price' ? (
          crypto.status !== 'ready' || bars.length === 0 ? (
            <SourceState state={crypto.status === 'ready' ? { status: 'empty', data: null, at: crypto.at } : crypto} source="hourly BTC closes, the crypto quote sparkline (seed-crypto-quotes)" pad={false} />
          ) : (
            <>
              <div class="flex gap-[10px]">
                <div class="flex h-[210px] min-w-0 flex-1 gap-[3px] border-b border-line" role="img" aria-label="BTC hourly close-to-close bars">
                  {bars.map((b, i) => {
                    const top = ((hi - Math.max(b.open, b.close)) / span) * 100;
                    const height = Math.max(0.6, (Math.abs(b.close - b.open) / span) * 100);
                    return <span key={i} class="relative flex-1"><span class={cx('absolute inset-x-0 rounded-[1px]', b.up ? 'bg-ok' : 'bg-crit')} style={{ top: `${top}%`, height: `${height}%` }} /></span>;
                  })}
                </div>
                <div class="flex h-[210px] w-9 flex-col justify-between font-mono text-[10px] text-dim">
                  {[0, 1, 2, 3, 4].map((k) => <span key={k}>{((hi - (span * k) / 4) / 1000).toFixed(1)}k</span>)}
                </div>
              </div>
              <div class="flex items-center gap-2 pr-[46px]">
                <div class="min-w-0 flex-1 opacity-70">
                  <BarStrip values={SAMPLE_BTC_VOLUME.slice(-bars.length)} height={30} gap={3} label="Volume (sample)" colorFor={(i) => (bars[i]?.up ? 'bg-ok/35' : 'bg-crit/35')} />
                </div>
                <SampleBadge title="No volume source yet. Bars are the design sample." />
              </div>
            </>
          )
        ) : (
          <div class="flex flex-col gap-2" data-testid={`btc-${tab}`}>
            {hlBtc ? (
              <>
                <LineChart values={tab === 'funding' ? hlBtc.sparkFunding : hlBtc.sparkOi} height={210} stroke={tab === 'funding' ? 'var(--color-high)' : 'var(--color-fin)'} />
                <span class="text-[11.5px] text-dim">Hyperliquid BTC perpetual, {tab === 'funding' ? 'funding rate' : 'open interest'}, recent polls.</span>
              </>
            ) : (
              <SourceState state={flow.status === 'ready' ? { status: 'empty', data: null, at: flow.at } : flow} source="Hyperliquid flow (seed-hyperliquid-flow)" pad={false} />
            )}
          </div>
        )}
      </div>
      <Derivatives
        funding={funding}
        composite={hlBtc && !hlBtc.warmup ? hlBtc.composite : null}
        warmup={hlBtc?.warmup ?? false}
        oiUsd={oiUsd}
        oiChange={oiChange}
        vol={vol}
        breadth={breadth}
      />
    </section>
  );
}

function Metric({ label, value, sub, subTone = 'muted', badge }: { label: string; value: string; sub: string; subTone?: Tone; badge?: ComponentChildren }) {
  return (
    <div class="flex flex-col gap-[2px]">
      <span class="flex items-center gap-2 text-[11.5px] text-dim">{label}{badge}</span>
      <span class="font-mono text-[16px] font-medium text-ink">{value}</span>
      <span class={cx('text-[11px]', TEXT[subTone])}>{sub}</span>
    </div>
  );
}

function Derivatives({
  funding, composite, warmup, oiUsd, oiChange, vol, breadth,
}: { funding: number | null; composite: number | null; warmup: boolean; oiUsd: number | null; oiChange: number | null; vol: number | null; breadth: { down: number; total: number } | null }) {
  const etf = useEtfFlows();
  const etfSummary = etf.status === 'ready' ? etf.data.summary : undefined;
  return (
    <aside class="flex w-full flex-col gap-[14px] border-t border-line bg-bg px-[18px] py-4 md:w-[220px] md:shrink-0 md:border-l md:border-t-0" data-testid="derivatives">
      <ColLabel>DERIVATIVES & FLOWS</ColLabel>
      <Metric
        label="Perp funding (1h)"
        value={funding != null && Number.isFinite(funding) ? `${funding < 0 ? MINUS : ''}${Math.abs(funding * 100).toFixed(4)}%` : '—'}
        sub={composite != null ? `Hyperliquid · risk score ${Math.round(composite)}/100` : warmup ? 'Hyperliquid · score warming up' : 'Hyperliquid'}
        subTone={funding != null && funding < 0 ? 'crit' : 'muted'}
      />
      <Metric
        label="Open interest"
        value={oiUsd != null && Number.isFinite(oiUsd) ? usdCompact(oiUsd) : '—'}
        sub={oiChange != null ? `${signed(oiChange)} over recent polls` : 'Hyperliquid'}
        subTone={oiChange != null && oiChange < 0 ? 'crit' : 'muted'}
      />
      <Metric label="Liquidations 24h" value={SAMPLE_LIQUIDATIONS.value} sub={SAMPLE_LIQUIDATIONS.sub} subTone="dim" badge={<SampleBadge title="No liquidation data source yet. Design sample." />} />
      <Metric label="48h realized vol" value={vol != null ? `${vol.toFixed(0)}%` : '—'} sub="annualized, hourly closes" badge={<DerivedTag how="Standard deviation of hourly log returns over 48h, annualized." />} />
      <Metric
        label="Spot ETF net flow"
        value={etfSummary ? usdCompact(etfSummary.totalEstFlow) : '—'}
        sub={etfSummary ? `est. from volume · ${etfSummary.netDirection.toLowerCase() || 'flat'}` : etf.status === 'loading' ? 'loading' : 'no data yet'}
        subTone={etfSummary && etfSummary.totalEstFlow < 0 ? 'crit' : 'muted'}
      />
      <Metric label="Breadth" value={breadth ? `${breadth.down} / ${breadth.total}` : '—'} sub="tracked coins down 24h" />
    </aside>
  );
}

function MarketEvents({ state, events }: { state: ReturnType<typeof useDigest>; events: ReturnType<typeof selectMarketEvents> }) {
  const now = Date.now();
  return (
    <Card title="Market-moving events" sub="highest-impact finance stories" right={events.length > 4 ? <span class="text-[12px] font-medium text-ink">{events.length} in digest</span> : undefined} testId="market-events">
      <div class="border-t border-line">
        {state.status !== 'ready' ? (
          <SourceState state={state} source="news digest (finance edition)" />
        ) : events.length === 0 ? (
          <p class="px-5 py-4 text-[12px] text-dim">No market-moving stories match.</p>
        ) : (
          events.slice(0, 4).map((e) => {
            const tag = marketTag(e.category);
            return (
              <a key={e.link} href={e.link} target="_blank" rel="noopener noreferrer" class="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-5 py-3 last:border-b-0 hover:bg-surface-2/50">
                <span class="flex w-[96px] shrink-0 items-center gap-[6px]">
                  <span class={cx('h-[6px] w-[6px] rounded-full', tag.tone === 'geo' ? 'bg-geo' : tag.tone === 'fin' ? 'bg-fin' : 'bg-dim')} />
                  <span class="font-mono text-[10.5px] font-medium tracking-[0.6px] text-muted">{tag.label}</span>
                </span>
                <span class="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <span class="text-[13px] font-medium text-ink">{e.title}</span>
                  <span class="text-[11.5px] text-dim">{e.source} · {sourceCount(e)} report{sourceCount(e) === 1 ? '' : 's'} · {relativeTime(e.publishedAt, now)}</span>
                </span>
                <span class="font-mono text-[11.5px] text-muted md:w-[160px] md:text-right">{e.tickers.length ? e.tickers.slice(0, 3).join(' · ') : `impact ${Math.round(e.importanceScore)}`}</span>
              </a>
            );
          })
        )}
      </div>
    </Card>
  );
}

const ALERT_STYLE: Record<AlertState, { label: string; tone: Tone }> = {
  triggered: { label: 'Triggered', tone: 'crit' },
  watching: { label: 'Watching', tone: 'high' },
  normal: { label: 'Normal', tone: 'dim' },
};

function RiskAlerts() {
  const crypto = useCryptoQuotes();
  const flow = useHyperliquid();
  const stables = useStablecoins();
  const fg = useFearGreed();
  const btc = crypto.status === 'ready' ? crypto.data.find((q) => q.symbol.toUpperCase() === 'BTC') : undefined;
  const hl = flow.status === 'ready' ? flow.data.assets.find((a) => a.symbol.toUpperCase() === 'BTC') : undefined;
  const fundingPct = hl ? Number(hl.funding) * 100 : null;
  const coins = stables.status === 'ready' ? stables.data.stablecoins : [];
  const maxDev = coins.length ? Math.max(...coins.map((c) => Math.abs(c.deviation))) : null;
  const depegged = stables.status === 'ready' ? stables.data.summary?.depeggedCount ?? 0 : 0;

  const rules: Array<{ name: string; detail: string; state: AlertState | null }> = [
    { name: 'Volatility breakout', detail: btc ? `BTC 24h ${signed(btc.change)} · watch 2.5%, fire 4%` : 'BTC quote unavailable', state: thresholdState(btc?.change, 2.5, 4) },
    { name: 'Funding extreme', detail: fundingPct != null ? `BTC perp ${fundingPct.toFixed(4)}%/h · watch 0.005%, fire 0.01%` : 'Hyperliquid unavailable', state: thresholdState(fundingPct, 0.005, 0.01) },
    {
      name: 'Stablecoin depeg',
      detail: coins.length ? `${depegged} of ${coins.length} off peg · max deviation ${maxDev?.toFixed(2)}%` : 'Stablecoin data unavailable',
      state: coins.length ? (depegged > 0 ? 'triggered' : thresholdState(maxDev, 0.5, 1)) : null,
    },
    { name: 'Sentiment extreme', detail: fg.status === 'ready' ? `Fear & greed ${Math.round(fg.data.compositeScore)} (${fg.data.compositeLabel})` : 'Fear & greed unavailable', state: fg.status === 'ready' ? fearGreedState(fg.data.compositeScore) : null },
  ];

  return (
    <Panel title="Risk alerts" sub={`${rules.length} rules`} right={<DerivedTag how="Fixed thresholds over seeded data. Delivery (push, email) arrives with the alerts phase." />} testId="risk-alerts">
      {rules.map((r) => {
        const style = r.state ? ALERT_STYLE[r.state] : { label: 'No data', tone: 'dim' as Tone };
        return (
          <div key={r.name} class={cx('flex items-center gap-[10px] rounded-[7px] border px-3 py-[10px]', r.state === 'triggered' ? 'border-crit/35 bg-crit/[0.07]' : 'border-line')}>
            <span class="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span class="text-[12.5px] font-medium text-ink">{r.name}</span>
              <span class="text-[11px] text-dim">{r.detail}</span>
            </span>
            <span class="flex items-center gap-[5px]">
              <Dot tone={style.tone} />
              <span class={cx('text-[11px] font-medium', r.state === 'normal' || !r.state ? 'text-muted' : TEXT[style.tone])}>{style.label}</span>
            </span>
          </div>
        );
      })}
    </Panel>
  );
}

function MacroCalendar({ search }: { search: string }) {
  const cal = useMacroCalendar();
  const rows = cal.status === 'ready'
    ? cal.data
        .filter((e) => matchesSearch(search, e.event, e.country))
        .sort((a, b) => a.date.localeCompare(b.date))
        .filter((e) => /high|medium/i.test(e.impact))
        .slice(0, 5)
    : [];
  return (
    <Panel title="Macro calendar" sub="next 7 days" testId="macro-calendar">
      <div class="flex gap-2">
        <ColLabel class="w-[50px] text-[9.5px]">DATE</ColLabel>
        <ColLabel class="flex-1 text-[9.5px]">EVENT</ColLabel>
        <ColLabel class="w-12 text-[9.5px]">CONS.</ColLabel>
        <ColLabel class="w-11 text-[9.5px]">PRIOR</ColLabel>
      </div>
      {cal.status !== 'ready' ? (
        <SourceState state={cal} source="economic calendar (seed-economic-calendar)" pad={false} />
      ) : rows.length === 0 ? (
        <p class="text-[12px] text-dim">No medium- or high-impact events this week.</p>
      ) : (
        rows.map((e) => (
          <div key={`${e.date}${e.event}`} class="flex items-center gap-2">
            <span class="w-[50px] font-mono text-[11.5px] text-muted">{new Date(`${e.date.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })}</span>
            <span class="flex min-w-0 flex-1 items-center gap-[6px]">
              <span class="truncate text-[12.5px] text-ink" title={`${e.country} · ${e.event}`}>{e.country ? `${e.country} ` : ''}{e.event}</span>
              {/high/i.test(e.impact) ? <span class="font-mono text-[9px] font-semibold tracking-[0.5px] text-crit">HIGH</span> : null}
            </span>
            <span class="w-12 font-mono text-[11.5px] text-ink">{e.estimate || '—'}</span>
            <span class="w-11 font-mono text-[11.5px] text-dim">{e.previous || '—'}</span>
          </div>
        ))
      )}
    </Panel>
  );
}

const CORRELATION_ASSETS = [
  { symbol: 'BTC-USD', label: 'BTC' },
  { symbol: 'ETH-USD', label: 'ETH' },
  { symbol: '^GSPC', label: 'SPX' },
  { symbol: 'GC=F', label: 'Gold' },
  { symbol: 'CL=F', label: 'Oil' },
] as const;

function Correlation() {
  const series = useCorrelationSeries();
  const assets = series.status === 'ready' ? CORRELATION_ASSETS.filter((a) => series.data[a.symbol]) : [];
  const cell = (r: number | null, same: boolean) => {
    if (same || r == null) return { background: 'var(--color-surface-2)', color: 'var(--color-dim)', text: '—' };
    const alpha = Math.min(0.75, Math.abs(r) * 0.8);
    const rgb = r >= 0 ? '76,195,255' : '255,159,67';
    return { background: `rgba(${rgb},${alpha.toFixed(2)})`, color: alpha > 0.5 ? 'var(--color-bg)' : 'var(--color-muted)', text: r.toFixed(2).replace('-', MINUS) };
  };
  return (
    <Panel title="Correlation" sub="14d · hourly returns" right={<DerivedTag how="Pearson correlation of hourly log returns over the 14-day correlation series. Oil stands in for DXY, which has no hourly series." />} testId="correlation">
      {series.status !== 'ready' || assets.length < 2 ? (
        <SourceState state={series.status === 'ready' ? { status: 'empty', data: null, at: series.at } : series} source="market correlation series (seed-market-correlation-series)" pad={false} />
      ) : (
        <div class="grid gap-[3px]" style={{ gridTemplateColumns: `40px repeat(${assets.length}, minmax(0, 1fr))` }}>
          <span />
          {assets.map((a) => <span key={a.symbol} class="text-center font-mono text-[10px] text-dim">{a.label}</span>)}
          {assets.map((row) => [
            <span key={`${row.symbol}-label`} class="self-center font-mono text-[10px] text-dim">{row.label}</span>,
            ...assets.map((col) => {
              const r = row.symbol === col.symbol ? null : returnCorrelation(series.data[row.symbol] ?? [], series.data[col.symbol] ?? []);
              const c = cell(r, row.symbol === col.symbol);
              return (
                <span key={`${row.symbol}-${col.symbol}`} class="flex h-[26px] items-center justify-center rounded-[3px] font-mono text-[10.5px]" style={{ background: c.background, color: c.color }}>
                  {c.text}
                </span>
              );
            }),
          ])}
        </div>
      )}
    </Panel>
  );
}
