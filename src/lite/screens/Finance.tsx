import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { Bitcoin, MapPin } from 'lucide-preact';
import { Topbar, matchesSearch } from '../components/Topbar';
import { Card, ColLabel, DerivedTag, Panel, SourceState, cx } from '../components/ui';
import { HealthDots, IndicatorCard, IndicatorFeed } from '../components/indicator';
import { LayersPopover, type LayerGroup } from '../components/LayersPopover';
import { LiteMap, PinMark, type MapMarker } from '../map/LiteMap';
import {
  selectMarketEvents,
  useChokepoints,
  useCommodityQuotes,
  useCountryShapes,
  useCryptoQuotes,
  useDigest,
  useEtfFlows,
  useFearGreed,
  useHyperliquid,
  useMacroCalendar,
  useMarketQuotes,
  useMaterialEvents,
  useOtherBonds,
  usePriceBoard,
  useSanctions,
  useShippingRates,
  useStablecoins,
  useTreasuryCurves,
} from '../data/hooks';
import { FINANCE_RULES, financeFeeds } from '../data/finance-indicators';
import { feedCounts, sortFeeds, type FeedState } from '../data/indicators';
import { MACRO_RULES, YIELD_MOVE_BP, bondMoves, financeMacroFeeds, macroValue, spreadBp, treasuryWindow } from '../data/finance-macro-indicators';
import {
  FINANCIAL_CENTRE_POINTS,
  chokepointPins,
  newSanctionCountries,
  pinIdForFeed,
  sanctionFills,
  shippingLanes,
  signalPins,
} from '../data/markets-map';
import { PRICE_LINK_RULE, eventTag, geoCause, linkPriceMoves, priceMoveLabel } from '../data/prices';
import { digestItems, relativeTime, sourceCount } from '../data/transforms';
import { MINUS, price, signed } from '../format';

const changeTone = (v: number | null | undefined): string => (v == null ? 'text-dim' : v < 0 ? 'text-crit' : 'text-ok');

/** Every Finance feed, sorted: fired newest first, then quiet, stale and unavailable. */
function useFinanceFeeds(): FeedState[] {
  const crypto = useCryptoQuotes();
  const flow = useHyperliquid();
  const stables = useStablecoins();
  const fearGreed = useFearGreed();
  const calendar = useMacroCalendar();
  const curves = useTreasuryCurves();
  const bonds = useOtherBonds();
  const etf = useEtfFlows();
  const rates = useShippingRates();
  const filings = useMaterialEvents();
  const digest = useDigest('finance');
  return useMemo(() => {
    const news = digest.status === 'ready' ? digestItems(digest.data) : [];
    const now = Date.now();
    return sortFeeds([
      ...financeFeeds({ crypto, flow, stables, fearGreed, news, now }),
      ...financeMacroFeeds({ calendar, curves, bonds, etf, flow, rates, filings, news, now }),
    ]);
  }, [crypto, flow, stables, fearGreed, calendar, curves, bonds, etf, rates, filings, digest]);
}

