---
title: Retarget stacked children before deleting a merged parent's branch; a hand delete can close them instead
date: 2026-11-07
area: ci
problem_type: workflow_issue
tags:
  - stacked-prs
  - github
  - retarget
  - branch-deletion
  - orphaned-stacked-merge-monitor
  - ship
severity: medium
module: .claude/skills/ship/SKILL.md (merge cleanup), scripts/check-stacked-merge.mjs
symptoms:
  - A stacked child PR shows "closed" seconds after its parent's branch was deleted, with a base_ref_deleted event right before it
  - "github-actions comment on the child: \"this PR closed after its base branch `<branch>` was deleted. GitHub may have closed it instead of retargeting it.\""
  - The child cannot be reopened while its base branch is gone
root_cause: race between a manual branch delete and the monitor's retarget
---

# Retarget stacked children before deleting a merged parent's branch; a hand delete can close them instead

## Problem

A stack was merged in order: #16, then #17 (based on #16's branch `docs/engineering-kb`), then #18
(based on #17's branch). #16 merged at 11:20:40. Following `/ship` step 8, the branch was deleted by
hand 16 seconds later with `git push origin --delete docs/engineering-kb`. GitHub closed #17 in the
same second instead of moving it to `main`.

## Symptoms

- #17's timeline: `base_ref_deleted` and `closed`, both at 11:20:56. #17 still pointed at the deleted branch.
- The Orphaned Stacked Merge Monitor's retarget step ran at 11:20:59 and found no open child to move.
  It then posted its recovery comment on #17: "Parent #16 … merged into `main`, and this PR closed after
  its base branch `docs/engineering-kb` was deleted. GitHub may have closed it instead of retargeting it."
- `gh pr reopen` fails while the base branch does not exist.

## What Didn't Work

- **Relying on GitHub's retarget.** GitHub sometimes moves children of a deleted, merged branch to the
  parent's base (#8517 → #8518) and sometimes closes them (#8164; #9950 → #9958; #16 → #17 here). With
  `delete_branch_on_merge` off on this fork, a hand delete is the second case often enough to plan for.
- **Relying on the monitor.** `.github/workflows/orphaned-stacked-merge-monitor.yml` runs on
  `pull_request: closed` and retargets open children (`planStackRetargets`,
  `scripts/check-stacked-merge.mjs:71`). Its job started 6 seconds after the merge and reached the
  retarget step 19 seconds after it. A delete inside that window wins. The script documents this race
  at `scripts/check-stacked-merge.mjs:608`.

## Solution

Recovery, without changing any code:

```bash
git push origin <parent-head-sha>:refs/heads/<parent-branch>   # restore the base at the merged head
gh pr reopen <child> --repo thangnc/worldmonitor
gh pr edit <child> --repo thangnc/worldmonitor --base main
gh pr list --repo thangnc/worldmonitor --base <parent-branch> --state open   # must be empty
git push origin --delete <parent-branch>
```

Then start a fresh CI run on the child. A base change alone re-runs nothing that guards proto
freshness: see
[the companion lesson](restart-ci-on-a-retargeted-pr-with-a-fresh-commit-not-close-reopen.md).

The order that avoids the close altogether is retarget first, then delete:

```bash
gh pr list --repo thangnc/worldmonitor --base <parent-branch> --state open --json number -q '.[].number'
gh pr edit <child> --repo thangnc/worldmonitor --base main      # for each child
git push origin --delete <parent-branch>                         # once the list is empty
```

## Why This Works

A child based on `main` has no dependency on the parent branch, so deleting that branch cannot close
it. Retargeting by hand removes the race between GitHub's own handling, the monitor's PATCH, and the
delete. Restoring the branch at the parent's merged head makes the closed child reopenable without
changing what it diffs against.

## Prevention

- `/ship` step 8 lists open children of the branch and retargets them before `git push origin --delete`.
- Deleting the branch through `gh pr merge --delete-branch` or the PR page has not been shown to avoid the close. Retarget first either way.
- After retargeting, bring the child's CI up to date before merging it (see the companion lesson).

## Related

- [Stacked PR children merge into an orphaned base branch when the parent's branch survives](../integration-issues/stacked-pr-children-merge-into-an-orphaned-base-branch.md): the opposite failure, when the branch is never deleted.
- [Restart CI on a retargeted PR with a fresh commit, not close-reopen](restart-ci-on-a-retargeted-pr-with-a-fresh-commit-not-close-reopen.md)
- #16, #17, #18: the stack where this happened (2026-11-07).
