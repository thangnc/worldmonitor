/**
 * The Finance map, "Where markets are moving" (spec: Screen design › Finance).
 * Finance signals are pinned where they are issued (a central bank, an
 * exchange), not where they are felt. Crypto feeds have no place and stay off
 * the map. Chokepoints, shipping lanes, new sanctions and financial centres
 * are context. Pure functions; Finance.tsx turns them into map markers.
 */
import type { ChokepointInfo } from '@/generated/client/worldmonitor/supply_chain/v1/service_client';
import type { CountrySanctionsPressure } from '@/generated/client/worldmonitor/sanctions/v1/service_client';
import { CENTRAL_BANKS, FINANCIAL_CENTERS, STOCK_EXCHANGES } from '@/config/finance-geo';
import { TRADE_ROUTES, resolveTradeRouteSegments } from '@/config/trade-routes';
import { STRATEGIC_WATERWAYS } from '@/config/geo';
import { signed } from '../format';
import type { BondMove } from './finance-macro-indicators';
import type { FeedState, Indicator } from './indicators';
import type { PriceBoard } from './prices';
import type { Tone } from './transforms';

export interface Issuer {
  id: string;
  /** Pin label: "Fed", "NYSE". */
  short: string;
  /** Card header: "Federal Reserve". */
  name: string;
  lat: number;
  lon: number;
}

function place(list: ReadonlyArray<{ id: string; lat: number; lon: number }>, id: string): { lat: number; lon: number } {
  const hit = list.find((p) => p.id === id);
  if (!hit) throw new Error(`markets map: no coordinates for ${id}`);
  return { lat: hit.lat, lon: hit.lon };
}

/** Where each Finance signal is issued. Coordinates come from src/config/finance-geo.ts. */
export const ISSUERS: Readonly<Record<string, Issuer>> = {
  fed: { id: 'fed', short: 'Fed', name: 'Federal Reserve · US Treasury · BLS', ...place(CENTRAL_BANKS, 'fed') },
  ecb: { id: 'ecb', short: 'ECB', name: 'European Central Bank · Bund', ...place(CENTRAL_BANKS, 'ecb') },
  boe: { id: 'boe', short: 'BoE', name: 'Bank of England · gilts', ...place(CENTRAL_BANKS, 'boe') },
  boj: { id: 'boj', short: 'BoJ', name: 'Bank of Japan · JGBs', ...place(CENTRAL_BANKS, 'boj') },
  nyse: { id: 'nyse', short: 'NYSE', name: 'US listed companies · SEC filings', ...place(STOCK_EXCHANGES, 'nyse') },
  shanghai: { id: 'shanghai', short: 'Shanghai', name: 'Shanghai Shipping Exchange', ...place(FINANCIAL_CENTERS, 'fc-shanghai') },
  london: { id: 'london', short: 'London', name: 'Baltic Exchange', ...place(FINANCIAL_CENTERS, 'fc-london') },
};

/** Finance feeds with a place. Crypto feeds (BTC, funding, depeg, ETF flows, perps, fear & greed) have none. */
export const FEED_ISSUER: Readonly<Record<string, string>> = {
  'macro-print': 'fed',
  treasury: 'fed',
  'sec-8k': 'nyse',
  'freight-scfi': 'shanghai',
  'freight-bdi': 'london',
};

/** Other 10-year bond markets by country. */
export const BOND_ISSUER: Readonly<Record<string, { issuer: string; bond: string }>> = {
  DE: { issuer: 'ecb', bond: 'Bund' },
  GB: { issuer: 'boe', bond: 'Gilt' },
  JP: { issuer: 'boj', bond: 'JGB' },
};

export interface PinSignal {
  feedId: string;
  text: string;
  fired: boolean;
  indicator?: Indicator;
}

export interface SignalPin {
  id: string;
  issuer: Issuer;
  signals: PinSignal[];
  fired: boolean;
}

