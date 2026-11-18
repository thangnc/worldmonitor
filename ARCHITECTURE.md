# Architecture

> **Inventory ownership**: map layers, services, protos, locales, CI workflows, and freshness sources are defined by their registries. `npm run docs:check` verifies registry and fixed-contract documentation; generated snapshots are refreshed with `npm run docs:stats`.
>
> **Ownership rule**: When deployment topology, API surface, desktop runtime, or bootstrap keys change, this document must be updated in the same PR.

> **Design philosophy**: For the "why" behind architectural decisions, intelligence tradecraft, and algorithmic choices, see [Design Philosophy](docs/engineering/architecture/design-philosophy.md).

World Monitor is a real-time global intelligence dashboard built as a TypeScript single-page application. It aggregates data from dozens of external sources covering geopolitics, military activity, financial markets, cyber threats, climate events, maritime tracking, and aviation into a unified operational picture rendered through an interactive map and a grid of specialized panels.

---

## 1. System Overview

```
┌────────────────────────────────────────────────────────────────┐
│                             Browser                             │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌─────────────┐  │
│  │ DeckGLMap│  │ GlobeMap │  │  Panels    │  │  Workers     │  │
│  │(deck.gl) │  │(globe.gl)│  │(Panel base)│  │(ML, analysis)│  │
│  └────┐─────┘  └────┐─────┘  └─────┐─────┘  └─────────────┘  │
│       └──────────────┴─────────────┘                           │
│                         │ fetch /api/*                          │
└─────────────────────────┴───────────────────────────────────┘
                          │
           ┌──────────────┼──────────────┐
           │              │              │
    ┌──────▼──────┐ ┌─────▼─────┐ ┌─────▼──────┐
    │   Vercel    │ │  Railway  │ │ Docker API │
    │ Edge Funcs  │ │ AIS Relay │ │ (Phase 4   │
    │ + Middleware│ │ + Seeds   │ │  option)   │
    └──────┬──────┘ └─────┬─────┘ └─────┬──────┘
           │              │              │
           └──────────────┼──────────────┘
                          │
                   ┌──────▼──────┐
                   │   Upstash   │
                   │    Redis    │
                   └──────┬──────┘
                          │
              ┌───────────┼───────────┐
              │           │           │
        ┌─────▼───┐ ┌─────▼───┐ ┌────▼────┐
        │ Finnhub │ │  Yahoo  │ │ ACLED   │
        │ OpenSky │ │  GDELT  │ │ UCDP    │
        │ CoinGeck│ │  FRED   │ │ FIRMS   │
        │   ...   │ │   ...   │ │   ...   │
        └─────────┘ └─────────┘ └─────────┘
           853 observed source hosts
```

**Source files**: `package.json`, `vercel.json`

---

## 2. Deployment Topology

| Service | Platform | Role |
|---------|----------|------|
| SPA + Edge Functions | Vercel | Static files, API endpoints, middleware (bot filtering, agent-friendly 404s) |
| CORS Preflight Worker | Cloudflare | Edge CORS for `api.worldmonitor.app` — short-circuits OPTIONS, stamps CORS headers on responses |
| AIS Relay | Railway | WebSocket proxy (AIS stream), seed loops (market, aviation, GPSJAM, risk scores, UCDP, positive events), RSS proxy, OREF polling |
| Macro Seed Bundle | Railway | Daily SGE physical-premium cohort, bounded histories, physical-divergence read model, health metadata, and transition cooldowns |
| Resilience Seed Bundle | Railway | Resilience/static/food seeds plus the daily five-factor scorecard cohort and read-model publisher |
| Redis | Upstash | Cache layer with stampede protection, seed-meta freshness tracking, rate limiting |
| Container Image | GHCR | Multi-arch Docker image (nginx serving built SPA, proxies API to upstream) |

**Source files**: `vercel.json`, `docker/Dockerfile`, `scripts/ais-relay.cjs`, `workers/api-cors-preflight/wrangler.toml`, `convex/schema.ts`

