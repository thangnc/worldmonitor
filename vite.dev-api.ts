/**
 * Dev-server middleware for `npm run dev`: serves the API routes the Lite UI
 * calls (sebuf RPCs, /api/health, /api/bootstrap, GPS jamming) from the same
 * handlers production runs, and maps
 * /lite/<screen> to lite.html like the vercel.json rewrites do.
 * Production never loads this file.
 */
import type { Plugin } from 'vite';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { validateGeneratedRequest } from './server/request-validator';

function liteDevRoutePlugin(): Plugin {
  return {
    name: 'wm-lite-dev-route',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Parity with the vercel.json redirects: / and the old dashboard routes
        // open /lite with a 307 that keeps the query string.
        const legacyRoute = req.url?.match(/^\/(?:dashboard|story|stocks(?:\/[^/?#]+)?)?\/?(\?[^#]*)?(?:#|$)/);
        if (legacyRoute) {
          res.statusCode = 307;
          res.setHeader('Location', `/lite${legacyRoute[1] ?? ''}`);
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

  // The RPC services the Lite UI calls (refactor Phase 1c removed the rest).
  async function buildRouter() {
    const [routerMod, corsMod, errorMod] = await Promise.all([
      import('./server/router'),
      import('./server/cors'),
      import('./server/error-mapper'),
    ]);
    const serverOptions = {
      onError: errorMod.mapErrorToResponse,
      validateRequest: validateGeneratedRequest,
    };
    const services = await Promise.all([
      Promise.all([import('./packages/contracts/generated/server/worldmonitor/seismology/v1/service_server'), import('./server/worldmonitor/seismology/v1/handler')])
        .then(([server, handler]) => server.createSeismologyServiceRoutes(handler.seismologyHandler, serverOptions)),
      Promise.all([import('./packages/contracts/generated/server/worldmonitor/research/v1/service_server'), import('./server/worldmonitor/research/v1/handler')])
        .then(([server, handler]) => server.createResearchServiceRoutes(handler.researchHandler, serverOptions)),
      Promise.all([import('./packages/contracts/generated/server/worldmonitor/unrest/v1/service_server'), import('./server/worldmonitor/unrest/v1/handler')])
        .then(([server, handler]) => server.createUnrestServiceRoutes(handler.unrestHandler, serverOptions)),
      Promise.all([import('./packages/contracts/generated/server/worldmonitor/conflict/v1/service_server'), import('./server/worldmonitor/conflict/v1/handler')])
        .then(([server, handler]) => server.createConflictServiceRoutes(handler.conflictHandler, serverOptions)),
      Promise.all([import('./packages/contracts/generated/server/worldmonitor/cyber/v1/service_server'), import('./server/worldmonitor/cyber/v1/handler')])
        .then(([server, handler]) => server.createCyberServiceRoutes(handler.cyberHandler, serverOptions)),
      Promise.all([import('./packages/contracts/generated/server/worldmonitor/economic/v1/service_server'), import('./server/worldmonitor/economic/v1/handler')])
        .then(([server, handler]) => server.createEconomicServiceRoutes(handler.economicHandler, serverOptions)),
      Promise.all([import('./packages/contracts/generated/server/worldmonitor/infrastructure/v1/service_server'), import('./server/worldmonitor/infrastructure/v1/handler')])
        .then(([server, handler]) => server.createInfrastructureServiceRoutes(handler.infrastructureHandler, serverOptions)),
      Promise.all([import('./packages/contracts/generated/server/worldmonitor/market/v1/service_server'), import('./server/worldmonitor/market/v1/handler')])
        .then(([server, handler]) => server.createMarketServiceRoutes(handler.marketHandler, serverOptions)),
      Promise.all([import('./packages/contracts/generated/server/worldmonitor/news/v1/service_server'), import('./server/worldmonitor/news/v1/handler')])
        .then(([server, handler]) => server.createNewsServiceRoutes(handler.newsHandler, serverOptions)),
      Promise.all([import('./packages/contracts/generated/server/worldmonitor/intelligence/v1/service_server'), import('./server/worldmonitor/intelligence/v1/handler')])
        .then(([server, handler]) => server.createIntelligenceServiceRoutes(handler.intelligenceHandler, serverOptions)),
      Promise.all([import('./packages/contracts/generated/server/worldmonitor/military/v1/service_server'), import('./server/worldmonitor/military/v1/handler')])
        .then(([server, handler]) => server.createMilitaryServiceRoutes(handler.militaryHandler, serverOptions)),
      Promise.all([import('./packages/contracts/generated/server/worldmonitor/supply_chain/v1/service_server'), import('./server/worldmonitor/supply-chain/v1/handler')])
        .then(([server, handler]) => server.createSupplyChainServiceRoutes(handler.supplyChainHandler, serverOptions)),
      Promise.all([import('./packages/contracts/generated/server/worldmonitor/sanctions/v1/service_server'), import('./server/worldmonitor/sanctions/v1/handler')])
        .then(([server, handler]) => server.createSanctionsServiceRoutes(handler.sanctionsHandler, serverOptions)),
    ]);
    const allRoutes = services.flat();

    cachedCorsMod = corsMod;
    return routerMod.createRouter(allRoutes);
  }

  return {
    name: 'sebuf-api',
    configureServer(server) {
      // Invalidate cached router on HMR updates to server/ files
      server.watcher.on('change', (file) => {
        if (file.includes('/server/') || file.includes('/packages/contracts/generated/server/')) {
          cachedRouter = null;
        }
      });

      server.middlewares.use(async (req, res, next) => {
        // Intercept sebuf routes in two forms:
        //  - standard /api/{domain}/v{N}/* (domain-first, e.g. /api/market/v1/...)
        //  - partner-URL-preservation /api/v{N}/{domain}/* (version-first, e.g.
        //    /api/v2/shipping/...). Only the second form applies when the
        //    external contract already uses a reversed layout.
        if (!req.url || !/^\/api\/(?:[a-z][a-z0-9-]*\/v\d+|v\d+\/[a-z][a-z0-9-]*)\//.test(req.url)) {
          return next();
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
    healthDevPlugin(),
    bootstrapDevPlugin(),
    gpsjamDevPlugin(),
    sebufApiPlugin(),
  ];
}
