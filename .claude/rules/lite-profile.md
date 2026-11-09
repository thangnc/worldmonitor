---
paths:
  - "src/config/panels.ts"
  - "src/config/map-layer-definitions.ts"
  - "src/config/feeds.ts"
  - "src/config/variant.ts"
  - "src/services/mission-presets.ts"
  - "shared/mission-domain.ts"
  - "shared/news-catalog.json"
  - "scripts/seed-*.mjs"
  - "scripts/railway-services.json"
  - "vercel.json"
  - "api/health.js"
  - "src/lite/**"
  - "src/config/lite-route.ts"
  - "lite.html"
  - "middleware.ts"
  - "src/main.ts"
---

# World Monitor Lite profile

Source of truth: [docs/engineering/architecture/lite.md](../../docs/engineering/architecture/lite.md). Read the matching section before changing panels, layers, feeds, seeders, or deployment config.

## Rules

- **No new variant.** Lite is a deployment profile on `full`, switched by one env flag. About 21 `SITE_VARIANT === 'full'` checks gate CII, intelligence and theater loading; a new variant would silently lose that data. See "Rejected alternatives".
- **Flag-gate every Lite-only change** on `LITE_PROFILE_ENABLED` (`VITE_LITE_PROFILE=true`). With the flag off, panels, layers, presets, feeds and seeders behave exactly as upstream. Never optional-chain `import.meta.env`; `tests/browser-bundle-secret-guard.test.mts` rejects it.
- **One source of truth.** Lite panels, cross-variant panels and layers live in `src/config/lite-profile.ts` (`LITE_PANEL_ORDER`, `LITE_CROSS_VARIANT_PANELS`, `LITE_MAP_LAYERS`). Change them there, then mirror the lists in `.claude/skills/verify-worldmonitor/steps/lite-profile.mjs`.
- **Cross-variant panels join `full` only under the flag** (`buildLitePanelCatalog` in `src/config/panels.ts`). Never add them to `FULL_PANELS` itself: that changes upstream. Panel keys can mean different panels per variant (`policy` is tech's AI policy news; `full` has `trade-policy`). Check the key's source catalog before adding it.
- **Layers.** A Lite layer must be allowed on `full` (`getAllowedLayerKeys('full')`), or `sanitizeLayersForVariant` strips it.
- **Defaults reach first visits only.** Saved layouts keep their panels. The `lite-desk` preset re-applies the profile and reads the same lists, so it stays in step automatically.
- **Never add long-tail token panels** (`defi-tokens`, `ai-tokens`, `other-tokens`) to `full`. The spec's "Removed or optional" table lists the other off-by-default IDs.
- **Optional modules** need one of the spec's decision-rule tests. State which test in the PR.
- **Seeders.** The owner's workers run on Render, not Railway, and only for the Lite seeder allowlist. A new seeder for a Lite panel joins the allowlist and the health key subset, together with the usual `seed-meta` and `api/health.js` registration (`seeders.md`). It also joins `LITE_SEED_SECTIONS` in `scripts/run-lite-seeders.mjs`, the local runner (`npm run seed:lite:watch`); `tests/lite-local-seeders.test.mts` fails when the Lite UI names a seeder it does not list.
- **No Convex or Clerk** on the owner's stack. Do not build Lite features on alert rules, preference sync, `intelHistory`, or entitlements without the non-Convex path the spec describes.
- **Sources.** A new feed or provider passes the source-policy filter: skip hosts whose `shared/source-attribution-manifest.json` licence is the World Monitor agreement or that are not cleared for this use.
- **Stores.** Supabase Postgres and the R2 raw archive enter only at their phase gate in the spec.
- **Lite UI (`src/lite/`).** Preact and Tailwind are allowed there and nowhere else. Do not import dashboard UI (`src/components/`, `src/app/`, `App.ts`); `npm run lint:boundaries` enforces it. Colors and fonts come from the `@theme` tokens in `src/lite/lite.css`. Write Tailwind classes out in full (use the maps in `src/lite/components/ui.tsx`), because built CSS only contains classes it can see. A scroll area or popup that scrolls uses `<OverlayScroll>` (`src/lite/components/scroll.tsx`), with positioning on a parent because the library makes its host a relative flex row; reset the page scroll with `scrollPageToTop`. `Card` clips with `overflow-hidden`, so a popover inside one caps its height to the room left in the card and scrolls (see `LayersPopover`).
- **Lite map (`src/lite/map/`).** MapLibre with OpenFreeMap tiles (spec "Owner decisions"). The style reads the `@theme` variables through `readLiteMapTokens`; hex values appear only as its fallbacks. Draw anything over the map (markers, the click-to-open card and its leader line, controls, the legend, the layers popover, credits) as Preact elements with Tailwind classes, not MapLibre controls or popups. Every marker on every Lite map follows the one grammar in `src/lite/map/marks.tsx` (spec "Map marker grammar"): event, asset, aggregate or judgement, coloured by state (`mark-normal`, `mark-elev`, `mark-crit`), never by domain; a new layer picks one of the four shapes and, if needed, adds a Lucide glyph to `MARK_GLYPHS`, and its legend and popover rows draw the same components. Context geometry (lane lines, country fills) may be MapLibre layers through `LiteMap`'s `overlays` prop, coloured from the tokens by each feature's `tone` (`elev`, `crit`, or an intensity step `ramp-1` to `ramp-4`). Data shading (the reported-violence country fill, GPS hexagons, DDoS shading) may be a MapLibre fill layer coloured from the `@theme` tokens through `readLiteMapTokens` (owner's decision, 2026-11-08); intensity areas use the shared blue ramp. Clicks on it open the same Preact card. Keep the OpenStreetMap credit visible. Hotspot colour comes from `scoreHotspots` (`src/lite/data/escalation.ts`), which only maps Lite data onto the shared escalation core; do not add scoring there.
- **Indicators.** Every early indicator renders through `src/lite/components/indicator.tsx` and finds its news through `linkNews` (`src/lite/data/news-link.ts`), with the domain's `LINK_WINDOW_HOURS`. Do not write a per-screen matcher or card. A fired indicator with no matching story shows "No linked news found", never a guessed cause.
- **Real, derived or sample.** A Lite widget reads a real source, computes a stated rule (tag it `DerivedTag`), or shows design samples (badge it `SampleBadge`). A failed or empty real source renders `SourceState`, never samples. Update the data table in the spec's "Lite UI" section when a widget changes class.
- **Default route.** Only `src/config/lite-route.ts` decides when `/` and `/dashboard` open the Lite UI. Keep `middleware.ts`, the `src/main.ts` guard, `vercel.json` and `docker/nginx.conf*` in step with it.

## Verify

```bash
npm run typecheck
npm run lint:boundaries
node --import tsx --test tests/lite-profile.test.mts tests/lite-ui.test.mts tests/mission-presets.test.mts tests/panel-config-guardrails.test.mjs tests/variant-layer-guardrail.test.mjs
npx vitest run --config vitest.dom.config.mts tests/dom/lite-ui.test.mts
```

Check the layout with the flag on and off, using the `verify-worldmonitor` skill:

```bash
VITE_LITE_PROFILE=true .claude/skills/verify-worldmonitor/scripts/wm-verify.sh launch
WM_VERIFY_EXPECT=lite .claude/skills/verify-worldmonitor/scripts/wm-verify.sh drive .claude/skills/verify-worldmonitor/steps/lite-profile.mjs --name lite-on
WM_VERIFY_EXPECT=lite .claude/skills/verify-worldmonitor/scripts/wm-verify.sh drive .claude/skills/verify-worldmonitor/steps/lite-ui.mjs --name lite-ui-on
# cleanup, relaunch without the flag, then WM_VERIFY_EXPECT=full ... --name lite-off
```
