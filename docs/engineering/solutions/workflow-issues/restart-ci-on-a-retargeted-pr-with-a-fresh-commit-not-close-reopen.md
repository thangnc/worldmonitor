---
title: Restart CI on a retargeted PR with a fresh commit, not close-reopen
date: 2026-11-07
area: ci
problem_type: workflow_issue
tags:
  - stacked-prs
  - github
  - retarget
  - proto-check
  - orphaned-stacked-merge-monitor
  - ci-rerun
severity: low
module: .github/workflows/proto-check.yml, .github/workflows/orphaned-stacked-merge-monitor.yml
symptoms:
  - "proto-changes fails with \"ERROR: Pull request metadata moved while codegen paths were being classified.\""
  - "proto-freshness fails with \"ERROR: Proto path classification did not complete successfully.\""
  - "A stacked child gets a github-actions comment: \"Parent #N … was closed without merging. This PR is still based on its branch …\" although the parent was reopened seconds later"
root_cause: base change fires no proto-check event, and close-reopen fires the orphan monitor
---

# Restart CI on a retargeted PR with a fresh commit, not close-reopen

## Problem

#17 had to be retargeted from its merged parent's branch to `main`. Its CI then needed a fresh run
against the new base. Two attempts at that each caused a different failure.

## Symptoms

- #17 was reopened at 11:21:13, still based on `docs/engineering-kb`, and retargeted to `main` at
  11:21:16. The Proto Generation Check run started by the `reopened` event recorded the old base
  (`EVENT_BASE_SHA` = the parent's head). Its `proto-changes` job then read the live PR and stopped:
  "ERROR: Pull request metadata moved while codegen paths were being classified."
  (`.github/workflows/proto-check.yml:174`). `proto-freshness` failed after it:
  "ERROR: Proto path classification did not complete successfully."
- Closing and reopening #17 at 11:23:50 to get a clean run worked for #17. It also made the Orphaned
  Stacked Merge Monitor post on #18, whose base was still #17's branch: "Parent #17 … was closed
  without merging. This PR is still based on its branch `docs/engineering-kb-index`, so merging it would
  not reach the default branch." #17 had been reopened two seconds after it closed.

## What Didn't Work

- **Retargeting and waiting.** `proto-check.yml` runs on `pull_request` with the default event types
  (`opened`, `synchronize`, `reopened`). A base change is an `edited` event, so nothing re-validates
  proto freshness against the new base.
- **Re-running the failed job.** A re-run replays the original event, which carries the old base SHA,
  so the guard at `proto-check.yml:174` fails the same way.
- **Close and reopen.** The `reopened` event does start a fresh run with the current base. But
  `orphaned-stacked-merge-monitor.yml` runs on `pull_request: closed`, and to
  `scripts/check-stacked-merge.mjs` a close without a merge means every open child is stranded. It
  comments on each one and never takes the comment back after the reopen.

## Solution

Retarget first. Then push a commit to the retargeted branch, which fires `synchronize` with the
current base. The useful commit is a merge of `main`, which also brings the branch up to date:

```bash
gh pr edit <n> --repo thangnc/worldmonitor --base main
git fetch origin main
git switch <branch> && git merge origin/main          # signed merge commit
git push origin HEAD:<branch>
```

If `main` is already an ancestor of the branch, use `git commit --allow-empty -m "ci: re-run against main"`.

## Why This Works

A `synchronize` event carries the PR's base and head as they are when the push lands, so the
proto-check guard sees no movement. A push never closes the PR, so the orphan monitor has nothing to
react to. Merging `main` also follows the monitor's own advice for retargeted children, since their
diff and CI may still reflect the old base.

## Prevention

- Do not retarget a PR while its runs are in progress. Retarget, then push.
- Use close-reopen only on a PR with no open children. Check with
  `gh pr list --repo thangnc/worldmonitor --base <branch> --state open` first.
- A "closed without merging" comment on a child is stale if the parent's timeline shows a `reopened` event right after the close.

## Related

- [Retarget stacked children before deleting a merged parent's branch](retarget-stacked-children-before-deleting-the-merged-parent-branch.md): how #17 came to need a retarget.
- [Stacked PR children merge into an orphaned base branch when the parent's branch survives](../integration-issues/stacked-pr-children-merge-into-an-orphaned-base-branch.md)
- #17, #18 (2026-11-07).