/** The pin id a feed's card focuses, or null for a feed with no place. */
export function pinIdForFeed(feed: FeedState): string | null {
  if (feed.id === 'other-bonds' && feed.kind === 'fired') {
    const country = feed.indicator.name.split('· ').pop() ?? '';
    const bond = BOND_ISSUER[country];
    return bond ? `signal:${bond.issuer}` : null;
  }
  const issuer = FEED_ISSUER[feed.id];
  return issuer ? `signal:${issuer}` : null;
}

const bp = (v: number) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(0)} bp`;

/**
 * One pin per issuer, carrying each of its signals: fired ones first, with
 * their indicator, then quiet readings. Loading feeds are left out; a stale
 * or unavailable feed is listed by state.
 */
export function signalPins(feeds: readonly FeedState[], bonds: readonly BondMove[], bondThresholdBp: number): SignalPin[] {
  const byIssuer = new Map<string, PinSignal[]>();
  const add = (issuer: string, signal: PinSignal) => {
    const list = byIssuer.get(issuer) ?? [];
    list.push(signal);
    byIssuer.set(issuer, list);
  };
  for (const feed of feeds) {
    const issuer = FEED_ISSUER[feed.id];
    if (!issuer || feed.kind === 'loading') continue;
    if (feed.kind === 'fired') add(issuer, { feedId: feed.id, text: feed.reading ?? `${feed.indicator.value} ${feed.indicator.change ?? ''}`.trim(), fired: true, indicator: feed.indicator });
    else add(issuer, { feedId: feed.id, text: feed.kind === 'quiet' ? feed.reading ?? feed.name : `${feed.name} · ${feed.kind}`, fired: false });
  }
  const bondFeed = feeds.find((f) => f.id === 'other-bonds');
  for (const move of bonds) {
    const market = BOND_ISSUER[move.country];
    if (!market) continue;
    const fired = Math.abs(move.moveBp) + 1e-9 >= bondThresholdBp;
    const indicator = fired && bondFeed?.kind === 'fired' && bondFeed.indicator.name.endsWith(`· ${move.country}`) ? bondFeed.indicator : undefined;
    add(market.issuer, { feedId: 'other-bonds', text: `${market.bond} 10y ${move.level.toFixed(2)}% ${bp(move.moveBp)}`, fired, indicator });
  }
  const pins: SignalPin[] = [];
  for (const [id, signals] of byIssuer) {
    const issuer = ISSUERS[id];
    if (!issuer) continue;
    signals.sort((a, b) => Number(b.fired) - Number(a.fired));
    pins.push({ id: `signal:${id}`, issuer, signals, fired: signals.some((s) => s.fired) });
  }
  return pins;
}

// ---- Chokepoints ------------------------------------------------------------

const OIL_CHOKEPOINTS = new Set(['hormuz_strait', 'bab_el_mandeb', 'suez']);
const GRAIN_CHOKEPOINTS = new Set(['bosphorus', 'kerch_strait']);

export interface ChokepointPin {
  id: string;
  name: string;
  lat: number;
  lon: number;
  tone: Tone;
  /** `red`, `yellow`, `green`, or empty when no status was read. */
  status: string;
  /** "Brent +2.9% 24h": the price the chokepoint moves, when it is not normal. */
  moved: string | null;
  info: ChokepointInfo | null;
}

/** Red at a disruption score of 50 or more (status `red`), amber at 20. */
export function chokepointTone(status: string): Tone {
  return status === 'red' ? 'crit' : status === 'yellow' ? 'elev' : 'dim';
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());

/**
 * Every strategic waterway, coloured by its status when the chokepoint status
 * source answered, otherwise grey with no status.
 */
export function chokepointPins(points: readonly ChokepointInfo[], board: PriceBoard | null, scfiWeekPct: number | null): ChokepointPin[] {
  const byId = new Map(points.map((p) => [p.id, p]));
  return STRATEGIC_WATERWAYS
    .map((w) => ({ w, info: byId.get(w.chokepointId) ?? null }))
    .map(({ w, info }) => {
      const c = { id: w.chokepointId, name: info?.name || w.name, lat: info?.lat ?? w.lat, lon: info?.lon ?? w.lon, status: info?.status ?? '' };
      const tone = chokepointTone(c.status);
      let moved: string | null = null;
      if (tone !== 'dim') {
        if (OIL_CHOKEPOINTS.has(c.id)) {
          const brent = board?.get('BZ=F');
          moved = brent ? `Brent ${signed(brent.change)} 24h` : null;
        } else if (GRAIN_CHOKEPOINTS.has(c.id)) {
          const wheat = board?.get('ZW=F');
          moved = wheat ? `Wheat ${signed(wheat.change)} 24h` : null;
        } else if (scfiWeekPct != null) {
          moved = `SCFI ${signed(scfiWeekPct)} w/w`;
        }
      }
      return { id: `chokepoint:${c.id}`, name: titleCase(c.name), lat: c.lat, lon: c.lon, tone, status: c.status, moved, info };
    });
}

// ---- Context geometry -------------------------------------------------------

export interface LineFeature {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: Array<[number, number]> };
  properties: { tone: Tone; id: string };
}

export interface FillFeature {
  type: 'Feature';
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
  properties: { tone: Tone; id: string; name: string };
}

export interface FeatureCollectionOf<F> {
  type: 'FeatureCollection';
  features: F[];
}

/**
 * Shipping lanes as straight segments through their waypoints. A lane is
 * amber when its status is disrupted or high risk, or when it passes a red
 * chokepoint.
 */
export function shippingLanes(redChokepoints: ReadonlySet<string>): FeatureCollectionOf<LineFeature> {
  const routes = new Map(TRADE_ROUTES.map((r) => [r.id, r]));
  const features: LineFeature[] = resolveTradeRouteSegments().map((seg) => {
    const route = routes.get(seg.routeId);
    const risky = seg.status !== 'active' || Boolean(route?.waypoints.some((w) => redChokepoints.has(w)));
    return {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [seg.sourcePosition, seg.targetPosition] },
      properties: { tone: risky ? 'elev' : 'dim', id: `${seg.routeId}:${seg.segmentIndex}` },
    };
  });
  return { type: 'FeatureCollection', features };
}

/** Countries with new designations in the latest sanctions data. */
export function newSanctionCountries(countries: readonly CountrySanctionsPressure[]): Map<string, CountrySanctionsPressure> {
  return new Map(countries.filter((c) => c.newEntryCount > 0 && c.countryCode).map((c) => [c.countryCode.toUpperCase(), c]));
}

/** ISO 3166-1 alpha-2 of a countries.geojson feature (same keys as src/services/country-geometry.ts). */
export function featureIso2(properties: Record<string, unknown> | null | undefined): string | null {
  const raw = properties?.['ISO3166-1-Alpha-2'] ?? properties?.ISO_A2 ?? properties?.iso_a2;
  return typeof raw === 'string' && /^[A-Z]{2}$/i.test(raw) ? raw.toUpperCase() : null;
}

export function sanctionFills(
  geo: { features: Array<{ geometry: FillFeature['geometry']; properties: Record<string, unknown> | null }> } | null,
  countries: ReadonlyMap<string, CountrySanctionsPressure>,
): FeatureCollectionOf<FillFeature> {
  const features: FillFeature[] = [];
  for (const f of geo?.features ?? []) {
    const iso = featureIso2(f.properties);
    const hit = iso ? countries.get(iso) : undefined;
    if (!iso || !hit) continue;
    features.push({ type: 'Feature', geometry: f.geometry, properties: { tone: 'elev', id: iso, name: hit.countryName } });
  }
  return { type: 'FeatureCollection', features };
}

/** Financial centres, context only. */
export const FINANCIAL_CENTRE_POINTS = FINANCIAL_CENTERS.map((c) => ({ id: `centre:${c.id}`, name: c.name, lat: c.lat, lon: c.lon }));
