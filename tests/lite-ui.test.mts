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
import { actorName, eventDates, eventSpan, formatCoordinates, ucdpBackgroundLabel, ucdpMarkers, ucdpNewest } from '../src/lite/data/ucdp.ts';
import { CONVERGENCE_RADIUS_KM, MILITARY_RADIUS_KM, escalationLevel, scoreHotspots } from '../src/lite/data/escalation.ts';
import { computeEscalationScore } from '../shared/analysis-hotspot-escalation.ts';
import { TIME_RANGE_HOURS, inTimeRange } from '../src/lite/data/transforms.ts';
import type { Hotspot } from '../src/types/index.ts';
import type { UcdpViolenceEvent } from '../src/generated/client/worldmonitor/conflict/v1/service_client.ts';
import { OPENFREEMAP_TILEJSON, buildLiteMapStyle } from '../src/lite/map/style.ts';
import { WORLD_BOUNDS, compactCount, markerBounds, placeCard, ucdpRadius } from '../src/lite/map/view.ts';
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
import {
  FLAT_MOVE,
  buildPriceBoard,
  eventTag,
  geoCause,
  isMarketMovingWarStory,
  linkPriceMoves,
  namedInstruments,
  priceMoveLabel,
} from '../src/lite/data/prices.ts';
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

  it('keeps a war story as a market event only when its headline names an instrument', () => {
    const war = (title: string) => item({ title, threat: { level: 'THREAT_LEVEL_HIGH', category: 'conflict', confidence: 0.8, source: 'keyword' } } as Partial<NewsItem>);
    assert.equal(isMarketMovingWarStory(war('Brent jumps after drone strike on Saudi refinery')), true);
    assert.equal(isMarketMovingWarStory(war('Shelling kills 12 in Kharkiv')), false);
    assert.equal(isMarketMovingWarStory(war('Forces pound the city as dollar aid stalls')), false, 'FX words do not admit a war story');
    assert.equal(isMarketMovingWarStory(item({ title: 'Gold hits record' })), false, 'not a war story');
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
    assert.equal(first?.deaths, 3);
    // The design's event card: actors, then date and coordinates in mono, then small print.
    assert.deepEqual(first?.popup.lines, [
      { text: 'Government of Yemen (North Yemen) vs Forces of the Presidential Leadership Council' },
      { text: '2026-09-30 · 13.580°N, 44.021°E', style: 'mono' },
      { text: 'Best estimate 3, range 2–5', style: 'dim' },
      { text: 'Source: Local sources; CIMP', style: 'dim' },
    ]);
    // No range when UCDP's low and high agree.
    assert.deepEqual(markers[1]?.popup.lines.map((l) => l.text).slice(1, 3), ['2026-09-30 · 13.600°N, 44.100°E', 'Source: Local sources; CIMP']);
  });

  it('summarises two or more events at one point: date span, violence types, actors, sources', () => {
    const events = [1, 2, 3, 4, 5, 6].map((d) => ucdpEvent({ id: String(d), dateStart: Date.UTC(2026, 8, d), dateEnd: Date.UTC(2026, 8, d), deathsBest: 1 }));
    events[5] = { ...events[5]!, violenceType: 'UCDP_VIOLENCE_TYPE_ONE_SIDED', sideA: 'XXX678', sideB: 'Civilians', sourceOriginal: 'Yemen Monitor' };
    const { markers } = ucdpMarkers(events, 'all');
    assert.equal(markers.length, 1);
    const popup = markers[0]?.popup;
    assert.equal(popup?.kind, 'UCDP · 6 events at this point');
    assert.equal(popup?.value, '6 deaths');
    assert.deepEqual(popup?.lines, [
      { text: '2026-09-01 to 2026-09-06 · 13.580°N, 44.021°E', style: 'mono' },
      { text: 'State-based ×5 · One-sided ×1' },
      { text: 'Government of Yemen (North Yemen) vs Forces of the Presidential Leadership Council ×5, and 1 other actor pair' },
      { text: 'Sources: Local sources; CIMP; Yemen Monitor', style: 'dim' },
    ]);
    // Two events already summarise; one shared actor pair is named once.
    const two = ucdpMarkers(events.slice(0, 2), 'all').markers[0]?.popup;
    assert.equal(two?.kind, 'UCDP · 2 events at this point');
    assert.equal(two?.lines[2]?.text, 'Government of Yemen (North Yemen) vs Forces of the Presidential Leadership Council');
  });

  it("names UCDP's unidentified-actor codes and spans multi-day points", () => {
    assert.equal(actorName('XXX100'), 'Unidentified group (UCDP XXX100)');
    assert.equal(actorName('Government of Colombia'), 'Government of Colombia');
    assert.equal(actorName('XXX-Clan'), 'XXX-Clan');
    const xxx = ucdpMarkers([ucdpEvent({ sideA: 'XXX100', sideB: 'XXX100' })], 'all').markers[0];
    assert.equal(xxx?.popup.lines[0]?.text, 'Unidentified group (UCDP XXX100) vs Unidentified group (UCDP XXX100)');
    assert.equal(eventSpan([{ dateStart: Date.UTC(2026, 8, 3), dateEnd: Date.UTC(2026, 8, 3) }]), '2026-09-03');
    assert.equal(eventSpan([{ dateStart: Date.UTC(2026, 8, 3), dateEnd: Date.UTC(2026, 8, 5) }, { dateStart: Date.UTC(2026, 8, 1), dateEnd: 0 }]), '2026-09-01 to 2026-09-05');
  });

  it('labels UCDP as the verified background with its newest date, whatever the range', () => {
    const events = [ucdpEvent({ dateStart: Date.UTC(2026, 8, 30) }), ucdpEvent({ dateStart: Date.UTC(2026, 8, 3) }), ucdpEvent({ dateStart: 0 })];
    assert.equal(ucdpNewest(events), Date.UTC(2026, 8, 30));
    assert.equal(ucdpBackgroundLabel(ucdpNewest(events)), 'UCDP to 2026-09-30 · verified background');
    assert.equal(ucdpBackgroundLabel(0), 'UCDP · verified background');
  });

  it('filters UCDP markers by region and keeps every location, deadliest first', () => {
    const kyiv = ucdpEvent({ id: 'k', location: { latitude: 50.4, longitude: 30.5 }, country: 'Ukraine' });
    assert.deepEqual(ucdpMarkers([ucdpEvent({}), kyiv], 'europe').markers.map((m) => m.popup.name), ['Ukraine']);
    // The map clusters by zoom, so no location is dropped to bound the DOM.
    const many = Array.from({ length: 405 }, (_, i) => ucdpEvent({ id: String(i), location: { latitude: 10, longitude: i * 0.1 }, deathsBest: i }));
    const all = ucdpMarkers(many, 'all');
    assert.equal(all.locations, 405);
    assert.equal(all.markers.length, 405);
    assert.equal(all.markers[0]?.popup.value, '404 deaths');
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

describe('Lite hotspot live escalation', () => {
  const NOW = Date.UTC(2026, 10, 8, 12);
  const kyiv: Hotspot = { id: 'kyiv', name: 'Kyiv', lat: 50.45, lon: 30.52, keywords: ['kyiv', 'ukraine'], escalationScore: 5 };
  const near = { latitude: 50.5, longitude: 30.6 }; // ~8 km from Kyiv
  const far = { latitude: 48.0, longitude: 37.8 }; // ~590 km away
  const none = { news: null, ciiScores: null, unrest: null, earthquakes: null, flights: null };

  it('scores with the shared core, reading only the inputs inside each window and radius', () => {
    const feeds = {
      news: [
        { title: 'Strikes hit Kyiv overnight', publishedAt: NOW - 30 * 60_000 },
        { title: 'Ukraine talks resume', publishedAt: NOW - 90 * 60_000 },
        { title: 'Kyiv power restored', publishedAt: NOW - 3 * 3_600_000 }, // outside the 2 h window
        { title: 'Unrelated market news', publishedAt: NOW - 10 * 60_000 },
      ],
      ciiScores: [{ region: 'UA', combinedScore: 72 }, { region: 'RU', combinedScore: 40 }],
      unrest: [
        { location: near, occurredAt: NOW - 3_600_000 },
        { location: far, occurredAt: NOW - 3_600_000 },
      ],
      earthquakes: [{ location: near, occurredAt: NOW - 3_600_000 }],
      flights: [
        { location: { latitude: 51.4, longitude: 30.5 }, lastSeenAt: NOW - 60_000 }, // ~105 km
        { location: { latitude: 53.0, longitude: 30.5 }, lastSeenAt: NOW - 60_000 }, // ~285 km
      ],
    } as unknown as Parameters<typeof scoreHotspots>[1];
    const [result] = scoreHotspots([kyiv], feeds, NOW);
    assert.deepEqual(result?.missing, []);
    // Two headlines in 2 h: the dashboard's matches, breaking flag and velocity.
    assert.equal(result?.score.components.newsActivity, 2 * 15 + 30 + 1 * 5);
    assert.equal(result?.score.components.ciiContribution, 72);
    assert.equal(result?.score.components.militaryActivity, 10);
    // Protest + earthquake (+ the flight) converge within 150 km; the far protest does not count.
    assert.ok((result?.score.components.geoConvergence ?? 0) > 0);
    assert.equal(CONVERGENCE_RADIUS_KM, 150);
    assert.equal(MILITARY_RADIUS_KM, 200);
    // No second formula: the same inputs through the shared core give the same score.
    const direct = computeEscalationScore(kyiv, {
      newsMatches: 2, hasBreaking: true, newsVelocity: 1, ciiScore: 72,
      geoAlertScore: 0, geoAlertTypes: 0, flightsNearby: 1, vesselsNearby: 0,
    }, { now: NOW });
    assert.equal(result?.score.components.newsActivity, direct.components.newsActivity);
    assert.equal(result?.score.staticBaseline, 5);
  });

  it('names missing feeds and scores them as the shared core scores absent inputs', () => {
    const [result] = scoreHotspots([kyiv], none, NOW);
    assert.deepEqual(result?.missing, ['news', 'countryRisk', 'unrest', 'earthquakes', 'militaryFlights']);
    assert.deepEqual(result?.score.components, { newsActivity: 0, ciiContribution: 30, geoConvergence: 0, militaryActivity: 0 });
    // Baseline 5 alone: 0.3 × 5 + 0.7 × (1 + 0.3) = 2.41, the dashboard's "watch" level.
    assert.equal(result?.score.combinedScore, 2.4);
    assert.equal(escalationLevel(result?.score.combinedScore ?? 0).label, 'Watch');
  });

  it('maps the live score to the dashboard levels; every level is drawn, names from elevated up', () => {
    assert.deepEqual(escalationLevel(4.6), { tone: 'crit', label: 'Critical', named: true });
    assert.deepEqual(escalationLevel(3.6), { tone: 'high', label: 'High', named: true });
    assert.deepEqual(escalationLevel(2.5), { tone: 'elev', label: 'Elevated', named: true });
    assert.deepEqual(escalationLevel(2.4), { tone: 'muted', label: 'Watch', named: false });
    assert.deepEqual(escalationLevel(1.2), { tone: 'muted', label: 'Stable', named: false });
  });
});

describe('Lite conflict map layout', () => {
  it('sizes UCDP circles by deaths and labels them compactly', () => {
    assert.equal(ucdpRadius(0), 6);
    assert.ok(ucdpRadius(412) > ucdpRadius(58));
    assert.equal(ucdpRadius(1_000_000), 26);
    assert.deepEqual([412, 1200, 6998, 15_400].map(compactCount), ['412', '1.2k', '7k', '15k']);
  });

  it('places the card away from the map centre and inside the map, with the leader line on its nearest edge', () => {
    const map = { w: 760, h: 380 };
    const card = { w: 272, h: 140 };
    for (const marker of [{ x: 100, y: 60 }, { x: 680, y: 60 }, { x: 100, y: 330 }, { x: 680, y: 330 }]) {
      const { left, top, attach } = placeCard(marker, card, map);
      assert.ok(left >= 12 && left + card.w <= map.w - 12, `left ${left} for ${JSON.stringify(marker)}`);
      assert.ok(top >= 12 && top + card.h <= map.h - 12, `top ${top} for ${JSON.stringify(marker)}`);
      // The card sits on the side away from the centre.
      assert.equal(left > marker.x, marker.x < map.w / 2);
      assert.ok(attach.x >= left && attach.x <= left + card.w && attach.y >= top && attach.y <= top + card.h);
    }
    // A map smaller than the card keeps the card at the margin.
    assert.deepEqual(placeCard({ x: 50, y: 50 }, card, { w: 200, h: 100 }).left, 12);
  });
});

describe('Lite time range', () => {
  it('keeps items inside the owner ranges (6h, 24h, 7d, 30d), and items without a time', () => {
    const now = Date.UTC(2026, 10, 8, 12);
    assert.deepEqual(TIME_RANGE_HOURS, { '6h': 6, '24h': 24, '7d': 168, '30d': 720 });
    assert.equal(inTimeRange(now - 29 * 24 * 3_600_000, now, '30d'), true);
    assert.equal(inTimeRange(now - 5 * 3_600_000, now, '6h'), true);
    assert.equal(inTimeRange(now - 7 * 3_600_000, now, '6h'), false);
    assert.equal(inTimeRange(now - 23 * 3_600_000, now, '24h'), true);
    assert.equal(inTimeRange(now - 8 * 24 * 3_600_000, now, '7d'), false);
    assert.equal(inTimeRange(0, now, '6h'), true);
  });
});

describe('Lite market events: price links', () => {
  const quote = (symbol: string, price: number, change: number) => ({ symbol, price, change });
  const board = buildPriceBoard(
    [
      [quote('BTC', 64000, -4.8), quote('ETH', 3100, -6.1)],
      [quote('^GSPC', 5800, 0.4), quote('^IXIC', 18000, 0.9), quote('^TNX', 4.38, 1.4), quote('NVDA', 140, 3.2)],
      [quote('BZ=F', 82, 2.9), quote('CL=F', 78, 2.6), quote('GC=F', 2400, 0.1), quote('EURUSD=X', 1.08, -0.1)],
    ],
    { value: 104.2, changePct: 0.3 },
  );
  const story = (title: string, category: string, extra: Partial<NewsItem> = {}) => ({ ...item({ title, ...extra }), category });

  it('names instruments from the headline, then the stock tickers', () => {
    assert.deepEqual(namedInstruments(item({ title: 'Oil and gold rally as dollar slips', tickers: ['NVDA'] })).map((i) => i.symbol), ['BZ=F', 'GC=F', 'DXY', 'NVDA']);
    assert.deepEqual(namedInstruments(item({ title: 'Bank of Japan holds rates' })), []);
  });

  it('pairs a named instrument with its companion, else uses the asset-class benchmarks', () => {
    assert.deepEqual(linkPriceMoves(story('Brent +2.9% as carriers reroute around the Cape', 'commodities'), board).map((m) => m.text), ['Brent +2.9%', 'WTI +2.6%']);
    assert.deepEqual(linkPriceMoves(story('Long-liquidation cascade after perp funding turns negative', 'crypto'), board).map((m) => m.text), ['BTC −4.8%', 'ETH −6.1%']);
    assert.deepEqual(linkPriceMoves(story('Fed minutes show split on cuts', 'centralbanks'), board).map((m) => m.text), ['US10Y 4.38%', 'DXY +0.3%']);
    assert.deepEqual(linkPriceMoves(story('Nvidia beats estimates', 'ipo', { tickers: ['NVDA'] }), board).map((m) => m.text), ['NVDA +3.2%', 'S&P 500 +0.4%']);
  });

  it('skips instruments without a quote and reports none when nothing is quoted', () => {
    assert.deepEqual(linkPriceMoves(story('Cocoa futures slide', 'commodities'), board).map((m) => m.text), ['Brent +2.9%', 'Gold +0.1%']);
    assert.deepEqual(linkPriceMoves(story('Bitcoin slides', 'crypto'), new Map()), []);
    assert.equal(priceMoveLabel([]).text, 'No linked quote');
  });

  it('says "No price impact" only when every linked quote stayed under the flat threshold', () => {
    const flat = buildPriceBoard([[quote('GC=F', 2400, FLAT_MOVE.pct / 2)]], { value: 104, changePct: -0.1 });
    const label = priceMoveLabel(linkPriceMoves(story('Gold steady ahead of jobs data', 'commodities'), flat));
    assert.equal(label.text, 'No price impact');
    assert.equal(label.flat, true);
    assert.match(label.detail, /Gold \+0\.1% · DXY −0\.1%/);
    assert.equal(priceMoveLabel(linkPriceMoves(story('Bitcoin slides', 'crypto'), board)).text, 'BTC −4.8% · ETH −6.1%');
  });

  it('tags commodity rows by the named commodity and words the geopolitical cause', () => {
    assert.equal(eventTag(story('Brent climbs', 'commodities')).label, 'OIL');
    assert.equal(eventTag(story('Gold record', 'commodities')).label, 'GOLD');
    assert.equal(eventTag(story('Commodity index flat', 'commodities')).label, 'OIL & COMMOD.');
    assert.equal(eventTag(story('Gold record', 'crypto')).label, 'CRYPTO');
    const war = { level: 'THREAT_LEVEL_HIGH', category: 'conflict', confidence: 0.8, source: 'keyword' } as NewsItem['threat'];
    assert.equal(geoCause(item({ title: 'Oil jumps after tanker hit', threat: war, locationName: 'Yemen' })), 'Yemen conflict');
    assert.equal(geoCause(item({ title: 'Oil jumps after tanker hit', threat: war })), 'Conflict');
    assert.equal(geoCause(item({ title: 'Gold record' })), null);
  });
});
