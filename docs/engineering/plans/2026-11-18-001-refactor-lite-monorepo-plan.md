---
title: "Refactor: Preact-only app, npm workspaces + Turborepo, Vite 8, deployment last"
date: 2026-11-18
status: active
type: refactor
origin: "Owner decision 2026-11-07 to drop upstream sync and build their own dashboard on the ingestion pipeline"
---

# Refactor plan: Preact-only app · npm workspaces + Turborepo · Vite 8 (Rolldown) · deployment last

## Context

The owner dropped upstream sync (2026-11-07) and is building their own dashboard on World Monitor's ingestion pipeline. Their order of work: **refactor the repo first (Turborepo, a faster bundler, Preact), deployment last.** They pay for Vercel Pro.

Two constraints shape the plan:

- **Turbopack is Next.js-only and needs React**, so it cannot bundle a Preact app. The Preact-compatible equivalent is **Vite 8 with Rolldown** (Rust bundler). The repo is on Vite `^6.4.5`.
- **Preact is already in use** in `src/lite/` (JSX via `tsconfig.json` `jsxImportSource`, Tailwind 4 via `@tailwindcss/vite`, built by `vite.lite.config.ts`). Deleting the old vanilla dashboard makes the whole web app Preact. `@preact/preset-vite` is missing, so there is no state-preserving HMR (prefresh) or devtools hook.

The legacy catalog is [legacy-features.md](../product/legacy-features.md). Production keeps deploying exactly as today (Vercel, `api/` Edge functions at the repo root) until the final phase. Each step is one PR that passes CI. Refactor PRs target the integration branch `refactor/lite-monorepo`, cut from `main` on 2026-11-18, not `main`. The owner merges that branch into `main` once the refactor checks out on it.

## Phase 0 — Record the decisions

- Update `docs/engineering/architecture/lite.md` and `CLAUDE.md`: no upstream sync, Lite is the product, no flag-gated parity, the target layout below, Turborepo, Vite 8. Update `.claude/rules/` paths as they move.
- Tag `archive/legacy-dashboard-2026-11` on `main`.
- Write `docs/engineering/product/legacy-features.md`: one row per old panel/layer (what it showed, domain, Redis key / RPC, producer, UI file at the tag, licence, port candidate). Includes PizzINT, USNI.

## Phase 1 — Delete what the product no longer uses

Too large for one PR, so it lands as four PRs into `refactor/lite-monorepo`, each leaving a working build:

- **1a. The dashboard.** `src/components`, `src/app`, `src/App.ts`, `src/main.ts`, and every `src/` module the Lite app, `api/`, `server/` and `scripts/` no longer import (found by esbuild and `tsc --listFilesOnly` reachability, not by hand); every HTML page except `lite.html`; `e2e/` and `playwright.config.ts`; `vite.lite.config.ts` and `vite.plugin.config.ts`. `vite.config.ts` becomes the Lite build, with the dev API plugins in `vite.dev-api.ts`; the web `vite build` drops from about 16.7 s (2026-11-07 baseline) to about 3 s. `/`, `/dashboard`, `/stocks` and `/story` redirect to `/lite`; the Lite UI loses its "Full dashboard" link and profile-off notice. Tests, CI steps, workflows, lint allowlists and the verify skill that only covered the dashboard go with it. Generators that fed the dashboard's marketing copy are frozen at their committed output: product facts (`generate-public-product-facts.mjs`, left out of `npm run generate`) and the CLI's TUI catalog (`cli/src/tui/data/catalog.generated.json`). Kept on purpose until 1b: `src/locales/en.json` (the verification-desk demo copies it) and the 35 `src/` config and service modules that the product-facts, crawlable-corpus, WebMCP and live-video scripts still import.
- **1b. Other surfaces.** `src-tauri/` (**first move `src-tauri/sidecar/local-api-server.mjs` and `docker/build-handlers.mjs` aside**; the deployment phase may use the Docker Node API), `blog-site/`, `pro-test/`, `demos/`, the plugin build, the crawlable corpus, sitemap, product-facts, AI-search and llms generators and the `src/` modules only they import, the public Mintlify docs that describe the dashboard, `docs:dates` (non-deterministic; blocks caching), and the Railway fleet registry. Their tests, CI jobs, scripts in `package.json`, and Dockerfiles.
- **1c. Convex, Clerk and the API the Lite UI does not call.** `convex/` and the `api/` endpoints and `server/` gates that need it (billing, OAuth, MCP grants, user preferences, notification channels). Run the `edge-contract-reviewer` subagent on the diff.
- **1d. Variants, the flag and CI.** Remove the remaining `VITE_VARIANT`/`SITE_VARIANT` branches and `VITE_LITE_PROFILE` flag-off paths, and replace the upstream CI (deploy gate, sharded unit jobs, the 1,000-line pre-push hook) with a lean pipeline sized for this repository.

