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
│                        Browser / Desktop                        │
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
    │   Vercel    │ │  Railway  │ │   Tauri    │
    │ Edge Funcs  │ │ AIS Relay │ │  Sidecar   │
    │ + Middleware│ │ + Seeds   │ │ (Node.js)  │
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
| Consumer Prices | Railway | Containerized price scrapers (Playwright, per-country baskets) + Redis publisher for the consumer-prices dataset |
| Redis | Upstash | Cache layer with stampede protection, seed-meta freshness tracking, rate limiting |
| Container Image | GHCR | Multi-arch Docker image (nginx serving built SPA, proxies API to upstream) |

**Source files**: `vercel.json`, `docker/Dockerfile`, `scripts/ais-relay.cjs`, `consumer-prices-core/Dockerfile`, `workers/api-cors-preflight/wrangler.toml`, `convex/schema.ts`, `src-tauri/tauri.conf.json`

**Cloudflare zone config (dashboard-managed, NOT in this repo):** the apex `worldmonitor.app` → `www` 301 is a Cloudflare Dynamic Redirect rule ("apex to www (exclude agent-discoverable paths)") whose exemption list is load-bearing: `/.well-known/*`, `/robots.txt`, `/auth.md`, `/security.txt`, `/mcp`, `/mcp/*`, `/oauth/*`, and `/agent/auth` are served on the apex, never redirected. Dropping the `/mcp*` exemptions breaks every apex-URL MCP client; dropping `/oauth/*` re-breaks OAuth dynamic client registration — a redirected POST becomes a GET and dies with 405 (issue #4938); dropping `/auth.md` breaks the `agent_auth.skill` link, which readiness scanners require to equal `<issuer>/auth.md`. When editing the rule, mind expression precedence: `and` binds tighter than `or`, so a new exemption must be added as its own `or` term **inside** the `not (…)` group (appending `and not …` after the last term is a silent no-op). `mcp-live-smoke.yml` probes the MCP/OAuth members of this list (`/mcp`, `/.well-known/oauth-authorization-server`, its `agent_auth.skill` `/auth.md`, and the OAuth endpoints it declares) every 15 minutes and fails on the redirect fingerprint; the `robots.txt` / `security.txt` exemptions are crawler-facing and have no automated probe.

**Cloudflare cache rules (zone-side, one of them generated here; the corpus, docs and agent files it claims are gone since refactor 1b and 1c-3, so the rule is a leftover for the owner to retire):** the zone's cache phase carries a blanket `Bypass cache - WWW documents` rule that makes every extensionless/HTML path on `www` ineligible for the edge cache. A cache rule outranks origin cache headers, so a correct `CDN-Cache-Control` on a document route buys nothing on its own — that is why the crawlable corpus answered `cf-cache-status: DYNAMIC` on every route for months while `tests/deploy-config.test.mjs` stayed green (issue #7659). Cloudflare evaluates matching cache rules in order and the last one to set a field wins, so eligibility is restored by *appending* a later rule, `WWW corpus HTML …`, which claims the `CONTENT_CORPUS_PREFIXES` families, since #7747 the blog, the Mintlify-proxied docs and the root agent text files (`EDGE_CACHED_FAMILIES` / `AGENT_TEXT_FILES`), and since #7804 the entry documents `/` and `/dashboard` (`ENTRY_DOCUMENTS`) — admitting an HTML document only for requests that want the HTML representation (no RSC headers, no markdown/plain media type in any `Accept` value, and on `/` none of the AI User-Agents `middleware.ts` routes to `/home.md`), because those URLs negotiate on request headers Cloudflare cannot key on; `.md`/`.txt`/`.xml` files are single-representation and exempt. The dashboard-managed `WWW entry HTML …` rule that used to cover `/` and `/dashboard` with no such guard sat one position earlier and, as the last matching writer, re-admitted every request the guard declined (#7804); it is listed in `RETIRED_CACHE_RULES`, reported by `--check` as drift wherever it sits, and deleted by `--apply` once the claim has landed. The rule is generated from that surface model by `scripts/cloudflare-cache-rule.mjs` (`--print` / `--check` / `--apply`) so it cannot drift from the vercel.json header rules it mirrors; `tests/cloudflare-cache-rule.test.mjs` pins its shape offline and `--check` compares it against the live zone.

---

## 3. Frontend Architecture

### Entry and Initialization

`src/main.ts` initializes Sentry error tracking, Vercel analytics, dynamic meta tags, runtime fetch patches (desktop sidecar redirection), theme application, and creates the `App` instance.

`App.init()` runs in 8 phases:

1. **Storage + i18n**: IndexedDB, language detection, locale loading
2. **ML Worker**: ONNX model prep (embeddings, sentiment, summarization)
3. **Sidecar**: Wait for desktop sidecar readiness (desktop only)
4. **Bootstrap**: Two-tier concurrent hydration from `/api/bootstrap` (fast 3s + slow 5s timeouts)
5. **Layout**: PanelLayoutManager renders map and panels
6. **UI**: SignalModal, IntelligenceGapBadge, BreakingNewsBanner, correlation engine
7. **Data**: Parallel `loadAllData()` + viewport-conditional `primeVisiblePanelData()`
8. **Refresh**: Variant-specific polling intervals via `startSmartPollLoop()`

### Component Model

All panels extend the `Panel` base class (109 classes across `src/components`). Panels render via `setContent(html)` (debounced 150ms) and use event delegation on a stable `this.content` element. Panels support resizable row/col spans persisted to localStorage.

### Dual Map System

- **DeckGLMap**: WebGL rendering via deck.gl + maplibre-gl. Supports ScatterplotLayer, GeoJsonLayer, PathLayer, IconLayer, PolygonLayer, ArcLayer, HeatmapLayer, H3HexagonLayer. PMTiles protocol for self-hosted basemap tiles. Supercluster for marker clustering.
- **Loaded news selection**: `MapContainer.onNewsClicked()` caches and forwards the callback to each renderer's `setOnNewsClick()`. The callback receives `Pick<NewsLocationMarker, 'article' | 'title'>`: optional original loaded article `{link, title, source}` and the displayed marker title. Existing markers without article metadata remain valid. The plugin uses this loaded identity to publish its latest interaction with current view context; it does not track popup visibility or fetch more data on selection.
- **GlobeMap**: 3D interactive globe via globe.gl. Single merged `htmlElementsData` array with `_kind` discriminator. Earth texture, atmosphere shader, auto-rotate after idle.

Layer definitions live in `src/config/map-layer-definitions.ts`, each specifying renderer support (flat/globe), premium status, variant filtering, and i18n keys.

### State Management

No external state library. `AppContext` is a central mutable object holding: map references, panel instances, panel/layer settings, all cached data (news, markets, predictions, clusters, intelligence caches), in-flight request tracking, and UI component references. URL state syncs bidirectionally via `src/utils/urlState.ts` (debounced 250ms).

### Web Workers

- **analysis.worker.ts**: News clustering (Jaccard similarity), cross-domain correlation detection
- **ml.worker.ts**: ONNX inference via `@xenova/transformers` (MiniLM-L6 embeddings, sentiment, summarization, NER), in-worker vector store for headline memory
- **vector-db.ts**: IndexedDB-backed vector store for semantic search

### Variant System

Detected by hostname (`tech.worldmonitor.app` → tech, `finance.worldmonitor.app` → finance, etc.) or localStorage on desktop. Controls: default panels, map layers, refresh intervals, theme, UI text. Variant change resets all settings to defaults.

**Source files**: `src/main.ts`, `src/App.ts`, `src/app/`, `src/components/Panel.ts`, `src/components/DeckGLMap.ts`, `src/components/GlobeMap.ts`, `src/config/variant.ts`, `src/workers/`

---

## 4. API Layer

### Edge Functions

The `api/` directory holds two kinds of endpoints, both deployed as Vercel Edge Functions:

- **Domain intelligence gateways** — generated from proto contracts and backed by handlers under `server/worldmonitor/**`. The per-domain thin entry points (`api/<domain>/v<N>/[rpc].ts`) are produced via `createDomainGateway` (`server/gateway.ts`) and esbuild-bundled, so the *deployed* artifact is self-contained even though the source composes server-side modules.
- **Operational endpoints** — hand-written for concerns that don't fit the contract model: the anonymous session (`api/wm-session.js`), bootstrap and health (`api/bootstrap.js`, `api/health.js`, `api/seed-health.js`), GPS jamming (`api/gpsjam.js`), the security report sink, and ops probes. Refactor Phase 1c removed checkout, billing, MCP, OAuth, user keys and preferences, and notifications along with Convex and Clerk.

Compact health separates actionable `problems` from bounded `pending` diagnostics. Both retain the source diagnosis. Pending deadlines also bound the Redis verdict cache lifetime.

Edge functions are bundled per file: each deployed function may not pull in unrelated modules at runtime, a constraint enforced by `tests/edge-functions.test.mjs` and the pre-push esbuild bundle check. Hand-written endpoints that genuinely cannot be proto-defined are listed in `api/api-route-exceptions.json` and enforced by `npm run lint:api-contract`.

### Shared Helpers

| File | Purpose |
|------|---------|
| `_cors.js` | Origin allowlist (worldmonitor.app, Vercel previews, tauri://localhost, localhost) |
| `_rate-limit.js` | Upstash sliding window rate limiting, IP extraction |
| `_api-key.js` | Origin-aware API key validation (desktop requires key, trusted browser exempt) |
| `_relay.js` | Factory for proxying requests to Railway relay service |

### Gateway Factory

`server/gateway.ts` provides `createDomainGateway(routes)` for per-domain Edge Function bundles. Pipeline:

1. Origin check (403 if disallowed)
2. CORS headers
3. OPTIONS preflight
4. API key validation
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

`server/worldmonitor/<domain>/v1/handler.ts` exports handler objects with per-RPC functions. Each RPC function uses `cachedFetchJson()` from `server/_shared/redis.ts` for cache-miss coalescing: concurrent requests for the same key share a single upstream fetch and Redis write.

The `scorecard/v1` domain is an exception to request-time upstream fetching. Its generated `ScorecardService` country, list, and bloc RPCs read one frozen cohort from `scorecard:five-factor:v1:read-model`, then use `scorecard:five-factor:v1` only as a bounded last-good fallback. The canonical pure adapters and country scorer live under `scripts/scorecard/v1/` for the scripts-root Railway publisher; a checked generator emits Edge-safe copies under the server domain, which owns Redis reads, bloc scoring, and public response conversion. See [Five-factor scorecard v1 architecture](docs/engineering/architecture/five-factor-scorecard-v1.md).

The `supply-chain/v1` country-vulnerability, ranking, and chokepoint-dependency RPCs also read a Railway-published cohort instead of fetching upstream data at request time. `seed-supply-vulnerability.mjs` scores each country and builds the chokepoint inverse index in one pass, writes country and chokepoint shards into the inactive Redis slot, and switches the shared cohort pointer only after every shard is valid. The manifest and every shard carry an explicit redistribution-policy version; readers reject an older unmarked cohort until the matching publisher activates a current one. Every direct RPC or MCP response fails closed on provider inputs whose programmatic redistribution is restricted, including requests with freely mintable browser-session tokens. The canonical cohort retains the full attribution-bound evidence for internal audit, but the restricted values do not leave through these routes. The three routes are also `no-store`.

`IntelligenceService.GetCountryCoverage` is the inverse case: it serves an agent surface that must agree, event for event, with what the browser country panel renders. Rather than reimplement the panel's rules server-side, the rules were moved to `shared/` and both sides import them — `country-headline-match.ts` (which country a headline is primarily about), `threat-keyword-classifier.ts` (lane and severity), and `country-timeline-events.ts` (36-hour incident clustering and structured-record precedence). A second copy of any of these is the defect this arrangement exists to prevent, and the ordering between them is load-bearing: cluster first, then filter by country, because a cluster is represented by its earliest member.

Its coverage half fetches Google News at request time through `news/v1`'s shared fetcher rather than standing up a second RSS transport; its structured half composes five existing first-party RPCs. Because several of those upstream handlers catch their own failures and return an empty array, this route cannot learn about an outage from a thrown error — it reads the backing seed key's own hit/miss/error status instead, and reports `failed` rather than `empty` when the cache is unreadable. Producers that genuinely cannot prove they were reached report `unknown`. `degraded` covers only `stale` and `failed`, the states that mean something changed; the per-producer `sources` block, always populated, is where the guarantee lives that an empty event list is never silently healthy.

`MarketService.GetPhysicalDivergenceIndex` is also a read-model RPC. The daily macro seed bundle normalizes SGE SHAU/SHAG benchmarks against the independently timestamped COMEX and FX snapshots, appends bounded per-metal history, and atomically publishes `market:physical-divergence:v1`, its health metadata, activation marker, and transition cooldowns. The Edge handler revalidates the stored contract and re-ages every input clock before it serves the response; the route is `no-store` so independently aging cohorts are never joined through a stale shared cache. MCP reads the same normalized snapshot, and the commodities panel renders the same explicit `ok`, `insufficient_history`, `stale_input`, or `missing_input` states.

**Source files**: `api/`, `server/gateway.ts`, `server/router.ts`, `server/_shared/redis.ts`, `server/worldmonitor/`

---

## 5. Proto/RPC Contract System

The project uses the **sebuf** framework built on Protocol Buffers:

```
proto/ definitions
    ↓ buf generate
src/generated/client/   (TypeScript RPC client stubs)
src/generated/server/   (TypeScript server message types)
docs/api/               (OpenAPI v3 specs)
```

Service definitions use `(sebuf.http.config)` annotations to map RPCs to HTTP verbs and paths. GET fields require `(sebuf.http.query)` annotation. `repeated string` fields need `parseStringArray()` in the handler. `int64` maps to `string` in TypeScript.

CI enforces generated code freshness via `.github/workflows/proto-check.yml`: runs `make generate` and fails if output differs from committed files.

**Source files**: `proto/`, `Makefile`, `src/generated/`, `.github/workflows/proto-check.yml`

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

**Source files**: `api/bootstrap.js`, `api/health.js`, `scripts/_seed-utils.mjs`, `scripts/seed-*.mjs`, `scripts/ais-relay.cjs`, `src/services/bootstrap.ts`, `src/app/refresh-scheduler.ts`

---

## 7. Desktop Architecture

### Tauri Shell

Tauri 2.x (Rust) manages the app lifecycle, system tray, and IPC commands:

- **Secret management**: Read/write platform keyring (macOS Keychain, Windows Credential Manager, Linux keyring)
- **Sidecar control**: Spawn Node.js process, probe port, inject environment variables
- **Window management**: Three trusted windows (main, settings, live-channels) with Edit menu for macOS clipboard shortcuts

### Node.js Sidecar

`docker/local-api/local-api-server.mjs` runs on a dynamic port. It dynamically loads Edge Function handler modules from `api/`, injects secrets from the keyring via environment variables, and monkey-patches `globalThis.fetch` to force IPv4 (Node.js tries IPv6 first, but many government APIs have broken IPv6).

### Fetch Patching

`installRuntimeFetchPatch()` in `src/services/runtime.ts` replaces `window.fetch` on the desktop renderer. All `/api/*` requests route to the sidecar with `Authorization: Bearer <token>` (5-min TTL from Tauri IPC). If the sidecar fails, requests fall back to the cloud API.

Seed-owned scorecard RPC paths are always cloud-preferred on desktop. The sidecar does not carry the Railway-published scorecard cohort, so routing these paths locally would create a false unavailable state instead of using the authenticated cloud API.

**Source files**: `src-tauri/src/main.rs`, `docker/local-api/local-api-server.mjs`, `src/services/runtime.ts`, `src/services/tauri-bridge.ts`

---

## 8. Security Model

### Trust Boundaries

```
Browser ↔ Vercel Edge ↔ Upstream APIs
Desktop ↔ Sidecar ↔ Cloud API / Upstream APIs
```

### Content Security Policy

Three CSP sources that must stay in sync:

1. `index.html` `<meta>` tag (development, Tauri fallback)
2. `vercel.json` HTTP header (production, overrides meta)
3. `src-tauri/tauri.conf.json` (desktop)

### Authentication

API keys are required for non-browser origins. Trusted browser origins (production domains, Vercel preview deployments, localhost) are exempt. Premium RPC paths always require a key.

### Bot Protection

`middleware.ts` filters automated traffic: blocks known crawler user-agents on API and asset paths, allows social preview bots (Twitter, Facebook, LinkedIn, Telegram, Discord) on story and OG endpoints.

### Rate Limiting

Per-IP sliding window via Upstash with per-endpoint overrides for high-traffic paths.

### Desktop Secret Storage

Secrets are stored in the platform keyring (never plaintext), injected into the sidecar via Tauri IPC, and scoped to an allowlist of environment variable keys.

**Source files**: `middleware.ts`, `vercel.json`, `index.html`, `src-tauri/tauri.conf.json`, `api/_api-key.js`, `server/_shared/rate-limit.ts`

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

`server/gateway.ts` computes an FNV-1a hash of each response body and returns it as an `ETag`. Clients send `If-None-Match` and receive `304 Not Modified` when content is unchanged.

### CDN Integration

`CDN-Cache-Control` headers give Cloudflare edge (when enabled) longer TTLs than `Cache-Control`, since CF can revalidate via ETag without full payload transfer.

The header only sets the TTL; it does not make a response cacheable. Cloudflare decides eligibility from its cache rules first, and HTML documents on `www` are bypassed by default (see the cache-rule note in §2). Adding `CDN-Cache-Control` to a new document route therefore has to be paired with a zone rule that re-admits it — by extending the surface model in `scripts/cloudflare-cache-rule.mjs` (`CONTENT_CORPUS_PREFIXES` for a new corpus family, `ENTRY_DOCUMENTS` for an exact-path entry document, `EDGE_CACHED_FAMILIES` / `AGENT_TEXT_FILES` otherwise) and re-running `scripts/cloudflare-cache-rule.mjs --apply`; `tests/cloudflare-cache-rule.test.mjs` fails when the two halves disagree.

### Seed Metadata

Every cache write also writes `seed-meta:<key>` with `{ fetchedAt, recordCount }`. The health endpoint reads these to determine data freshness and raise staleness alerts.

The five-factor scorecard adds an atomic two-key read pattern: `scorecard:five-factor:v1` is the auditable evidence-plus-result rollback unit, while `scorecard:five-factor:v1:read-model` serves country fields and the compact list without downloading the multi-megabyte canonical value. Both keys switch and retain TTL together; malformed hash fields fall back to the canonical last-good cohort.

**Source files**: `server/_shared/redis.ts`, `server/gateway.ts`, `api/health.js`

---

## 10. Testing

### Unit and Integration

`node:test` runner. Test files in `tests/*.test.{mjs,mts}` cover: server handlers, cache keying, circuit breakers, edge function constraints, data validation, market quote dedup, health checks, panel config guardrails, and variant layer filtering.

### Sidecar and API Tests

`api/*.test.mjs` and `docker/local-api/*.test.mjs` test CORS handling, YouTube embed proxying, and the Node API server the Docker image runs.

### Edge Function Guardrails

`tests/edge-functions.test.mjs` validates that all non-helper `api/*.js` files are self-contained: no `node:` built-in imports, no cross-directory `../server/` or `../src/` imports. The pre-push hook also runs an esbuild bundle check on each endpoint.

### Pre-Push Hook

`.husky/pre-push` runs the local checks that match what the branch changed since it left `refactor/lite-monorepo` (or `main`): `tsc` for the browser and API, the edge-function bundle check, the import-boundary and `localStorage` guards, markdownlint, `npm run docs:check` when workflows, this table, the docs checker or the hook change, and `make generate` when `proto/` changes and `buf` is installed. CI runs the full set.

**Source files**: `tests/`, `.husky/pre-push`

---

## 11. CI/CD

| Workflow | Trigger | Checks |
|----------|---------|--------|
| `ci.yml` | PR, push to `main` and `refactor/lite-monorepo` | The pull-request gate since refactor Phase 1b, replacing the upstream `test.yml`, `typecheck.yml`, `lint-code.yml` and their deploy gate. No path filters: every job runs on every PR. `checks` runs the browser, API, contract-test and DOM-test typechecks, Biome, import boundaries, Unicode safety, the API-contract, rate-limit, premium-fetch and `localStorage` guards, markdownlint, the Vite env secrets check, bootstrap tier keys, `docs:check` and `sources:check`. `unit` runs `test:data` (without built output) on three shards with a local Redis and the `scripts/` dependency tree. `build` runs `npm run build` (the Vercel build command), the suites that read built output, the edge-function bundle check and `generate:check`. `dom` runs `test:dom`; `server` runs `test:server` and `test:sidecar`; `health-probe-cutovers` checks, with full history, that a new or repointed `api/health.js` probe carries cutover evidence against the base it merges onto. Four jobs keep the gates of services outside the Lite web app until 1c or Phase 2 decides their fate: `consumer-prices` and `zapier` run those packages' tests, `umami-postgres` builds the Umami images and exercises the migration and write path against Postgres 17, and `digest-image` builds the digest-notifications image |
| `proto-check.yml` | PR (proto changes) | Generated code matches committed output at the exact PR head (`internal-generate`; on internal branches `internal-auto-generate` commits any drift) and, in parallel, at the PR merge result (`internal-merge-freshness`). When a generated commit is pushed, the aggregate `proto-freshness` ignores the superseded head's merge verdict and the new commit gets its own run |
| `feed-validation.yml` | PR (feed changes), daily cron | RSS feed reachability and validation |
| `china-decision-parity-live.yml` | 6-hourly cron, push to main (audit paths), manual (optional staging URL) | Live half of the China decision-signal parity audit: probes the deployed composition RPC and the public `chinaDecisionSignals` bootstrap projection for the six-domain contract and a canonical snapshot under one hour old (#5643 — the probe existed but nothing invoked it, and `--require-live` keeps a lost `--url` from passing vacuously) |
| `tps-open-data-live.yml` | Twice-daily cron, push to main (adapter/suite paths), manual | Live contract probe of the two official Toronto Police open-data sources (ArcGIS MCI + CKAN Calls); fails if fewer than 2 mandatory source probes execute (the suite was inert until this workflow set LIVE_TPS_OPEN_DATA_TESTS=1, and `node --test` exits 0 on an all-skip run) |
| `openrouter-free-models-live.yml` | Daily cron, push to main (model policy/suite paths), manual | Checks that both OpenRouter free-chain models in `scripts/lib/llm-model-policy.cjs` are still usable for free: listed on `/models` at zero price, not within 14 days of `expiration_date`, and holding a zero-price endpoint outside `OPENROUTER_PROVIDER_ROUTING.ignore`; with the optional `OPENROUTER_API_KEY` secret it also sends one real completion per model. A delisted `:free` slug returns HTTP 404 on every call (#8570). Fails unless each live case passes by name |
| `security-audit.yml` | PR, push to main, daily cron, manual | Audit-specific sparse checkouts for production npm lockfile audits, including the Zapier integration, plus RustSec Cargo.lock advisories; fixable Rust findings block, dated decisions/no-fix findings remain visible, and daily sweeps require database availability |
| `codeql.yml` | Daily cron (03:23 UTC, all six languages), manual; not on PRs or pushes | Advanced CodeQL scans; init and analyze share one release pin and Dependabot update group. Skips only the generated `vendor/vercel-og/dist` bundle (`paths-ignore`). Findings reach Code scanning when the next daily scan after a change lands on main completes. Default-branch runs then delete all but the newest overlay-base cache per job and language. Requires the default-setup handover in CONTRIBUTING.md. On this fork the scheduled jobs are gated to `koala73/worldmonitor`, so it runs only on manual dispatch, and the owner turned off CodeQL default setup on 2026-11-07 with no replacement scan: code scanning is off |
| `railway-deploy-drift.yml` | Hourly cron, manual | Runs two independent read-only checks against the exact production fleet: Viewer-safe source/build/deploy configuration drift and deployment/Git-closure drift. It has no mutation, dispatch, retry, approval, or acceptance-baseline path |
| `railway-registry-sync.yml` | Push to `main` touching Railway desired state or reconciler code, manual | Resolves the current `main` revision before checkout, so a run that main outpaced or an older re-run applies the newest registry rather than its trigger SHA (attempts created before #9274 keep the old refusal on re-run; dispatch a new run), then applies registry-managed production configuration from that revision with the dedicated mutation token, then verifies it with the separate Viewer identity. Audits configuration only — the deployment-history check is legitimately red during post-merge build lag |
| `railway-deploy-trigger.yml` | Manual rollback only | Keeps the legacy reconciler quiesced unless an operator explicitly activates the bounded rollback path; it does not own normal Railway deployment creation |
| `analytics-collector-monitor.yml` | 15-minute cron, manual | Probes the self-hosted Umami collector directly (heartbeat, tracker script, ingest route) and fails when events are being dropped — Railway reported a green deployment through the 4-day #5565 blackout, so deployment status is not trusted here |
| `deploy-error-canary.yml` | Hourly cron, manual | Compares per-route API error rates over the last two hours with the preceding seven days in Axiom; fails on qualifying regressions, missing configuration, or invalid query results |
| `umami-storage-monitor.yml` | 15-minute cron, manual | Reads the Umami Postgres Railway volume and the `umami-retention` deployment history without mutation, carries a bounded history between runs as an artifact, and fails on capacity or projected days-to-full thresholds, or when the retention runner's newest deployment that ran is `CRASHED` |
| `sentry-resolve-pin-audit.yml` | Daily cron, manual | Read-only audit of resolved Sentry issues (#7838): fails when a resolution carries an `inRelease`, `inNextRelease` or `inCommit` pin instead of a plain resolve. The GitHub integration adds such a pin whenever a commit body says `Fixes WORLDMONITOR-XX`, and browser events all carry a static semver release, so a pinned issue can never reopen and reads resolved forever while the bug keeps firing. It reports only the short ID, permalink and pin value, never the resolver identity Sentry attaches alongside the pin |
| `contributor-trust.yml` | PR | Gates untrusted first-time-contributor runs |
| `issue-ui-evidence.yml` | Issue opened or edited | The bug report form refuses an empty screenshot field but cannot check that it holds an image, so this catches the rest: an issue from outside the maintainer set whose title or body says `UI` and carries no screenshot, recording or image link gets the `needs-screenshot` label and one comment asking for the image. The label clears on the edit that attaches one. Never closes or reopens an issue. Maintainer, collaborator and bot issues are exempt. The decision reads the issue's current state from the API, not the webhook snapshot; issue text reaches the script only through the payload file and that read |
| `stacked-merge-guard.yml` | PR (including base edits), push to main | Required pre-merge check (#7006): fails when a PR's base is not `main` and that base branch's own PR is already merged, which is how a stacked child can show MERGED while `main` never receives the commits |
| `orphaned-stacked-merge-monitor.yml` | PR closed and merged | Post-merge safety net for #7006: retargets open children of a merged parent, flags children GitHub closed when the parent branch was deleted and strands their open children, then fails when the merge commit is not an ancestor of `main`, opens an issue, and comments on the purple PR |
| `deploy-worker.yml` | Push to main (worker paths), manual | Deploys the `api-cors-preflight` Cloudflare Worker |
| `deploy-railway-reconcile-control.yml` | Push to main (control-plane paths), manual | Tests and deploys the isolated SQLite-backed Durable Object used for Railway reconciliation leases, attempts, dispatch holds, and the global mutation-uncertain barrier; deployment does not itself activate the trigger cutover |
| `railway-deploy-trigger-watchdog.yml` | Manual rollback only | Checks the legacy rollback surface only when an operator dispatches it; it can authorize a fenced replacement only when both legacy activation flags are explicitly enabled |
| `railway-reconcile-manual-recovery.yml` | Protected manual dispatch only | Evidence-bound break-glass resolution for ambiguous dispatch holds or post-mutation barriers; records immutable supersession and delegates any retry to the ordinary lease-aware workflow rather than carrying a Railway deploy token |
| `docker-publish.yml` | Release, push to main (`docker/**`, `.dockerignore`, this workflow), daily cron (02:19 UTC), manual | Multi-arch image (amd64, arm64) pushed to GHCR. A release tag, whether a person published it or `build-desktop.yml` dispatched the build for a release it published with `GITHUB_TOKEN` (which raises no event), cuts the version tags and, unless it is a pre-release, moves `latest`; a push to main, the cron and a dispatch against main publish `sha-<commit>` alone and never move `latest`. So a Dependabot base-image bump or a Docker config change is built, smoke-tested and published within minutes of merging; application changes, already built before merge by Test's `unit-built-output`, reach a `sha-*` image with the daily cron; everything reaches `latest` with the next release. Both `FROM` lines in `docker/Dockerfile` are digest-pinned, so a base fix reaches the registry only once Dependabot has moved the pin on `main`. This is also the only workflow that builds and pushes `docker/Dockerfile`'s image, so before any push it loads the amd64 image and requests its live routes; a failed push-triggered or scheduled run opens or re-comments a tracking issue, because nothing else watches an unattended publish |

The Railway `umami` runtime is built from `Dockerfile.umami`, which pins the
upstream v3.2.0 release and applies the reviewed session-data upsert fix.
The separate `umami-retention` cron uses `Dockerfile.umami-retention` and the
bounded SQL contract. The old collector is drained to zero before the patched
image runs its schema migration as a monitored one-off; schema verification,
patched-runtime write acceptance, and retention are independent operational
gates.

**Source files**: `.github/workflows/`, `.husky/pre-push`. The workflow list is CI-checked against `.github/workflows/*.yml` by `npm run docs:check` — a new workflow file must be added to this table.

---

## 12. Directory Reference

```
.
├── api/                    Vercel Edge Functions (self-contained JS)
│   ├── _*.js               Shared helpers (CORS, rate-limit, API key, relay, Sentry, session)
│   └── <domain>/           Domain endpoints (aviation/, climate/, conflict/, ...)
├── consumer-prices-core/   Consumer-price collection service (Playwright scrapers, per-country baskets; Railway/Docker)
├── data/                   Static data (telegram channels, OREF threat translations, gamma irradiators)
├── deploy/                 Deployment configs (nginx)
├── docker/                 Dockerfile + nginx config for Railway
├── docs/                   Engineering records (docs/engineering/) and generated OpenAPI (docs/api/)
├── proto/                  Protobuf service definitions (sebuf framework)
├── public/                 Static assets served as-is (favicons, textures, map styles, data, robots.txt, 404.html)
├── scripts/                Seed scripts, build helpers, relay service
├── server/                 Server-side code (bundled into Edge Functions)
│   ├── _shared/            Redis, rate-limit, LLM, caching utilities
│   ├── gateway.ts          Domain gateway factory
│   ├── router.ts           Route matching
│   └── worldmonitor/       Domain handlers (mirrors proto structure)
├── shared/                 Cross-platform JSON configs (markets, RSS domains)
├── src/                    Browser SPA (TypeScript)
│   ├── app/                App orchestration managers
│   ├── bootstrap/          Startup/recovery (chunk reload, deferred Sentry, SW update)
│   ├── components/         Panel subclasses + map components
│   ├── config/             Variant, panel, layer, market configurations
│   ├── data/               Static JSON datasets (conservation, renewable, happiness)
│   ├── e2e/                Map test harnesses (consumed by Playwright specs)
│   ├── embed/              Embeddable widget loader
│   ├── generated/          Proto-generated client/server stubs (DO NOT EDIT)
│   ├── locales/            i18n translation files
│   ├── services/           Business logic organized by domain
│   ├── shared/             Cross-cutting helpers (premium paths, registries, staleness)
│   ├── shims/              Runtime shims (child-process for sidecar)
│   ├── styles/             Global CSS (layers, themes, panel styles)
│   ├── types/              TypeScript type definitions
│   ├── utils/              Shared utilities (circuit-breaker, theme, URL state)
│   └── workers/            Web Workers (analysis, ML, vector DB)
├── src-tauri/              Tauri desktop shell (Rust)
│   └── sidecar/            Node.js sidecar API server
├── tests/                  Unit/integration tests (node:test)
└── workers/                Cloudflare Workers (edge CORS preflight for api.worldmonitor.app)
```
