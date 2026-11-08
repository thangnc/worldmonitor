// World Monitor Lite UI shell (src/lite/, docs/engineering/architecture/lite.md "Lite UI").
// Renders the real App with fetch stubbed: one digest fixture, one insights
// snapshot, every other source failing. Proves the Briefing home and its three
// child screens render, planned items are marked "soon", sample widgets carry
// the Sample badge, and a failed source shows its own state instead of falling
// back to sample data.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

// MapLibre needs WebGL, which happy-dom lacks. This double covers only what
// src/lite/map/LiteMap.tsx calls, and places a marker by appending its element.
vi.mock('maplibre-gl', () => {
  class FakeMap {
    static last: FakeMap | null = null;
    touchZoomRotate = { disableRotation: () => undefined };
    handlers = new Map<string, Array<(e?: unknown) => void>>();
    // GeoJSON sources (the country fill and the context overlays) and the layers that draw them.
    sources = new Map<string, { data: unknown; setData: (d: unknown) => void }>();
    layers: Array<{ id: string; before?: string }> = [];
    featureState = new Map<string, Record<string, unknown>>();
    constructor(readonly options: { container: HTMLElement }) { FakeMap.last = this; }
    getContainer(): HTMLElement { return this.options.container; }
    on(type: string, fn: (e?: unknown) => void): this { this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]); return this; }
    once(type: string, fn: (e?: unknown) => void): this { return this.on(type, fn); }
    off(type: string, fn: (e?: unknown) => void): this { this.handlers.set(type, (this.handlers.get(type) ?? []).filter((f) => f !== fn)); return this; }
    fire(type: string, e?: unknown): void { for (const fn of this.handlers.get(type) ?? []) fn(e); }
    isStyleLoaded(): boolean { return true; }
    addSource(id: string, spec: { data: unknown }): this {
      const source = { data: spec.data, setData(d: unknown) { source.data = d; } };
      this.sources.set(id, source);
      return this;
    }
    getSource(id: string): unknown { return this.sources.get(id); }
    addLayer(layer: { id: string }, before?: string): this { this.layers.push({ id: layer.id, before }); return this; }
    getLayer(id: string): unknown { return this.layers.find((l) => l.id === id); }
    setFeatureState(target: { id: string | number }, state: Record<string, unknown>): void { this.featureState.set(String(target.id), state); }
    // The fill layer is hit wherever the test clicks: it names the country to hit in `clickCountry`.
    clickCountry = '';
    queryRenderedFeatures(): Array<{ id: string; properties: Record<string, string> }> {
      return this.clickCountry ? [{ id: this.clickCountry, properties: { 'ISO3166-1-Alpha-2': this.clickCountry } }] : [];
    }
    getZoom(): number { return 1; }
    getBounds() { return { getWest: () => -180, getSouth: () => -85, getEast: () => 180, getNorth: () => 85 }; }
    project(): { x: number; y: number } { return { x: 0, y: 0 }; }
    easeTo(): this { return this; }
    fitBounds(): this { return this; }
    zoomIn(): this { return this; }
    zoomOut(): this { return this; }
    remove(): void {}
  }
  class FakeMarker {
    constructor(readonly options: { element: HTMLElement }) {}
    setLngLat(): this { return this; }
    addTo(map: FakeMap): this { map.getContainer().appendChild(this.options.element); return this; }
    remove(): this { this.options.element.remove(); return this; }
  }
  return { Map: FakeMap, Marker: FakeMarker, setWorkerUrl: () => undefined, __FakeMap: FakeMap };
});

// The country shapes: one feature is enough for the shading layer to start.
vi.mock('@/services/country-geometry', () => ({
  getCountriesGeoJson: vi.fn(async () => ({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { 'ISO3166-1-Alpha-2': 'UA', name: 'Ukraine' }, geometry: { type: 'Polygon', coordinates: [[[22, 44], [40, 44], [40, 52], [22, 52], [22, 44]]] } }],
  })),
}));
vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({ default: '/maplibre-worker.js' }));

// The bootstrap tiers are out of scope here: resolve them at once and hydrate
// nothing, so every loader goes straight to its (stubbed) RPC.
vi.mock('@/services/bootstrap', () => ({
  fetchBootstrapData: vi.fn(async () => undefined),
  waitForBootstrapSlowTier: vi.fn(async () => true),
  getHydratedData: vi.fn(() => undefined),
  ensureHydrated: vi.fn(async () => undefined),
}));

const DIGEST = {
  generatedAt: '2026-11-07T00:00:00.000Z',
  feedStatuses: {},
  coverage: { feedCompleted: 280, feedTotal: 300 },
  categories: {
    middleeast: {
      items: [
        {
          source: 'Reuters', title: 'Naval incident near Bab el-Mandeb', link: 'https://example.com/1', publishedAt: Date.now() - 3_600_000,
          isAlert: true, locationName: '', importanceScore: 82, corroborationCount: 3, snippet: '', tickers: [], credibilityScore: 80,
          threat: { level: 'THREAT_LEVEL_HIGH', category: 'conflict', confidence: 0.8, source: 'keyword' },
          storyMeta: { firstSeen: Date.now() - 3_600_000, mentionCount: 3, sourceCount: 3, phase: 'STORY_PHASE_DEVELOPING' },
        },
      ],
    },
    markets: { items: [{ source: 'Bloomberg', title: 'Brent rises as carriers reroute', link: 'https://example.com/2', publishedAt: Date.now(), isAlert: false, locationName: '', importanceScore: 60, corroborationCount: 1, snippet: '', tickers: ['BZ=F'], credibilityScore: 60 }] },
    // A bucket no Lite list reads: it reaches only the hotspots' news input,
    // where 'houthi' and 'red sea' match the Sana'a and Horn of Africa keywords.
    shipping: { items: [{ source: 'Reuters', title: 'Houthi forces fire on Red Sea shipping', link: 'https://example.com/4', publishedAt: Date.now() - 1_800_000, isAlert: false, locationName: '', importanceScore: 0, corroborationCount: 1, snippet: '', tickers: [], credibilityScore: 60 }] },
    ai: { items: [{ source: 'Some Lab Blog', title: 'Lab releases open-weights model', link: 'https://example.com/3', publishedAt: Date.now(), isAlert: false, locationName: '', importanceScore: 51, corroborationCount: 1, snippet: 'Benchmarks&nbsp;self-reported.', tickers: [], credibilityScore: 40 }] },
  },
};

