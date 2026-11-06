---
paths:
  - "scripts/seed-*.mjs"
  - "scripts/_seed-utils.mjs"
  - "scripts/_bundle-runner.mjs"
  - "scripts/ais-relay.cjs"
  - "server/_shared/**"
---

# Railway seeders and the Redis cache

Source of truth: CLAUDE.md "Critical boundaries", [docs/health-endpoints.mdx](../../docs/health-endpoints.mdx), `docs/solutions/` (grep `seed`, `railway`, `freshness`).

## Rules

- Publish through the `_seed-utils.mjs` helpers (`atomicPublish`, `writeSeedMeta`, `writeExtraKeyWithMetaAtomically`, `runSeed`). Every data key gets a matching `seed-meta:<key>` with `fetchedAt` and `recordCount`.
- Set the key TTL to at least 3× the seed interval, so one missed run does not empty the cache.
- Load credentials only through `loadEnvFile()`. Do not add an env parser. Never resolve credentials from `$HOME` or an absolute path.
- Register every new key in `api/health.js` (`BOOTSTRAP_KEYS`, `STANDALONE_KEYS`, `ON_DEMAND_KEYS`, `SEED_META`). Add startup data to `api/bootstrap.js`. Opt-in panels stay on the on-demand path. A key with no dashboard consumer is a standalone health key.
- An upstream outage must not crash the cron or replace last-known-good data with an empty success. Keep retained data visible together with its source error. See `docs/solutions/runtime-errors/upstream-outage-must-not-crash-the-cron.md`.
- Never advance a success timestamp on a failed attempt. When several sources feed one key, report freshness as the oldest source (minimum), not the newest.
- Set a `User-Agent` on every outbound fetch, and register each new host in the source attribution manifest (`npm run sources:generate`).
- Never run a production seeder or deploy without explicit authorization in this conversation.

## Verify

- Run producer and reader checks with fixtures. A unit test of the seeder alone does not prove that the handler reads what was written.
- Run `npm run test:railway-registry` after Railway registry changes.
- Report live freshness evidence (a `/api/health` key status, `seed-meta` age) separately from local proof. A merge is not a run. See `docs/solutions/integration-issues/merged-is-not-ran-long-cron-seeders.md`.
