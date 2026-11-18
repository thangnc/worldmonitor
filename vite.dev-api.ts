/**
 * Dev-server middleware for `npm run dev`: serves the API routes the Lite UI
 * calls (sebuf RPCs, /api/health, /api/bootstrap, the RSS proxy, GPS jamming,
 * Polymarket, MIIT news) from the same handlers production runs, and maps
 * /lite/<screen> to lite.html like the vercel.json rewrites do.
 * Production never loads this file.
 */
import type { Plugin } from 'vite';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
// The dev proxy reuses the same www-tolerant allowlist predicate the Edge
// handler enforces (api/rss-proxy.js), so dev and prod agree on allow/deny.
import { isAllowedDomain } from './api/_rss-allowed-domain-match.js';
import { rssFetchHeadersForHost } from './api/_rss-fetch-headers.js';
import { validateGeneratedRequest } from './server/request-validator';

function liteDevRoutePlugin(): Plugin {
  return {
    name: 'wm-lite-dev-route',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Parity with the vercel.json redirects: / and the old dashboard routes open /lite.
        if (req.url && /^\/(?:dashboard|story|stocks(?:\/[^/?#]+)?)?\/?(?:[?#]|$)/.test(req.url) && !/[?&]mode=agent\b/.test(req.url)) {
          res.statusCode = 302;
          res.setHeader('Location', '/lite');
          res.end();
          return;
        }
        if (req.url && /^\/lite\/[a-z-]+\/?(?:[?#]|$)/.test(req.url)) {
          req.url = `/lite.html${req.url.slice(req.url.search(/[?#]|$/))}`;
        }
        next();
      });
    },
  };
}

function polymarketPlugin(): Plugin {
  const GAMMA_BASE = 'https://gamma-api.polymarket.com';
  const ALLOWED_ORDER = ['volume', 'liquidity', 'startDate', 'endDate', 'spread'];

  return {
    name: 'polymarket-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/polymarket')) return next();

        const url = new URL(req.url, 'http://localhost');
        const endpoint = url.searchParams.get('endpoint') || 'markets';
        const closed = ['true', 'false'].includes(url.searchParams.get('closed') ?? '') ? url.searchParams.get('closed') : 'false';
        const order = ALLOWED_ORDER.includes(url.searchParams.get('order') ?? '') ? url.searchParams.get('order') : 'volume';
        const ascending = ['true', 'false'].includes(url.searchParams.get('ascending') ?? '') ? url.searchParams.get('ascending') : 'false';
        const rawLimit = parseInt(url.searchParams.get('limit') ?? '', 10);
        const limit = isNaN(rawLimit) ? 50 : Math.max(1, Math.min(100, rawLimit));

        const params = new URLSearchParams({ closed: closed!, order: order!, ascending: ascending!, limit: String(limit) });
        if (endpoint === 'events') {
          const tag = (url.searchParams.get('tag') ?? '').replace(/[^a-z0-9-]/gi, '').slice(0, 100);
          if (tag) params.set('tag_slug', tag);
        }

        const gammaUrl = `${GAMMA_BASE}/${endpoint === 'events' ? 'events' : 'markets'}?${params}`;

        res.setHeader('Content-Type', 'application/json');
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 8000);
          const resp = await fetch(gammaUrl, { headers: { Accept: 'application/json' }, signal: controller.signal });
          clearTimeout(timer);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const data = await resp.text();
          res.setHeader('Cache-Control', 'public, max-age=120');
          res.setHeader('X-Polymarket-Source', 'gamma');
          res.end(data);
        } catch {
          // Expected: Cloudflare JA3 blocks server-side TLS — return empty array
          res.setHeader('Cache-Control', 'public, max-age=300');
          res.end('[]');
        }
      });
    },
  };
}

/**
 * Vite dev server plugin for sebuf API routes.
 *
 * Intercepts requests matching /api/{domain}/v1/* and routes them through
 * the same handler pipeline as the Vercel catch-all gateway. Other /api/*
 * paths fall through to existing proxy rules.
 */
