// World Monitor Lite UI (`/lite`, docs/engineering/architecture/lite.md "Lite UI").
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
  closeToCloseBars,
  corroborationOf,
  decodeEntities,
  digestItems,
  dropNearDuplicates,
  evidenceClassOf,
  evidenceMix,
  fearGreedState,
  publisherCount,
  interleaveByMarketTag,
  isWarStory,
  realizedVolatility,
  regionOfCategory,
  regionOfPoint,
  relativeTime,
  returnCorrelation,
  thresholdState,
  timeBuckets,
} from '../src/lite/data/transforms.ts';
import { UCDP_MARKER_LIMIT, eventDates, formatCoordinates, ucdpMarkers } from '../src/lite/data/ucdp.ts';
import type { UcdpViolenceEvent } from '../src/generated/client/worldmonitor/conflict/v1/service_client.ts';
import { OPENFREEMAP_TILEJSON, buildLiteMapStyle } from '../src/lite/map/style.ts';
import { WORLD_BOUNDS, markerBounds } from '../src/lite/map/view.ts';
import type { ListFeedDigestResponse, NewsItem } from '../src/generated/client/worldmonitor/news/v1/service_client.ts';
import {
  PRIORITY_THRESHOLD,
  corroborationSentence,
  domainOfCategory,
  evaluateWatchRules,
  evidenceLine,
  marketRegime,
  momentum,
  priorityScore,
  rankPriorityEvents,
  sigmaMove,
  sinceStats,
  trendLabel,
} from '../src/lite/data/briefing.ts';
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
  it('maps /lite to the Briefing, its children to the domain screens, and unknown paths to the Briefing', () => {
    assert.equal(parseLiteScreen('/lite'), 'briefing');
    assert.equal(parseLiteScreen('/lite/'), 'briefing');
    assert.equal(parseLiteScreen('/lite/geopolitics'), 'geopolitics');
    assert.equal(parseLiteScreen('/lite/finance'), 'finance');
    assert.equal(parseLiteScreen('/lite/tech/'), 'tech');
    assert.equal(parseLiteScreen('/lite/unknown'), 'briefing');
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

  it('lets exactly the four Lite paths through the unknown-page 404 gate', () => {
    delete process.env.VITE_LITE_PROFILE;
    for (const path of ['/lite', '/lite/', '/lite/geopolitics', '/lite/finance', '/lite/tech']) {
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

  it('keeps one copy of a story reworded across buckets and outlets', () => {
    // Real headlines from one finance digest: the same sanctions story five times.
    const titles = [
      'US Treasury sanctions eight Canadian money exchange firms over Iran ties - Reuters',
      'US sanctions Canadian money-exchange firms over Iran ties',
      'US Treasury sanctions Canadian money services firms over Iran-related activity',
      'US Sanctions Eight Canadian Money Firms Over Alleged Iran Crypto Links',
      'Bank of Japan signals December rate hike after inflation reaches 2.1%',
      'ECB Candidate de Cos Says Vigilance Needed on Inflation Risks - Bloomberg',
    ];
    const out = dropNearDuplicates(titles.map((title) => ({ title })));
    assert.deepEqual(out.map((i) => i.title), [titles[0], titles[4], titles[5]]);
  });

  it('takes market stories in turns across asset classes', () => {
    const ranked = [
      { ...item({ title: 'a1' }), category: 'crypto' },
      { ...item({ title: 'a2' }), category: 'crypto' },
      { ...item({ title: 'a3' }), category: 'crypto' },
      { ...item({ title: 'r1' }), category: 'centralbanks' },
      { ...item({ title: 'r2' }), category: 'bonds' },
      { ...item({ title: 'c1' }), category: 'ipo' },
    ];
    // Classes start in the order their first story ranks; bonds and central banks are both RATES.
    assert.deepEqual(interleaveByMarketTag(ranked).map((i) => i.title), ['a1', 'r1', 'c1', 'a2', 'r2', 'a3']);
    assert.deepEqual(interleaveByMarketTag([]), []);
  });

  it('leaves war stories to Geopolitics but keeps sanctions in finance', () => {
    const threat = (category: string) => item({ threat: { level: 'THREAT_LEVEL_HIGH', category, confidence: 0.8, source: 'keyword' } } as Partial<NewsItem>);
    for (const category of ['conflict', 'military', 'terrorism']) assert.equal(isWarStory(threat(category)), true, category);
    for (const category of ['economic', 'diplomatic', 'protest', 'general']) assert.equal(isWarStory(threat(category)), false, category);
    assert.equal(isWarStory(item()), false);
  });

  it('uses the dashboard corroboration verdict, which tier 1 never upgrades', () => {
    // Same publishers, same verdict, whichever outlet the item came from.
    assert.deepEqual(corroborationOf(item({ source: 'Reuters', corroborationCount: 3 })), { state: 'corroborated', publishers: 3 });
    assert.deepEqual(corroborationOf(item({ source: 'Some Blog', corroborationCount: 3 })), { state: 'corroborated', publishers: 3 });
    assert.deepEqual(corroborationOf(item({ source: 'Reuters', corroborationCount: 1 })), { state: 'single-publisher', publishers: 1 });
    // No server count is unknown, never a confident "one source".
    assert.deepEqual(corroborationOf(item({ source: 'Reuters', corroborationCount: 0 })), { state: 'unknown' });
    // storyMeta.sourceCount is report volume; the verdict counts publishers only.
    const reprinted = item({ corroborationCount: 1, storyMeta: { firstSeen: 0, mentionCount: 1, sourceCount: 5, phase: 'STORY_PHASE_DEVELOPING' } });
    assert.equal(corroborationOf(reprinted).state, 'single-publisher');
    assert.equal(publisherCount({ state: 'unknown' }), null);
  });

  it('words the verdict without claiming truth', () => {
    assert.equal(evidenceLine(item({ source: 'Reuters', corroborationCount: 3 })), '3 publishers · tier 1');
    assert.equal(evidenceLine(item({ source: 'Some Blog', corroborationCount: 1 })), 'single publisher');
    assert.equal(evidenceLine(item({ source: 'Reuters', corroborationCount: 0 })), 'publisher count unknown · tier 1');
    assert.equal(corroborationSentence({ state: 'corroborated', publishers: 4 }), '4 publishers carry the story');
    assert.equal(corroborationSentence({ state: 'tier4-only', publishers: 2 }), '2 publishers, all aggregators or blogs');
    assert.equal(corroborationSentence({ state: 'unknown' }), 'The digest carried no publisher count');
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

describe('Lite Briefing rules', () => {
  const lite = (overrides: Partial<NewsItem> & { category?: string } = {}) => ({ category: 'europe', ...item(overrides) });

  it('maps digest and insights buckets to the three domains', () => {
    assert.equal(domainOfCategory('middleeast'), 'geo');
    assert.equal(domainOfCategory('crypto'), 'fin');
    assert.equal(domainOfCategory('finance'), 'fin');
    assert.equal(domainOfCategory('ai'), 'tech');
    assert.equal(domainOfCategory('tech'), 'tech');
    assert.equal(domainOfCategory('something-new'), 'geo');
  });

  it('ranks by impact × confidence above the threshold and counts the rest', () => {
    assert.equal(priorityScore({ importanceScore: 80, credibilityScore: 50 }), 40);
    const { ranked, below } = rankPriorityEvents([
      { domain: 'geo', items: [lite({ title: 'A', importanceScore: 90, credibilityScore: 30 }), lite({ title: 'B', importanceScore: 60, credibilityScore: 90 })] },
      { domain: 'fin', items: [lite({ title: 'b', importanceScore: 99, credibilityScore: 99 }), lite({ title: 'C', importanceScore: PRIORITY_THRESHOLD - 1, credibilityScore: 99 })] },
    ]);
    assert.deepEqual(ranked.map((e) => [e.title, e.domain, e.priority]), [['B', 'geo', 54], ['A', 'geo', 27]]);
    assert.deepEqual(below.map((e) => e.title), ['C']);
  });

  it('reads story phase as momentum and day-over-day change as a trend', () => {
    assert.equal(momentum('STORY_PHASE_BREAKING').label, 'rising');
    assert.equal(momentum('STORY_PHASE_FADING').label, 'fading');
    assert.equal(momentum(undefined).label, 'steady');
    assert.equal(trendLabel(140)?.label, 'escalating');
    assert.equal(trendLabel(4)?.label, 'stable');
    assert.equal(trendLabel(-18)?.label, 'de-escalating');
    assert.equal(trendLabel(null), null);
  });

  it('calls a risk-off tilt only with a lead of two signals, and needs three known moves', () => {
    assert.equal(marketRegime({ oil: 2.9, btc: -4.8, usd: 0.3, spx: -0.4, gold: 0.8 })?.label, 'Risk-off tilt');
    assert.equal(marketRegime({ oil: 2.9, btc: -4.8, usd: 0.3 })?.why, 'oil ↑, crypto ↓, USD ↑');
    assert.equal(marketRegime({ btc: 3, usd: -0.5, spx: 1 })?.label, 'Risk-on tilt');
    assert.equal(marketRegime({ btc: 3, usd: 0.5, spx: 0 })?.label, 'No clear tilt');
    assert.equal(marketRegime({ btc: -5, oil: 3 }), null);
  });

  it('measures the last 2h move in sigmas of the series itself', () => {
    const calm = Array.from({ length: 40 }, (_, i) => 100 + (i % 2 ? 0.1 : -0.1));
    assert.ok(Math.abs(sigmaMove(calm)?.z ?? 99) < 4);
    const crash = [...calm, 99.9, 95];
    const move = sigmaMove(crash);
    assert.ok((move?.z ?? 0) < -4);
    assert.ok((move?.movePct ?? 0) < -4);
    assert.equal(sigmaMove([1, 2, 3]), null);
  });

  it('fires watch rules only on recent, qualifying input', () => {
    const now = Date.UTC(2026, 10, 7, 12);
    const fresh = { storyMeta: { firstSeen: now - 3_600_000, mentionCount: 1, sourceCount: 3, phase: 'STORY_PHASE_BREAKING' as const } };
    const stale = { storyMeta: { firstSeen: now - 2 * 86_400_000, mentionCount: 1, sourceCount: 3, phase: 'STORY_PHASE_SUSTAINED' as const } };
    const { ranked } = rankPriorityEvents([
      { domain: 'geo', items: [
        lite({ title: 'Strike', importanceScore: 85, credibilityScore: 60, ...fresh }),
        lite({ title: 'Old', importanceScore: 90, credibilityScore: 90, ...stale }),
        lite({ title: 'Weak', importanceScore: 85, credibilityScore: 20, ...fresh }),
      ] },
    ]);
    const alerts = evaluateWatchRules({
      events: ranked,
      btcCloses: [],
      techItems: [lite({ title: 'Rule', category: 'policy', source: 'Reuters', ...fresh }), lite({ title: 'Blog', category: 'policy', ...fresh })],
      now,
    });
    assert.deepEqual(alerts.map((a) => a.title).sort(), ['Rule', 'Strike']);
    assert.deepEqual(sinceStats(ranked, now - 2 * 3_600_000), { fresh: 2, breaking: 2, fading: 0 });
  });
});

describe('Lite conflict map', () => {
  it('builds a low-noise OpenFreeMap style from the Lite tokens', () => {
    const tokens = { bg: '#000001', surface: '#000002', track: '#000003', dim: '#000004' };
    const style = buildLiteMapStyle(tokens);
    assert.deepEqual(Object.keys(style.sources), ['openmaptiles']);
    assert.equal((style.sources.openmaptiles as { url: string }).url, OPENFREEMAP_TILEJSON);
    assert.match(style.glyphs ?? '', /^https:\/\/tiles\.openfreemap\.org\/fonts\//);
    const byId = new Map(style.layers.map((l) => [l.id, l as { paint?: Record<string, unknown>; 'source-layer'?: string }]));
    assert.equal(byId.get('land')?.paint?.['background-color'], tokens.surface);
    assert.equal(byId.get('water')?.paint?.['fill-color'], tokens.bg);
    assert.equal(byId.get('country-border')?.paint?.['line-color'], tokens.track);
    assert.equal(byId.get('country-label')?.paint?.['text-color'], tokens.dim);
    // Land, water, borders and place names only: no roads, buildings or POIs.
    const sourceLayers = new Set(style.layers.map((l) => (l as { 'source-layer'?: string })['source-layer']).filter(Boolean));
    assert.deepEqual([...sourceLayers].sort(), ['boundary', 'place', 'water']);
  });

  const ucdpEvent = (over: Partial<UcdpViolenceEvent>): UcdpViolenceEvent => ({
    id: '1',
    dateStart: Date.UTC(2026, 8, 30),
    dateEnd: Date.UTC(2026, 8, 30),
    location: { latitude: 13.579522, longitude: 44.020908 },
    country: 'Yemen (North Yemen)',
    sideA: 'Government of Yemen (North Yemen)',
    sideB: 'Forces of the Presidential Leadership Council',
    deathsBest: 3,
    deathsLow: 2,
    deathsHigh: 5,
    violenceType: 'UCDP_VIOLENCE_TYPE_STATE_BASED',
    sourceOriginal: 'Local sources; CIMP',
    ...over,
  });

  it('places one UCDP marker per event location, with the event details', () => {
    const near = ucdpEvent({ id: '2', location: { latitude: 13.6, longitude: 44.1 }, deathsBest: 1, deathsLow: 1, deathsHigh: 1 });
    const { markers, locations } = ucdpMarkers([ucdpEvent({}), near], 'all');
    // 0.08° apart: two markers at the recorded coordinates, not one grid cell.
    assert.equal(locations, 2);
    assert.deepEqual(markers.map((m) => [m.lat, m.lon]), [[13.579522, 44.020908], [13.6, 44.1]]);
    const [first] = markers;
    assert.equal(first?.id, 'ucdp:13.579522,44.020908');
    assert.equal(first?.popup.kind, 'UCDP · State-based violence');
    assert.equal(first?.popup.name, 'Yemen (North Yemen)');
    assert.equal(first?.popup.value, '3 deaths');
    assert.deepEqual(first?.popup.lines, [
      'Government of Yemen (North Yemen) vs Forces of the Presidential Leadership Council',
      '2026-09-30 · best estimate 3, range 2–5',
      '13.580°N, 44.021°E',
      'Source: Local sources; CIMP',
    ]);
    assert.equal(markers[1]?.popup.lines[1], '2026-09-30');
  });

  it('lists every event UCDP geocodes to the same point in one popup, newest first', () => {
    const events = [1, 2, 3, 4, 5, 6].map((d) => ucdpEvent({ id: String(d), dateStart: Date.UTC(2026, 8, d), dateEnd: Date.UTC(2026, 8, d), deathsBest: 1 }));
    const { markers } = ucdpMarkers(events, 'all');
    assert.equal(markers.length, 1);
    const popup = markers[0]?.popup;
    assert.equal(popup?.kind, 'UCDP · 6 events at this point');
    assert.equal(popup?.value, '6 deaths');
    assert.equal(popup?.lines[0], '13.580°N, 44.021°E');
    assert.match(popup?.lines[1] ?? '', /^2026-09-06 · State-based · Government of Yemen/);
    assert.equal(popup?.lines.at(-1), '2 more events at this point');
  });

  it('filters UCDP markers by region and caps them at the deadliest locations', () => {
    const kyiv = ucdpEvent({ id: 'k', location: { latitude: 50.4, longitude: 30.5 }, country: 'Ukraine' });
    assert.deepEqual(ucdpMarkers([ucdpEvent({}), kyiv], 'europe').markers.map((m) => m.popup.name), ['Ukraine']);
    const many = Array.from({ length: UCDP_MARKER_LIMIT + 5 }, (_, i) => ucdpEvent({ id: String(i), location: { latitude: 10, longitude: i * 0.1 }, deathsBest: i }));
    const capped = ucdpMarkers(many, 'all');
    assert.equal(capped.locations, UCDP_MARKER_LIMIT + 5);
    assert.equal(capped.markers.length, UCDP_MARKER_LIMIT);
    assert.equal(capped.markers[0]?.popup.value, `${UCDP_MARKER_LIMIT + 4} deaths`);
  });

  it('formats UCDP coordinates and multi-day events', () => {
    assert.equal(formatCoordinates(-1.5, -70.25), '1.500°S, 70.250°W');
    assert.equal(eventDates({ dateStart: Date.UTC(2026, 8, 24), dateEnd: Date.UTC(2026, 8, 26) }), '2026-09-24 to 2026-09-26');
    assert.equal(eventDates({ dateStart: 0, dateEnd: 0 }), 'Date unknown');
  });

  it('fits the world, or the markers padded to at least 8°', () => {
    assert.deepEqual(markerBounds([]), WORLD_BOUNDS);
    // One point: an 8° box around it.
    assert.deepEqual(markerBounds([{ lat: 50, lon: 30 }]), [[26, 46], [34, 54]]);
    // A wide spread: 2° of padding, clamped to the world.
    assert.deepEqual(markerBounds([{ lat: 10, lon: -178 }, { lat: 60, lon: 40 }]), [[-180, 8], [42, 62]]);
  });
});
