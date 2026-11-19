---
title: A worktree resolves removed packages through the main checkout's node_modules, so a local pass hides a CI MODULE_NOT_FOUND
date: 2026-11-18
last_updated: 2026-11-19
area: tests
problem_type: test_failure
tags:
  - worktree
  - node-resolution
  - node-modules
  - package-lock
  - dependency-removal
  - module-not-found
  - local-vs-ci
severity: medium
module: test-harness
symptoms:
  - "Error: Cannot find module 'metro/private/Assets'"
  - "Error: Cannot find module 'jayson'"
  - "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'protobufjs' imported from scripts/generate-request-validation.mjs"
  - A test passes in a .claude/worktrees/ checkout and fails in CI right after a PR removed packages from package-lock.json
root_cause: Node resolves a bare specifier by walking up parent directories, and .claude/worktrees/<name>/ sits inside the main checkout, whose node_modules still holds the removed packages.
---

# A worktree resolves removed packages through the main checkout's node_modules, so a local pass hides a CI MODULE_NOT_FOUND

## Problem

Worktrees for parallel work live under `.claude/worktrees/` (CLAUDE.md "Start safely"), inside the main checkout. When a package is missing from the worktree's own `node_modules`, Node keeps walking up the directory tree and finds it in the main checkout's `node_modules`. A branch that removes packages from `package-lock.json` therefore still resolves them locally, and every test that loads them passes. CI installs only what the lockfile lists, so the same tests fail there.

## Symptoms

Refactor PR #64 removed Convex, Clerk and the billing packages (437 packages left the lockfile). The full local `npm run test:data` run in the worktree passed. CI unit shard 2 failed twice:

```text
tests/security-audit-baseline.test.mjs: Error: Cannot find module 'metro/private/Assets'
tests/dependency-backports.test.mjs:   Error: Cannot find module 'jayson'
```

`metro` and `jayson` had arrived only through the removed packages. Their backport tests still `require()`d them.

## What Didn't Work

- A local green run in the worktree. It resolved both packages from `/…/worldmonitor/node_modules`, one level above the worktree.
- Checking the worktree's `ls node_modules/<pkg>`. It correctly showed the package missing, but nothing failed, so nobody looked.

## Solution

After removing dependencies, check imports against the lockfiles instead of trusting a local pass:

1. Collect the package names from `package-lock.json` and `scripts/package-lock.json` (every `node_modules/<name>` key).
2. Scan bare `import`, `import()` and `require()` specifiers in tracked source and tests. Skip workspaces with their own `package.json`, such as `consumer-prices-core/`.
3. Every specifier whose package is in neither lockfile is a CI failure waiting to happen. Delete the tests and tools that only served the removed packages, along with stale `overrides` entries in `package.json`.

In #64 that scan also found `scripts/audit-dodo-catalog.cjs`, which `require()`d the removed `dodopayments` package and read the deleted `convex/config/productCatalog.ts`.

Count only **top-level** lockfile entries (`node_modules/<name>`), not nested ones. Better still, resolve every bare import from its own file with `createRequire(file).resolve(...)` and flag any path outside the worktree. Lite-only cleanup PR 5 (#148) removed 33 unused root packages. Its first scan checked only the removed names and passed locally. CI then failed three ways:

- packages that had been hoisted only because a removed package depended on them: `@loaders.gl/xml` and `@loaders.gl/wms` (from deck.gl), `protobufjs` (from onnxruntime-web, used by `make generate` through `scripts/generate-request-validation.mjs`) and `semver`;
- `semver` still appeared in the lockfile, but only nested under other packages, so a name-only lockfile check missed it;
- `sax` was hoisted the same way, and a Lite seeder imports it. CI's unit job installs `scripts/` dependencies, so CI stayed green, but `npm run seed:lite` from a root-only install would have broken.

The fix declared each still-used package directly and deleted the test that only served deck.gl's loaders.

## Why This Works

The lockfile is what CI installs (`npm ci`), so it is the only accurate list of resolvable packages. Local resolution in a nested worktree adds the main checkout's `node_modules` as an extra, invisible fallback.

## Prevention

- After a change that removes packages, run the resolve-from-file scan before pushing; a package that only arrived through a removed one disappears with it. When the change is large, also push early and let CI confirm.
- Read a locally passing test that loads a removed package as a warning, not as proof.
- Rule line: `.claude/rules/tests.md`.

## Related

- [A Railway seeder crashes at import when scripts/ locks an older dependency than the root](../runtime-errors/railway-seeder-crashes-when-scripts-locks-older-dependency-than-root.md): another case where the dependency tree a test sees differs from the one production installs.
- [Local .env presence silently changes Vite bundle output shape](../workflow-issues/vite-bundle-budget-seed-requires-env-clean-build.md): local state that CI does not have.