function sebufApiPlugin(): Plugin {
  // Cache router across requests (H-13 fix). Invalidated by Vite's module graph on HMR.
  let cachedRouter: Awaited<ReturnType<typeof buildRouter>> | null = null;
  let cachedCorsMod: any = null;

  async function buildRouter() {
    const [
      routerMod, corsMod, errorMod,
      seismologyServerMod, seismologyHandlerMod,
      wildfireServerMod, wildfireHandlerMod,
      climateServerMod, climateHandlerMod,
      predictionServerMod, predictionHandlerMod,
      displacementServerMod, displacementHandlerMod,
      aviationServerMod, aviationHandlerMod,
      researchServerMod, researchHandlerMod,
      unrestServerMod, unrestHandlerMod,
      conflictServerMod, conflictHandlerMod,
      maritimeServerMod, maritimeHandlerMod,
      cyberServerMod, cyberHandlerMod,
      economicServerMod, economicHandlerMod,
      infrastructureServerMod, infrastructureHandlerMod,
      marketServerMod, marketHandlerMod,
      newsServerMod, newsHandlerMod,
      intelligenceServerMod, intelligenceHandlerMod,
      militaryServerMod, militaryHandlerMod,
      positiveEventsServerMod, positiveEventsHandlerMod,
      givingServerMod, givingHandlerMod,
      tradeServerMod, tradeHandlerMod,
      supplyChainServerMod, supplyChainHandlerMod,
      naturalServerMod, naturalHandlerMod,
      resilienceServerMod, resilienceHandlerMod,
      leadsServerMod, leadsHandlerMod,
      scenarioServerMod, scenarioHandlerMod,
      shippingV2ServerMod, shippingV2HandlerMod,
    ] = await Promise.all([
        import('./server/router'),
        import('./server/cors'),
        import('./server/error-mapper'),
        import('./src/generated/server/worldmonitor/seismology/v1/service_server'),
        import('./server/worldmonitor/seismology/v1/handler'),
        import('./src/generated/server/worldmonitor/wildfire/v1/service_server'),
        import('./server/worldmonitor/wildfire/v1/handler'),
        import('./src/generated/server/worldmonitor/climate/v1/service_server'),
        import('./server/worldmonitor/climate/v1/handler'),
        import('./src/generated/server/worldmonitor/prediction/v1/service_server'),
        import('./server/worldmonitor/prediction/v1/handler'),
        import('./src/generated/server/worldmonitor/displacement/v1/service_server'),
        import('./server/worldmonitor/displacement/v1/handler'),
        import('./src/generated/server/worldmonitor/aviation/v1/service_server'),
        import('./server/worldmonitor/aviation/v1/handler'),
        import('./src/generated/server/worldmonitor/research/v1/service_server'),
        import('./server/worldmonitor/research/v1/handler'),
        import('./src/generated/server/worldmonitor/unrest/v1/service_server'),
        import('./server/worldmonitor/unrest/v1/handler'),
        import('./src/generated/server/worldmonitor/conflict/v1/service_server'),
        import('./server/worldmonitor/conflict/v1/handler'),
        import('./src/generated/server/worldmonitor/maritime/v1/service_server'),
        import('./server/worldmonitor/maritime/v1/handler'),
        import('./src/generated/server/worldmonitor/cyber/v1/service_server'),
        import('./server/worldmonitor/cyber/v1/handler'),
        import('./src/generated/server/worldmonitor/economic/v1/service_server'),
        import('./server/worldmonitor/economic/v1/handler'),
        import('./src/generated/server/worldmonitor/infrastructure/v1/service_server'),
        import('./server/worldmonitor/infrastructure/v1/handler'),
        import('./src/generated/server/worldmonitor/market/v1/service_server'),
        import('./server/worldmonitor/market/v1/handler'),
        import('./src/generated/server/worldmonitor/news/v1/service_server'),
        import('./server/worldmonitor/news/v1/handler'),
        import('./src/generated/server/worldmonitor/intelligence/v1/service_server'),
        import('./server/worldmonitor/intelligence/v1/handler'),
        import('./src/generated/server/worldmonitor/military/v1/service_server'),
        import('./server/worldmonitor/military/v1/handler'),
        import('./src/generated/server/worldmonitor/positive_events/v1/service_server'),
        import('./server/worldmonitor/positive-events/v1/handler'),
        import('./src/generated/server/worldmonitor/giving/v1/service_server'),
        import('./server/worldmonitor/giving/v1/handler'),
        import('./src/generated/server/worldmonitor/trade/v1/service_server'),
        import('./server/worldmonitor/trade/v1/handler'),
        import('./src/generated/server/worldmonitor/supply_chain/v1/service_server'),
        import('./server/worldmonitor/supply-chain/v1/handler'),
        import('./src/generated/server/worldmonitor/natural/v1/service_server'),
        import('./server/worldmonitor/natural/v1/handler'),
        import('./src/generated/server/worldmonitor/resilience/v1/service_server'),
        import('./server/worldmonitor/resilience/v1/handler'),
        import('./src/generated/server/worldmonitor/leads/v1/service_server'),
        import('./server/worldmonitor/leads/v1/handler'),
        import('./src/generated/server/worldmonitor/scenario/v1/service_server'),
        import('./server/worldmonitor/scenario/v1/handler'),
        import('./src/generated/server/worldmonitor/shipping/v2/service_server'),
        import('./server/worldmonitor/shipping/v2/handler'),
      ]);

    const serverOptions = {
      onError: errorMod.mapErrorToResponse,
      validateRequest: validateGeneratedRequest,
    };
    const allRoutes = [
      ...seismologyServerMod.createSeismologyServiceRoutes(seismologyHandlerMod.seismologyHandler, serverOptions),
      ...wildfireServerMod.createWildfireServiceRoutes(wildfireHandlerMod.wildfireHandler, serverOptions),
      ...climateServerMod.createClimateServiceRoutes(climateHandlerMod.climateHandler, serverOptions),
      ...predictionServerMod.createPredictionServiceRoutes(predictionHandlerMod.predictionHandler, serverOptions),
      ...displacementServerMod.createDisplacementServiceRoutes(displacementHandlerMod.displacementHandler, serverOptions),
      ...aviationServerMod.createAviationServiceRoutes(aviationHandlerMod.aviationHandler, serverOptions),
      ...researchServerMod.createResearchServiceRoutes(researchHandlerMod.researchHandler, serverOptions),
      ...unrestServerMod.createUnrestServiceRoutes(unrestHandlerMod.unrestHandler, serverOptions),
      ...conflictServerMod.createConflictServiceRoutes(conflictHandlerMod.conflictHandler, serverOptions),
      ...maritimeServerMod.createMaritimeServiceRoutes(maritimeHandlerMod.maritimeHandler, serverOptions),
      ...cyberServerMod.createCyberServiceRoutes(cyberHandlerMod.cyberHandler, serverOptions),
      ...economicServerMod.createEconomicServiceRoutes(economicHandlerMod.economicHandler, serverOptions),
      ...infrastructureServerMod.createInfrastructureServiceRoutes(infrastructureHandlerMod.infrastructureHandler, serverOptions),
      ...marketServerMod.createMarketServiceRoutes(marketHandlerMod.marketHandler, serverOptions),
      ...newsServerMod.createNewsServiceRoutes(newsHandlerMod.newsHandler, serverOptions),
      ...intelligenceServerMod.createIntelligenceServiceRoutes(intelligenceHandlerMod.intelligenceHandler, serverOptions),
      ...militaryServerMod.createMilitaryServiceRoutes(militaryHandlerMod.militaryHandler, serverOptions),
      ...positiveEventsServerMod.createPositiveEventsServiceRoutes(positiveEventsHandlerMod.positiveEventsHandler, serverOptions),
      ...givingServerMod.createGivingServiceRoutes(givingHandlerMod.givingHandler, serverOptions),
      ...tradeServerMod.createTradeServiceRoutes(tradeHandlerMod.tradeHandler, serverOptions),
      ...supplyChainServerMod.createSupplyChainServiceRoutes(supplyChainHandlerMod.supplyChainHandler, serverOptions),
      ...naturalServerMod.createNaturalServiceRoutes(naturalHandlerMod.naturalHandler, serverOptions),
      ...resilienceServerMod.createResilienceServiceRoutes(resilienceHandlerMod.resilienceHandler, serverOptions),
      ...leadsServerMod.createLeadsServiceRoutes(leadsHandlerMod.leadsHandler, serverOptions),
      ...scenarioServerMod.createScenarioServiceRoutes(scenarioHandlerMod.scenarioHandler, serverOptions),
      ...shippingV2ServerMod.createShippingV2ServiceRoutes(shippingV2HandlerMod.shippingV2Handler, serverOptions),
    ];
    cachedCorsMod = corsMod;
    return routerMod.createRouter(allRoutes);
  }

  return {
    name: 'sebuf-api',
    configureServer(server) {
      // Invalidate cached router on HMR updates to server/ files
      server.watcher.on('change', (file) => {
        if (file.includes('/server/') || file.includes('/src/generated/server/')) {
          cachedRouter = null;
        }
      });

      // Legacy v1 URL aliases → new sebuf RPC paths (mirror of the alias files
      // in api/scenario/v1/ + api/supply-chain/v1/). Vercel serves the alias
      // files directly; vite dev has no file-based routing for api/, so we
      // rewrite the pathname here before the router lookup.
      const V1_ALIASES: Record<string, string> = {
        '/api/scenario/v1/run': '/api/scenario/v1/run-scenario',
        '/api/scenario/v1/status': '/api/scenario/v1/get-scenario-status',
        '/api/scenario/v1/templates': '/api/scenario/v1/list-scenario-templates',
        '/api/supply-chain/v1/country-products': '/api/supply-chain/v1/get-country-products',
        '/api/supply-chain/v1/multi-sector-cost-shock': '/api/supply-chain/v1/get-multi-sector-cost-shock',
      };

      server.middlewares.use(async (req, res, next) => {
        // Intercept sebuf routes in two forms:
        //  - standard /api/{domain}/v{N}/* (domain-first, e.g. /api/market/v1/...)
        //  - partner-URL-preservation /api/v{N}/{domain}/* (version-first, e.g.
        //    /api/v2/shipping/...). Only the second form applies when the
        //    external contract already uses a reversed layout.
        if (!req.url || !/^\/api\/(?:[a-z][a-z0-9-]*\/v\d+|v\d+\/[a-z][a-z0-9-]*)\//.test(req.url)) {
          return next();
        }

        // Rewrite documented v1 URL → new sebuf path if this is an alias.
        const [pathOnly, queryOnly] = req.url.split('?', 2);
        const aliasTarget = pathOnly ? V1_ALIASES[pathOnly] : undefined;
        if (aliasTarget) {
          req.url = queryOnly ? `${aliasTarget}?${queryOnly}` : aliasTarget;
        }

        try {
          // Build router once, reuse across requests (H-13 fix)
          if (!cachedRouter) {
            cachedRouter = await buildRouter();
          }
          const router = cachedRouter;
          const corsMod = cachedCorsMod;

          // Convert Connect IncomingMessage to Web Standard Request
          const port = server.config.server.port || 3000;
          const url = new URL(req.url, `http://localhost:${port}`);

          // Read body for POST requests
          let body: string | undefined;
          if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
            }
            body = Buffer.concat(chunks).toString();
          }

          // Extract headers from IncomingMessage
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === 'string') {
              headers[key] = value;
            } else if (Array.isArray(value)) {
              headers[key] = value.join(', ');
            }
          }
          delete headers['x-user-id'];
          delete headers['x-wm-mcp-internal-verified'];
          delete headers['x-wm-rl-principal'];

          const webRequest = new Request(url.toString(), {
            method: req.method,
            headers,
            body: body || undefined,
          });

          const corsHeaders = corsMod.getCorsHeaders(webRequest);

          // OPTIONS preflight
          if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            for (const [key, value] of Object.entries(corsHeaders)) {
              res.setHeader(key, value);
            }
            res.end();
            return;
          }

          // Origin check
          if (corsMod.isDisallowedOrigin(webRequest)) {
            res.statusCode = 403;
            res.setHeader('Content-Type', 'application/json');
            for (const [key, value] of Object.entries(corsHeaders)) {
              res.setHeader(key, value);
            }
            res.end(JSON.stringify({ error: 'Origin not allowed' }));
            return;
          }

          // Route matching
          const matchedHandler = router.match(webRequest);
          if (!matchedHandler) {
            const allowed = router.allowedMethods(new URL(webRequest.url).pathname);
            if (allowed.length > 0) {
              res.statusCode = 405;
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Allow', allowed.join(', '));
            } else {
              res.statusCode = 404;
              res.setHeader('Content-Type', 'application/json');
            }
            for (const [key, value] of Object.entries(corsHeaders)) {
              res.setHeader(key, value);
            }
            res.end(JSON.stringify({ error: res.statusCode === 405 ? 'Method not allowed' : 'Not found' }));
            return;
          }

          // Execute handler
          const response = await matchedHandler(webRequest);

          // Write response. HEAD is GET without a payload (#7275).
          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });
          for (const [key, value] of Object.entries(corsHeaders)) {
            res.setHeader(key, value);
          }
          if (req.method === 'HEAD') {
            if (response.body) {
              try { void response.body.cancel(); } catch { /* already consumed */ }
            }
            res.end();
            return;
          }
          res.end(await response.text());
        } catch (err) {
          console.error('[sebuf-api] Error:', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      });
    },
  };
}