const story = (title: string, category: string) => ({
  primaryTitle: title, primarySource: 'Reuters', primaryLink: 'https://example.com/s', pubDate: '', sourceCount: 3,
  uniqueSourceCount: 3, sources: ['Reuters', 'AP News', 'Some Blog'], importanceScore: 80, velocity: { level: 'normal', sourcesPerHour: 1 },
  isAlert: false, category, threatLevel: 'high', countryCode: null,
});

// Built per request so the snapshot is always inside the 1h acceptance window.
const insights = () => ({
  worldBrief: 'Red Sea shipping risk is the dominant cross-domain driver this morning.',
  briefStoryLines: [
    { n: 1, text: 'Carriers reroute after a naval incident near Bab el-Mandeb. [1]' },
    { n: 2, text: 'Brent rises as carriers reroute. [2]' },
    { n: 3, text: 'A lab releases an open-weights model. [3]' },
  ],
  worldBriefSources: [
    { title: 'Naval incident near Bab el-Mandeb', source: 'Reuters', url: 'https://example.com/1' },
    { title: 'Brent rises', source: 'Bloomberg', url: 'https://example.com/2' },
    { title: 'Open weights', source: 'Some Lab Blog', url: 'https://example.com/3' },
  ],
  briefProvider: 'test',
  status: 'ok',
  topStories: [story('Naval incident near Bab el-Mandeb', 'middleeast'), story('Brent rises as carriers reroute', 'markets'), story('Lab releases open-weights model', 'ai')],
  generatedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
  clusterCount: 3,
  multiSourceCount: 1,
  fastMovingCount: 0,
});

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

let root: HTMLElement;

// Stubbed for the whole file, never restored: loaders still pending when a
// test ends must not reach happy-dom's real network stack.
beforeAll(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/api/news/v1/list-feed-digest')) {
      return new Response(JSON.stringify(DIGEST), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/api/bootstrap') && url.includes('keys=insights')) {
      return new Response(JSON.stringify({ data: { insights: insights() } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('unavailable', { status: 503 });
  }));
});

beforeEach(async () => {
  history.replaceState(null, '', '/lite');
  const { resetResourcesForTests } = await import('../../src/lite/data/store');
  resetResourcesForTests();
  const { __resetServerInsightsCacheForTests } = await import('../../src/services/insights-loader');
  __resetServerInsightsCacheForTests();
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  render(null, root);
  root.remove();
});

