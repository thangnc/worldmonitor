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
---

# World Monitor Lite profile

Source of truth: [docs/architecture/lite.md](../../docs/architecture/lite.md). Read the matching section before changing panels, layers, feeds, seeders, or deployment config.

## Rules

- **No new variant.** Lite is a deployment profile on `full`, switched by one env flag. About 21 `SITE_VARIANT === 'full'` checks gate CII, intelligence and theater loading; a new variant would silently lose that data. See "Rejected alternatives".
- **Flag-gate every Lite-only change.** With the flag off, panels, layers, feeds and seeders behave exactly as upstream. Follow the existing `VITE_ENABLE_*` build-flag style.
- **Register before profiling.** A panel from another variant (`hardware`, `ai-regulation`, `centralbanks`, `crypto-news`) must be added to `FULL_PANELS` with `enabled: false` first. Otherwise `applyMissionPresetToState` and `src/app/panel-enablement.ts` drop it silently. A map layer must be in `VARIANT_LAYER_ORDER.full`, or `sanitizeLayersForVariant` strips it.
- **Defaults reach first visits only.** `FULL_PANELS` defaults do not change saved layouts. Keep the Lite mission preset in step with the profile defaults so the layout can be re-applied.
- **Never add long-tail token panels** (`defi-tokens`, `ai-tokens`, `other-tokens`) to `full`. The spec's "Removed or optional" table lists the other off-by-default IDs.
- **Optional modules** need one of the spec's decision-rule tests. State which test in the PR.
- **Seeders.** The owner's workers run on Render, not Railway, and only for the Lite seeder allowlist. A new seeder for a Lite panel joins the allowlist and the health key subset, together with the usual `seed-meta` and `api/health.js` registration (`seeders.md`).
- **No Convex or Clerk** on the owner's stack. Do not build Lite features on alert rules, preference sync, `intelHistory`, or entitlements without the non-Convex path the spec describes.
- **Sources.** A new feed or provider passes the source-policy filter: skip hosts whose `shared/source-attribution-manifest.json` licence is the World Monitor agreement or that are not cleared for this use.
- **Stores.** Supabase Postgres and the R2 raw archive enter only at their phase gate in the spec.

## Verify

```bash
npm run typecheck
npm run lint:boundaries
node --import tsx --test tests/mission-presets.test.mts tests/panel-config-guardrails.test.mjs tests/variant-layer-guardrail.test.mjs
```

Check the changed layout with the profile flag on and off, using the `verify-worldmonitor` skill.