function miitNewsPlugin(): Plugin {
  return {
    name: 'miit-news',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/api/miit-news') return next();
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          const { default: handler } = await server.ssrLoadModule('/api/miit-news.js');
          const headers = new Headers();
          if (typeof req.headers.origin === 'string') headers.set('Origin', req.headers.origin);
          const response: Response = await handler(new Request(`http://localhost${req.url}`, { headers }));
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(req.method === 'HEAD' ? undefined : await response.text());
        } catch (error) {
          console.error('[miit-news]', error);
          res.statusCode = 502;
          res.end();
        }
      });
    },
  };
}

// Dev only: run api/health.js instead of serving it as a module, so the Lite
// sidebar card and Sources screen read real verdicts from the local Redis.
// The handler keeps its own gate: compact mode is public, full mode needs a key.
function healthDevPlugin(): Plugin {
  return {
    name: 'health-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/api/health') return next();
        try {
          const { default: handler } = await server.ssrLoadModule('/api/health.js');
          const headers = new Headers();
          for (const name of ['origin', 'x-worldmonitor-key', 'x-api-key']) {
            const value = req.headers[name];
            if (typeof value === 'string') headers.set(name, value);
          }
          const response: Response = await handler(
            new Request(`http://localhost${req.url}`, { method: req.method, headers }),
            { waitUntil: (work: Promise<unknown>) => { work.catch(() => {}); } },
          );
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(req.method === 'HEAD' ? undefined : await response.text());
        } catch (error) {
          console.error('[health-dev]', error);
          res.statusCode = 502;
          res.end();
        }
      });
    },
  };
}

