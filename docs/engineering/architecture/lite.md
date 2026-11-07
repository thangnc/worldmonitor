# World Monitor Lite profile

Status: accepted scope and architecture, 2026-11-07. Phase 0 (repository review) is done. Phase 1 (profile shell) is implemented in code; the access gate is configured at deploy time.

This is the canonical spec for the owner's private, low-noise build of World Monitor. It records the original proposal, what review against the code changed, and the owner's decisions. `CLAUDE.md` holds the always-loaded summary and `.claude/rules/lite-profile.md` holds the file-level rules. Change this document first when scope or architecture changes.

## Purpose

Replace the "everything happening" view with three bounded domains. The default screen answers in under a minute: **what changed, why it matters, and what may happen next.**

1. Geopolitics and conflicts
2. Finance, Bitcoin and crypto
3. Technology and AI

Start with a low-noise executive view, keep the existing ingestion architecture, and promote an item only when several signals say it matters.

## Owner decisions

| Question | Decision |
|---|---|
| Name and branding | Keep "World Monitor". The instance is private and gated to the owner, not offered to others ([trademark policy](../../trademark-policy.mdx)). If it is ever opened to other people, switch to a distinct name with "Based on World Monitor" attribution. |
| Variant | Keep the existing `full` variant. No new `lite` variant. |
| Lite mechanism | A deployment profile: one build/deploy env flag on the owner's deployment turns on the three-domain defaults and the owner's custom features. With the flag off, behavior is identical to upstream. |
| "For me only" | The profile flag plus an access gate in front of the owner's domain. |
| Hosting | The owner's managed stack (see [Platform map](#platform-map)). The Docker compose stack stays a secondary option with the same flag. |
| AI models | External APIs allowed, through the existing chain in `server/_shared/llm.ts`. Keys and per-call cost are an operating concern. Local Ollama stays optional. |
| Conflict data | No ACLED (2026-11-07): API access is hard to obtain. UCDP (`seed-ucdp-events`, `UCDP_ACCESS_TOKEN`) supplies the map events and each country's conflict floor. GDELT country events (`seed-gdelt-bulk-materializer`, no key) supply the realtime conflict and unrest signal; `get-risk-scores.ts` scores them whenever ACLED returns no events. UCDP alone cannot do this, because it is an annual release. Health reports ACLED as `not_configured`, which is not a failure, and the `[CII] ACLED returned 0 events` log line is expected. |
| Lite map | MapLibre on OpenFreeMap vector tiles, solid land (2026-11-07): free, no key, no usage limits, and already the dashboard's fallback basemap. The style (`src/lite/map/style.ts`) draws only land, water, country borders and place names, colored from the Lite `@theme` tokens; markers, the popup a marker click opens, zoom buttons and the OpenStreetMap credit are Tailwind-styled HTML. No popup is open until a marker is clicked. MapLibre loads only when Geopolitics opens. If OpenFreeMap is down, the map shows the background with markers still placed. |
| Conflict map design | The owner's design (2026-11-08). UCDP locations are red circles sized by deaths, clustered by zoom (`supercluster`) with the toll printed inside; a click zooms a cluster in or opens a location's event card. Curated hotspots are diamonds with a name, coloured by the dashboard's live escalation score (`src/lite/data/escalation.ts` over `shared/analysis-hotspot-escalation.ts`: news in the last 2 h, CII, unrest, earthquake and military-flight convergence within 150 km, flights within 200 km; no vessels or session history). All curated hotspots are drawn, as on the dashboard; from 3/5 (elevated) they also show their name, and below it they are small grey diamonds labelled watch or stable in their card. Cards open on click beside the marker with a leader line. The dashboard's time range (1h–7d, default 7d) plus 30d (2026-11-08) sits on the map. It filters the digest-driven parts of the screen counted back from now, and the UCDP events counted back from UCDP's newest event, because UCDP is a delayed release (weeks behind) and a range ending today would hold none; the map's subtitle names that date. UCDP dates events by day, so ranges up to 24h all show its latest day, and the subtitle says so. A point with two or more UCDP events gets a summary card (date span, violence types, actor pairs, sources), and UCDP's `XXX` codes for actors it cannot identify read "Unidentified group (UCDP XXX100)". |
| Front page | A dedicated Lite UI at `/lite`, built from the owner's designs with Preact and Tailwind CSS. With the flag on it is the default page; the full dashboard stays reachable at `/dashboard?full=1`. See [Lite UI](#lite-ui-lite). |

