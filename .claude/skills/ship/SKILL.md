---
name: ship
description: Finish the task in the current worktree. Verify, make a signed commit, push as <type>/<slug> to the fork, open a PR against the fork's main, and watch CI. Merges and worktree removal happen only when the user asks.
argument-hint: "[optional notes for the PR description]"
disable-model-invocation: true
metadata:
  internal: true
---

# ship

Ship the current worktree's change. Notes from the user: **$ARGUMENTS**

This fork's delivery path. The procedure behind it is [CONTRIBUTING.md "Complete one change"](../../../CONTRIBUTING.md#complete-one-change) and ["Pull Request Process"](../../../CONTRIBUTING.md#pull-request-process). The required checks come from the [change → check map](../../../CLAUDE.md#find-the-code-and-its-checks). Run each command plainly and separately; this is a worktree-isolated session.

Fork facts that override the upstream wording:

- `origin` is the fork `thangnc/worldmonitor`. PRs target the fork's `main`, not `koala73/worldmonitor`.
- `gh` must act as the `thangnc` account. `gh auth status` must show it active; otherwise run `gh auth switch -u thangnc`.
- Commits are authored as `Thang Nguyen <thang.nguyencao@gmail.com>` and SSH-signed. The `main` ruleset rejects unsigned commits.

## Steps

1. **In a worktree, on current `main`.**
   - `git rev-parse --path-format=absolute --git-dir` must differ from `--git-common-dir`. If they're equal, stop: this skill only ships from a worktree.
   - Work out `<type>` and `<slug>` from the worktree name (`<type>-<slug>`, for example `fix-ucdp-timeout` gives `fix/ucdp-timeout`), or ask the user. `<type>` is a Conventional Commits type.
   - Look for an existing PR for that branch: `gh pr list --repo thangnc/worldmonitor --head <type>/<slug> --state open`. If one exists, ship to it (steps 5 and 7) and never open a second one.
   - `git fetch origin main`, then `git merge-base --is-ancestor origin/main HEAD`. If `main` moved, merge it in (`git merge origin/main`, which is signed) and rerun the affected checks.
2. **Verify, and report the real output.** Pick the checks from the change → check map for the paths in `git diff --name-only origin/main...HEAD` plus the working tree. At minimum:
   - Browser code (`src/`): `npm run typecheck`, `npm run lint`, `npm run lint:boundaries`, and the focused suites (`ls tests/ | grep <subject>`).
   - `api/`, `server/`, `scripts/seed-*`, `src/services/`: also `npm run typecheck:api`, and run the `edge-contract-reviewer` agent on the diff. Include what it found.
   - `.github/workflows/`: `actionlint` on the changed workflow and `npm run docs:check`.
   - `CLAUDE.md` or `.claude/`: the tests that read them (`tests/proto-codegen-workflow.test.mts`, `tests/cii-docs-drift.test.mts`, `tests/agent-page.test.mjs`, `tests/sentry-triage-skill.test.mjs`) and `npm run docs:check`.
   - `src/lite/`, `lite.html`, the Lite routes: `tests/lite-ui.test.mts`, `tests/lite-profile.test.mts`, `npx vitest run --config vitest.dom.config.mts tests/dom/lite-ui.test.mts`, and `npm run build:full` (its `bundle:check` budget too).
   - A suite that also fails on a clean `origin/main` is a baseline failure, not this change's. Prove it with a detached worktree of `origin/main` before saying so.
   - A build rewrites `src/config/docs-page-dates.generated.ts` and `public/sitemap*.xml`. Restore them with `git checkout --` afterwards.
3. **UI evidence.** When the change adds or alters UI:
   - Drive it with the `verify-worldmonitor` skill. For `/lite`, use `steps/lite-ui.mjs`.
   - Capture desktop (1440) and phone (390) screenshots, and label any test data.
   - Attach them in step 6. A PR that changes UI is not ready without them (CLAUDE.md "Include UI evidence in pull requests").
4. **Review the diff and commit.**
   - Look at `git status --short`, `git diff`, and `git diff --check`.
   - Never commit `design/` (it holds a 1 MB AI-generated base64 image), `.env*`, secrets, build output, or a `node_modules` symlink.
   - It must be one change. Split anything unrelated out and mention it.
   - Stage explicit paths, not `git add -A`.
   - Write an English Conventional Commits message that says why. End it with the commit attribution lines this session uses.
   - Check the signature: `git log --format='%G? %an <%ae> %s' -1` must show `G` and the author above.
5. **Push:** `git push -u origin HEAD:<type>/<slug>`.
   - The pre-push hook runs tsc for src and API, edge-bundle checks, markdown lint and the version sync. Never bypass it with `--no-verify`; fix what it reports.
   - Never force-push without the user's say-so. To bring in `main`, merge it instead of rebasing.
6. **Open the PR:** `gh pr create --repo thangnc/worldmonitor --base main --head <type>/<slug>`.
   - `--repo` is required; without it `gh` targets the upstream repo.
   - The title is the commit subject. Write the body in English:
     - the user outcome, and what changed and why
     - the verification results with real numbers
     - what is not verified (for example Vercel, live data, a credential-gated path)
     - anything deliberately left out
     - the user's notes, if any
   - End the body with the PR attribution lines this session uses.
   - Write the body to a file in the scratchpad and pass `--body-file <path>`. A worktree-isolated session refuses a heredoc body that names git.
   - Attach the step 3 screenshots: `gh pr edit <n> --repo thangnc/worldmonitor --attach '/abs/path.png#Description, commit <sha>'`. Then check that the images appear in the body.
7. **Watch CI** until every run for the head commit completes. Report each run, and each failed job.
   - First wait until `gh run list --repo thangnc/worldmonitor --commit <full sha>` lists a run; `gh pr checks --watch` exits early with "no checks reported" if it starts too soon.
   - Then watch with one plain command in the background: `gh pr checks <n> --repo thangnc/worldmonitor --watch --interval 30`. A worktree-isolated session refuses polling loops that build `gh` arguments at runtime.
   - Pull request runs: Test, Typecheck, Proto Generation Check and Stacked Merge Guard on every PR. Resilience Snapshot Rehearsal and others when their paths change. Contributor Trust skips. The `main` ruleset requires no check, but the owner merges only on green.
   - A `startup_failure` with no jobs means GitHub rejected the workflow. Read the message on the run page. On this fork it has been the Actions policy: only GitHub-made actions plus the SHA-pinned ones allowed in Settings, Actions.
   - On a failure, read the failed log (`gh run view <id> --repo thangnc/worldmonitor --log-failed`) and fix it in this worktree. A failure that also happens on `main` belongs in its own PR, not this one.
8. **Stop and report.** Give the PR link and the CI result.
   - Don't merge unless the user asks.
   - When they do: `gh pr merge <n> --repo thangnc/worldmonitor --merge --match-head-commit <full sha>`. Use a merge commit, never squash or rebase.
   - A push to `main` starts Convex Deploy, which fails because the fork has no `CONVEX_DEPLOY_KEY`. That is expected. Nothing deploys, so never add the key to make it pass.
   - Deploying is a separate authorization. Merging is not deploying.
   - After the merge, and only when asked:
     - `ExitWorktree` with `action: remove`
       - It warns that it will discard the merged commit because local `main` is behind. First run `git fetch origin main` and `git merge-base --is-ancestor <sha> origin/main`; if the commit is on `main` and `git status` is clean, pass `discard_changes: true`.
     - delete the remote branch: `git push origin --delete <type>/<slug>`
     - `git pull` in the main checkout