Keep the `/lite/*` URLs until the deployment phase. `lite.html` becomes `apps/web/index.html` in Phase 2.

## Phase 2 — npm workspaces + Turborepo

Layout (deployment-neutral; `api/` and `middleware.ts` stay at the root until Phase 4 so Vercel keeps working unchanged):

```
apps/
  web/        Preact + Tailwind UI (← src/lite: app/, ui/, features/{briefing,geopolitics,finance,tech}/, map/, data/)
  ingest/     seeders on the Lite allowlist (← scripts/seed-*, _seed-utils, run-lite-seeders.mjs)
  relay/      ← scripts/ais-relay.cjs + scripts/shared/
packages/
  contracts/  ← proto/ + src/generated/ (make generate writes here) + OpenAPI output
  server/     ← server/ (gateway, handlers, _shared/redis)
  shared/     ← shared/
  client/     ← the src/services modules apps/web imports (transitive closure from src/lite/data/sources.ts)
tools/        ← non-seed scripts/ (lint-boundaries, generate-derived, source-attribution, docs checks)
api/, middleware.ts   unchanged location until Phase 4
```

- Root `package.json` `"workspaces": ["apps/*", "packages/*"]`; `tsconfig.base.json` that each workspace extends; path alias `@/` replaced by package names.
- `turbo.json`: `generate → build → typecheck/lint/test`, explicit `inputs`/`outputs`; `docs/engineering/**` outside every hash.
- Vercel Remote Cache (included with Pro); CI runs `turbo run lint typecheck test --affected`; `turbo-ignore web` replaces `scripts/vercel-ignore.sh`.
- `scripts/lint-boundaries.mjs` → enforce `apps → packages`, never `packages → apps`.
- Move order: `packages/shared`, `packages/contracts`, `packages/server`, `packages/client`, then `apps/web`, `apps/ingest`, `apps/relay`; one PR each.

## Phase 3 — Bundler and Preact tooling (apps/web)

- Vite 6 → 8 (Rolldown). Check `@tailwindcss/vite`, `vitest` (`^4.1.12`) and any Rollup-specific options (`worker.rollupOptions` in `vite.lite.config.ts`) against Vite 8.
- Add `@preact/preset-vite`: prefresh HMR, devtools, `preact/compat` aliasing if any React-only package appears.
- Re-measure: `apps/web` build time, dev cold start, HMR latency, bundle size. Baseline from 2026-11-07: `build:full` 48–50 s, main `vite build` ~16.7 s.

## Phase 4 — Deployment (last; decide then)

Options to evaluate with measurements once Phases 0–3 land:

- **Oracle Cloud Always Free VPS** (ARM A1) running Docker Compose: Node API (`local-api-server.mjs`), relay + AIS, seeders; Cloudflare Tunnel + Access; Vercel Pro for the UI with an `/api/*` rewrite. ~$0 beyond Vercel Pro.
- **Vercel Pro Node functions** (not Edge) for the API, plus Vercel Cron for light seeders; relay/AIS still needs a long-running host.
- Render / Cloudflare Workers (earlier analysis: limits or extra cost).

Measurements for that decision: Upstash commands/day vs free tier, memory of api + relay + seeders, arm64 Docker build (verify the pinned `node:24-alpine` digest is multi-arch), `/api/bootstrap` latency per option.

## Verification (per phase)

- Every PR: `npm run typecheck`, `npm run lint:boundaries`, the Lite tests (`tests/lite-ui.test.mts`, `tests/dom/lite-ui.test.mts`), the API and seeder suites that remain, `git diff --check`.
- Phase 1: `verify-worldmonitor` Lite steps (`lite-ui.mjs`) on a Vercel preview; all four `/lite` routes render real data; `/api/health` unchanged.
- Phase 2: a no-change `turbo run build` is a full cache hit; changing only `apps/ingest` does not rebuild `apps/web`; Vercel preview deploys unchanged.
- Phase 3: same Lite browser checks; build/dev/HMR numbers recorded against the baseline.
- Phase 4: the deployment verification from the chosen option (seed-meta freshness for 24 h, Access-protected API, reboot test).
