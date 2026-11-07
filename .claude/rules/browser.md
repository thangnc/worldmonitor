---
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
  - "src/**/*.css"
  - "index.html"
  - "vite.config.ts"
---

# Browser app

Source of truth: [ARCHITECTURE.md](../../ARCHITECTURE.md), the [verify-worldmonitor skill](../skills/verify-worldmonitor/SKILL.md), `docs/solutions/ui-bugs/`.

## Rules

- Imports flow `types -> config -> services -> components -> app -> App.ts`. Logic shared with the server or MCP lives once in top-level `shared/`.
- No framework and no state library. Shared state lives in `AppContext`, and URL state goes through `src/utils/urlState.ts`. The one exception is the Lite UI in `src/lite/` (Preact and Tailwind); its rules are in `lite-profile.md`.
- Panels extend `src/components/Panel.ts` and render only through `setSafeContent` (or `setSafeContentImmediate` after a user action), `setContentNodes`, or `setTrustedContent`. Painting the panel DOM directly leaves the error chip and retry timer latched after one failure.
- Do not assign `innerHTML`/`outerHTML` or call `insertAdjacentHTML`. Build markup with the `safeHtml` tagged template from `src/utils/sanitize.ts`, which escapes interpolations, or build nodes with `h()`/`fragment()` from `src/utils/dom-utils.ts`. `unsafeRawHtml`/`trustedHtml` require a stated reason.
- Use the helper in `src/utils/safe-storage.ts` instead of dereferencing `localStorage`. Some Android WebViews expose it as `null`.
- Every overlay declares its reload contract with `declareOverlay(el, { reload })` (`src/utils/open-modal.ts`).
- A service client that calls a premium RPC is constructed with `{ fetch: premiumFetch }`. Other clients use `{ fetch: (...args) => globalThis.fetch(...args) }`.
- A loader that cannot tell a cache miss from a failure must not render a confident empty state.
- Read startup data with `getHydratedData(key)`. Opt-in panels use `ensureHydrated(key)`. Both are in `src/services/bootstrap.ts`.
- A change for one variant (full, tech, finance, commodity, energy, happy) can affect the others. Check `src/config/variant.ts` and the variant panel and layer defaults.
- New host literals under `src/` need a source attribution manifest row (`npm run sources:check`).
- User-facing strings go through i18n. Shell namespaces have a byte budget for first paint.

## Verify

```bash
npm run typecheck
npm run lint                     # biome + safe-html
npm run lint:boundaries
npm run lint:panel-content-writes
npm run lint:safe-local-storage
npm run lint:overlay-reload-policy
npm run lint:premium-fetch       # when service clients change
```

For changed behavior, invoke the `verify-worldmonitor` skill. Start from an existing strict e2e spec, then drive the changed interaction manually. A PR that changes UI must include uploaded screenshots (CLAUDE.md "Include UI evidence").