### Open decisions

These were open in the proposal and are still open:

1. The initial watchlist: countries, conflicts, assets, institutions, companies, AI topics.
2. Alert latency and false-positive tolerance per domain.
3. Budget and licensing posture for market, news and specialist data.
4. Who reviews source policy, corrections and high-impact alert rules (default: the owner).

## Scope by domain

Panel and layer IDs are the keys in `src/config/panels.ts` and `src/config/map-layer-definitions.ts`. "Missing from `full`" means the panel exists only in another variant and must be added to `FULL_PANELS` before the profile can show it.

### Geopolitics and conflicts

Event-centric, not headline-centric. Refresh target: 5 to 15 minutes.

| Proposal widget | Existing building blocks | Gap |
|---|---|---|
| Priority event feed | `insights`, `strategic-posture`, `cross-source-signals` | No durable event object (see [Intelligence layer](#intelligence-layer)) |
| Conflict map | layers `conflicts`, `hotspots`, `military`, `ciiChoropleth`, `sanctions`, `ucdpEvents` | — |
| Escalation tracker | `cii`, `strategic-risk`, `escalation-correlation`, `ucdp-events` | 24h/7d change exists for CII; not per event |
| Regional timeline | `threat-timeline`, story lifecycle (`shared/story-phase.js`) | No multi-story event timeline |
| Watchlists and alerts | followed countries, `monitors` | Alert delivery depends on Convex (see [Platform map](#platform-map)) |

### Finance and crypto

Contextual monitoring, not a trading terminal. Refresh target: 1 to 5 minutes for prices, event-driven for news.

| Proposal widget | Existing building blocks | Gap |
|---|---|---|
| Market pulse | `markets`, `macro-signals`, `fear-greed` | — |
| BTC/crypto detail | `crypto`, `etf-flows`, `stablecoins`; Hyperliquid positioning stress (`scripts/seed-hyperliquid-flow.mjs`) | `crypto-news` missing from `full`; no liquidation data |
| Macro and calendar | `economic-calendar`, `macro-signals` | `centralbanks` missing from `full` |
| Market-moving events | market news in the digest; seeded crypto, stock, index, commodity and FX quotes for the price links | Rows are deduplicated stories, not clustered events; no freight index to link shipping stories to |
| Risk alerts | stablecoin depeg status (`shared/stablecoin-classifier.cjs`), relay `market_alert` on 24h moves | Depeg never notifies; funding and open interest are display-only; no volatility model |

Market commentary is labelled as analysis, not investment advice. Price and derivatives data must be licensed and fit provider rate limits.

### Technology and AI

Material capability, policy and business changes, not product marketing. Refresh target: 15 to 60 minutes.

| Proposal widget | Existing building blocks | Gap |
|---|---|---|
| AI/tech event feed | `ai`, `tech` | Not grouped into events |
| Model and product tracker | — | New panel and sources needed |
| Policy and governance | `policy` (AI Policy & Regulation news), `ai-regulation`, `src/config/ai-regulations.ts` | Both missing from `full`. `full` has `trade-policy`, a different panel |
| Research radar | research service (`server/worldmonitor/research/v1/`: arXiv, Hacker News, trending repos) | Data exists; no panel on `full` |
| Infrastructure and business | `hardware`, `tech-readiness`, layer `datacenters`, `src/config/ai-datacenters.ts` | `hardware` missing from `full` |

### Interaction rules

- One dashboard with geopolitics, finance and technology as the default layout. Ship a "Lite" mission preset (`src/services/mission-presets.ts`) so the layout can be re-applied: `FULL_PANELS` defaults only reach first visits and new keys.
- Pin entities, regions, assets, companies, models and topics. Reuse followed countries, the market watchlist and `monitors` before adding a new store.
- Every summary exposes its sources, timestamps, confidence and "why this matters".
- Progressive disclosure: headline → event card → evidence and timeline → original links.
- Keep confirmed facts, attributed claims, model inference and open questions visibly distinct.

## Removed or optional by default

All of these are `enabled: false` panel flags or layer booleans under the profile. None needs a code change.

| Category | Decision | IDs |
|---|---|---|
| General and regional news streams | Off; source layer for search only | `live-news`, `politics`, `us`, `europe`, `middleeast`, `africa`, `latam`, `asia`, `gov`, `thinktanks` |
| Webcams, clocks, aviation | Off | `live-webcams`, `world-clock`, `airline-intel` |
| Hazards and environment | Optional: enable per region or as a correlated alert | `satellite-fires`, `climate`, `disease-outbreaks`, `displacement`; layers `weather`, `natural`, `outages`, `ais` |
| Social trend and firehose | Off; at most a labelled discovery layer | `social-velocity`, `telegram-intel`, `x-intel`, `wsb-ticker-scanner` |
| Retail and consumer | Off | `consumer-prices`, `grocery-basket`, `bigmac`, `fuel-prices` |
| Commodities and supply chain | Off | `commodities`, `supply-chain`, `energy` |
| Long-tail crypto tokens | Never added to `full` | `defi-tokens`, `ai-tokens`, `other-tokens` |
| Repeated per-source widgets | Consolidate into event cards | — |

The proposal also listed sports, entertainment and celebrity streams. The catalog has none, so there is nothing to remove.

### Decision rule for optional modules

Enable an optional panel, layer or feed only if it meets at least one test:

- It is an early indicator for a core-domain event.
- It materially changes exposure for a defined watchlist.
- The owner requests it with a clear decision use.
- Its expected signal outweighs its maintenance, cost, licensing and distraction burden.

## Profile mechanism

- `VITE_LITE_PROFILE=true` at build time turns the profile on (`LITE_PROFILE_ENABLED` in `src/config/lite-profile.ts`). The module also holds the Lite panel order, the cross-variant panel list, and the desktop and mobile layer sets.
- Under the flag: Lite panel and layer defaults, the Lite mission preset, the Lite-only panels and features, the source-policy filter, and the Lite seeder allowlist.
- Without the flag: no behavior change. Lite-only code paths are flag-gated so upstream merges stay cheap.
- The variant stays `full`. A custom hostname already resolves to `full` (`src/config/variant.ts`), so the owner's domain needs no variant change.
- Panels taken from the `finance` variant (`crypto-news`, `centralbanks`) and the `tech` variant (`policy`, `ai-regulation`, `hardware`) join the `full` catalog only under the flag (`buildLitePanelCatalog`), so presets and panel enablement keep them. Their news comes from the other editions' digests. Upstream `full` does not change.
- Under the flag, the `full` catalog lists the Lite panels first and enabled, and every other `full` panel disabled but still available in Settings. Default map layers are exactly the Lite set (`buildLiteMapLayers`).
- The `lite-desk` mission preset (Lite Desk) re-applies the layout. It is always in the catalog, so preset ids, analytics and checkout attribution stay in sync, but it is offered only when the flag is on.
- Lite layers are all allowed on `full`. Finance and tech map layers (`stockExchanges`, `centralBanks`, `financialCenters`, `techHQs`) are not in the profile; adding one later needs `VARIANT_LAYER_ORDER.full`, or `sanitizeLayersForVariant` strips it.
- No Lite panel is premium on the web build (`cii` and `strategic-risk` are premium only in the desktop app), so Phase 1 needs no premium unlock.

## Lite UI (`/lite`)

The owner's front page: a sidebar, the cross-domain Briefing at `/lite` (home), and its three child screens, Geopolitics & Conflicts (`/lite/geopolitics`), Finance & Crypto (`/lite/finance`) and Technology & AI (`/lite/tech`). The Briefing links to each child through the sidebar, its events' domain tags and its panel headers. The design exports are kept out of the repository; their sample rows live in `src/lite/data/fixtures.ts`.

**Stack exception.** The dashboard has no framework. `src/lite/` alone uses Preact (JSX through `tsconfig.json`'s `jsxImportSource`) and Tailwind CSS 4 (`@tailwindcss/vite`, scoped to `src/lite/lite.css`), with Lucide icons and self-hosted IBM Plex fonts (the CSP allows no font host). `scripts/lint-boundaries.mjs` keeps it separate: `src/lite/` may import `config`, `services`, `utils`, `shared/` and generated clients, never `src/components/`, `src/app/` or `App.ts`, and nothing outside it may import `src/lite/`.

**Routing.**

| Request | Flag on | Flag off |
|---|---|---|
| `/` on the owner's host | `middleware.ts` 307s to `/lite` (legacy `/?lat=` map links still go to `/dashboard`) | Unchanged (404 on a custom host) |
| `/` in dev or Docker, `/dashboard` | The guard at the top of `src/main.ts` replaces the page with `/lite` unless the URL carries dashboard state | Unchanged |
| `/dashboard?full=1` | The dashboard; remembered for the tab (`sessionStorage` `wm-lite-full`) | The dashboard |
| `/lite`, `/lite/geopolitics`, `/lite/finance`, `/lite/tech` | The Lite UI | A notice that the profile is off, with a link to `/dashboard` |
| Installed PWA | Starts on `/lite` | Starts on `/dashboard` |

The rules are in `src/config/lite-route.ts`. `vercel.json`, `docker/nginx.conf*` and a Vite dev middleware serve `lite.html` for the four paths only, and `isKnownPublicPagePath` (`src/config/agent-not-found.ts`) lets exactly those four past the 404 gate. `npm run build:lite` (`vite.lite.config.ts`) builds the page on its own after the main build, so it shares no chunks with the dashboard.

**Data.** `src/lite/data/sources.ts` reads the same sources as the dashboard, without `App`: the bootstrap tiers once, then the generated RPC clients, and the news digest through its public CDN shape. It uses no premium path. Each widget is one of:

- **Real**: rendered from a source. An empty or failed source shows its own state and names its seeder. It never falls back to sample data.
- **Derived**: computed by a stated rule and tagged DERIVED with the rule in its tooltip.
- **Sample**: no source exists yet. It renders the design's values with a SAMPLE badge.

| Screen | Real | Derived | Sample |
|---|---|---|---|
| Briefing | Hourly AI brief: lead, cited lines and their sources (`insights`, seed-insights); market pulse tickers; macro calendar and AI regulation deadlines as catalysts | Priority events: each child screen's main list merged, importance ≥ 50, ranked by importance × credibility; momentum from story phase; the corroboration and attributed-claims columns from the dashboard's corroboration verdict; "since" counts; market regime (five 24h moves); escalation trend from CII history (±10% is stable); watch alerts from built-in rules (impact, BTC 2h move > 4σ, primary-source AI policy) | None. Open questions, Pin, Split cluster, Mute, Manage and Generate brief are SOON |
| Geopolitics | UCDP events on a MapLibre map (OpenFreeMap tiles, styled from the Lite tokens), clustered by zoom with event cards; priority incidents (digest, medium threat and up) | Curated hotspots coloured by the dashboard's live escalation score (see Owner decisions); region strip from CII and country history; report histogram over the selected time range (1h–30d), which also filters incidents, timeline and evidence mix; timeline tags and incident status from the dashboard's corroboration verdict, with tier 1 marked beside it; evidence mix by source class | Watchlist |
| Finance | Tickers (DXY from gold drivers); hourly BTC closes; Hyperliquid funding and open interest; spot ETF flow (an estimate); breadth; market-moving stories (one copy per story, asset classes in turns, war stories left to Geopolitics unless the headline names a commodity, then marked "Linked to GEO"); macro calendar | Risk alerts (fixed thresholds); market-event price links (24h change of the instruments a headline names or its tickers, else asset-class benchmarks; "No price impact" under 0.25% or 3bp); 48h realized volatility; 14-day correlation of hourly returns (Oil stands in for DXY, which has no hourly series) | Liquidations; BTC volume bars |
| Technology & AI | Material developments (tech digest); policy actions (the curated `src/config/ai-regulations.ts` list); arXiv papers; funding and infrastructure stories | Evidence pills (corroboration verdict, "Primary source" when a tier-1 outlet reports alone); research signal (arXiv plus Hacker News); watched-topic counts | Model and product tracker; infrastructure KPI tiles |

**Corroboration.** Every Lite status, tag and pill comes from `assessCorroboration` in `server/_shared/corroboration.ts`, the rule the full dashboard's news and insights badges use, applied to each digest item (`corroborationOf` in `src/lite/data/transforms.ts`). It counts publisher families from the digest's origin-aware `corroborationCount`, so one newsroom's feeds and reprints count once:

- **Corroborated**: two or more publishers.
- **Single publisher**: one.
- **Low-tier only**: every publisher seen is a declared tier-4 outlet (aggregators and blogs).
- **No count**: the digest carried none. It never reads as a single source.

It describes coverage, not accuracy, so Lite never labels a headline "confirmed". Tier 1 (`isPrimarySource`) is shown beside the verdict and never upgrades it. Tier 1 in `shared/source-tiers.json` covers wires and official bodies and also some major outlets and public broadcasters. Confirmed facts need the event-analysis phase. `storyMeta.sourceCount` is report volume: Lite shows it as a report count and never as corroboration.

Alerts, Watchlists, Sources, Scoring rules, Settings and each screen's primary action are shown and marked SOON. They arrive with the phases that give them data.

## Platform map

| Upstream | Owner's stack | Notes |
|---|---|---|
| Vercel (SPA + Edge API) | Vercel | Same build and `vercel.json`. |
| Upstash Redis | Upstash | Same; Redis stays the only store the dashboard reads (`cachedFetchJson`, `seed-meta`). |
| Railway (seeders, relay, workers) | Render | Seeders are platform-neutral (`loadEnvFile`, `scripts/_bundle-runner.mjs`). Port the cron schedules from `scripts/railway-services.json` for the Lite allowlist only. Railway-specific watch paths and deploy-gate tests do not apply to Render. |
| Convex (accounts, prefs sync, alert rules, `intelHistory`, entitlements) | None by default | Single user: preferences stay in localStorage. Alert rules and delivery, `intelHistory`, and premium unlock need a non-Convex path or are dropped. |
| Clerk | None | No accounts. Access is the gate below. |
| — | Cloudflare | DNS, the access gate (Cloudflare Access, or Vercel Deployment Protection; verify plan limits), and R2 for raw archives. `scripts/_r2-storage.mjs` already supports Cloudflare and S3 modes and records sha256. |
| — | Supabase (Postgres) | Phase-gated, see below. |

### Phase gates for new stores

Do not add a datastore before its gate is met:

- **Supabase Postgres** when the build needs any of: an event store with timelines, history longer than Redis TTLs, alert rules or delivery state, or a replacement for `intelHistory` (pgvector). Template: `consumer-prices-core/` (`pg`, migrations, `raw_payload_json`, `raw_hash`).
- **R2 raw archive** when audit or replay of upstream payloads is required. Store the body, fetch time, canonical URL, source and content hash.

### Operations

- **Seeder allowlist.** Upstream runs about 250 seeders. The profile runs only those feeding Lite panels. This sets Render cost. It must include `seed-gdelt-bulk-materializer`: without ACLED it is the only realtime conflict input to the risk scores (see [Owner decisions](#owner-decisions)). The hotspots' live score also reads `seed-unrest-events` (runs on GDELT alone without ACLED), `seed-earthquakes` (USGS, no key) and `seed-military-flights` (adsb.lol by default; OpenSky and Wingbits are optional); without them it falls back to news, CII and the curated baseline, and each hotspot card names the missing inputs.
- **Health.** `api/health.js` grades every registered key. Keys produced only by Railway services or Convex show as stale on the owner's stack, so the profile needs a health key subset matching the allowlist.
- **Licensing.** `shared/source-attribution-manifest.json` has 1,044 hosts: 735 `terms-review`, 189 `excluded`, 120 `reviewed`. Sixteen are licensed under "the World Monitor agreement", which does not cover the owner. The profile applies a source-policy filter from the manifest's `license` and `status` fields.
- **AGPL.** A private modified deployment that only the owner uses needs no source offer to others ([self-hosting](../../self-hosting.mdx)); the fork is public anyway.

## Intelligence layer

Goal: turn many reports into a few evidence-linked events, keep uncertainty visible, and never present generated text as verification.

### Reuse map

| Capability | Exists | Where |
|---|---|---|
| URL canonicalization | Partial (not at ingest) | `shared/article-identity.js` |
| Story similarity | Yes | `shared/story-identity.js` (server), `shared/news-clustering-core.js` (client and MCP), `scripts/lib/brief-dedup.mjs` (digest embeddings) |
| Syndication and publisher families | Yes | `shared/syndication.js`, `shared/publisher-families.js` |
| Source tier and credibility | Yes | `shared/source-tiers.json`, `shared/news-credibility.js`, `shared/source-provenance.ts` |
| Corroboration | Yes | `server/_shared/corroboration.ts` |
| Impact and importance | Yes (several) | `computeImportanceScore` in `server/worldmonitor/news/v1/list-feed-digest.ts`, `scoreImportance` in `scripts/_clustering.mjs`, CII, hotspot escalation |
| Momentum | Partial | `src/services/velocity.ts`, story lifecycle |
| Trend and anomaly | Yes | `shared/keyword-spike-core.js`, temporal-baseline z-scores |
| Grounded briefs with citations and abstention | Yes | country brief, `scripts/_insights-brief.mjs`, `shared/brief-llm-core.js`, `shared/brief-claim-rules.js` |
| LLM chain | Yes | `server/_shared/llm.ts` |

The three similarity definitions are separate on purpose (`shared/news-clustering-core.js` header). Do not merge them without a product decision.

### Gaps to build

1. A durable **event object**: multi-story, with an evidence timeline and a per-event confidence.
2. A **novelty** score. Only a console prototype exists in `src/services/parallel-analysis.ts`.
3. A per-source **track record**.
4. **Crypto risk alerts**: depeg notifications, volatility, funding and open-interest stress. Liquidation data has no source yet.
5. An **AI/tech event detector** and model-release tracker.
6. **Numeric alert thresholds** and an alert delivery path that does not need Convex.

### Scoring model

Keep component scores interpretable instead of one opaque "AI score": confidence, impact, relevance (watchlist), novelty, momentum. Start rule-based and adjust from feedback. Introduce learned ranking only after enough reviewed outcomes exist to measure false positives, missed events, bias and alert fatigue.

### Briefing contract

Each briefing states the development with its timestamp, keeps confirmed information and attributed claims separate, says what changed since the last brief and why it matters to the watchlist, gives confidence and open questions, and links its sources. AI does extraction, clustering help, summaries and question answering over cited records. It does not invent sources, silently merge conflicting events, make ungrounded forecasts, or take trading or operational decisions.

### Evaluation

| Area | Measure |
|---|---|
| Noise reduction | Headlines per retained event; duplicate suppression rate |
| Timeliness | Ingestion-to-display and alert latency against the domain targets |
| Cluster quality | Sampled precision and recall; merge and split corrections |
| Source quality | Corroboration rate; later correction rate |
| Ranking quality | Top-N relevance review; alert dismiss and mute rate |
| Briefing quality | Citation coverage; factual error rate; usefulness rating |

## Phase plan

| Phase | Scope | Exit condition |
|---|---|---|
| 0. Repository review | This document | Done |
| 1. Profile shell | `VITE_LITE_PROFILE`; Lite panel and layer defaults; Lite Desk preset; the five cross-variant panels; access gate at deploy time | Done in code: the dashboard boots into the Lite layout with the flag on and is unchanged with it off (`tests/lite-profile.test.mts`, `verify-worldmonitor` step `lite-profile.mjs`). The access gate is set up when deploying |
| 1b. Lite UI | `/lite`: the cross-domain Briefing home and three child screens, real data where a source exists, labelled samples elsewhere (see [Lite UI](#lite-ui-lite)) | Done in code: `tests/lite-ui.test.mts`, `tests/dom/lite-ui.test.mts`, `verify-worldmonitor` step `lite-ui.mjs` with the flag on and off |
| 2. Core feeds on the owner's stack | Render services for the seeder allowlist; health key subset; source-policy filter; verify how much general news the `full` digest still carries | Lite panels fresh in `/api/health`; no unlicensed sources |
| 3. Event intelligence | Event object and timeline, novelty, crypto-risk and AI-event detectors, non-Convex alerts (Supabase gate) | Sampled cluster and alert quality meet agreed targets |
| 4. Briefings and trends | Lite brief built on the existing citation-checked brief code | Briefing accuracy and usefulness reviewed |
| 5. Harden | Backups, R2 archive if replay is needed, cost review | Recovery and upgrade path tested |

## Corrections to the original proposal

- The domain scope, removals and most widgets are configuration of the existing `full` variant, not a rebuild.
- There are no sports, entertainment or celebrity feeds to remove.
- PostgreSQL, a work queue and an object store are not needed to start: every handler reads Redis. They enter at phase gates.
- Most of the intelligence layer exists. The real gaps are the event object, novelty, source track record, crypto and AI alerts, and non-Convex alerting.
- Without Convex, alerts, preference sync, `intelHistory` and entitlements do not work. The proposal did not account for this.
- "World Monitor Lite" may not be used as a public product name without permission.

## Rejected alternatives

- **A new `lite` variant.** About 30 registration points (variant list, CORS, Convex preference variants, digest editions, desktop download list, locales, SEO, e2e). About 21 `SITE_VARIANT === 'full'` checks gate CII, intelligence and theater loading (for example `src/app/data-loader.ts` CII refresh and the intelligence refresh in `src/App.ts`), so a new variant would silently lose that data. It also multiplies upstream merge conflicts.
- **A mission preset alone.** Presets are one-off rewrites of local state, not defaults, and cannot gate custom features or seeders. The profile still ships a preset for re-applying the layout.
