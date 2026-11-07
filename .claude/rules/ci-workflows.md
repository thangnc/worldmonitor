---
paths:
  - ".github/workflows/**"
  - ".github/actions/**"
  - ".husky/**"
---

# CI workflows and git hooks

Source of truth: [ARCHITECTURE.md "CI/CD"](../../ARCHITECTURE.md#11-cicd), `docs/engineering/solutions/workflow-issues/`, `docs/engineering/solutions/conventions/a-gate-required-check-must-be-an-if-gated-job-not-a-path-filtered-workflow.md`.

## Rules

- Add or update the workflow's row in the ARCHITECTURE.md CI/CD table in the same change.
- A check required by the Deploy Gate must be an `if:`-gated job, not a path-filtered workflow. A workflow skipped by a path filter never reports, so the required check stays pending.
- PR workflows never run repository-controlled code with a write token. Generated-artifact writes follow the read-only-then-writer split in [CONTRIBUTING.md "Generated Artifacts in Pull Requests"](../../CONTRIBUTING.md#generated-artifacts-in-pull-requests).
- Pin each third-party action to a full commit SHA, as every existing workflow does. Grant the minimum `permissions:` per job.
- A check must fail closed when it loses its target (no files matched, an empty artifact, a missing input).
- Do not bypass hooks with `--no-verify`. Fix the cause the hook reports.

## Verify

```bash
npm run docs:check     # required; the pre-push hook enforces it for workflow changes
```

Validate the changed workflow, for example with `actionlint` or a dry run on a branch, before pushing. After pushing, watch the required checks on the exact PR head (`gh pr checks <n>`). Do not report success while any check is pending or failed.
