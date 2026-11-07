# Lite UI

The owner's front page under the World Monitor Lite profile ([spec](../../../../docs/architecture/lite.md#lite-ui-lite)): a sidebar and three screens built with Preact and Tailwind in `src/lite/`. With `VITE_LITE_PROFILE=true`, `/` and `/dashboard` open it, and `/dashboard?full=1` keeps the full dashboard reachable for the tab. Without the flag, `/lite` shows a notice and nothing else changes.

## Sub-features

- `lite-default-route`: `/` (middleware on Vercel, the `src/main.ts` guard elsewhere) and `/dashboard` land on `/lite`.
- `lite-screens`: `/lite`, `/lite/finance` and `/lite/tech` render through the sidebar links without a page load.
- `lite-badges`: sample widgets carry `[data-sample="true"]`; rule-based values carry `[data-derived="true"]`; a real source that is empty or failed renders `[data-source-state]`.
- `lite-soon`: Briefing, Alerts, Watchlists, Sources, Scoring rules, Settings and each primary action are `[data-soon="true"]`.
- `lite-escape`: `[data-testid="open-full-dashboard"]` opens `/dashboard?full=1`, and a reload stays on the dashboard.

## How to get to it (user POV)

- Open `/` or `/dashboard` on a profile build, or `/lite` directly.
- Use the sidebar's DOMAINS items to switch screens.

## Driving it with wm-verify

- **Flag on.** `VITE_LITE_PROFILE=true wm-verify.sh launch` (the owner's `.env.local` already sets it), then `WM_VERIFY_EXPECT=lite wm-verify.sh drive .claude/skills/verify-worldmonitor/steps/lite-ui.mjs --name lite-ui-on`. It asserts the redirects, visits each screen at 1440 and 390 px, logs every source state and sample count, checks there is no horizontal overflow, and proves the escape route.
- **Flag off.** `cleanup`, then `VITE_LITE_PROFILE= wm-verify.sh launch` and `WM_VERIFY_EXPECT=full ... --name lite-ui-off`. `/dashboard` must stay the dashboard and `/lite` must show `[data-lite-off="true"]`.
- **Handles.** `[data-lite-screen]` on the root, `[data-nav="geopolitics|finance|tech"]`, `[data-testid="priority-incidents|market-events|tech-developments"]` for each screen's main card.

## Gotchas

- Locally, most widgets read Redis through the dev server's RPC handlers, so they are empty until the matching seeder has run (`node scripts/seed-<name>.mjs`). An empty widget names its seeder. UCDP needs an API key.
- `/api/bootstrap`, `/api/health` and `/api/wm-session` are legacy `api/*.js` routes the dev server does not serve: the health card reads "Health endpoint unavailable" and `/api/wm-session` 404s. Production serves them.
- The design's map image is not used. The dot map is drawn from `public/data/countries-110m.json`, so coastlines are coarse by design.
