---
paths:
  - "api/**"
  - "packages/server/**"
  - "middleware.ts"
---

# Edge API and handlers

Source of truth: CLAUDE.md "Critical boundaries", [docs/engineering/architecture/adding-endpoints.md](../../docs/engineering/architecture/adding-endpoints.md), [docs/engineering/architecture/health-endpoints.md](../../docs/engineering/architecture/health-endpoints.md).

## Before editing

- New JSON endpoints go through sebuf (proto → `make generate` → `packages/server/worldmonitor/<domain>/v1/handler.ts`). Do not add a standalone `api/*.js` or `api/*.ts` data route. Non-JSON payloads (XML, binary, HTML embeds) are the only exception, and each must be listed in `api/api-route-exceptions.json`.
- Grep landmark symbols (`BOOTSTRAP_KEYS`, `SEED_META`, `PUBLIC_NO_AUTH_RPC_PATHS`, `PREMIUM_RPC_PATHS`, `validateApiKey`). Do not read `api/health.js` or `packages/server/gateway.ts` top to bottom.

## Rules

- Every Edge entry is esbuild-bundled per file. Do not import `node:http`, `node:https`, or `node:zlib`. Pass fetch as `(...args) => globalThis.fetch(...args)`, never `fetch.bind(globalThis)`.
- Legacy `api/*.js` imports only same-directory `_*.js` helpers or packages. TypeScript entries may import `packages/server/` and `packages/contracts/generated/` only, by relative path (not `@wm/server` or `@wm/contracts`). `packages/server/` never imports the web app (`apps/web/`, `lint:boundaries` Check 2); it reaches `packages/client/` modules (the RPC path lists, trade-route and chokepoint config, `utils/summary-cache-key`) by relative path, not `@wm/client`.
- Type handlers against the generated interface using indexed access, as shown in the endpoint guide.
- Read upstream data through `cachedFetchJson()` (`packages/server/_shared/redis.ts`). Put every request-varying input in the cache key: query and path params, user or plan scope, variant, locale.
- Pick the cache tier from how often the data changes. Health responses are never cached.
- Outbound server fetches set a `User-Agent`. Stagger Yahoo Finance requests by at least 150 ms.
- A new RPC path is classified once in each of `PREMIUM_RPC_PATHS`, `PUBLIC_NO_AUTH_RPC_PATHS`, and the rate-limit policy (`ENDPOINT_RATE_POLICIES`) when it needs one.
- A new outbound host in a URL literal needs a row in `packages/shared/source-attribution-manifest.json` (`npm run sources:generate`).
- Never let a reader turn a failed read into an empty success. See `docs/engineering/solutions/conventions/a-degrading-accessor-turns-a-failed-read-into-a-confident-absence.md`.

## Verify

```bash
npm run typecheck:api
npm run lint:api-contract
npm run lint:rate-limit-policies          # when the RPC paths or rate policies change
node --import tsx --test tests/edge-functions.test.mjs
npm run test:sidecar                      # owns the api/ node suites
```

Before opening a PR, run the `edge-contract-reviewer` subagent on the diff.
