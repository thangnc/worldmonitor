# Solutions

One lesson per file: a problem this repository hit, why it happened, and the
guard that keeps it fixed. Start from [INDEX.md](INDEX.md), which groups every
lesson by the area where the fix lives. Grep it for an area, a tag, or a word
from the symptom.

## Where a lesson goes

`solutions/<category>/<slug>.md`. The slug and the title state the lesson,
not the symptom: `upstream-outage-must-not-crash-the-cron.md`, not
`seeder-crash.md`.

| Category directory | `problem_type` |
|---|---|
| `architecture-patterns/` | `architecture_pattern` |
| `best-practices/` | `best_practice` |
| `build-errors/` | `build_error` |
| `conventions/` | `convention` |
| `database-issues/` | `database_issue` |
| `design-patterns/` | `design_pattern` |
| `integration-issues/` | `integration_issue` |
| `logic-errors/` | `logic_error` |
| `performance-issues/` | `performance_issue` |
| `reliability/` | `reliability_issue` |
| `runtime-errors/` | `runtime_error` |
| `security-issues/` | `security_issue` |
| `test-failures/` | `test_failure` |
| `tooling-decisions/` | `tooling_decision` |
| `ui-bugs/` | `ui_bug` |
| `workflow-issues/` | `workflow_issue` |

## Frontmatter

```yaml
---
title: An upstream outage must not crash the cron; health owns the alarm
date: 2026-09-14              # YYYY-MM-DD, when the lesson was learned
area: seeders                 # where the fix lives; see the list below
problem_type: runtime_error   # must match the category directory
tags:                         # kebab-case, at least one
  - railway
  - upstream-outage
severity: high                # optional: critical, high, medium, low
module: scripts/_seed-utils.mjs   # optional: files or subsystem involved
---
```

Required: `title`, `date`, `area`, `problem_type`, `tags`.

Optional: `severity`, `module`, `symptoms` (list), `root_cause`,
`resolution_type`, `applies_when` (list), `related` (list of paths), `issue`,
`status` (`active` or `superseded`), `superseded_by` (repo path, required when
`status: superseded`), `last_updated`.

`area` is one of: `edge-api`, `mcp`, `seeders`, `intelligence`, `browser`,
`lite`, `proto`, `convex`, `payments`, `desktop`, `observability`, `ci`,
`tests`, `tooling`, `docs`, `public-site`. [INDEX.md](INDEX.md) says what each
covers.

## Body

Lead with an H1 that repeats the title. Then, for a bug:
`## Problem`, `## Symptoms`, `## What Didn't Work`, `## Solution`,
`## Why This Works`, `## Prevention`, `## Related`. For a practice:
`## Context`, `## Guidance`, `## Why This Matters`, `## When to Apply`,
`## Examples`. Name the test that guards the fix.

## Keeping it current

- Update an existing lesson instead of writing a second one on the same
  trap. When a lesson stops being true, set `status: superseded` and
  `superseded_by`.
- `npm run generate` rewrites [INDEX.md](INDEX.md). Never edit it by hand.
- `tests/engineering-docs.test.mjs` enforces this schema. The schema itself
  lives in `scripts/lib/engineering-docs.mjs`; change it there and here
  together.
