---
title: "Lite hosting brief: measurements for the Phase 4 decision"
date: 2026-11-18
status: active
type: ops
origin: "Refactor plan Phase 4 (2026-11-18-001): measure before choosing where Lite runs"
---

# Lite hosting brief: measurements for the Phase 4 decision

Phase 4 of the [refactor plan](2026-11-18-001-refactor-lite-monorepo-plan.md) chooses where Lite runs. This brief records what could be measured or counted without deploying anything, and the decisions the owner still has to make. Nothing here has been deployed, and no account has been created.

## What was measured locally (2026-11-18, Apple silicon, Docker 29.8, linux/arm64)

| Check | Result |
|---|---|
| The pinned base images (`node:24-alpine`, `node:22-alpine`, `node:24-slim`, `nginx:alpine`, `postgres:18-alpine`) | Every pinned digest is a multi-arch index with `linux/arm64/v8` and `linux/amd64`, so Oracle's ARM A1 can run them unchanged |
| `docker/Dockerfile` (UI only, nginx) | Builds on arm64 with Vite 8 and Rolldown's musl binding; serves the five `/lite` routes and the `/` → `/lite` 307 |
| `Dockerfile` (UI + Node API, supervisord) | Builds on arm64 (1 min with a warm layer cache), image 368 MB. Needs `WM_SESSION_SECRET` (32+ characters) to start |
| `Dockerfile.relay` | Builds on arm64, image 361 MB. Needs `RELAY_SHARED_SECRET` to start |
| API container memory, no Redis | 44 MiB idle, 63 MiB after 600 requests (`/api/bootstrap`, a market RPC, `/api/health?compact=1`) |
| Relay container memory, no network | 36 MiB idle. The real figure depends on the AIS vessel cap (`AIS_MAX_VESSELS`) and needs the owner's AIS key to measure |

Not measured: `/api/bootstrap` latency per hosting option (it needs the deployments), seeder memory (seeders call live upstreams and write to Redis), and anything under real Upstash latency.

## Upstash commands per day (estimate from the code)

These numbers come from reading the code, not from a meter. A subagent counted them, and I spot-checked the two largest: the health snapshot TTL and the Sidebar poll. The free tier is not stated anywhere in the repository; the table assumes **500k commands a month** (about 16.7k a day), which the owner should confirm. The only price in the repository is pay-as-you-go at $0.20 per 100k commands ([bootstrap R2 comparison](../research/investigations/2026-07-14-bootstrap-r2-economic-comparison.md)).

| Source | Commands per day | How it is counted |
|---|---|---|
| Lite seeders (`npm run seed:lite:watch` schedule) | ~34k | 7 commands per standard publish (lock, staging SET, canonical SET, DEL, seed-meta, verify GET, release), plus each extra key. Market quotes (39 country-index keys) and GDELT bulk lead |
| Runner ticks | ~9.2k | Every 5 min: 1 heartbeat SET and 31 seed-meta reads |
| One tab, per visible 5 minutes | ~1,040 | About 940 of it is `/api/health?compact=1`: its verdict snapshot lives 60 s (`HEALTH_VERDICT_SNAPSHOT_TTL_SECONDS`), so each 5-minute Sidebar poll runs a full sweep of about 930 commands (STRLEN, seed-meta GET, EXISTS over every registered key). Each RPC adds one rate-limit EVALSHA and 1–2 GETs |
| One page load | ~1,100 | The bootstrap tiers' 25- and 63-GET pipelines, plus the first refresh |
| News-digest rebuilds | ~0.7–2.3M, roughly ±3× | 2–10k commands per rebuild on a 900 s TTL. The Insights seeder warms full/en and full/zh every 15 min, and the open UI keeps finance and tech warm |
| `scripts/ais-relay.cjs`, if it runs | +79k–190k, plus millions through its digest warm | Classify, a 10-second transit flush, a duplicate market loop and a digest warm of 32 edition × language cells every 17 min |

| Usage (no relay) | Per day | Per month | At $0.20 per 100k |
|---|---|---|---|
| 1 tab visible 8 h a day | ~0.8–1.7M | ~24–51M | ~$48–$102 a month |
| 1 tab visible 24 h a day | ~1.4–2.6M | ~42–78M | ~$84–$156 a month |
| 8 h a day, with digest rebuilds kept off the hot path | ~145k | ~4.3M | ~$9 a month |

The free tier does not cover Lite as it runs today, even without the relay. The three changes that would cut the most commands are, in order:

