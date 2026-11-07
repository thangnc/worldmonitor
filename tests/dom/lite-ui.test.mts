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
    touchZoomRotate = { disableRotation: () => undefined };
    constructor(readonly options: { container: HTMLElement }) {}
    getContainer(): HTMLElement { return this.options.container; }
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
  class FakePopup {
    private content: HTMLElement | null = null;
    private map: FakeMap | null = null;
    private listeners: Array<() => void> = [];
    on(_type: 'close', fn: () => void): this { this.listeners.push(fn); return this; }
    setDOMContent(el: HTMLElement): this { this.content = el; return this; }
    setOffset(): this { return this; }
    setLngLat(): this { return this; }
    isOpen(): boolean { return this.map !== null; }
    addTo(map: FakeMap): this { this.map = map; if (this.content) map.getContainer().appendChild(this.content); return this; }
    // Like MapLibre: removing a popup fires 'close'.
    remove(): this { this.content?.remove(); this.map = null; for (const fn of this.listeners) fn(); return this; }
  }
  return { Map: FakeMap, Marker: FakeMarker, Popup: FakePopup, setWorkerUrl: () => undefined };
});
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
    expect(root.querySelector('[data-testid="event-detail"]')?.textContent).toContain('CONFIRMED');
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
    expect(incident?.textContent).toContain('Confirmed');
    // The watchlist has no source yet, so it is badged.
    expect(root.querySelector('[data-testid="watchlist"] [data-sample="true"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="regional-timeline"]')?.textContent).toContain('Naval incident');
    // The MapLibre map starts, credits its tiles and places one marker per
    // curated hotspot (UCDP fails here, so only hotspots remain).
    const map = root.querySelector('[data-testid="conflict-map"] [data-map-status]');
    expect(map?.getAttribute('data-map-status')).toBe('ready');
    expect(root.querySelector('[data-map-credits]')?.textContent).toContain('OpenStreetMap');
    const { INTEL_HOTSPOTS } = await import('../../src/config/geo');
    const hotspots = INTEL_HOTSPOTS.filter((h) => (h.escalationScore ?? 0) >= 3).map((h) => `hotspot:${h.id}`);
    expect(hotspots.length).toBeGreaterThan(1);
    expect([...root.querySelectorAll('[data-marker]')].map((m) => m.getAttribute('data-marker')).sort()).toEqual(hotspots.sort());

    // No popup until a marker is clicked; then exactly that marker's details.
    expect(root.querySelector('[data-map-popup]')).toBeNull();
    const first = INTEL_HOTSPOTS.find((h) => `hotspot:${h.id}` === hotspots[0]);
    await act(() => (root.querySelector(`[data-marker="${hotspots[0]}"] button`) as HTMLButtonElement).click());
    const popup = root.querySelectorAll('[data-map-popup]');
    expect(popup.length).toBe(1);
    expect(popup[0]?.getAttribute('data-map-popup')).toBe(hotspots[0]);
    expect(popup[0]?.textContent).toContain(first?.name);
    expect(root.querySelector(`[data-marker="${hotspots[0]}"] button`)?.getAttribute('aria-expanded')).toBe('true');
    // The close button and Escape both dismiss it.
    await act(() => (root.querySelector('[data-map-popup] button[aria-label="Close"]') as HTMLButtonElement).click());
    expect(root.querySelector('[data-map-popup]')).toBeNull();
    await act(() => (root.querySelector(`[data-marker="${hotspots[1]}"] button`) as HTMLButtonElement).click());
    expect(root.querySelector('[data-map-popup]')?.getAttribute('data-map-popup')).toBe(hotspots[1]);
    await act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(root.querySelector('[data-map-popup]')).toBeNull();

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
    expect(root.querySelector('[data-testid="derivatives"] [data-sample="true"]')).not.toBeNull();

    await act(() => (root.querySelector('[data-nav="tech"]') as HTMLAnchorElement).click());
    await flush();
    expect(location.pathname).toBe('/lite/tech');
    const development = root.querySelector('[data-development]');
    expect(development?.textContent).toContain('Lab releases open-weights model');
    expect(development?.textContent).toContain('Benchmarks self-reported.');
    expect(development?.textContent).toContain('Single source');
    expect(root.querySelectorAll('[data-testid="model-tracker"] [data-sample-row]')).toHaveLength(4);
    expect(root.querySelector('[data-testid="model-tracker"] [data-sample="true"]')).not.toBeNull();
  });
});
