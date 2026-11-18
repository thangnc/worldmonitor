---
paths:
  - "packages/client/config/map-layer-definitions.ts"
  - "packages/shared/news-catalog.json"
  - "scripts/seed-*.mjs"
  - "scripts/railway-services.json"
  - "vercel.json"
  - "api/health.js"
  - "apps/web/src/lite/**"
  - "packages/client/config/lite-route.ts"
  - "apps/web/lite.html"
  - "middleware.ts"
  - "apps/web/vite.dev-api.ts"
  - "docker/nginx.conf*"
---

# World Monitor Lite

Source of truth: [docs/engineering/architecture/lite.md](../../docs/engineering/architecture/lite.md). Read the matching section before changing screens, layers, feeds, seeders, or deployment config.

## Rules

- **One app, no flag, no variants.** The Lite UI is the only web app (refactor Phase 1d removed `VITE_LITE_PROFILE`, `VITE_VARIANT` and `SITE_VARIANT`). Build Lite work directly, with no env flag and no flag-off path. Do not add a build flag or a site variant to switch it. Never optional-chain `import.meta.env`; `tests/browser-bundle-secret-guard.test.mts` rejects it.
- **Optional modules** need one of the spec's decision-rule tests. State which test in the PR.
- **Seeders.** The owner's workers run on Render, not Railway, and only for the Lite seeder allowlist. A new seeder for a Lite panel joins the allowlist and the health key subset, together with the usual `seed-meta` and `api/health.js` registration (`seeders.md`). It also joins `LITE_SEED_SECTIONS` in `scripts/run-lite-seeders.mjs`, the local runner (`npm run seed:lite:watch`); `tests/lite-local-seeders.test.mts` fails when the Lite UI names a seeder it does not list.
- **No Convex or Clerk.** Both left the repository in refactor Phase 1c. Do not build Lite features on alert rules, preference sync, `intelHistory`, or entitlements without the non-Convex path the spec describes.
- **Sources.** A new feed or provider passes the source-policy filter: skip hosts whose `packages/shared/source-attribution-manifest.json` licence is the World Monitor agreement or that are not cleared for this use.
- **Stores.** Supabase Postgres and the R2 raw archive enter only at their phase gate in the spec.
- **Lite UI (`apps/web/src/lite/`).** Preact and Tailwind are allowed there and nowhere else. It sits on top of `types → config → services`, and nothing outside it imports it; `npm run lint:boundaries` enforces both. Colors and fonts come from the `@theme` tokens in `apps/web/src/lite/lite.css`. Write Tailwind classes out in full (use the maps in `apps/web/src/lite/components/ui.tsx`), because built CSS only contains classes it can see. Tailwind scans `apps/web` only, so a class name spelled only in `packages/` is never generated; keep class names in `apps/web`. `tests/web-build-turbo-inputs.test.mjs` ties that scan to the turbo build inputs. A scroll area or popup that scrolls uses `<OverlayScroll>` (`apps/web/src/lite/components/scroll.tsx`), with positioning on a parent because the library makes its host a relative flex row; reset the page scroll with `scrollPageToTop`. `Card` clips with `overflow-hidden`, so a popover inside one caps its height to the room left in the card and scrolls (see `LayersPopover`).
- **Lite map (`apps/web/src/lite/map/`).** MapLibre with OpenFreeMap tiles (spec "Owner decisions"). The style reads the `@theme` variables through `readLiteMapTokens`; hex values appear only as its fallbacks. Draw anything over the map (markers, the click-to-open card and its leader line, controls, the legend, the layers popover, credits) as Preact elements with Tailwind classes, not MapLibre controls or popups. Every marker on every Lite map follows the one grammar in `apps/web/src/lite/map/marks.tsx` (spec "Map marker grammar"): event, asset, aggregate or judgement, coloured by state (`mark-normal`, `mark-elev`, `mark-crit`), never by domain; a new layer picks one of the four shapes and, if needed, adds a Lucide glyph to `MARK_GLYPHS`, and its legend and popover rows draw the same components. Context geometry (lane lines, country fills) may be MapLibre layers through `LiteMap`'s `overlays` prop, coloured from the tokens by each feature's `tone` (`elev`, `crit`, or an intensity step `ramp-1` to `ramp-4`). Data shading (the reported-violence country fill, GPS hexagons, DDoS shading) may be a MapLibre fill layer coloured from the `@theme` tokens through `readLiteMapTokens` (owner's decision, 2026-11-08); intensity areas use the shared blue ramp. Clicks on it open the same Preact card. Keep the OpenStreetMap credit visible. Hotspot colour comes from `scoreHotspots` (`apps/web/src/lite/data/escalation.ts`), which only maps Lite data onto the shared escalation core; do not add scoring there. A map with a time range uses `TimeRangeControl` (`apps/web/src/lite/components/TimeRange.tsx`, 6h/24h/7d), and each layer row says what it shows at the range (`layerRangeNote`, `techLayerRangeNote`); a layer the range cannot change says so, and a missing window names its source instead of showing another window's data.
- **Indicators.** Every early indicator renders through `apps/web/src/lite/components/indicator.tsx` and finds its news through `linkNews` (`apps/web/src/lite/data/news-link.ts`), with the domain's `LINK_WINDOW_HOURS`. Do not write a per-screen matcher or card. A fired indicator with no matching story shows "No linked news found", never a guessed cause.
- **Real, derived or sample.** A Lite widget reads a real source, computes a stated rule (tag it `DerivedTag`), or shows design samples (badge it `SampleBadge`). A failed or empty real source renders `SourceState`, never samples. Update the data table in the spec's "Lite UI" section when a widget changes class.
- **Default route.** `/` and `/dashboard`, with any query, always open `/lite` with a temporary redirect (307) that keeps the query string. `vercel.json` owns it on Vercel (its redirects run before `middleware.ts`, which has no route logic); `docker/nginx.conf*` and the dev server (`apps/web/vite.dev-api.ts`) mirror it. Change all three together; `tests/deploy-config.test.mjs` pins the `vercel.json` and nginx rules (the dev-server redirect has no test). `packages/client/config/lite-route.ts` names the `/lite/*` screen paths.

## Verify

```bash
npm run typecheck
npm run lint:boundaries
node --import tsx --test tests/lite-ui.test.mts tests/deploy-config.test.mjs
npx vitest run --config vitest.dom.config.mts tests/dom/lite-ui.test.mts
```

Check the screens with the `verify-worldmonitor` skill:

```bash
.claude/skills/verify-worldmonitor/scripts/wm-verify.sh launch
.claude/skills/verify-worldmonitor/scripts/wm-verify.sh drive .claude/skills/verify-worldmonitor/steps/lite-ui.mjs --name lite-ui
```
