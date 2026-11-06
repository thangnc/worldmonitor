---
paths:
  - "convex/**"
---

# Convex (user-scoped state)

Source of truth: `docs/solutions/database-issues/` (grep `convex`), `docs/solutions/runtime-errors/convex-validator-copied-into-an-action-rejects-the-field-the-table-gained.md`.

## Rules

- Convex holds auth, entitlements, API keys, alert rules, notification channels, and preferences. Do not put dashboard data that seeders produce here. That data belongs in Redis.
- Never hand-edit `convex/_generated/`.
- Define each table's validator once and reuse it. A validator copied into an action rejects a field the table gains later.
- Avoid writing to hot documents. Concurrent writes to one document cause OCC conflicts, and a staleness check does not stop a herd of concurrent touches.
- Production environment variables take effect inside deployed functions only after the next `convex deploy`.
- Do not run `convex deploy` or change production data without explicit authorization.

## Verify

```bash
npm run typecheck:api    # includes the Convex audits
npm run test:convex
```
