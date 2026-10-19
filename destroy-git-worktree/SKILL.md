---
name: destroy-git-worktree
description: >-
  Tear down the current session's git worktree: run the teardown script, return to the
  primary worktree, remove the worktree and its branch, and clear workflow state. Use
  when the user wants to destroy, remove, clean up, or exit a worktree. Requires the
  setup-git-worktree workflow.
compatibility: Requires Git 2.17+, a completed worktree setup, and permission to remove the worktree.
---

# Destroy a Git Worktree

## Outcome

The current worktree's environment is cleaned up, the session is back in the primary
worktree, the linked worktree is removed, its branch is deleted or deliberately kept,
and the workflow state is cleared. If cleanup or a safety gate fails, the worktree and
branch are kept and the user is told exactly what remains.

## Words used in this skill

- **Current worktree**: the linked worktree this session owns.
- **Primary worktree**: the main checkout where the control plane lives.
- **Cleanup**: the teardown script's work (services, database, containers, ports).
- **Gate**: a pre-removal check for dirty files, unpushed commits, unmerged work,
  submodules, or locks.
- **Leave**: stop without removing anything; the session returns to the primary.

## Step 0 — Read the contract

Read `AGENTS.md` in the primary worktree and take the `Workflow doc:` path from the
marked block. Read the doc's `yaml worktree-config` block.

If the setup is missing, stop:

> This repository has no worktree workflow. Run setup-git-worktree first.

Parse `storage`, `scripts`, `base_ref`, `state_dir`, and `naming`. Resolve the effective
script set: on Windows use `scripts.windows` when present; on Unix-like systems use
`scripts.unix` when present; otherwise use the top-level `scripts.runner`,
`scripts.init`, and `scripts.teardown`. Do not guess.

Resolve the primary path from the first `worktree` record of:

```text
git worktree list --porcelain
```

Determine whether the current directory is linked:

```text
git rev-parse --git-dir
git rev-parse --git-common-dir
```

Different values mean linked.

Done when the primary path and config are known.

## Step 1 — Locate the current worktree

Use this order. Stop at the first reliable match.

1. **Current directory is a linked worktree**: use its top-level path.
2. **Context remembers a path**: the create banner or a prior state entry in this
   session gives a path. Validate it:
   - it appears in `git worktree list --porcelain`,
   - it is not the primary,
   - it is inside the configured storage root.
3. **Ask**: list every worktree and let the user choose.

When listing, show for each:

- path and branch,
- HEAD,
- locked or not,
- dirty or clean (`git -C <path> status --porcelain`),
- commits not in the recorded base commit (`git -C <path> log --oneline <base_commit>..HEAD`);
  if the state file is missing, resolve `<base_commit>` in the primary first,
- whether a state file exists.

Never remove the primary. Never pick a worktree just because it is the only one; the
user must confirm when the session does not already own it.

If there are no linked worktrees, report that and stop. The session is already in the
primary.

Done when one target worktree is chosen and validated.

## Step 2 — Preflight the target

- Target path is not the primary and is inside the storage root.
- Target is registered by `git worktree list --porcelain`.
- The branch and the worktree leaf have the same canonical name. If they differ, warn
  and use the actual branch from Git, not the directory name.
- Read the state file if present. Use its `base_commit` for the gates below. If the state
  is missing, reconstruct the fields from Git, resolve `base_ref` in the primary with
  `git -C <primary> rev-parse <base_ref>`, and record that as `base_commit`.
- Check `locked` in `git worktree list --porcelain`. If locked, ask before running
  `git worktree unlock <path>`. Treat a lock as a sign that another session may be using
  it.

Done when the target is safe to operate on and the user has confirmed the target.

## Step 3 — Run teardown

If the worktree directory exists, switch to it. Run the control-plane teardown script
with explicit arguments:

```text
<runner> <primary>/<scripts.dir>/<teardown> \
  --repo <primary> --worktree <target> --name <name> --json
```

- Capture stdout and stderr; keep the log path.
- Use a generous timeout for stopping services and dropping resources.
- The script must be non-interactive and idempotent.
- If the target directory is already gone, run the script from the primary with the
  saved path and name.

Done when teardown exits 0 with `"ok": true`.

## Step 4 — Handle teardown failure

Do not remove the worktree. Return to the primary worktree, keep the worktree, keep the
branch, and report:

- exit code and last 20 log lines,
- which resource failed (database, container, port, process, permission),
- the exact command to retry.

Offer three choices:

1. **Retry** after the user fixes the cause. Run teardown again. If it succeeds, continue
   to Step 5.
2. **Force remove the worktree**: first run the dirty-files check below and show what
   will be lost. After explicit confirmation, run `git worktree remove --force`, keep
   the branch, keep the state file with `"teardown": "failed"`, and print the resources
   that may still exist. Do not delete the branch.
3. **Leave**: keep the worktree and branch as they are. The session stays in the primary
   and the user can try again later.

If the user chooses force remove or leave, end with the return banner but state clearly
that cleanup did not complete. Never claim the environment is clean.

Done when the user chooses retry, force remove, or leave.

## Step 5 — Return to the primary and run the gates

Switch to the primary worktree and verify:

```text
git rev-parse --show-toplevel
```

It must equal the primary path. If the primary is missing, stop and report; do not delete
anything.

Cleanup success only means the environment is clean. It does not mean the code is safe
to delete. Run all gates from the primary with `git -C <target>`.

**Dirty files**

