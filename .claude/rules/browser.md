---
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
  - "src/**/*.css"
  - "packages/client/**"
  - "lite.html"
  - "vite.config.ts"
  - "vite.dev-api.ts"
---

# Browser app

Source of truth: the Lite spec ([docs/engineering/architecture/lite.md](../../docs/engineering/architecture/lite.md)), the [verify-worldmonitor skill](../skills/verify-worldmonitor/SKILL.md), `docs/engineering/solutions/ui-bugs/`.

The Lite UI (`src/lite/`, Preact and Tailwind) is the only web app. Refactor Phase 1 removed the old dashboard; [legacy features](../../docs/engineering/product/legacy-features.md) says how to bring a feature back. UI rules are in `lite-profile.md`.

## Rules

- Imports flow `types -> config -> services -> lite`: `packages/client/{types,config,services}/` (`@wm/client`), then the Lite UI in `src/lite/`. The Lite UI imports `@wm/client/<dir>/<file>` by name (there is no `@/` alias); files inside `packages/client/` import each other by relative path. Logic shared with the server or MCP lives once in `packages/shared/`; browser code imports it as `@wm/shared/...`, except `packages/client/shared/` and the `packages/client/` modules `packages/server/` imports, which use relative paths only (`lint:boundaries` Check 5).
- There is one build: no site variant (`VITE_VARIANT`) and no profile flag (`VITE_LITE_PROFILE`); refactor Phase 1d removed both. Do not reintroduce a build-time switch for Lite behavior.
- The dev server's `/` and `/dashboard` redirect (`liteDevRoutePlugin` in `vite.dev-api.ts`) mirrors `vercel.json`: a 307 to `/lite` that keeps the query string. Change them together (`lite-profile.md`, "Default route").
- Do not assign `innerHTML`/`outerHTML` or call `insertAdjacentHTML`. Render with Preact.
- Use the helper in `packages/client/utils/safe-storage.ts` instead of dereferencing `localStorage`. Some Android WebViews expose it as `null`.
- A service client that calls a premium RPC must authenticate it; the Lite UI calls none (`npm run lint:premium-fetch`). Other clients use `{ fetch: (...args) => globalThis.fetch(...args) }`.
- A loader that cannot tell a cache miss from a failure must not render a confident empty state.
- New host literals under `src/` or `packages/client/` need a source attribution manifest row (`npm run sources:check`).

## Verify

```bash
npm run typecheck
npm run lint                     # biome + safe-html
npm run lint:boundaries
npm run lint:safe-local-storage
npm run lint:premium-fetch       # when service clients change
npm run build
```

For changed behavior, invoke the `verify-worldmonitor` skill. A PR that changes UI must include uploaded screenshots (CLAUDE.md "Include UI evidence").