**Cloudflare zone config (dashboard-managed, NOT in this repo):** the apex `worldmonitor.app` → `www` 301 is a Cloudflare Dynamic Redirect rule ("apex to www (exclude agent-discoverable paths)") whose exemption list is load-bearing: `/.well-known/*`, `/robots.txt`, `/auth.md`, `/security.txt`, `/mcp`, `/mcp/*`, `/oauth/*`, and `/agent/auth` are served on the apex, never redirected. Dropping the `/mcp*` exemptions breaks every apex-URL MCP client; dropping `/oauth/*` re-breaks OAuth dynamic client registration — a redirected POST becomes a GET and dies with 405 (issue #4938); dropping `/auth.md` breaks the `agent_auth.skill` link, which readiness scanners require to equal `<issuer>/auth.md`. When editing the rule, mind expression precedence: `and` binds tighter than `or`, so a new exemption must be added as its own `or` term **inside** the `not (…)` group (appending `and not …` after the last term is a silent no-op). `mcp-live-smoke.yml` probes the MCP/OAuth members of this list (`/mcp`, `/.well-known/oauth-authorization-server`, its `agent_auth.skill` `/auth.md`, and the OAuth endpoints it declares) every 15 minutes and fails on the redirect fingerprint; the `robots.txt` / `security.txt` exemptions are crawler-facing and have no automated probe.

**Cloudflare cache rules (zone-side, upstream's zone):** upstream's `worldmonitor.app` zone carries cache rules for its crawlable corpus, blog, docs and agent files; the generator `scripts/cloudflare-cache-rule.mjs` and its test left with those surfaces (2026-11). This deployment has no Cloudflare zone yet (Phase 4). A future zone must not bypass the edge cache for the HTML documents whose `CDN-Cache-Control` `vercel.json` sets: a cache rule outranks origin cache headers.

---

## 3. Frontend Architecture

### Entry and Initialization

`src/main.ts` initializes Sentry error tracking, Vercel analytics, dynamic meta tags, the web API redirect, theme application, and creates the `App` instance.

`App.init()` runs in 8 phases:

1. **Storage + i18n**: IndexedDB, language detection, locale loading
2. **ML Worker**: ONNX model prep (embeddings, sentiment, summarization)
3. **Bootstrap**: Two-tier concurrent hydration from `/api/bootstrap` (fast 3s + slow 5s timeouts)
4. **Layout**: PanelLayoutManager renders map and panels
5. **UI**: SignalModal, IntelligenceGapBadge, BreakingNewsBanner, correlation engine
6. **Data**: Parallel `loadAllData()` + viewport-conditional `primeVisiblePanelData()`
7. **Refresh**: Variant-specific polling intervals via `startSmartPollLoop()`

### Component Model

All panels extend the `Panel` base class (109 classes across `src/components`). Panels render via `setContent(html)` (debounced 150ms) and use event delegation on a stable `this.content` element. Panels support resizable row/col spans persisted to localStorage.

### Dual Map System

- **DeckGLMap**: WebGL rendering via deck.gl + maplibre-gl. Supports ScatterplotLayer, GeoJsonLayer, PathLayer, IconLayer, PolygonLayer, ArcLayer, HeatmapLayer, H3HexagonLayer. PMTiles protocol for self-hosted basemap tiles. Supercluster for marker clustering.
- **Loaded news selection**: `MapContainer.onNewsClicked()` caches and forwards the callback to each renderer's `setOnNewsClick()`. The callback receives `Pick<NewsLocationMarker, 'article' | 'title'>`: optional original loaded article `{link, title, source}` and the displayed marker title. Existing markers without article metadata remain valid. The plugin uses this loaded identity to publish its latest interaction with current view context; it does not track popup visibility or fetch more data on selection.
- **GlobeMap**: 3D interactive globe via globe.gl. Single merged `htmlElementsData` array with `_kind` discriminator. Earth texture, atmosphere shader, auto-rotate after idle.

Layer definitions live in `packages/client/config/map-layer-definitions.ts`, each specifying renderer support (flat/globe), premium status, variant filtering, and i18n keys.

### State Management

No external state library. `AppContext` is a central mutable object holding: map references, panel instances, panel/layer settings, all cached data (news, markets, predictions, clusters, intelligence caches), in-flight request tracking, and UI component references. URL state syncs bidirectionally via `src/utils/urlState.ts` (debounced 250ms).

### Web Workers

- **analysis.worker.ts**: News clustering (Jaccard similarity), cross-domain correlation detection
- **ml.worker.ts**: ONNX inference via `@xenova/transformers` (MiniLM-L6 embeddings, sentiment, summarization, NER), in-worker vector store for headline memory
- **vector-db.ts**: IndexedDB-backed vector store for semantic search

### No variants

Refactor Phase 1d removed the site variants (`VITE_VARIANT`, `SITE_VARIANT`, the `tech.`/`finance.`/… host detection) and the Lite profile flag (`VITE_LITE_PROFILE`). The Lite UI (`apps/web/src/lite/`) is the one web app on every host; `/` and `/dashboard` 307 to `/lite` (`vercel.json`, `docker/nginx.conf*`, `apps/web/vite.dev-api.ts`). The `variant` parameter of the news RPCs names a server-side digest edition, not a site variant.

---

## 4. API Layer

### Edge Functions

The `api/` directory holds two kinds of endpoints, both deployed as Vercel Edge Functions:

- **Domain intelligence gateways** — generated from proto contracts and backed by handlers under `packages/server/worldmonitor/**`. The per-domain thin entry points (`api/<domain>/v<N>/[rpc].ts`) are produced via `createDomainGateway` (`packages/server/gateway.ts`) and esbuild-bundled, so the *deployed* artifact is self-contained even though the source composes server-side modules.
- **Operational endpoints** — hand-written for concerns that don't fit the contract model: the anonymous session (`api/wm-session.js`), bootstrap and health (`api/bootstrap.js`, `api/health.js`, `api/seed-health.js`), GPS jamming (`api/gpsjam.js`), the security report sink, and ops probes. Refactor Phase 1c removed checkout, billing, MCP, OAuth, user keys and preferences, and notifications along with Convex and Clerk.

Compact health separates actionable `problems` from bounded `pending` diagnostics. Both retain the source diagnosis. Pending deadlines also bound the Redis verdict cache lifetime.

Edge functions are bundled per file: each deployed function may not pull in unrelated modules at runtime, a constraint enforced by `tests/edge-functions.test.mjs` and the pre-push esbuild bundle check. Hand-written endpoints that genuinely cannot be proto-defined are listed in `api/api-route-exceptions.json` and enforced by `npm run lint:api-contract`.

### Shared Helpers

| File | Purpose |
|------|---------|
| `_cors.js` | Origin allowlist (worldmonitor.app, Vercel previews, localhost outside production) |
| `_rate-limit.js` | Upstash sliding window rate limiting, IP extraction |
| `_api-key.js` | Credential check: anonymous `wms_` session or operator key (`WORLDMONITOR_VALID_KEYS`, header or `__Host-wm-pro-key` cookie) |
| `_relay.js` | Factory for proxying requests to Railway relay service |

### Gateway Factory

`packages/server/gateway.ts` provides `createDomainGateway(routes)` for per-domain Edge Function bundles. Pipeline:

1. Origin check (403 if disallowed)
2. CORS headers
3. OPTIONS preflight
4. API key validation (`validateApiKey`; `PREMIUM_RPC_PATHS` require an operator key, everything else also takes an anonymous session)
5. Rate limiting (endpoint-specific, then global fallback)
6. Route matching (static Map lookup, then dynamic `{param}` scan)
7. POST-to-GET compatibility (for stale clients). Unmatched POSTs with a trusted `Content-Length` under 1 MB may be retried as GET when a GET handler exists for the path. The body is all-or-nothing: JSON objects of scalars and scalar arrays become query parameters; object values, nested/non-scalar array members, non-object JSON, malformed JSON, and unread bodies return 400 without applying a partial translation. Empty or whitespace-only bodies still fall through to GET with no extra query parameters. Unknown paths still 404/405. Array expansion remains capped at 200 values per key.
8. Handler execution with error boundary
9. ETag generation (FNV-1a hash) + 304 Not Modified
10. Cache header application

### Cache Tiers

| Tier | s-maxage | Use case |
|------|----------|----------|
| fast | 300s | Live event streams, flight status |
| medium | 600s | Market quotes, stock analysis |
| slow | 1800s | ACLED events, cyber threats |
| static | 7200s | Humanitarian summaries, ETF flows |
| daily | 86400s | Critical minerals, static reference data |
| no-store | 0 | Vessel snapshots, aircraft tracking |

### Domain Handlers

`packages/server/worldmonitor/<domain>/v1/handler.ts` exports handler objects with per-RPC functions. Each RPC function uses `cachedFetchJson()` from `packages/server/_shared/redis.ts` for cache-miss coalescing: concurrent requests for the same key share a single upstream fetch and Redis write.

The `scorecard/v1` domain is an exception to request-time upstream fetching. Its generated `ScorecardService` country, list, and bloc RPCs read one frozen cohort from `scorecard:five-factor:v1:read-model`, then use `scorecard:five-factor:v1` only as a bounded last-good fallback. The canonical pure adapters and country scorer live under `scripts/scorecard/v1/` for the scripts-root Railway publisher; a checked generator emits Edge-safe copies under the server domain, which owns Redis reads, bloc scoring, and public response conversion. See [Five-factor scorecard v1 architecture](docs/engineering/architecture/five-factor-scorecard-v1.md).

The `supply-chain/v1` country-vulnerability, ranking, and chokepoint-dependency RPCs also read a Railway-published cohort instead of fetching upstream data at request time. `seed-supply-vulnerability.mjs` scores each country and builds the chokepoint inverse index in one pass, writes country and chokepoint shards into the inactive Redis slot, and switches the shared cohort pointer only after every shard is valid. The manifest and every shard carry an explicit redistribution-policy version; readers reject an older unmarked cohort until the matching publisher activates a current one. Every direct RPC or MCP response fails closed on provider inputs whose programmatic redistribution is restricted, including requests with freely mintable browser-session tokens. The canonical cohort retains the full attribution-bound evidence for internal audit, but the restricted values do not leave through these routes. The three routes are also `no-store`.

`IntelligenceService.GetCountryCoverage` is the inverse case: it serves an agent surface that must agree, event for event, with what the browser country panel renders. Rather than reimplement the panel's rules server-side, the rules were moved to `packages/shared/` and both sides import them — `country-headline-match.ts` (which country a headline is primarily about), `threat-keyword-classifier.ts` (lane and severity), and `country-timeline-events.ts` (36-hour incident clustering and structured-record precedence). A second copy of any of these is the defect this arrangement exists to prevent, and the ordering between them is load-bearing: cluster first, then filter by country, because a cluster is represented by its earliest member.

Its coverage half fetches Google News at request time through `news/v1`'s shared fetcher rather than standing up a second RSS transport; its structured half composes five existing first-party RPCs. Because several of those upstream handlers catch their own failures and return an empty array, this route cannot learn about an outage from a thrown error — it reads the backing seed key's own hit/miss/error status instead, and reports `failed` rather than `empty` when the cache is unreadable. Producers that genuinely cannot prove they were reached report `unknown`. `degraded` covers only `stale` and `failed`, the states that mean something changed; the per-producer `sources` block, always populated, is where the guarantee lives that an empty event list is never silently healthy.

`MarketService.GetPhysicalDivergenceIndex` is also a read-model RPC. The daily macro seed bundle normalizes SGE SHAU/SHAG benchmarks against the independently timestamped COMEX and FX snapshots, appends bounded per-metal history, and atomically publishes `market:physical-divergence:v1`, its health metadata, activation marker, and transition cooldowns. The Edge handler revalidates the stored contract and re-ages every input clock before it serves the response; the route is `no-store` so independently aging cohorts are never joined through a stale shared cache. MCP reads the same normalized snapshot, and the commodities panel renders the same explicit `ok`, `insufficient_history`, `stale_input`, or `missing_input` states.

**Source files**: `api/`, `packages/server/gateway.ts`, `packages/server/router.ts`, `packages/server/_shared/redis.ts`, `packages/server/worldmonitor/`

---

## 5. Proto/RPC Contract System

The project uses the **sebuf** framework built on Protocol Buffers:

```
packages/contracts/proto/                (definitions)
    ↓ buf generate
packages/contracts/generated/client/     (TypeScript RPC client stubs)
packages/contracts/generated/server/     (TypeScript server message types)
packages/contracts/openapi/              (OpenAPI v3 specs)
```

Service definitions use `(sebuf.http.config)` annotations to map RPCs to HTTP verbs and paths. GET fields require `(sebuf.http.query)` annotation. `repeated string` fields need `parseStringArray()` in the handler. `int64` maps to `string` in TypeScript.

CI enforces generated code freshness via `.github/workflows/proto-check.yml`: runs `make generate` and fails if output differs from committed files.

**Source files**: `packages/contracts/proto/`, `Makefile`, `packages/contracts/generated/`, `.github/workflows/proto-check.yml`

---

## 6. Data Pipeline

### Bootstrap Hydration

`/api/bootstrap` reads cached keys from Redis in a single batch call. The SPA fetches two tiers concurrently (fast + slow) with separate abort controllers and timeouts. Large or opt-in datasets use a public, CDN-shielded single-key request and are consumed through `ensureHydrated(key)` only when their panel renders. Tier-hydrated data is consumed by panels via `getHydratedData(key)`.

### Seed Scripts

`scripts/seed-*.mjs` fetch upstream data, transform it, and write to Redis via `atomicPublish()` from `scripts/_seed-utils.mjs`. Atomic publish acquires a Redis lock (SET NX), validates data, writes the cache key, writes `seed-meta:<key>` with `{ fetchedAt, recordCount }`, and releases the lock.

`seed-five-factor-scorecard.mjs` runs inside Railway's measured `seed-bundle-resilience` placement. It reads only landed source snapshots, builds the closed scorecard evidence ledger, stages a narrow hash read model, and atomically switches the canonical cohort and read model with one idempotent Lua publication. `seed-meta:scorecard:five-factor` and health coverage remain separate from deployment and production-acceptance evidence.

`seed-supply-vulnerability.mjs` runs once per durable turn in the static-reference Railway bundle after its mirrored inputs. It publishes `supply-chain:vulnerability:cohort:v1` plus two-slot country and chokepoint shards, then writes separate activation and seed-health metadata. The cohort pointer is the read authority; compatibility manifests are not independent publication clocks.

### AIS Relay Seed Loops

The Railway relay service (`scripts/ais-relay.cjs`) runs continuous seed loops:

- Market data (stocks, commodities, crypto, stablecoins, sectors, ETF flows, gulf quotes)
- Aviation (international delays)
- Positive events
- GPSJAM (GPS interference)
- Risk scores (CII)
- UCDP events

These are the primary seeders. Standalone `seed-*.mjs` scripts on Railway cron are secondary/backup.

The market backup bundle also persists 14 days of timestamped hourly Yahoo closes for the news-to-market correlation panel. This series is an on-demand bootstrap key, so it does not increase the default hydration payload.

### Refresh Scheduling

`startSmartPollLoop()` supports: exponential backoff (max 4x), viewport-conditional refresh (only if panel is near viewport), tab-pause (suspend when hidden), and staggered flush on tab visibility (150ms delays).

### Health Monitoring

`api/health.js` checks every bootstrap and standalone key. For each key it reads `seed-meta:<key>` and compares `fetchedAt` against `maxStaleMin`. Cascade groups handle fallback chains (e.g., theater-posture: live, stale, backup). Returns per-key status: OK, STALE, WARN, EMPTY.

**Source files**: `api/bootstrap.js`, `api/health.js`, `scripts/_seed-utils.mjs`, `scripts/seed-*.mjs`, `scripts/ais-relay.cjs`, `packages/client/services/bootstrap.ts`, `src/app/refresh-scheduler.ts`

---

## 7. Desktop Architecture (removed)

The Tauri desktop app left in refactor Phase 1b, and its runtime branches (the desktop fetch patch, the sidecar cache, the Tauri CORS origins, the `/desktop-sign-in` route and the `/api/version` updater probe) left in the 2026-11 Lite-only cleanup. The section number stays so links to later sections keep working. `docker/local-api/local-api-server.mjs`, the former sidecar, remains as the Docker Node API option for Phase 4; it still carries its desktop-key relay and Tauri paths until that decision.

---

## 8. Security Model

### Trust Boundaries

```
Browser ↔ Vercel Edge ↔ Upstream APIs
```

### Content Security Policy

Two CSP sources that must stay in sync:

1. `index.html` `<meta>` tag (development)
2. `vercel.json` HTTP header (production, overrides meta)

### Authentication

API keys are required for non-browser origins. Trusted browser origins (production domains, Vercel preview deployments, localhost) are exempt. Premium RPC paths always require a key.

### Bot Protection

`middleware.ts` filters automated traffic: blocks known crawler user-agents on API and asset paths, allows social preview bots (Twitter, Facebook, LinkedIn, Telegram, Discord) on story and OG endpoints.

### Rate Limiting

Per-IP sliding window via Upstash with per-endpoint overrides for high-traffic paths.

**Source files**: `middleware.ts`, `vercel.json`, `index.html`, `api/_api-key.js`, `packages/server/_shared/rate-limit.ts`

---

## 9. Caching Architecture

### Four-Layer Hierarchy

```
Bootstrap seed (Railway writes to Redis on schedule)
    ↓ miss
In-memory cache (per Vercel instance, short TTL)
    ↓ miss
Redis (Upstash, cross-instance, cachedFetchJson coalesces concurrent misses)
    ↓ miss
Upstream API fetch (result cached back to Redis + seed-meta written)
```

### Cache Key Rules

Every RPC handler with shared cache MUST include request-varying parameters in the cache key. Failure to do so causes cross-request data leakage.

### ETag / Conditional Requests

`packages/server/gateway.ts` computes an FNV-1a hash of each response body and returns it as an `ETag`. Clients send `If-None-Match` and receive `304 Not Modified` when content is unchanged.

### CDN Integration

`CDN-Cache-Control` headers give Cloudflare edge (when enabled) longer TTLs than `Cache-Control`, since CF can revalidate via ETag without full payload transfer.

The header only sets the TTL; it does not make a response cacheable. Cloudflare decides eligibility from its cache rules first, and HTML documents on `www` are bypassed by default (see the cache-rule note in §2). Adding `CDN-Cache-Control` to a new document route therefore has to be paired with a zone rule that re-admits it.

### Seed Metadata

Every cache write also writes `seed-meta:<key>` with `{ fetchedAt, recordCount }`. The health endpoint reads these to determine data freshness and raise staleness alerts.

The five-factor scorecard adds an atomic two-key read pattern: `scorecard:five-factor:v1` is the auditable evidence-plus-result rollback unit, while `scorecard:five-factor:v1:read-model` serves country fields and the compact list without downloading the multi-megabyte canonical value. Both keys switch and retain TTL together; malformed hash fields fall back to the canonical last-good cohort.

**Source files**: `packages/server/_shared/redis.ts`, `packages/server/gateway.ts`, `api/health.js`

---

## 10. Testing

### Unit and Integration

`node:test` runner. Test files in `tests/*.test.{mjs,mts}` cover: server handlers, cache keying, circuit breakers, edge function constraints, data validation, market quote dedup, health checks, panel config guardrails, and variant layer filtering.

### Sidecar and API Tests

`api/*.test.mjs` and `docker/local-api/*.test.mjs` test CORS handling, YouTube embed proxying, and the Node API server the Docker image runs.

### Edge Function Guardrails

`tests/edge-functions.test.mjs` validates that all non-helper `api/*.js` files are self-contained: no `node:` built-in imports, no cross-directory `../packages/` or `../apps/` imports. The pre-push hook also runs an esbuild bundle check on each endpoint.

### Pre-Push Hook

`.husky/pre-push` runs the local checks that match what the branch changed since it left `refactor/lite-monorepo` (or `main`): `tsc` for the browser and API, the edge-function bundle check, the import-boundary and `localStorage` guards, markdownlint, `npm run docs:check` when workflows, this table, the docs checker or the hook change, and `make generate` when `packages/contracts/proto/` changes and `buf` is installed. CI runs the full set.

**Source files**: `tests/`, `.husky/pre-push`

---

## 11. CI/CD

The repository has no deployment pipeline: the owner removed every deploy and publish workflow (the Cloudflare Worker deploys, the Railway registry sync, deploy trigger, watchdog, drift and recovery workflows, and the GHCR image publish) until the production environment is chosen (2026-11-19, refactor Phase 4). Nothing deploys on a push to `main`.

| Workflow | Trigger | Checks |
|----------|---------|--------|
| `ci.yml` | PR, push to `main` and `refactor/lite-monorepo` | The pull-request gate since refactor Phase 1b, replacing the upstream `test.yml`, `typecheck.yml`, `lint-code.yml` and their deploy gate. No path filters: every job runs on every PR. `checks` runs the browser, API, contract-test and DOM-test typechecks (through the Turborepo cache, shared through Vercel Remote Cache when `TURBO_TOKEN`/`TURBO_TEAM` are set), Biome, import boundaries, Unicode safety, the API-contract, rate-limit, premium-fetch and `localStorage` guards, markdownlint, the Vite env secrets check, bootstrap tier keys, `docs:check` and `sources:check`. `unit` runs `test:data` (without built output) on three shards with a local Redis and the `scripts/` dependency tree. `build` runs the Vercel build command through `npx turbo run build`, the suites that read built output, the edge-function bundle check and `generate:check`. `dom` runs `test:dom`; `server` runs `test:server` and `test:sidecar`; `health-probe-cutovers` checks, with full history, that a new or repointed `api/health.js` probe carries cutover evidence against the base it merges onto. The upstream-only service gates (`consumer-prices`, `zapier`, `umami-postgres`, `digest-image`) left with those services in the Lite-only cleanup (2026-11) |
| `proto-check.yml` | PR (proto changes) | Generated code matches committed output at the exact PR head (`internal-generate`; on internal branches `internal-auto-generate` commits any drift) and, in parallel, at the PR merge result (`internal-merge-freshness`). When a generated commit is pushed, the aggregate `proto-freshness` ignores the superseded head's merge verdict and the new commit gets its own run |
| `feed-validation.yml` | PR (feed changes), daily cron | RSS feed reachability and validation |
| `china-decision-parity-live.yml` | 6-hourly cron, push to main (audit paths), manual (optional staging URL) | Live half of the China decision-signal parity audit: probes the deployed composition RPC and the public `chinaDecisionSignals` bootstrap projection for the six-domain contract and a canonical snapshot under one hour old (#5643 — the probe existed but nothing invoked it, and `--require-live` keeps a lost `--url` from passing vacuously) |
| `tps-open-data-live.yml` | Twice-daily cron, push to main (adapter/suite paths), manual | Live contract probe of the two official Toronto Police open-data sources (ArcGIS MCI + CKAN Calls); fails if fewer than 2 mandatory source probes execute (the suite was inert until this workflow set LIVE_TPS_OPEN_DATA_TESTS=1, and `node --test` exits 0 on an all-skip run) |
| `openrouter-free-models-live.yml` | Daily cron, push to main (model policy/suite paths), manual | Checks that both OpenRouter free-chain models in `scripts/lib/llm-model-policy.cjs` are still usable for free: listed on `/models` at zero price, not within 14 days of `expiration_date`, and holding a zero-price endpoint outside `OPENROUTER_PROVIDER_ROUTING.ignore`; with the optional `OPENROUTER_API_KEY` secret it also sends one real completion per model. A delisted `:free` slug returns HTTP 404 on every call (#8570). Fails unless each live case passes by name |
| `security-audit.yml` | PR, push to main, daily cron, manual | Audit-specific sparse checkouts for the production npm lockfile audits (root, `scripts/`, the Docker runtime and the two Cloudflare workers); dated decisions remain visible, and daily sweeps require database availability |
| `codeql.yml` | Daily cron (03:23 UTC: Actions, JavaScript/TypeScript and Python), manual; not on PRs or pushes | Advanced CodeQL scans of the whole tree; init and analyze share one release pin and Dependabot update group. Findings reach Code scanning when the next daily scan after a change lands on main completes. Default-branch runs then delete all but the newest overlay-base cache per job and language. Requires the default-setup handover in CONTRIBUTING.md. On this fork the scheduled jobs are gated to `koala73/worldmonitor`, so it runs only on manual dispatch, and the owner turned off CodeQL default setup on 2026-11-07 with no replacement scan: code scanning is off |
| `deploy-error-canary.yml` | Hourly cron, manual | Compares per-route API error rates over the last two hours with the preceding seven days in Axiom; fails on qualifying regressions, missing configuration, or invalid query results |
| `sentry-resolve-pin-audit.yml` | Daily cron, manual | Read-only audit of resolved Sentry issues (#7838): fails when a resolution carries an `inRelease`, `inNextRelease` or `inCommit` pin instead of a plain resolve. The GitHub integration adds such a pin whenever a commit body says `Fixes WORLDMONITOR-XX`, and browser events all carry a static semver release, so a pinned issue can never reopen and reads resolved forever while the bug keeps firing. It reports only the short ID, permalink and pin value, never the resolver identity Sentry attaches alongside the pin |
| `contributor-trust.yml` | PR | Gates untrusted first-time-contributor runs |
| `issue-ui-evidence.yml` | Issue opened or edited | The bug report form refuses an empty screenshot field but cannot check that it holds an image, so this catches the rest: an issue from outside the maintainer set whose title or body says `UI` and carries no screenshot, recording or image link gets the `needs-screenshot` label and one comment asking for the image. The label clears on the edit that attaches one. Never closes or reopens an issue. Maintainer, collaborator and bot issues are exempt. The decision reads the issue's current state from the API, not the webhook snapshot; issue text reaches the script only through the payload file and that read |
| `stacked-merge-guard.yml` | PR (including base edits), push to main | Required pre-merge check (#7006): fails when a PR's base is not `main` and that base branch's own PR is already merged, which is how a stacked child can show MERGED while `main` never receives the commits |
| `orphaned-stacked-merge-monitor.yml` | PR closed and merged | Post-merge safety net for #7006: retargets open children of a merged parent, flags children GitHub closed when the parent branch was deleted and strands their open children, then fails when the merge commit is not an ancestor of `main`, opens an issue, and comments on the purple PR |

**Source files**: `.github/workflows/`, `.husky/pre-push`. The workflow list is CI-checked against `.github/workflows/*.yml` by `npm run docs:check` — a new workflow file must be added to this table.

---

## 12. Directory Reference

```
.
├── api/                    Vercel Edge Functions (self-contained JS)
│   ├── _*.js               Shared helpers (CORS, rate-limit, API key, relay, Sentry, session)
│   └── <domain>/           Domain endpoints (aviation/, climate/, conflict/, ...)
├── apps/
│   └── web/                @wm/web: the Lite UI, the only web app (Vite root; builds into the root dist/)
│       ├── lite.html       App shell (vercel.json and nginx rewrite /lite and its screens to it)
│       ├── src/lite/       Preact + Tailwind screens, components, map and data adapters
│       ├── vite.config.ts  The one Vite config (reads the root .env* and public/)
│       └── vite.dev-api.ts Dev-server routes: sebuf RPCs, /api/health, /api/bootstrap, the /lite redirect
├── data/                   Static data (telegram channels, OREF threat translations, gamma irradiators)
├── docker/                 Dockerfile + nginx config for Railway
├── docs/                   Engineering records (docs/engineering/)
├── packages/
│   ├── client/             @wm/client: browser modules the Lite UI builds on (the Edge code reaches a few by relative path)
│   │   ├── bootstrap/      Deferred Sentry and RUM
│   │   ├── config/         Static geo, market, military and Lite route config
│   │   ├── locales/        i18n strings (en)
│   │   ├── services/       Runtime, bootstrap hydration, RPC clients, session
│   │   ├── shared/         Premium and public RPC path lists (the gateway reads them too)
│   │   ├── types/          TypeScript type definitions
│   │   └── utils/          Safe storage, circuit breaker, cache keys
│   ├── contracts/          @wm/contracts: proto/ (sebuf service definitions), generated/ (client/server stubs, DO NOT EDIT), openapi/ (generated specs)
│   ├── server/             @wm/server: server-side code bundled into the Edge Functions (api/ imports it by relative path)
│   │   ├── __tests__/      vitest suites (npm run test:server)
│   │   ├── _shared/        Redis, rate-limit, LLM, caching utilities
│   │   ├── gateway.ts      Domain gateway factory
│   │   ├── router.ts       Route matching
│   │   └── worldmonitor/   Domain handlers (mirrors proto structure)
│   └── shared/             @wm/shared: logic and data the browser, server and seeders apply the same way (scripts/shared/ mirrors part of it)
├── public/                 Static assets served as-is (favicons, textures, map styles, data, robots.txt, 404.html)
├── scripts/                Seed scripts, build helpers, relay service
├── tests/                  Unit/integration tests (node:test)
└── workers/                Cloudflare Workers (edge CORS preflight for api.worldmonitor.app)
```
