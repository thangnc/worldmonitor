---
name: learn
description: Record a durable lesson from this session in the engineering knowledge base — a lesson file in docs/engineering/solutions/, a standing rule in .claude/rules/, or a term in CONCEPTS.md — then refresh the indexes. Use when the user runs /learn, says "remember this for the repo", "write this up as a solution", "compound this", or when a fix in this session exposed a trap the next change could fall into.
argument-hint: "[optional: the lesson in a sentence, or the area]"
metadata:
  internal: true
---

# learn

Turn what this session taught into a record the next session will find. User notes: **$ARGUMENTS**

The knowledge base is [docs/engineering/](../../../docs/engineering/README.md). Lessons follow the schema in [solutions/README.md](../../../docs/engineering/solutions/README.md). `tests/engineering-docs.test.mjs` enforces it, and `npm run generate` rebuilds [solutions/INDEX.md](../../../docs/engineering/solutions/INDEX.md).

Personal memory is not a substitute. A durable repo convention belongs in the repo (CLAUDE.md "Skills, subagents, and prior fixes").

## 1. Name the lesson

- State it in one sentence: the trap plus the rule that avoids it. Write "An upstream outage must not crash the cron; health owns the alarm", not "Fixed seeder crash".
- Gather the evidence from this session: the symptom, the root cause with `file:line`, the fix (commit or PR), and the test that now guards it.
- If the session only fixed a typo or a one-off config value, say so and stop. Not every fix is a lesson.

## 2. Look for an existing record first

- Grep [solutions/INDEX.md](../../../docs/engineering/solutions/INDEX.md) for the area, the key symbol, and two or three words from the symptom. Then grep `docs/engineering/solutions/` itself.
- If a lesson already covers the trap, update it: add the new evidence and set `last_updated`. Do not write a near-duplicate.
- If the new finding contradicts an existing lesson, write the new one. Then set `status: superseded` and `superseded_by: <new path>` on the old one.

## 3. Choose where it goes

| What was learned | Record it in |
|---|---|
| A specific trap, its cause, its fix and its guard | A lesson: `docs/engineering/solutions/<category>/<slug>.md` |
| A standing rule for every change to certain paths | One short line in the matching `.claude/rules/<area>.md`, linking to the lesson that justifies it. Write the lesson too unless one exists. |
| A shared term the code and docs use | A `###` entry in `CONCEPTS.md` |
| An operating procedure (rollout, recovery, credentials) | `docs/engineering/runbooks/` |
| A design decision or contract | The spec in `docs/engineering/architecture/` (for Lite, `lite.md`) |

Keep `.claude/rules/` files short. They load into every matching session, so a rule is one line plus a link, never the whole story.

## 4. Write the lesson

- **Category directory:** choose by the kind of problem (`logic-errors/`, `integration-issues/`, `conventions/`, …). The table in [solutions/README.md](../../../docs/engineering/solutions/README.md) maps each directory to its `problem_type`.
- **`area`:** where the fix lives. The table at the top of [INDEX.md](../../../docs/engineering/solutions/INDEX.md) says what each area covers.
- **Slug:** the lesson in kebab-case.
- **Frontmatter:** `title`, `date` (today), `area`, `problem_type`, `tags`. Add `severity`, `module`, `symptoms` and `root_cause` when known.
- **Body:** an H1 that repeats the title, then `## Problem`, `## Symptoms`, `## What Didn't Work`, `## Solution`, `## Why This Works`, `## Prevention`, `## Related`. For a practice rather than a bug, use `## Context`, `## Guidance`, `## Why This Matters`, `## When to Apply`, `## Examples`.
- **Proof:** name real paths and the guarding test. Quote a symptom exactly as it appeared (an error message, a log line, a wrong number) so a grep finds it later.
- **Links:** use links relative to the lesson's own file.

## 5. Refresh and check

```bash
npm run generate                                   # rewrites solutions/INDEX.md and plans/INDEX.md
node --test tests/engineering-docs.test.mjs        # schema, index, links, harness paths
npm run lint:md
git diff --check
```

Fix what the test reports. Never hand-edit an `INDEX.md`; a hook blocks it.

## 6. Hand back

Report the file you wrote or updated, its area and category, and any rule or CONCEPTS.md line you added. Commit it with the change it documents when that change is still open; otherwise leave it for the user to ship with `/ship`.