export function Finance() {
  const [search, setSearch] = useState('');
  const [focus, setFocus] = useState<string | null>(null);
  const digest = useDigest('finance');
  const events = useMemo(() => (digest.status === 'ready' ? selectMarketEvents(digest.data) : []), [digest]);
  const feeds = useFinanceFeeds();

  return (
    <>
      <Topbar
        title="Finance & Crypto"
        subtitle={<>1D · seeded quotes · {digest.status === 'ready' ? `${events.length} market-moving stories` : 'loading stories'} · not investment advice</>}
        search={search}
        onSearch={setSearch}
        searchWidth={240}
        actionLabel="New alert rule"
      />
      <div class="flex flex-col gap-6 px-4 py-6 wide:flex-row wide:px-7">
        <div class="flex min-w-0 flex-1 flex-col gap-5">
          <Tickers />
          <MarketsMap feeds={feeds} focus={focus} onFocus={setFocus} />
          <MarketEvents state={digest} events={events.filter((e) => matchesSearch(search, e.title, e.source, e.tickers.join(' ')))} />
          <MacroCalendar search={search} />
        </div>
        <div class="flex w-full flex-col gap-4 wide:w-[352px] wide:shrink-0">
          <Indicators feeds={feeds} onOpen={(feed) => setFocus(pinIdForFeed(feed))} />
          <TreasuryCurve />
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

/** Five tiles, 1D change only (owner's choice: Finance shows the 1D range). */
function Tickers() {
  const crypto = useCryptoQuotes();
  const equities = useMarketQuotes();
  const commodities = useCommodityQuotes();

  const find = (list: ReadonlyArray<{ symbol: string; price: number; change: number }> | null, symbol: string) =>
    list?.find((q) => q.symbol.toUpperCase() === symbol.toUpperCase());
  const cryptoList = crypto.status === 'ready' ? crypto.data : null;
  const equityList = equities.status === 'ready' ? equities.data : null;
  const commodityList = commodities.status === 'ready' ? commodities.data : null;
  const tnx = find(equityList, '^TNX');

  const tile = (symbol: string, cls: string, q: { price: number; change: number } | undefined): Ticker => ({
    symbol,
    cls,
    value: q ? price(q.price) : '—',
    change: q ? `${signed(q.change)} 1D` : '—',
    changeValue: q ? q.change : null,
  });

  let tenYear: Ticker = { symbol: 'US 10Y', cls: 'Rates', value: '—', change: '—', changeValue: null };
  if (tnx) {
    const prev = tnx.price / (1 + tnx.change / 100);
    const bp = (tnx.price - prev) * 100;
    tenYear = { symbol: 'US 10Y', cls: 'Rates', value: `${tnx.price.toFixed(2)}%`, change: `${bp < 0 ? MINUS : '+'}${Math.abs(bp).toFixed(0)}bp 1D`, changeValue: bp };
  }

  const tickers: Ticker[] = [
    tile('BTC', 'Crypto', find(cryptoList, 'BTC')),
    tile('Brent', 'Oil', find(commodityList, 'BZ=F')),
    tile('Gold', 'Metals', find(commodityList, 'GC=F')),
    tile('S&P 500', 'Equities', find(equityList, '^GSPC')),
    tenYear,
  ];

  return (
    <div class="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-line bg-line sm:grid-cols-3 md:grid-cols-5" data-testid="ticker-strip">
      {tickers.map((t) => (
        <div key={t.symbol} class="flex flex-col gap-1 bg-surface px-[14px] py-3" data-ticker={t.symbol}>
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

type MapLayer = 'signals' | 'chokepoints' | 'lanes' | 'sanctions' | 'centres';

const dayMonthUtc = (ts: number | string) => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * "Where markets are moving": Finance signals pinned where they are issued,
 * chokepoints with the price they move, and context layers.
 */
function MarketsMap({ feeds, focus, onFocus }: { feeds: readonly FeedState[]; focus: string | null; onFocus: (id: string | null) => void }) {
  const [layers, setLayers] = useState<Record<MapLayer, boolean>>({ signals: true, chokepoints: true, lanes: true, sanctions: true, centres: true });
  const bonds = useOtherBonds();
  const chokepoints = useChokepoints();
  const sanctions = useSanctions();
  const rates = useShippingRates();
  const board = usePriceBoard();
  const now = Date.now();

  const moves = useMemo(() => (bonds.status === 'ready' ? bondMoves(bonds.data) : []), [bonds]);
  const pins = useMemo(() => signalPins(feeds, moves, YIELD_MOVE_BP), [feeds, moves]);
  const scfi = rates.status === 'ready' ? rates.data.indices.find((i) => i.indexId === 'SCFI')?.periodChangePct ?? null : null;
  const chokes = useMemo(
    () => chokepointPins(chokepoints.status === 'ready' ? chokepoints.data.chokepoints : [], board, scfi),
    [chokepoints, board, scfi],
  );
  const redChokepoints = useMemo(() => new Set(chokes.filter((c) => c.tone === 'crit').map((c) => c.id.replace('chokepoint:', ''))), [chokes]);
  const lanes = useMemo(() => shippingLanes(redChokepoints), [redChokepoints]);
  const sanctioned = useMemo(() => newSanctionCountries(sanctions.status === 'ready' ? sanctions.data.countries : []), [sanctions]);
  // Country shapes (about 200 KB) load only when there is something to shade.
  const shapes = useCountryShapes(layers.sanctions && sanctioned.size > 0);
  const fills = useMemo(
    () => sanctionFills(shapes?.status === 'ready' ? shapes.data : null, sanctioned),
    [shapes, sanctioned],
  );

  const markers = useMemo((): MapMarker[] => {
    const out: MapMarker[] = [];
    if (layers.centres) {
      for (const c of FINANCIAL_CENTRE_POINTS) {
        out.push({ kind: 'pin', shape: 'centre', tone: 'dim', fired: false, id: c.id, lat: c.lat, lon: c.lon, title: `${c.name} · financial centre`, popup: { kind: 'Financial centre', name: c.name, value: '', lines: [] } });
      }
    }
    if (layers.chokepoints) {
      for (const c of chokes) {
        out.push({
          kind: 'pin', shape: 'chokepoint', tone: c.tone, fired: c.tone !== 'dim', id: c.id, lat: c.lat, lon: c.lon,
          title: `${c.name} · ${c.info ? c.status : 'no status read'}`,
          label: c.tone !== 'dim' ? c.name : undefined,
          sub: c.moved ?? undefined,
          popup: {
            kind: 'Chokepoint',
            name: c.name,
            value: c.info ? `${Math.round(c.info.disruptionScore)}/100` : '—',
            lines: c.info
              ? [
                  { text: `Disruption score ${Math.round(c.info.disruptionScore)} (${c.status || 'unknown'}) · ${c.info.activeWarnings} active warning${c.info.activeWarnings === 1 ? '' : 's'}` },
                  ...(c.moved ? [{ text: `Moves: ${c.moved}`, style: 'mono' as const }] : []),
                  ...(c.info.description ? [{ text: c.info.description, style: 'dim' as const }] : []),
                ]
              : [{ text: 'No status read: the chokepoint status source did not answer.', style: 'dim' as const }],
          },
        });
      }
    }
    if (layers.signals) {
      for (const p of pins) {
        const [first, ...rest] = p.signals;
        const fired = p.signals.filter((s) => s.fired && s.indicator);
        out.push({
          kind: 'pin', shape: 'signal', tone: 'muted', fired: p.fired, id: p.id, lat: p.issuer.lat, lon: p.issuer.lon,
          // New York sits on Washington at world zoom: lift the NYSE pin clear of the Fed's.
          nudge: p.issuer.id === 'nyse' ? [6, -14] : undefined,
          title: `${p.issuer.short} · ${p.signals.map((s) => s.text).join(' · ')}`,
          // Only fired pins carry a name chip; quiet ones keep the map readable and show it on hover.
          label: p.fired && first ? `${p.issuer.short} · ${first.text}` : undefined,
          sub: p.fired && rest.length ? rest.map((s) => s.text).join(' · ') : undefined,
          popup: {
            kind: p.issuer.name,
            name: p.issuer.short,
            value: '',
            lines: [],
            body: (
              <>
                {fired.map((s) => <IndicatorCard key={s.feedId} indicator={s.indicator!} now={now} />)}
                {p.signals.filter((s) => !s.indicator).map((s) => (
                  <p key={`${s.feedId}${s.text}`} class={cx('font-mono text-[11.5px]', s.fired ? 'text-ink' : 'text-muted')}>
                    {s.text}{s.fired ? '' : ' · quiet'}
                  </p>
                ))}
              </>
            ),
          },
        });
      }
    }
    return out;
  }, [layers, pins, chokes, now]);

  const overlays = useMemo(
    () => ({ lines: layers.lanes ? lanes : undefined, fills: layers.sanctions ? fills : undefined }),
    [layers.lanes, layers.sanctions, lanes, fills],
  );

  const fired = pins.filter((p) => p.fired).length;
  const groups: LayerGroup[] = [
    {
      title: 'Signals',
      note: 'where issued',
      rows: [
        { id: 'signals', mark: <PinMark shape="signal" tone="muted" fired />, name: 'Finance signals', sub: `${fired} fired · ${pins.length - fired} quiet · crypto stays off the map`, on: layers.signals },
        { id: 'chokepoints', mark: <PinMark shape="chokepoint" tone="crit" fired />, name: 'Chokepoints', sub: 'red at disruption score 50 · with the price it moves', on: layers.chokepoints },
        { id: 'geo', mark: <MapPin size={14} class="text-geo" aria-hidden="true" />, name: 'Market-moving geopolitics', sub: 'arrives with the Geopolitics indicators (step 2)', on: null },
      ],
    },
    {
      title: 'Context',
      note: 'optional',
      rows: [
        { id: 'lanes', mark: <span class="block h-[2px] w-4 bg-elev" aria-hidden="true" />, name: 'Shipping lanes', sub: 'amber = disrupted, high risk or via a red chokepoint', on: layers.lanes },
        {
          id: 'sanctions', mark: <span class="block h-[10px] w-[14px] border border-elev bg-elev/15" aria-hidden="true" />, name: 'New sanctions',
          sub: sanctions.status === 'ready'
            ? `${sanctioned.size ? `${sanctioned.size} countr${sanctioned.size === 1 ? 'y' : 'ies'}` : 'none'} in OFAC data to ${dayMonthUtc(Number(sanctions.data.datasetDate) || sanctions.data.datasetDate)}`
            : 'OFAC · seed-sanctions-pressure',
          on: layers.sanctions,
        },
        { id: 'centres', mark: <PinMark shape="centre" tone="dim" fired={false} />, name: 'Financial centres', sub: 'context only', on: layers.centres },
      ],
    },
  ];

  const failed = [
    chokepoints.status === 'error' || chokepoints.status === 'empty' ? 'chokepoint status (grey)' : null,
    sanctions.status === 'error' ? 'sanctions (seed-sanctions-pressure)' : null,
  ].filter(Boolean);

  return (
    <Card
      title="Where markets are moving"
      sub="signals pinned at the issuing bank or exchange"
      right={<LayersPopover groups={groups} onToggle={(id, on) => setLayers((l) => ({ ...l, [id]: on }))} footer="Pins mark where a signal is issued, not where it is felt." />}
      testId="markets-map"
    >
      <div class="relative h-[320px] border-t border-line md:h-[400px]">
        <LiteMap markers={markers} fit="world" overlays={overlays} focusId={focus} onSelect={(id) => { if (!id) onFocus(null); }} />
        <div class="pointer-events-none absolute bottom-3 left-3 z-[4] hidden flex-col gap-[6px] rounded-[8px] border border-line bg-surface/90 px-3 py-[10px] sm:flex" data-testid="markets-legend">
          <LegendRow mark={<span class="flex gap-[3px]"><PinMark shape="signal" tone="muted" fired /><PinMark shape="signal" tone="muted" fired={false} /></span>} name="Finance signals" note="fired · quiet" />
          <LegendRow mark={<span class="flex gap-[3px]"><PinMark shape="chokepoint" tone="dim" fired={false} /><PinMark shape="chokepoint" tone="crit" fired /></span>} name="Chokepoints" note="red = disrupted" />
          <LegendRow mark={<span class="flex gap-[3px]"><span class="mt-[5px] block h-[2px] w-[10px] bg-track" /><span class="mt-[5px] block h-[2px] w-[10px] bg-elev" /></span>} name="Shipping lanes" note="amber = at risk" />
          <LegendRow mark={<span class="block h-[10px] w-[14px] border border-elev bg-elev/15" />} name="New sanctions" note="by country" />
          <LegendRow mark={<PinMark shape="centre" tone="dim" fired={false} />} name="Financial centres" note="context only" />
        </div>
        {failed.length ? (
          <span class="absolute right-3 top-10 z-[4] rounded-[4px] bg-surface/90 px-2 py-px text-[10.5px] text-dim">Unavailable: {failed.join(', ')}</span>
        ) : null}
      </div>
      <div class="grid border-t border-line md:grid-cols-2">
        <MapNote icon={<MapPin size={14} class="text-muted" aria-hidden="true" />} title="Pinned where the signal is issued">
          A Treasury or payrolls move sits at the Fed, a Bund move at the ECB, an 8-K at the NYSE. The pin marks the source, not where the effect is felt.
        </MapNote>
        <MapNote icon={<Bitcoin size={14} class="text-muted" aria-hidden="true" />} title="Crypto stays off the map">
          Bitcoin ETF flows, stablecoin pegs, perp positioning and BTC moves have no real place, so they stay as cards in the Indicators panel.
        </MapNote>
      </div>
    </Card>
  );
}

function LegendRow({ mark, name, note }: { mark: ComponentChildren; name: string; note: string }) {
  return (
    <span class="flex items-center gap-2">
      <span class="flex w-[30px] items-center">{mark}</span>
      <span class="text-[11.5px] text-ink">{name}</span>
      <span class="text-[10.5px] text-dim">{note}</span>
    </span>
  );
}

function MapNote({ icon, title, children }: { icon: ComponentChildren; title: string; children: ComponentChildren }) {
  return (
    <div class="flex gap-3 border-line px-5 py-[14px] md:odd:border-r [&+&]:border-t md:[&+&]:border-t-0">
      <span class="mt-[2px]">{icon}</span>
      <span class="flex flex-col gap-[3px]">
        <span class="text-[13px] font-semibold text-ink">{title}</span>
        <span class="text-[12px] leading-[17px] text-dim">{children}</span>
      </span>
    </div>
  );
}

/** Six rows: one per asset class when every class has a story. */
const MARKET_EVENT_ROWS = 6;

const TAG_DOT = { geo: 'bg-geo', fin: 'bg-fin', dim: 'bg-dim' } as const;

function MarketEvents({ state, events }: { state: ReturnType<typeof useDigest>; events: ReturnType<typeof selectMarketEvents> }) {
  const [expanded, setExpanded] = useState(false);
  const board = usePriceBoard();
  const now = Date.now();
  const more = events.length > MARKET_EVENT_ROWS;
  const shown = expanded ? events : events.slice(0, MARKET_EVENT_ROWS);
  return (
    <Card
      title="Market-moving events"
      sub="grouped by cause · linked to price moves"
      right={
        <>
          <DerivedTag how={PRICE_LINK_RULE} />
          {more ? (
            <button type="button" class="text-[12px] font-medium text-ink hover:underline" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} data-testid="market-events-toggle">
              {expanded ? 'Show fewer ↑' : `View all ${events.length} →`}
            </button>
          ) : null}
        </>
      }
      testId="market-events"
    >
      <div class="border-t border-line">
        {state.status !== 'ready' ? (
          <SourceState state={state} source="news digest (finance edition)" />
        ) : events.length === 0 ? (
          <p class="px-5 py-4 text-[12px] text-dim">No market-moving stories match.</p>
        ) : (
          shown.map((e) => {
            const tag = eventTag(e);
            const cause = geoCause(e);
            const moves = board ? priceMoveLabel(linkPriceMoves(e, board)) : null;
            return (
              <a key={e.link} href={e.link} target="_blank" rel="noopener noreferrer" class="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-5 py-[14px] last:border-b-0 hover:bg-surface-2/50" data-testid="market-event">
                <span class="flex w-[104px] shrink-0 items-center gap-[8px]">
                  <span class={cx('h-[6px] w-[6px] rounded-full', TAG_DOT[cause ? 'geo' : tag.tone])} />
                  <span class="font-mono text-[11px] font-medium tracking-[0.6px] text-muted">{tag.label}</span>
                </span>
                <span class="flex min-w-0 flex-1 basis-full flex-col gap-[3px] md:basis-0">
                  <span class="text-[14px] font-medium text-ink">{e.title}</span>
                  <span class="text-[12px] text-dim">
                    {cause ? <>Linked to <span class="text-geo">GEO</span> · {cause} · </> : null}
                    {e.source} · {sourceCount(e)} report{sourceCount(e) === 1 ? '' : 's'} · {relativeTime(e.publishedAt, now)}
                  </span>
                </span>
                <span
                  class={cx('font-mono text-[12px] md:max-w-[260px] md:shrink-0 md:text-right', moves && !moves.flat ? 'text-muted' : 'text-dim')}
                  title={moves?.detail}
                  data-testid="market-event-moves"
                >
                  {moves ? moves.text : '…'}
                </span>
              </a>
            );
          })
        )}
      </div>
    </Card>
  );
}

function Indicators({ feeds, onOpen }: { feeds: readonly FeedState[]; onOpen: (feed: FeedState) => void }) {
  const counts = feedCounts(feeds);
  return (
    <Panel
      title="Indicators"
      right={<><HealthDots feeds={feeds} /><DerivedTag how={`${FINANCE_RULES} ${MACRO_RULES} Nothing is delivered yet.`} /></>}
      testId="risk-alerts"
    >
      <p class="-mt-1 text-[11.5px] text-dim" data-testid="indicator-counts">
        {[`${counts.fired} fired`, counts.quiet && `${counts.quiet} quiet`, counts.stale && `${counts.stale} stale`, counts.unavailable && `${counts.unavailable} unavailable`, 'newest first'].filter(Boolean).join(' · ')}
      </p>
      <IndicatorFeed feeds={feeds} now={Date.now()} onOpen={onOpen} />
      <p class="text-[11px] leading-4 text-dim">Crypto has no place on the map: ETF flows, pegs and perps stay here as cards with their linked news.</p>
    </Panel>
  );
}

const dayLabel = (ymd: string) =>
  new Date(`${ymd.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "+0.3%", "+165k", or the raw string for other units. */
function printValue(value: string, unit: string): string {
  const n = Number.parseFloat(value);
  if (!value.trim() || !Number.isFinite(n)) return '—';
  if (/^k$/i.test(unit)) return macroValue(n, true);
  return `${n < 0 ? MINUS : n > 0 ? '+' : ''}${Math.abs(n).toFixed(1)}${unit === '%' ? '%' : unit ? ` ${unit}` : ''}`;
}

function printChange(actual: string, previous: string, unit: string): { text: string; value: number } | null {
  const a = Number.parseFloat(actual);
  const p = Number.parseFloat(previous);
  if (!actual.trim() || !previous.trim() || !Number.isFinite(a) || !Number.isFinite(p)) return null;
  const d = a - p;
  return { text: /^k$/i.test(unit) ? macroValue(d, true) : signed(d, 1, unit === '%' ? ' pt' : unit ? ` ${unit}` : ''), value: d };
}

function MacroCalendar({ search }: { search: string }) {
  const cal = useMacroCalendar();
  const rows = cal.status === 'ready'
    ? cal.data.events
        .filter((e) => /high|medium/i.test(e.impact) && matchesSearch(search, e.event, e.country))
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 8)
    : [];
  return (
    <Card
      title="Macro calendar"
      sub="recent releases & the next two weeks"
      right={<DerivedTag how="CHANGE is the actual minus the prior print. No source gives a forecast yet, so the prior print stands in for one." />}
      testId="macro-calendar"
    >
      <div class="flex flex-col gap-3 border-t border-line px-5 py-4">
        <div class="flex gap-3">
          <ColLabel class="w-[86px] text-[9.5px]">DATE</ColLabel>
          <ColLabel class="flex-1 text-[9.5px]">EVENT</ColLabel>
          <ColLabel class="w-16 text-right text-[9.5px]">PRIOR</ColLabel>
          <ColLabel class="w-16 text-right text-[9.5px]">ACTUAL</ColLabel>
          <ColLabel class="w-20 text-right text-[9.5px]">CHANGE</ColLabel>
        </div>
        {cal.status !== 'ready' ? (
          <SourceState state={cal} source="economic calendar (seed-economic-calendar)" pad={false} />
        ) : rows.length === 0 ? (
          <p class="text-[12px] text-dim">No medium- or high-impact releases in this window.</p>
        ) : (
          rows.map((e) => {
            const change = printChange(e.actual, e.previous, e.unit);
            return (
              <div key={`${e.date}${e.event}`} class="flex items-center gap-3 border-t border-line pt-3" data-macro-row>
                <span class="w-[86px] shrink-0 font-mono text-[11.5px] text-dim">{dayLabel(e.date)}</span>
                <span class="flex min-w-0 flex-1 items-center gap-[6px]">
                  <span class="truncate text-[13px] text-ink" title={`${e.country} · ${e.event}`}>{e.country ? `${e.country} ` : ''}{e.event}</span>
                  {/high/i.test(e.impact) ? <span class="font-mono text-[9px] font-semibold tracking-[0.5px] text-crit">HIGH</span> : null}
                </span>
                <span class="w-16 text-right font-mono text-[12px] text-muted">{printValue(e.previous, e.unit)}</span>
                <span class="w-16 text-right font-mono text-[12px] font-medium text-ink">{printValue(e.actual, e.unit)}</span>
                <span class={cx('w-20 text-right font-mono text-[12px]', change ? changeTone(change.value) : 'text-dim')}>{change ? change.text : '—'}</span>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

const CURVE_TENORS = [
  { key: 'threeMonth', label: '3M' },
  { key: 'twoYear', label: '2Y' },
  { key: 'fiveYear', label: '5Y' },
  { key: 'tenYear', label: '10Y' },
  { key: 'thirtyYear', label: '30Y' },
] as const;

const curveDate = (ts: number) => new Date(ts).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

function TreasuryCurve() {
  const curves = useTreasuryCurves();
  const win = curves.status === 'ready' ? treasuryWindow(curves.data) : null;
  if (!win) {
    return (
      <Panel title="US Treasury curve" sub="today vs 1 week ago" testId="treasury-curve">
        <SourceState state={curves.status === 'ready' ? { status: 'empty', data: null, at: curves.at } : curves} source="Treasury par yields (seed-us-treasury-par-yield)" pad={false} />
      </Panel>
    );
  }
  const { latest, weekAgo } = win;
  const today = CURVE_TENORS.map((t) => latest[t.key] ?? null);
  const before = CURVE_TENORS.map((t) => (weekAgo ? weekAgo[t.key] ?? null : null));
  const values = [...today, ...before].filter((v): v is number => v != null);
  const lo = Math.floor(Math.min(...values) * 10) / 10 - 0.05;
  const hi = Math.ceil(Math.max(...values) * 10) / 10 + 0.05;
  const W = 300;
  const H = 120;
  const x = (i: number) => 14 + (i / (CURVE_TENORS.length - 1)) * (W - 28);
  const y = (v: number) => 8 + (1 - (v - lo) / (hi - lo || 1)) * (H - 16);
  const path = (series: Array<number | null>) => series.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(' ');
  const grid = [lo + (hi - lo) * 0.15, (lo + hi) / 2, hi - (hi - lo) * 0.15];
  const spread = spreadBp(latest);
  const spreadWeek = spreadBp(weekAgo);
  const flip = spread != null && spreadWeek != null && spread !== 0 && spreadWeek !== 0 && Math.sign(spread) !== Math.sign(spreadWeek);
  const bp = (v: number) => `${v < 0 ? MINUS : '+'}${Math.abs(v).toFixed(0)} bp`;
  return (
    <Panel title="US Treasury curve" sub="today vs 1 week ago" testId="treasury-curve">
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted">
        <span class="flex items-center gap-[6px]"><span class="h-[2px] w-4 rounded bg-ink" aria-hidden="true" />{curveDate(latest.date)}</span>
        {weekAgo ? <span class="flex items-center gap-[6px]"><span class="h-[2px] w-4 rounded bg-dim" aria-hidden="true" />{curveDate(weekAgo.date)}</span> : <span class="text-dim">no curve a week back</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} class="h-[130px] w-full" role="img" aria-label={`US Treasury par yield curve on ${curveDate(latest.date)}${weekAgo ? ` and ${curveDate(weekAgo.date)}` : ''}`}>
        {grid.map((g) => (
          <g key={g}>
            <line x1={0} x2={W} y1={y(g)} y2={y(g)} stroke="var(--color-line)" stroke-width={1} vector-effect="non-scaling-stroke" />
            <text x={0} y={y(g) - 3} fill="var(--color-dim)" font-size="8" font-family="var(--font-mono)">{g.toFixed(1)}%</text>
          </g>
        ))}
        {weekAgo ? <polyline points={path(before)} fill="none" stroke="var(--color-dim)" stroke-width={1.5} data-series="week-ago" /> : null}
        <polyline points={path(today)} fill="none" stroke="var(--color-ink)" stroke-width={2} data-series="latest" />
        {today.map((v, i) => (v == null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill="var(--color-ink)" />))}
      </svg>
      <div class="grid grid-cols-5 gap-1 text-center">
        {CURVE_TENORS.map((t, i) => {
          const now = today[i];
          const then = before[i];
          const d = now != null && then != null ? (now - then) * 100 : null;
          return (
            <span key={t.key} class="flex flex-col gap-[2px]">
              <span class="font-mono text-[10px] text-dim">{t.label}</span>
              <span class="font-mono text-[11.5px] text-ink">{now != null ? now.toFixed(2) : '—'}</span>
              <span class={cx('font-mono text-[10.5px]', d == null ? 'text-dim' : 'text-muted')}>{d != null ? bp(d) : '—'}</span>
            </span>
          );
        })}
      </div>
      <p class="text-[11px] leading-4 text-dim">
        {spread != null ? `2s10s ${bp(spread)}${spreadWeek != null ? ` (${bp(spread - spreadWeek)} w/w)` : ''}. ` : ''}
        {flip ? '2s10s changed sign this week.' : 'No 2s10s sign flip in this window.'} Official par yields, data to {curveDate(latest.date)}.
      </p>
    </Panel>
  );
}
