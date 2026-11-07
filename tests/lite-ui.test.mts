// World Monitor Lite UI (`/lite`, docs/architecture/lite.md "Lite UI").
// Covers the pure parts: routing, the default-route redirect in middleware.ts
// and src/main.ts, and the labelled heuristics the widgets display.
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LITE_SCREEN_PATHS,
  parseLiteScreen,
  shouldRedirectToLite,
} from '../src/config/lite-route.ts';
import {
  claimStatus,
  closeToCloseBars,
  decodeEntities,
  digestItems,
  evidenceClassOf,
  evidenceMix,
  fearGreedState,
  realizedVolatility,
  regionOfCategory,
  regionOfPoint,
  relativeTime,
  returnCorrelation,
  thresholdState,
  timeBuckets,
} from '../src/lite/data/transforms.ts';
import type { ListFeedDigestResponse, NewsItem } from '../src/generated/client/worldmonitor/news/v1/service_client.ts';
import middleware from '../middleware.ts';

function item(overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    source: 'Some Blog',
    title: 'Headline',
    link: 'https://example.com/a',
    publishedAt: 0,
    isAlert: false,
    locationName: '',
    importanceScore: 50,
    corroborationCount: 1,
    snippet: '',
    tickers: [],
    credibilityScore: 50,
    ...overrides,
  };
}

describe('Lite routes', () => {
  it('maps paths to the three screens and falls back to Geopolitics', () => {
    assert.equal(parseLiteScreen('/lite'), 'geopolitics');
    assert.equal(parseLiteScreen('/lite/'), 'geopolitics');
    assert.equal(parseLiteScreen('/lite/finance'), 'finance');
    assert.equal(parseLiteScreen('/lite/tech/'), 'tech');
    assert.equal(parseLiteScreen('/lite/unknown'), 'geopolitics');
    for (const [screen, path] of Object.entries(LITE_SCREEN_PATHS)) assert.equal(parseLiteScreen(path), screen);
  });
});

describe('Lite default route (client guard in src/main.ts)', () => {
  const on = { enabled: true, fullDashboardInSession: false };

  it('sends / and /dashboard to /lite only when the profile is on', () => {
    assert.equal(shouldRedirectToLite('/', '', on), true);
    assert.equal(shouldRedirectToLite('/dashboard', '', on), true);
    assert.equal(shouldRedirectToLite('/dashboard/', '', on), true);
    assert.equal(shouldRedirectToLite('/', '', { ...on, enabled: false }), false);
    assert.equal(shouldRedirectToLite('/dashboard', '', { ...on, enabled: false }), false);
  });

  it('keeps the full dashboard reachable with ?full=1 or a remembered session', () => {
    assert.equal(shouldRedirectToLite('/dashboard', '?full=1', on), false);
    assert.equal(shouldRedirectToLite('/dashboard', '', { ...on, fullDashboardInSession: true }), false);
  });

  it('never hijacks a shared map view, deep link or standalone window', () => {
    for (const query of ['?lat=1&lon=2', '?layers=conflicts', '?country=UA', '?settings=1', '?live-channels=1', '?c=IR']) {
      assert.equal(shouldRedirectToLite('/dashboard', query, on), false, query);
    }
    assert.equal(shouldRedirectToLite('/stocks', '', on), false);
    assert.equal(shouldRedirectToLite('/lite', '', on), false);
  });
});

describe('Lite default route (middleware.ts)', () => {
  const original = process.env.VITE_LITE_PROFILE;
  afterEach(() => {
    if (original === undefined) delete process.env.VITE_LITE_PROFILE;
    else process.env.VITE_LITE_PROFILE = original;
  });
  const request = (path: string) =>
    new Request(`https://monitor.example.com${path}`, { headers: { host: 'monitor.example.com', 'user-agent': 'Mozilla/5.0', accept: 'text/html' } });

  it('307s / to /lite with the query when the profile is on', () => {
    process.env.VITE_LITE_PROFILE = 'true';
    const resp = middleware(request('/?utm_source=x')) as Response;
    assert.equal(resp.status, 307);
    assert.equal(resp.headers.get('location'), 'https://monitor.example.com/lite?utm_source=x');
    assert.match(resp.headers.get('cache-control') ?? '', /no-store/);
  });

  it('leaves / alone when the profile is off', () => {
    delete process.env.VITE_LITE_PROFILE;
    const resp = middleware(request('/')) as Response | undefined;
    assert.notEqual(resp?.status, 307);
    assert.notEqual(resp?.headers.get('location'), 'https://monitor.example.com/lite');
  });

  it('still sends a legacy map link to the dashboard when the profile is on', () => {
    process.env.VITE_LITE_PROFILE = 'true';
    const resp = middleware(request('/?lat=10&lon=20')) as Response;
    assert.equal(resp.status, 308);
    assert.match(resp.headers.get('location') ?? '', /\/dashboard\?lat=10&lon=20$/);
  });

  it('applies the same rule as the client guard: ?full=1 and dashboard state keep the dashboard', () => {
    process.env.VITE_LITE_PROFILE = 'true';
    for (const query of ['?full=1', '?preset=lite-desk', '?mission=x', '?settings=1', '?live-channels=1', '?expanded=1']) {
      const resp = middleware(request(`/${query}`)) as Response | undefined;
      assert.notEqual(resp?.status, 307, query);
    }
  });

  it('lets exactly the three Lite paths through the unknown-page 404 gate', () => {
    delete process.env.VITE_LITE_PROFILE;
    for (const path of ['/lite', '/lite/', '/lite/finance', '/lite/tech']) {
      const resp = middleware(request(path)) as Response | undefined;
      assert.notEqual(resp?.status, 404, path);
    }
    const unknown = middleware(request('/lite/unknown')) as Response | undefined;
    assert.equal(unknown?.status, 404);
  });
});

