---
paths:
  - "tests/**"
  - "e2e/**"
  - "**/__tests__/**"
  - "**/*.test.*"
  - "**/*.spec.ts"
---

# Tests

Source of truth: CLAUDE.md test-suite table, [CONTRIBUTING.md "Verify the changed path"](../../CONTRIBUTING.md#verify-the-changed-path), `docs/engineering/solutions/test-failures/`, `docs/engineering/solutions/best-practices/test-guard-assertions-and-module-state-reset.md`.

## Where a test goes

| Kind | Location | Runner |
|---|---|---|
| Data, contract, script | `tests/*.test.{mjs,mts}` | node:test (`npm run test:data`) |
| DOM (happy-dom) | `tests/dom/` | vitest (`npm run test:dom`) |
| Server, correlation engine | `packages/server/__tests__/`, `src/services/correlation-engine/` | vitest (`npm run test:server`) |
| `api/` node suites, sidecar | next to the code | `npm run test:sidecar` |
| Browser | `.claude/skills/verify-worldmonitor/steps/` | Playwright drive through the `verify-worldmonitor` skill (no `e2e/` suite) |

The two runners are not interchangeable. A vitest file run under node:test fails with a bare "test failed" message, so put each file in its runner's directory.

## Rules

- Find an existing suite before creating one (`ls tests/ | grep <subject>`). Extend a strict existing proof instead of adding a second runner.
- Add a test only when existing coverage cannot prove the changed outcome or a material failure mode.
- Assert the outcome the branch produces, not what a lenient classifier concludes from it.
- Prove a new guard catches the bug: break the code once at each call site and watch the test fail.
- Reset module-level state between cases. Tests must be hermetic against the environment, not only against `.env` files.
- A test double must not be richer than the real library it replaces.
- Pin fixtures and clocks. Do not depend on live upstreams, rolling captures, or today's date.
- Do not delete or weaken a check without evidence that its protection is obsolete, redundant, or ineffective.
- A worktree under `.claude/worktrees/` resolves missing packages through the main checkout's `node_modules`. After removing packages, check imports against `package-lock.json` instead of trusting a local pass ([lesson](../../docs/engineering/solutions/test-failures/worktree-resolves-removed-packages-through-the-main-checkout.md)).

## Run

```bash
node --import tsx --test tests/<name>.test.mjs
npx vitest run --config vitest.dom.config.mts tests/dom/<file>
npx vitest run --config vitest.config.mts <path>
```

Run heavy suites one after another, not in parallel. A timeout, skipped job, or unmet prerequisite is not a pass.