describe('Lite UI shell', () => {
  it('opens on the Briefing: the AI brief, cross-domain priority events and derived panels', async () => {
    const { App } = await import('../../src/lite/App');
    await act(() => render(h(App, null), root));
    await vi.waitFor(async () => {
      await flush();
      expect(root.querySelector('[data-testid="brief-lead"]')).not.toBeNull();
    }, { timeout: 10_000, interval: 50 });

    expect(root.querySelector('[data-lite-screen]')?.getAttribute('data-lite-screen')).toBe('briefing');
    expect(root.querySelector('h1')?.textContent).toBe('Cross-domain briefing');
    expect(root.querySelector('[data-nav="briefing"]')?.getAttribute('aria-current')).toBe('page');
    // Five planned nav items plus the topbar action: visible, not interactive.
    const soon = [...root.querySelectorAll('[data-soon="true"]')].map((el) => el.textContent?.replace('SOON', '').trim());
    expect(soon).toEqual(expect.arrayContaining(['Alerts', 'Watchlists', 'Sources', 'Scoring rules', 'Settings']));
    expect(soon).not.toContain('Briefing');
    expect(root.querySelector('[data-testid="open-full-dashboard"]')?.getAttribute('href')).toBe('/dashboard?full=1');

    // The brief: lead, one line per story with its domain and its citation link.
    expect(root.querySelector('[data-testid="brief-lead"]')?.textContent).toContain('Red Sea shipping risk');
    const lines = [...root.querySelectorAll('[data-brief-line]')];
    expect(lines.map((l) => l.getAttribute('data-brief-line'))).toEqual(['geo', 'fin', 'tech']);
    expect(lines[0]?.textContent).not.toContain('[1] [1]');
    expect(lines[0]?.querySelector('a')?.getAttribute('href')).toBe('https://example.com/1');

    // Priority events merge the three digests, highest impact × confidence first.
    const events = [...root.querySelectorAll('[data-event-domain]')];
    expect(events.map((e) => e.getAttribute('data-event-domain'))).toEqual(['geo', 'fin', 'tech']);
    expect(events[0]?.getAttribute('data-expanded')).toBe('true');
    // The detail states the shared corroboration verdict; tier 1 is beside it, never "confirmed".
    const detail = root.querySelector('[data-testid="event-detail"]')?.textContent ?? '';
    expect(detail).toContain('3 publishers carry the story');
    expect(detail).toContain('Reuters reports the headline (tier-1 outlet)');
    expect(detail).not.toContain('CONFIRMED');
    expect(root.querySelector('[data-testid="priority-events"] [data-derived="true"]')).not.toBeNull();

    // The domain filter narrows both the brief and the events.
    const finance = [...root.querySelectorAll('[aria-label="Domain"] button')].find((b) => b.textContent?.includes('Finance')) as HTMLButtonElement;
    await act(() => finance.click());
    expect([...root.querySelectorAll('[data-event-domain]')].map((e) => e.getAttribute('data-event-domain'))).toEqual(['fin']);
    expect([...root.querySelectorAll('[data-brief-line]')].map((l) => l.getAttribute('data-brief-line'))).toEqual(['fin']);

    // A failed market source shows its own state, never samples.
    await vi.waitFor(async () => {
      await flush();
      expect(root.querySelector('[data-testid="market-pulse"] [data-source-state="error"]')).not.toBeNull();
    }, { timeout: 10_000, interval: 50 });
    expect(root.querySelector('[data-sample="true"]')).toBeNull();
    // A failed source never reads as a confident "nothing": no calendar claim, no CII rows.
    await vi.waitFor(async () => {
      await flush();
      expect(root.querySelector('[data-testid="catalysts"] [data-source-state="error"]')).not.toBeNull();
      expect(root.querySelector('[data-testid="escalation-tracker"] [data-source-state="error"]')).not.toBeNull();
    }, { timeout: 10_000, interval: 50 });
    expect(root.querySelector('[data-testid="catalysts"]')?.textContent).not.toContain('No high-impact');
    expect([...root.querySelectorAll('[data-testid="escalation-tracker"] [data-region]')].map((r) => r.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('unavailable')]),
    );
  });

  it('opens Geopolitics from the Briefing with live digest rows', async () => {
    const { App } = await import('../../src/lite/App');
    await act(() => render(h(App, null), root));
    await flush();

    await act(() => (root.querySelector('[data-nav="geopolitics"]') as HTMLAnchorElement).click());
    await flush();
    expect(location.pathname).toBe('/lite/geopolitics');
    expect(root.querySelector('h1')?.textContent).toBe('Geopolitics & Conflicts');
    // Real digest data reaches the incidents table.
    const incident = root.querySelector('[data-incident]');
    expect(incident?.textContent).toContain('Naval incident near Bab el-Mandeb');
    expect(incident?.textContent).toContain('Corroborated');
    expect(incident?.textContent).toContain('3 · T1');
    // The watchlist has no source yet, so it is badged.
    expect(root.querySelector('[data-testid="watchlist"] [data-sample="true"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="regional-timeline"]')?.textContent).toContain('Naval incident');
    // The MapLibre map starts, credits its tiles and shows the design's legend.
    // MapLibre loads through three lazy imports, which can outlast one flush on a busy CI runner.
    await vi.waitFor(async () => {
      await flush();
      expect(root.querySelector('[data-testid="conflict-map"] [data-map-status]')?.getAttribute('data-map-status')).toBe('ready');
    }, { timeout: 5000 });
    expect(root.querySelector('[data-map-credits]')?.textContent).toContain('OpenStreetMap');
    const legend = root.querySelector('[data-testid="map-legend"]')?.textContent ?? '';
    expect(legend).toContain('Reported violence · GDELT');
    expect(legend).toContain('Verified background · UCDP');
    expect(legend).toContain('Curated hotspot');
    // Every curated hotspot is drawn, as on the dashboard, coloured by the live
    // score. Only news and the curated baseline are available here, so only the
    // two baseline-4 hotspots with a 'red sea' keyword, Sana'a and Horn of
    // Africa, reach elevated from the one fresh headline, and only they carry a
    // name; Kyiv (baseline 5, no news) is at watch.
    const { INTEL_HOTSPOTS } = await import('../../src/config/geo');
    const drawn = [...root.querySelectorAll('[data-marker]')].map((m) => m.getAttribute('data-marker'));
    expect(drawn.sort()).toEqual(INTEL_HOTSPOTS.map((h) => `hotspot:${h.id}`).sort());
    const named = [...root.querySelectorAll('[data-marker] span.rounded-\\[4px\\]')].map((n) => n.textContent);
    expect(named.sort()).toEqual(['Horn of Africa', "Sana'a"]);
    expect(root.querySelector('[data-marker="hotspot:kyiv"] button')?.getAttribute('aria-label')).toContain('live escalation 2.4/5, watch');
    const diamond = root.querySelector('[data-marker="hotspot:sanaa"] button') as HTMLButtonElement;
    expect(diamond.getAttribute('aria-label')).toContain('live escalation 2.6/5, elevated');

    // No card until the diamond is clicked; then that hotspot's live score.
    expect(root.querySelector('[data-map-popup]')).toBeNull();
    await act(() => diamond.click());
    const card = root.querySelectorAll('[data-map-popup]');
    expect(card.length).toBe(1);
    expect(card[0]?.getAttribute('data-map-popup')).toBe('hotspot:sanaa');
    expect(card[0]?.textContent).toContain('Curated hotspot');
    expect(card[0]?.textContent).toContain('2.6/5');
    expect(card[0]?.textContent).toContain('live score, baseline 4/5');
    expect(card[0]?.textContent).toContain('Not available: country risk, unrest events, earthquakes, military flights');
    expect(diamond.getAttribute('aria-expanded')).toBe('true');
    // The close button and Escape both dismiss it.
    await act(() => (root.querySelector('[data-map-popup] button[aria-label="Close"]') as HTMLButtonElement).click());
    expect(root.querySelector('[data-map-popup]')).toBeNull();
    await act(() => diamond.click());
    expect(root.querySelector('[data-map-popup]')).not.toBeNull();
    await act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(root.querySelector('[data-map-popup]')).toBeNull();

    // The owner's ranges; they filter the digest-driven parts (the hour-old incident stays in all of them).
    const buttons = [...root.querySelectorAll('[data-testid="time-range"] button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['6h', '24h', '7d', '30d']);
    const pick = (range: string) => buttons.find((b) => b.textContent === range) as HTMLButtonElement;
    await act(() => pick('6h').click());
    expect(root.querySelector('h1 + p')?.textContent).toContain('1 active events in 6h');
    expect(root.querySelector('[data-incident]')?.textContent).toContain('Naval incident near Bab el-Mandeb');
    // No GDELT counts here: the violence feed names its seeder instead of guessing.
    expect(root.querySelector('[data-testid="geo-indicators"] [data-feed="violence"]')?.getAttribute('data-feed-state')).toBe('unavailable');

    // The sidebar's Briefing link returns home.
    await act(() => (root.querySelector('[data-nav="briefing"]') as HTMLAnchorElement).click());
    await flush();
    expect(location.pathname).toBe('/lite');
    expect(root.querySelector('h1')?.textContent).toBe('Cross-domain briefing');
  });

  it('navigates to Finance and Technology without a page load', async () => {
    const { App } = await import('../../src/lite/App');
    await act(() => render(h(App, null), root));
    await flush();

    await act(() => (root.querySelector('[data-nav="finance"]') as HTMLAnchorElement).click());
    await flush();
    expect(location.pathname).toBe('/lite/finance');
    expect(root.querySelector('h1')?.textContent).toBe('Finance & Crypto');
    expect(root.querySelector('[data-testid="market-events"]')?.textContent).toContain('Brent rises as carriers reroute');
    // Generated RPC clients load lazily; wait for every source to settle.
    const states = () => [...root.querySelectorAll('[data-source-state]')].map((el) => el.getAttribute('data-source-state'));
    await vi.waitFor(async () => {
      await flush();
      expect(states()).not.toContain('loading');
    }, { timeout: 10_000, interval: 50 });
    expect(states()).toContain('error');
    // Step 3b: the chart widgets and their samples are gone; five 1D tickers and the markets map remain.
    for (const gone of ['btc-detail', 'derivatives', 'correlation']) expect(root.querySelector(`[data-testid="${gone}"]`)).toBeNull();
    expect(root.querySelector('[data-lite-screen] [data-sample="true"]')).toBeNull();
    expect([...root.querySelectorAll('[data-testid="ticker-strip"] [data-ticker]')].map((t) => t.getAttribute('data-ticker'))).toEqual(['BTC', 'Brent', 'Gold', 'S&P 500', 'US 10Y']);
    expect(root.querySelector('[data-testid="markets-map"]')).not.toBeNull();

    await act(() => (root.querySelector('[data-nav="tech"]') as HTMLAnchorElement).click());
    await flush();
    expect(location.pathname).toBe('/lite/tech');
    const development = root.querySelector('[data-development]');
    expect(development?.textContent).toContain('Lab releases open-weights model');
    expect(development?.textContent).toContain('Benchmarks self-reported.');
    expect(development?.textContent).toContain('Single publisher');
    expect(root.querySelectorAll('[data-testid="model-tracker"] [data-sample-row]')).toHaveLength(4);
    expect(root.querySelector('[data-testid="model-tracker"] [data-sample="true"]')).not.toBeNull();
  });
});

describe('Lite indicator card', () => {
  it('renders a fired Finance rule as a card with its linked news, expands it, and keeps quiet rules as rows', async () => {
    const base = fetch;
    const now = Date.now();
    const depegDigest = {
      ...DIGEST,
      categories: {
        ...DIGEST.categories,
        crypto: { items: [{ source: 'CoinDesk', title: 'Ethena USDe slips below its peg as redemptions rise', link: 'https://example.com/usde', publishedAt: now - 2 * 3_600_000, isAlert: false, locationName: '', importanceScore: 55, corroborationCount: 2, snippet: '', tickers: [], credibilityScore: 60 }] },
      },
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.includes('/api/news/v1/list-feed-digest')) return json(depegDigest);
      if (url.includes('/api/market/v1/list-stablecoin-markets')) {
        return json({
          timestamp: new Date(now - 5 * 60_000).toISOString(),
          summary: { depeggedCount: 0 },
          stablecoins: [
            { id: 'tether', symbol: 'usdt', name: 'Tether', price: 1.0003, deviation: 0.03, pegStatus: 'ON PEG' },
            { id: 'ethena-usde', symbol: 'usde', name: 'Ethena USDe', price: 0.994, deviation: 0.6, pegStatus: 'SLIGHT DEPEG' },
          ],
        });
      }
      if (url.includes('/api/market/v1/get-fear-greed-index')) return json({ compositeScore: 55, compositeLabel: 'Neutral', seededAt: new Date(now - 3_600_000).toISOString() });
      return base(input, init);
    }));
    try {
      history.replaceState(null, '', '/lite/finance');
      const { App } = await import('../../src/lite/App');
      await act(() => render(h(App, null), root));
      const panel = () => root.querySelector('[data-testid="risk-alerts"]') as HTMLElement;
      await vi.waitFor(async () => {
        await flush();
        expect(panel().querySelector('[data-indicator="stablecoin-depeg"]')).not.toBeNull();
        expect(panel().querySelector('[data-feed="fear-greed"]')?.getAttribute('data-feed-state')).toBe('quiet');
      }, { timeout: 10_000, interval: 50 });

      const compact = panel().querySelector('[data-indicator="stablecoin-depeg"]') as HTMLButtonElement;
      expect(compact.tagName).toBe('BUTTON');
      expect(compact.textContent).toContain('Stablecoin depeg · USDe');
      expect(compact.textContent).toContain('$0.9940');
      expect(compact.textContent).toContain('MARKET DATA');
      expect(compact.textContent).toContain('1 linked');
      // Fired cards come first; a failed source is a row that names its seeder.
      expect(panel().querySelector('[data-testid="indicator-feed"]')?.firstElementChild).toBe(compact);
      expect(panel().querySelector('[data-feed="btc-funding"]')?.textContent).toContain('seed-hyperliquid-flow');

      await act(() => compact.click());
      const full = panel().querySelector('article[data-indicator="stablecoin-depeg"]') as HTMLElement;
      expect(full).not.toBeNull();
      expect(full.textContent).toContain('FIRED');
      const linked = full.querySelector('[data-testid="linked-news"]') as HTMLElement;
      expect(linked.textContent).toContain('Ethena USDe slips below its peg as redemptions rise');
      expect(linked.textContent).toContain('−2h');
      expect(linked.querySelector('[data-match]')?.textContent).toBe('driver: USDe');
      expect((linked.querySelector('a') as HTMLAnchorElement).rel).toBe('noopener noreferrer');

      // Escape collapses it back to the compact card.
      await act(() => { full.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
      expect(panel().querySelector('article[data-indicator="stablecoin-depeg"]')).toBeNull();
      expect(panel().querySelector('button[data-indicator="stablecoin-depeg"]')).not.toBeNull();
    } finally {
      vi.stubGlobal('fetch', base);
    }
  });

  it('renders the step-3 Finance feeds with their detail line, and the Treasury curve today against a week ago', async () => {
    const base = fetch;
    const now = Date.now();
    const day = (offset: number) => Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate()) + offset * 86_400_000;
    const curve = (date: number, twoYear: number, tenYear: number) => ({ date, threeMonth: 4.19, twoYear, fiveYear: 4.64, tenYear, thirtyYear: 5.26 });
    const filingsDigest = {
      ...DIGEST,
      categories: {
        ...DIGEST.categories,
        // The Treasury rule fires at the 16:00 New York close of the curve's date.
        markets: { items: [{ source: 'Reuters', title: 'Treasury yields jump as traders reprice Fed path', link: 'https://example.com/ust', publishedAt: day(0) + 20 * 3_600_000, isAlert: false, locationName: '', importanceScore: 60, corroborationCount: 3, snippet: '', tickers: [], credibilityScore: 70 }] },
      },
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.includes('/api/news/v1/list-feed-digest')) return json(filingsDigest);
      if (url.includes('/api/economic/v1/get-us-treasury-par-yield-curve')) {
        return json({ unavailable: false, curves: [curve(day(-8), 4.56, 4.94), curve(day(-1), 4.4, 4.75), curve(day(0), 4.51, 4.86)] });
      }
      if (url.includes('/api/intelligence/v1/list-material-events')) {
        return json({
          unavailable: false, fetchedAtMs: now - 60_000,
          events: [{ company: 'APPLE INC', cik: '0000320193', form: '8-K', accession: 'a', filedAtMs: now - 2 * 3_600_000, url: 'https://www.sec.gov/a', items: [{ code: '1.05', description: 'Material Cybersecurity Incidents' }] }],
        });
      }
      return base(input, init);
    }));
    try {
      history.replaceState(null, '', '/lite/finance');
      const { App } = await import('../../src/lite/App');
      await act(() => render(h(App, null), root));
      const panel = () => root.querySelector('[data-testid="risk-alerts"]') as HTMLElement;
      await vi.waitFor(async () => {
        await flush();
        expect(panel().querySelector('[data-indicator="treasury"]')).not.toBeNull();
        expect(panel().querySelector('[data-indicator="sec-8k"]')).not.toBeNull();
      }, { timeout: 10_000, interval: 50 });

      const treasury = panel().querySelector('[data-indicator="treasury"]') as HTMLButtonElement;
      expect(treasury.textContent).toContain('4.51 / 4.86%');
      expect(treasury.textContent).toContain('+11 / +11 bp');
      expect(treasury.querySelector('[data-testid="indicator-detail"]')?.textContent).toContain('2s10s +35 bp');
      expect(treasury.textContent).toContain('OFFICIAL');
      expect(treasury.textContent).toContain('1 linked');
      const filing = panel().querySelector('[data-indicator="sec-8k"]') as HTMLButtonElement;
      expect(filing.textContent).toContain('8-K filing · APPLE INC');
      expect(filing.textContent).toContain('Item 1.05');
      // Feeds this test left unanswered name their seeders.
      expect(panel().querySelector('[data-feed="freight-scfi"]')?.textContent).toContain('seed-supply-chain-trade');
      expect(panel().querySelector('[data-feed="other-bonds"]')?.textContent).toContain('seed-bundle-yield-curves');

      const curveCard = root.querySelector('[data-testid="treasury-curve"]') as HTMLElement;
      expect(curveCard.querySelector('[data-series="latest"]')).not.toBeNull();
      expect(curveCard.querySelector('[data-series="week-ago"]')).not.toBeNull();
      expect(curveCard.textContent).toContain('2s10s +35 bp (−3 bp w/w)');
    } finally {
      vi.stubGlobal('fetch', base);
    }
  });

  it('pins Finance signals where they are issued, opens their card from the map and from the panel, and toggles layers', async () => {
    const base = fetch;
    const now = Date.now();
    const day = (offset: number) => Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate()) + offset * 86_400_000;
    const curve = (date: number, twoYear: number, tenYear: number) => ({ date, threeMonth: 4.19, twoYear, fiveYear: 4.64, tenYear, thirtyYear: 5.26 });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.includes('/api/economic/v1/get-us-treasury-par-yield-curve')) {
        return json({ unavailable: false, curves: [curve(day(-8), 4.56, 4.94), curve(day(-1), 4.4, 4.75), curve(day(0), 4.51, 4.86)] });
      }
      if (url.includes('/api/supply-chain/v1/get-chokepoint-status')) {
        return json({ fetchedAt: new Date(now).toISOString(), upstreamUnavailable: false, chokepoints: [{ id: 'bab_el_mandeb', name: 'BAB EL-MANDEB', lat: 12.5, lon: 43.3, disruptionScore: 72, status: 'red', activeWarnings: 3, congestionLevel: '', affectedRoutes: [], description: '', aisDisruptions: 0, directions: [], directionalDwt: [], warRiskTier: 'WAR_RISK_TIER_UNSPECIFIED', navigationalWarningsAvailable: true, aisSnapshotAvailable: true }] });
      }
      return base(input, init);
    }));
    try {
      history.replaceState(null, '', '/lite/finance');
      const { App } = await import('../../src/lite/App');
      await act(() => render(h(App, null), root));
      const map = () => root.querySelector('[data-testid="markets-map"]') as HTMLElement;
      await vi.waitFor(async () => {
        await flush();
        expect(map().querySelector('[data-map-status]')?.getAttribute('data-map-status')).toBe('ready');
        expect(map().querySelector('[data-marker="signal:fed"]')).not.toBeNull();
        expect(map().querySelector('[data-marker="chokepoint:bab_el_mandeb"]')).not.toBeNull();
      }, { timeout: 10_000, interval: 50 });

      // Crypto feeds have no pin; the fired Treasury feed is a labelled pin at the Fed.
      const drawn = [...map().querySelectorAll('[data-marker^="signal:"]')].map((m) => m.getAttribute('data-marker'));
      expect(drawn).not.toContain('signal:btc');
      const fed = map().querySelector('[data-marker="signal:fed"]') as HTMLElement;
      expect(fed.textContent).toContain('Fed · UST 10Y 4.86% +11 bp');
      expect(map().querySelector('[data-marker="chokepoint:bab_el_mandeb"]')?.textContent).toContain('Bab El-Mandeb');
      // A chokepoint the source did not report is drawn grey, without a name chip.
      expect(map().querySelector('[data-marker="chokepoint:panama"]')?.textContent).toBe('');

      // The pin opens the same indicator card the panel shows.
      await act(() => (fed.querySelector('button') as HTMLButtonElement).click());
      const popup = map().querySelector('[data-map-popup="signal:fed"]') as HTMLElement;
      expect(popup.querySelector('article[data-indicator="treasury"]')).not.toBeNull();
      await act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
      expect(map().querySelector('[data-map-popup]')).toBeNull();

      // Opening the card in the panel focuses its pin.
      await act(() => (root.querySelector('[data-testid="risk-alerts"] button[data-indicator="treasury"]') as HTMLButtonElement).click());
      await flush();
      expect(map().querySelector('[data-map-popup]')?.getAttribute('data-map-popup')).toBe('signal:fed');

      // The layers popover turns a layer off and closes on Escape, back to its chip.
      const chip = map().querySelector('[data-testid="layers-chip"]') as HTMLButtonElement;
      expect(chip.textContent).toContain('Layers · 5');
      await act(() => chip.click());
      const popover = map().querySelector('[data-testid="layers-popover"]') as HTMLElement;
      expect(popover.querySelector('[data-layer-row="geo"]')?.textContent).toContain('N/A');
      await act(() => (popover.querySelector('[data-layer-row="centres"] [role="switch"]') as HTMLButtonElement).click());
      await flush();
      expect(map().querySelector('[data-marker^="centre:"]')).toBeNull();
      expect(chip.textContent).toContain('Layers · 4');
      await act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
      expect(map().querySelector('[data-testid="layers-popover"]')).toBeNull();
      expect(document.activeElement).toBe(chip);
    } finally {
      vi.stubGlobal('fetch', base);
    }
  });

  it('renders the Tech indicators and infrastructure tiles from real feeds, and a failed feed as its state', async () => {
    const base = fetch;
    const now = Date.now();
    const day = (offset: number) => new Date(now - offset * 86_400_000).toISOString().slice(0, 10);
    const techDigest = {
      ...DIGEST,
      categories: {
        ...DIGEST.categories,
        security: { items: [{ source: 'BleepingComputer', title: 'Yemen internet goes dark after power grid failure', link: 'https://example.com/ye', publishedAt: now - 3_600_000, isAlert: false, locationName: '', importanceScore: 40, corroborationCount: 1, snippet: '', tickers: [], credibilityScore: 60 }] },
      },
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.includes('/api/news/v1/list-feed-digest')) return json(techDigest);
      if (url.includes('/api/infrastructure/v1/list-internet-outages')) {
        return json({
          fetchedAt: now - 10 * 60_000,
          outages: [{
            id: 'cf-1', title: 'Internet disruption in Yemen', link: '', description: '', detectedAt: now - 2 * 3_600_000, country: 'Yemen', region: '',
            severity: 'OUTAGE_SEVERITY_TOTAL', categories: ['Cloudflare Radar', 'POWER OUTAGE', 'NATIONWIDE', 'YemenNet'], cause: 'POWER_OUTAGE', outageType: 'NATIONWIDE', endedAt: 0,
          }],
        });
      }
      if (url.includes('/api/infrastructure/v1/list-service-statuses')) {
        return json({ statuses: [
          { id: 'aws', name: 'AWS', status: 'SERVICE_OPERATIONAL_STATUS_OPERATIONAL', description: '', url: '', checkedAt: now - 60_000, latencyMs: 90 },
          { id: 'azure', name: 'Azure', status: 'SERVICE_OPERATIONAL_STATUS_DEGRADED', description: 'Recent incidents reported', url: '', checkedAt: now - 60_000, latencyMs: 90 },
        ] });
      }
      return base(input, init);
    }));
    // The cyber keys ride the on-demand bootstrap path: KEV answers, the history misses.
    const bootstrap = await import('@/services/bootstrap');
    vi.mocked(bootstrap.ensureHydrated).mockImplementation(async (key: string) => (key === 'kevRecent'
      ? { fetchedAt: now - 3_600_000, days: 30, attribution: '', items: [
          { id: 'CVE-2026-0002', addedAt: day(10), dueAt: '', name: 'Old entry', vendorProduct: '', cvssScore: 7.5, cvssSeverity: 'HIGH', description: '' },
        ] }
      : undefined));
    try {
      history.replaceState(null, '', '/lite/tech');
      const { App } = await import('../../src/lite/App');
      await act(() => render(h(App, null), root));
      const panel = () => root.querySelector('[data-testid="tech-indicators"]') as HTMLElement;
      const tile = (key: string) => root.querySelector(`[data-infra-tile="${key}"]`) as HTMLElement;
      await vi.waitFor(async () => {
        await flush();
        expect(panel().querySelector('[data-indicator="internet-outage"]')).not.toBeNull();
        expect(panel().querySelector('[data-feed="attack-spike"]')?.getAttribute('data-feed-state')).toBe('unavailable');
        expect(tile('Threat indicators').textContent).toContain('source unavailable');
      }, { timeout: 10_000, interval: 50 });

      const card = panel().querySelector('[data-indicator="internet-outage"]') as HTMLElement;
      expect(card.textContent).toContain('Internet outage · Yemen');
      expect(card.textContent).toContain('Nationwide');
      expect(card.textContent).toContain('REPORTED');
      expect(card.querySelector('[data-testid="indicator-detail"]')?.textContent).toContain('stated cause: power outage');
      expect(card.textContent).toContain('1 linked');
      expect(panel().querySelector('[data-feed="service-outage"]')?.textContent).toContain('degraded: Azure');
      expect(panel().querySelector('[data-feed="kev-new"]')?.getAttribute('data-feed-state')).toBe('quiet');
      expect(panel().querySelector('[data-feed="attack-spike"]')?.textContent).toContain('seed-cyber-threats');

      expect(tile('Active outages').textContent).toContain('1 nationwide');
      expect(tile('Providers degraded').textContent).toContain('1 / 2');
      expect(tile('Exploited CVEs · week').textContent).toContain('vs last week');
      // The tiles are real or a stated state now: no sample badge on the panel.
      expect(root.querySelector('[data-testid="infra-business"] [data-sample="true"]')).toBeNull();
    } finally {
      vi.stubGlobal('fetch', base);
      vi.mocked(bootstrap.ensureHydrated).mockImplementation(async () => undefined);
    }
  });

  it('says "No linked news found" with what it searched when no story matches', async () => {
    const { IndicatorCard, IndicatorCardCompact } = await import('../../src/lite/components/indicator');
    const indicator = {
      id: 'btc-move', domain: 'fin' as const, name: 'Price move · BTC 24h', value: '$71,240', change: '−5.0% 24h', rule: '±4%',
      trust: { level: 'market' as const, source: 'CoinGecko' }, at: Date.UTC(2026, 10, 8, 8, 31),
      links: { stories: [], searched: 1316, windowHours: 6 },
      why: 'must not render without links',
    };
    await act(() => render(h('div', null, h(IndicatorCardCompact, { indicator }), h(IndicatorCard, { indicator, now: Date.UTC(2026, 10, 8, 9) })), root));
    const compact = root.querySelector('button[data-indicator="btc-move"]') as HTMLElement;
    expect(compact.getAttribute('data-linked')).toBe('false');
    expect(compact.textContent).toContain('No linked news found');
    const full = root.querySelector('article[data-indicator="btc-move"]') as HTMLElement;
    expect(full.querySelector('[data-testid="no-linked-news"]')?.textContent).toContain('Searched 1,316 stories from 6 h before to 1 h after');
    expect(full.querySelector('[data-testid="linked-news"]')).toBeNull();
    // The AI line is suppressed when nothing is linked.
    expect(full.textContent).not.toContain('Model inference');
    expect(full.textContent).toContain('08:31 UTC');
  });
});