describe('Lite transforms', () => {
  it('flattens digest buckets, keeps the bucket name and drops repeated titles', () => {
    const digest = {
      categories: {
        europe: { items: [item({ title: 'A' }), item({ title: 'B' })] },
        intel: { items: [item({ title: 'a ' })] },
      },
    } as unknown as ListFeedDigestResponse;
    const out = digestItems(digest);
    assert.deepEqual(out.map((i) => [i.title, i.category]), [['A', 'europe'], ['B', 'europe']]);
    assert.deepEqual(digestItems(null), []);
  });

  it('labels corroboration, never truth', () => {
    assert.equal(claimStatus(item({ source: 'Reuters', corroborationCount: 3 })), 'confirmed');
    assert.equal(claimStatus(item({ source: 'Some Blog', corroborationCount: 3 })), 'attributed');
    assert.equal(claimStatus(item({ source: 'Reuters', corroborationCount: 1 })), 'unverified');
  });

  it('splits sources into classes whose shares sum to 1', () => {
    assert.equal(evidenceClassOf('Reuters'), 'wire');
    const mix = evidenceMix([item({ source: 'Reuters' }), item({ source: 'Some Blog' }), item({ source: 'Reuters' })]);
    assert.equal(Math.round(mix.reduce((s, c) => s + c.share, 0) * 1000), 1000);
    assert.equal(mix.find((c) => c.key === 'wire')?.count, 2);
    assert.ok(evidenceMix([]).every((c) => c.share === 0));
  });

  it('buckets timestamps oldest to newest and ignores the future and the too-old', () => {
    const now = 100 * 3_600_000;
    const buckets = timeBuckets([now - 1, now - 3_600_000 * 2.5, now + 5, now - 3_600_000 * 10], now, 4, 4);
    assert.deepEqual(buckets, [0, 1, 0, 1]);
  });

  it('computes realized volatility and return correlation', () => {
    assert.equal(realizedVolatility([100]), null);
    assert.equal(realizedVolatility([100, 100, 100]), 0);
    const up = [100, 101, 103, 102, 105, 107];
    assert.ok((realizedVolatility(up) ?? 0) > 0);
    assert.ok(Math.abs((returnCorrelation(up, up) ?? 0) - 1) < 1e-9);
    assert.ok((returnCorrelation(up, up.map((v) => 1 / v)) ?? 0) < -0.99);
    assert.equal(returnCorrelation([1, 2], [1, 2]), null);
  });

  it('builds close-to-close bars without inventing highs or lows', () => {
    assert.deepEqual(closeToCloseBars([10, 12, 11]), [
      { open: 10, close: 12, up: true },
      { open: 12, close: 11, up: false },
    ]);
  });

  it('grades thresholds and sentiment extremes, and reports missing data as null', () => {
    assert.equal(thresholdState(-4.8, 2.5, 4), 'triggered');
    assert.equal(thresholdState(3, 2.5, 4), 'watching');
    assert.equal(thresholdState(0.4, 2.5, 4), 'normal');
    assert.equal(thresholdState(undefined, 2.5, 4), null);
    assert.equal(fearGreedState(12), 'triggered');
    assert.equal(fearGreedState(72), 'watching');
    assert.equal(fearGreedState(50), 'normal');
    assert.equal(fearGreedState(0), null);
  });

  it('places regions by bucket and by coordinates', () => {
    assert.equal(regionOfCategory('middleeast'), 'middleeast');
    assert.equal(regionOfCategory('intel'), null);
    assert.equal(regionOfPoint(15.5, 43), 'middleeast'); // Bab el-Mandeb
    assert.equal(regionOfPoint(50.4, 30.5), 'europe'); // Kyiv
    assert.equal(regionOfPoint(14, -1), 'africa'); // Sahel
    assert.equal(regionOfPoint(24, 120), 'asia'); // Taiwan Strait
    assert.equal(regionOfPoint(40, -100), null);
  });

  it('decodes feed entities to plain text and formats relative times', () => {
    assert.equal(decodeEntities('A&nbsp;&amp;&nbsp;B &#39;x&#39; &#x2014;'), "A & B 'x' —");
    const now = Date.UTC(2026, 10, 7, 12);
    assert.equal(relativeTime(now - 38 * 60_000, now), '38m');
    assert.equal(relativeTime(now - 3 * 3_600_000, now), '3h');
    assert.equal(relativeTime(0, now), '—');
  });
});