// Dev only: run api/bootstrap.js instead of serving it as a module. Without
// it, `ensureHydrated` gets JavaScript source for the on-demand keys and the
// Lite feeds that read only from bootstrap (UKMTO incidents, GDELT conflict
// counts, GPS high cells) read "No data yet" although the local Redis has
// them.
//
// Only the public on-demand URLs (`?keys=<name>&public=1`, what
// `ensureHydrated` asks for), and only when a Redis is configured. Everything
// else falls through to the old behaviour:
// - keyed and session URLs (the dashboard's `?keys=insights`) would answer 401,
//   since the dev server has neither;
// - the fast and slow tiers would hydrate the whole dashboard from the local
//   Redis and bypass the e2e specs' fixtures;
// - with no Redis (CI, the e2e smokes) the handler answers 503 where the specs
//   expect the dev fallback.
function bootstrapDevPlugin(): Plugin {
  return {
    name: 'bootstrap-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const redis = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
        const onDemand = url.searchParams.has('keys') && !url.searchParams.has('tier') && url.searchParams.get('public') === '1';
        if (url.pathname !== '/api/bootstrap' || !onDemand || !redis) return next();
        try {
          const { default: handler } = await server.ssrLoadModule('/api/bootstrap.js');
          // Public URLs need only the origin; the handler's own CORS check reads it.
          const headers = new Headers();
          if (typeof req.headers.origin === 'string') headers.set('origin', req.headers.origin);
          const response: Response = await handler(
            new Request(`http://localhost${req.url}`, { method: req.method, headers }),
            { waitUntil: (work: Promise<unknown>) => { work.catch(() => {}); } },
          );
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(req.method === 'HEAD' ? undefined : await response.text());
        } catch (error) {
          console.error('[bootstrap-dev]', error);
          res.statusCode = 502;
          res.end();
        }
      });
    },
  };
}