describe('Lite Geopolitics: GDELT reported violence', () => {
  it('shades spiking countries, fires the violence indicator with its linked news, and opens a country card', async () => {
    const HOUR = 3_600_000;
    const DAY = 86_400_000;
    const now = Date.now();
    const currentHour = Math.floor(now / HOUR) * HOUR;
    const today = Math.floor(now / DAY) * DAY;
    // Ukraine: 40 reports a day for a week; 5 an hour over the last six complete hours (×3).
    const counts = {
      updatedAt: now - 60_000, cursor: '', cohortsPerHour: 4, cohortsPerDay: 96,
      hours: Array.from({ length: 48 }, (_, i) => currentHour - (47 - i) * HOUR).map((start) => ({
        hour: new Date(start).toISOString().slice(0, 13),
        cohorts: start === currentHour ? 1 : 4,
        byCountry: start >= currentHour - 6 * HOUR && start < currentHour ? { UA: 5 } : { UA: 1 },
      })),
      days: Array.from({ length: 30 }, (_, i) => today - (29 - i) * DAY).map((start) => ({
        date: new Date(start).toISOString().slice(0, 10),
        cohorts: start === today ? 40 : 96,
        byCountry: { UA: 40 },
      })),
    };
    const boot = await import('@/services/bootstrap');
    vi.mocked(boot.ensureHydrated).mockImplementation(async (key: string) => (key === 'gdeltConflictCounts' ? counts : undefined));
    const base = fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/api/news/v1/list-feed-digest')) {
        const digest = {
          ...DIGEST,
          categories: {
            ...DIGEST.categories,
            europe: { items: [{ source: 'Reuters', title: 'Ukraine reports drone strikes on Kharkiv', link: 'https://example.com/ua', publishedAt: now - 2 * HOUR, isAlert: false, locationName: '', importanceScore: 40, corroborationCount: 2, snippet: '', tickers: [], credibilityScore: 70 }] },
          },
        };
        return new Response(JSON.stringify(digest), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return base(input, init);
    }));
    try {
      history.replaceState(null, '', '/lite/geopolitics');
      const { App } = await import('../../src/lite/App');
      await act(() => render(h(App, null), root));
      const maplib = (await import('maplibre-gl')) as unknown as {
        __FakeMap: { last: { sources: Map<string, unknown>; layers: Array<{ id: string; before?: string }>; featureState: Map<string, Record<string, unknown>>; clickCountry: string; fire: (type: string, e?: unknown) => void } | null };
      };
      await vi.waitFor(async () => {
        await flush();
        expect(root.querySelector('[data-testid="geo-indicators"] [data-indicator="violence:UA"]')).not.toBeNull();
        expect(maplib.__FakeMap.last?.sources.has('lite-countries')).toBe(true);
      }, { timeout: 10_000, interval: 50 });
      // At 7d Ukraine is at its normal, so nothing is shaded; the last 6 h are at ×3.
      expect(maplib.__FakeMap.last?.featureState.get('UA')?.step ?? 0).toBe(0);
      const range = (r: string) => [...root.querySelectorAll('[data-testid="time-range"] button')].find((b) => b.textContent === r) as HTMLButtonElement;
      await act(() => range('6h').click());
      await flush();
      expect(maplib.__FakeMap.last?.featureState.get('UA')?.step).toBe(3);
      const map = maplib.__FakeMap.last!;
      // The shading is a fill under the borders and labels.
      expect(map.sources.has('lite-countries')).toBe(true);
      expect(map.layers).toContainEqual({ id: 'lite-country-fill', before: 'country-border' });

      const card = root.querySelector('[data-testid="geo-indicators"] [data-indicator="violence:UA"]') as HTMLElement;
      expect(card.textContent).toContain('Violence spike · Ukraine');
      expect(card.textContent).toContain('30 reports');
      expect(card.textContent).toContain('REPORTED');
      expect(card.textContent).toContain('1 linked');
      await act(() => (card as HTMLButtonElement).click());
      expect(root.querySelector('[data-testid="geo-indicators"] [data-testid="linked-news"]')?.textContent).toContain('Ukraine reports drone strikes on Kharkiv');

      // The 6h histogram has one bar per complete hour.
      expect(root.querySelector('[data-testid="gdelt-histogram"]')).not.toBeNull();

      // Clicking the shaded country opens its card at the click point.
      map.clickCountry = 'UA';
      await act(() => map.fire('click', { point: { x: 10, y: 10 }, lngLat: { lng: 31, lat: 48 } }));
      const popup = root.querySelector('[data-map-popup="country:UA"]');
      expect(popup?.textContent).toContain('Reported violence · GDELT');
      expect(popup?.textContent).toContain('Ukraine');
      expect(popup?.textContent).toContain('reports');
      expect(popup?.textContent).toContain('Machine-coded news reports, not verified events.');
      // Clicking where no shaded country is closes it.
      map.clickCountry = '';
      await act(() => map.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng: 0, lat: 0 } }));
      expect(root.querySelector('[data-map-popup]')).toBeNull();
      // Back at 7d the shading clears through feature state.
      await act(() => range('7d').click());
      await flush();
      expect(map.featureState.get('UA')?.step).toBe(0);

      // The strip shows five hotspots; a tile opens its hotspot's card.
      const tiles = [...root.querySelectorAll('[data-hotspot-tile]')] as HTMLButtonElement[];
      expect(tiles).toHaveLength(5);
      await act(() => tiles[0]!.click());
      expect(root.querySelector('[data-map-popup]')?.getAttribute('data-map-popup')).toBe(`hotspot:${tiles[0]!.getAttribute('data-hotspot-tile')}`);
    } finally {
      vi.stubGlobal('fetch', base);
      vi.mocked(boot.ensureHydrated).mockImplementation(async () => undefined);
    }
  });
});