```text
git -C <target> status --porcelain
```

If there is output, list the first 20 entries. Ask the user to choose:

1. Commit the changes.
2. Create a patch or copy the files out.
3. Force removal after acknowledging the loss.
4. Leave the worktree.

Do not force remove on your own.

**Unpushed commits**

First check whether the branch has an upstream:

```text
git -C <target> rev-parse --abbrev-ref --symbolic-full-name @{u}
```

If it does, compare with `git -C <target> log --oneline @{u}..HEAD`. If it does not,
compare with `git -C <target> log --oneline <base_commit>..HEAD` and say the commits are
not on an upstream. Warn that deleting the branch would lose them. Ask whether to keep
the branch, push first, or acknowledge the loss.

**Unmerged branch**

```text
git -C <target> merge-base --is-ancestor <branch> <base_commit>
```

A non-zero exit means the branch has work not contained in the recorded base commit. Do
not delete it without an explicit decision.

**Submodules**

```text
git -C <target> submodule status --recursive
```

Lines beginning with `+`, `-`, or `U` mean the submodule checkout differs or is
uninitialized. Warn and ask before removal.

**Lock**

If the worktree is locked, ask to unlock it. Do not remove a locked worktree silently.

If any gate fails, stop before removal. Report exactly what remains and what the user
must resolve. The session stays in the primary, and the worktree stays on disk.

Done when every gate passes or the user chooses to leave.

## Step 6 — Remove the worktree

Only after all gates pass:

```text
git worktree remove <target>
```

Handle failures:

- **Dirty or untracked files**: do not use `--force` without explicit confirmation. If
  the user confirms, run `git worktree remove --force <target>`.
- **Locked**: unlock and retry, or ask.
- **File locks on Windows**: stop the processes or background jobs using the worktree,
  then retry. If it still fails, leave the worktree and report.
- **Directory already gone**: run `git worktree prune` and treat the worktree as
  removed.

Verify with `git worktree list --porcelain` that the target no longer appears.

Never run `git clean -x` or remove the primary directory.

Done when the worktree is no longer registered.

## Step 7 — Delete the branch

Only after the worktree is removed:

```text
git branch -d <branch>
```

- If `-d` refuses, check whether the gate already proved the branch is an ancestor of
  `base_commit`. If it did, the commits are already contained and `-D` is safe. If it
  did not, stop and ask; use `-D` only after explicit confirmation. Print the branch SHA
  and a recovery command first.
- Do not delete the remote branch.
- If the branch is checked out in another worktree, stop.
- If the branch is the primary branch, stop.

If branch deletion fails, report it. The worktree is already gone; the branch remains
for recovery.

Done when the branch is deleted or deliberately kept.

## Step 8 — Clear state

- Remove `<common>/<state_dir>/<name>.json` only when the worktree was removed and the
  branch was deleted.
- If the user chose force remove with a failed teardown, or kept the branch, keep the
  state file and mark `"teardown": "failed"` and/or `"branch_kept": true`. That is the
  record the user needs to finish cleanup or recover the branch.
- Keep logs when cleanup failed or the branch was kept; they are useful for diagnosis.
- Remove empty state directories.
- Run `git worktree prune` to clear stale administrative entries.

Done when the state entry is either cleared or deliberately kept with a reason, and
`git worktree prune` succeeds.

## Step 9 — Report

End the answer with:

```text
本次会话已切换回 main worktree。
Primary: <primary path>
Branch: <primary branch>
Worktree: removed | left at <path>
Branch: deleted | kept as <branch>
Resources: cleaned | still present: <list>
```

The exact phrase `本次会话已切换回 main worktree` must appear at the end. If cleanup or
a gate failed, say `destroy incomplete` and explain what remains.

## Edge cases

- **Setup missing**: stop and direct the user to setup-git-worktree.
- **No worktrees**: report and stay in the primary.
- **Target is the primary**: refuse.
- **Target path is outside the storage root**: refuse.
- **Target missing from disk**: prune its administrative entry; run teardown from the
  primary with saved metadata if the script needs it.
- **Context lost**: list worktrees and ask. Never guess.
- **Multiple worktrees**: show them and ask; do not destroy another session's worktree
  without confirmation.
- **Locked worktree**: ask before unlocking. A lock may mean another agent is active.
- **Background jobs**: kill jobs whose working directory is the target before teardown
  and removal. Track them from create.
- **Global permission denied**: treat as a failure; keep the worktree and report the
  denied path. Do not silently fall back.
- **Teardown script missing**: stop and ask the user to re-run setup.
- **Windows file locks**: stop dev servers, watchers, and package managers before
  removal; retry once. If it still fails, leave and report.
- **Concurrent destroy**: if the target disappears between checks, re-read
  `git worktree list` and report the actual state; do not delete a path by name.

## Completion criteria

- [ ] The workflow doc and config were read.
- [ ] The target was identified from cwd, validated context, or an explicit user choice.
- [ ] Target is not the primary and is inside the storage root.
- [ ] Teardown ran; a failure produced a keep/retry/force decision, not a silent removal.
- [ ] Dirty, unpushed, unmerged, submodule, and lock gates were checked.
- [ ] The session returned to the primary before removal.
- [ ] The worktree was removed, or the reason it was kept is reported.
- [ ] The branch was deleted after successful removal, or kept with a reason.
- [ ] State was cleared, or deliberately kept with a reason; `git worktree prune` ran.
- [ ] The final answer contains `本次会话已切换回 main worktree`.
