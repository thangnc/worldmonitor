# Plans

Implementation plans for multi-step work, and in
[`requirements/`](requirements/) the requirement briefs they started from.
[INDEX.md](INDEX.md) lists them by status. A plan records intent when it was
written: check the code and git history before relying on one.

## Frontmatter

```yaml
---
title: UKMTO maritime incidents
date: 2026-10-29        # YYYY-MM-DD, when the plan was written
status: active          # active, done, abandoned or superseded
type: feat              # optional: feat, fix, refactor, …
evidence: PR #9876      # optional: what shipped it, or why it stopped
---
```

Required: `title`, `date`, `status`.

Optional: `type`, `origin` (what prompted it), `topic`, `evidence`,
`superseded_by` (repo path, required when `status: superseded`), and the
planning-tool fields `artifact_contract`, `artifact_readiness`, `execution`,
`product_contract_source`.

## Keeping it current

- Set `status: done` with `evidence` in the change that ships the plan's core
  deliverable. Set `abandoned` or `superseded` when the approach is dropped.
- Name new plans `YYYY-MM-DD-NNN-<type>-<slug>-plan.md`.
- `npm run generate` rewrites [INDEX.md](INDEX.md).
  `tests/engineering-docs.test.mjs` enforces the schema.