1. **Digest rebuilds.** Warm only Lite's English editions (the Insights seeder's zh warm, and the relay's 32-cell warm if the relay runs), lengthen the digest TTL, and trim story tracking for Lite.
2. **The health poll.** Sweep only the Lite health keys (about 60 instead of about 920), or keep the compact snapshot at least as long as the 5-minute poll.
3. **The relay.** Do not run it whole for Lite: gate Classify, the transit flush and the duplicate market loop. After that, drop Market-Quotes' 39 country-index keys, and the 3 of the 7 publish commands that only stage and verify.

Two effects pull the other way. On Vercel, the `public=1` bootstrap and digest responses are cached by the CDN (`s-maxage` 600–7200 s), so repeat reads never reach Redis. A VPS running `local-api-server.mjs` has no CDN unless a Cloudflare cache rule is added in front of the tunnel.

## The options, with these numbers

| | Oracle Always Free VPS + Vercel Pro UI | Vercel Pro Node functions | Render / Cloudflare Workers |
|---|---|---|---|
| API runtime | `local-api-server.mjs` in the `Dockerfile` image (63 MiB under light load) | The 24 `api/` entries declare `runtime: 'edge'`. Each one needs its config changed and a check for Edge-only APIs | Earlier analysis: limits or extra cost |
| Seeders and relay | Same host, Docker Compose; arm64 images verified | Light seeders on Vercel Cron; the relay still needs a long-running host | — |
| Redis traffic | No CDN by default; add a Cloudflare cache rule for `public=1` URLs | CDN absorbs repeat public reads | — |
| Redis host | Upstash, or Redis on the VPS behind the repository's Upstash-compatible REST shim (`docker/Dockerfile.redis-rest`) | Upstash | Upstash |

## Owner decisions

1. **Where the API runs:** the VPS, Vercel Node functions, or a split.
2. **Redis:** pay for Upstash by usage (about $9 to $100+ a month, depending on reductions 1 and 2), or run Redis on the VPS. The owner's stated preference is to keep Upstash.
3. **The relay:** run it gated for Lite, or not at all. Lite does not load the vessel feed (`apps/web/src/lite/data/escalation.ts`), and of the Sources connectors only cable health names the relay as its producer (`apps/web/src/lite/data/connectors.ts`). The Finance map's chokepoint status also depends on it, through its handler (`packages/server/worldmonitor/supply-chain/v1/get-chokepoint-status.ts`):
   - The handler reads the relay's transit summaries (`supply_chain:transit-summaries:v1`, built from the PortWatch key) and its AIS snapshot.
   - In production the relay runs `seed-chokepoint-flows` every 6 h. Without the relay, a plain seeder schedule has to run that seeder, as the local runner does (`scripts/run-lite-seeders.mjs`).
   - Without the relay the chokepoint status still renders, from tanker flows and NGA warnings, but reports partial coverage.
   - Four warm-ping loops in the relay POST to the upstream project's production API (`https://api.worldmonitor.app`) with an `Origin: https://worldmonitor.app` header: cable health (every 30 min), service statuses (15 min), risk scores (8 min) and chokepoint status (6 min). They write nothing to this deployment's Redis, so they warm upstream's caches, not ours, and without `WORLDMONITOR_RELAY_KEY` they get 401s. The relay's widget agent also fetches its session from `https://api.worldmonitor.app/api/wm-session`. Gating the relay for Lite should turn these off or point them at this deployment's API.
4. **The command reductions above:** each is a behaviour change, so each needs approval before it is built.

Before choosing, one day of `seed:lite:watch` and one open tab against a scratch Upstash database would replace the estimate with a meter reading. That needs the owner to create the database and put its credentials in `.env.local`.

## Carried into Phase 4 (from the refactor plan)

- Moving the seeders, relay and tools into `apps/ingest`, `apps/relay` and `tools/`, together with the Railway registry trim.
- `turbo-ignore` for the UI deploy, once `api/` has a workspace.
- The Docker sidecar desktop-key relay, and the notification and digest seeders that still reach for Convex.
- The frozen OpenAPI auth contract and its deprecation `Link` to the deleted `api-versioning.md`.
- README product text and `scripts/cloudflare-cache-rule.mjs`.
- The forecast services that read `../packages/shared/country-names.json`, which a deploy rooted at `scripts/` cannot reach.
- The `deploy-worker.yml` path filter gap.
- The Vite native config-loader follow-up from Phase 3.