function rssProxyPlugin(): Plugin {
  return {
    name: 'rss-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/rss-proxy')) {
          return next();
        }

        const url = new URL(req.url, 'http://localhost');
        const feedUrl = url.searchParams.get('url');
        if (!feedUrl) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Missing url parameter' }));
          return;
        }

        try {
          const parsed = new URL(feedUrl);
          if (parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.password || !isAllowedDomain(parsed.hostname)) {
            res.statusCode = 403;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `Domain not allowed: ${parsed.hostname}` }));
            return;
          }

          const controller = new AbortController();
          const timeout = feedUrl.includes('news.google.com') ? 20000 : 12000;
          const timer = setTimeout(() => controller.abort(), timeout);

          let response: Response;
          try {
            let current = parsed;
            for (let hop = 0; ; hop++) {
              response = await fetch(current.href, {
                signal: controller.signal,
                headers: rssFetchHeadersForHost(current.hostname),
                redirect: 'manual',
              });
              if (![301, 302, 303, 307, 308].includes(response.status)) break;
              const location = response.headers.get('location');
              await response.body?.cancel();
              if (!location || hop >= 5) throw new Error('Invalid RSS redirect');
              const nextUrl = new URL(location, current);
              if (nextUrl.protocol !== 'https:' || nextUrl.port || nextUrl.username || nextUrl.password || !isAllowedDomain(nextUrl.hostname)) {
                res.statusCode = 403;
                res.end(JSON.stringify({ error: 'Redirect not allowed' }));
                return;
              }
              current = nextUrl;
            }
          } finally {
            clearTimeout(timer);
          }

          const data = await response.text();
          res.statusCode = response.status;
          // Same isolation as api/rss-proxy.js: callers parse response.text(),
          // so feed bytes must never render as a same-origin document.
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
          res.setHeader('Cache-Control', 'public, max-age=300');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(data);
        } catch (error: any) {
          console.error('[rss-proxy]', feedUrl, error.message);
          res.statusCode = error.name === 'AbortError' ? 504 : 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error.name === 'AbortError' ? 'Feed timeout' : 'Failed to fetch feed' }));
        }
      });
    },
  };
}

function gpsjamDevPlugin(): Plugin {
  return {
    name: 'gpsjam-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== '/api/gpsjam' && !req.url?.startsWith('/api/gpsjam?')) {
          return next();
        }

        try {
          const data = await readFile(resolve(__dirname, 'scripts/data/gpsjam-latest.json'), 'utf8');
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(data);
        } catch {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(JSON.stringify({ error: 'No GPS jam data. Run: node scripts/fetch-gpsjam.mjs' }));
        }
      });
    },
  };
}

// Mirror the WebMCP security gates during local development. Chrome's
// #enable-webmcp-testing flag bypasses origin-trial enrollment, but it does not
// bypass origin isolation or Permissions Policy. Keeping these headers in the
// dev server makes the documented local smoke meaningful while preserving the
// production boundary: no Origin-Trial token is ever served locally.

export function devApiPlugins(): Plugin[] {
  return [
    liteDevRoutePlugin(),
    polymarketPlugin(),
    rssProxyPlugin(),
    miitNewsPlugin(),
    healthDevPlugin(),
    bootstrapDevPlugin(),
    gpsjamDevPlugin(),
    sebufApiPlugin(),
  ];
}
