---
name: destroy-git-worktree
description: >-
  Tear down the session's git worktree: confirm ownership, run teardown, purge isolated
  artifacts, check for work that would be lost, return to the primary worktree, remove the
  worktree (or recover an orphaned directory), delete or keep the branch, and clear
  schema 2 state. Use when the user wants to destroy, remove, clean up, or exit a
  worktree. Requires the setup-git-worktree workflow.
compatibility: Requires Git 2.17+, a completed worktree setup, permission to remove the worktree, and write access to the repository's Git directory.
---

# Destroy a Git Worktree

## Outcome

The current worktree's environment is cleaned up, the session is back in the primary
worktree, the linked worktree is removed, its branch is deleted or deliberately kept,
and the workflow state is cleared. If cleanup or a safety gate fails, the worktree and
branch are kept and the user is told exactly what remains.

## Words used in this skill

- **Current worktree**: the linked worktree this session created and owns. The current
  directory is evidence, not proof of ownership.
- **Primary worktree**: the main checkout where the control plane lives.
- **Integration branch**: the branch a completed worktree branch lands on.
- **Cleanup**: the teardown script's work (services, database, containers, ports).
- **Purge**: teardown with `--purge`, which removes the configured `cleanup` paths such
  as `node_modules` and `dist`. It does not remove `env.file`; managed keys are handled
  separately.
- **Gate**: a pre-removal check for dirty files, unpushed commits, unmerged work,
  submodules, or locks.
- **Orphan**: a worktree directory whose Git administrative entry is already gone.
- **Leave**: stop without removing anything; the session returns to the primary.

## Step 0 — Read the contract

Read `AGENTS.md` in the primary worktree and take the `Workflow doc:` path from the
marked block. Read the doc's `yaml worktree-config` block.

If the setup is missing, stop:

> This repository has no worktree workflow. Run setup-git-worktree first.

Parse `storage`, `scripts`, `base_ref`, `state_dir`, `naming`, `integration`, `cleanup`,
and the optional `env` block; read `config_file` when present and verify it agrees with
the document. For schema 2, `config_file` is required; stop if it is missing. Resolve the
effective script set: on Windows use `scripts.windows` when present; on Unix-like systems
use `scripts.unix` when present; otherwise use the top-level `scripts.runner`,
`scripts.init`, and `scripts.teardown`. Do not guess.

For schema 1, derive `integration.branch` from the primary's current branch
(`git -C <primary> rev-parse --abbrev-ref HEAD`), treat `integration.mode` as `direct`,
and treat `cleanup` as empty. If the primary is in detached HEAD, ask the user which
branch is the integration branch; do not invent one. Schema 1 state is still readable;
record derived values in memory and upgrade the state on the next write.

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

## Step 1 — Locate and confirm the worktree

The current directory is a **candidate**, not proof of ownership. Never infer ownership
from cwd alone, and never auto-select the only linked worktree.

Gather candidates:

1. If cwd is a linked worktree, its top-level path is candidate 1.
2. The create banner or a state entry in this conversation may name a path. Validate it:
   it appears in `git worktree list --porcelain`, it is not the primary, and it is inside
   the configured storage root.
3. Otherwise, list every worktree.

For the candidate, show:

- path and branch,
- HEAD,
- locked or not, including the lock reason,
- dirty or clean (`git -C <path> status --porcelain`),
- commits not in the recorded base commit, when a base commit is known,
- whether a state file exists, and its `requirement`, `created_at`, and `lifecycle` when
  present.

Then ask: "Is this the worktree this session created?" If the user says no or is unsure,
list the worktrees and ask them to choose by path and branch. A state file helps the user
recognize the worktree; it does not prove ownership.

Never remove the primary. If there are no linked worktrees and no state-recorded orphan
path, report that and stop. The session is already in the primary.

Done when one target worktree is chosen and the user has confirmed it.

## Step 2 — Preflight the target

- Target path is not the primary and is inside the storage root.
- Target is registered by `git worktree list --porcelain`, or it is an unregistered
  orphan directory at the recorded path. For an orphan, confirm the path, the leaf name,
  and the orphan guards in Step 6; skip Git-metadata gates that need a registration.
- `integration.branch` resolves locally, or its configured remote ref exists for
  pull-request mode. If neither resolves, stop and ask the user to fetch or re-run setup.
- The branch and the worktree leaf have the same canonical name. If they differ, warn
  and use the actual branch from Git, not the directory name.
- Read the state file if present. Accept schema 1 or 2. Use the config's
  `integration.branch` for the gates; fall back to the state's `integration_branch` when
  the config is schema 1. Use state `base_commit` for the "commits since creation"
  display. If the state is missing, reconstruct fields from Git: resolve
  `integration.branch` in the primary, and resolve `base_ref` to a commit for the
  "commits since creation" display. Record the reconstructed values in memory.
- Read `copied_files` and `cleanup` when present. Also read
  `<common>/<state_dir>/<name>.copied.json` when it exists and union its `files` with
  `copied_files`. If the manifest exists but cannot be parsed, stop and report; do not
  guess which files are read-only. Copied files must never be deleted by purge; cleanup
  paths are the only ignored paths `--purge` may remove.
- Check `locked` and the lock reason in `git worktree list --porcelain`. If locked, show
  the reason and ask before running `git worktree unlock <path>`. A lock may mean another
  session is active; do not unlock silently.

Done when the target is safe to operate on and the user has confirmed the target.

## Step 3 — Run teardown

Before teardown, resolve listeners on the ports allocated to this worktree (state
`resources`, the port registry, or the script's own record). For each listener:

- Resolve the PID and command line (`Get-NetTCPConnection -LocalPort <port>` plus
  `Get-CimInstance Win32_Process`, or `lsof -nP -iTCP:<port> -sTCP:LISTEN` / `ss -ltnp`).
- Stop it only when the command line contains the absolute worktree path. Terminate the
  process tree (`taskkill /PID <pid> /T /F` or `kill -- -<pgid>`).
- If the owner is unclear or unrelated, stop and report; do not kill it.
- After stopping, verify the port has no listener.

If the worktree directory exists and is registered, switch to it. If it is an orphan, stay
in the primary and pass the saved path and name to the script. Run the control-plane
teardown script with explicit arguments:

```text
<runner> <primary>/<scripts.dir>/<teardown> \
  --repo <primary> --worktree <target> --name <name> \
  --config <primary>/<config_file> \
  --copied-manifest <common>/<state_dir>/<name>.copied.json --json
```

- Capture stdout and stderr; keep the log path.
- If `config_file` is absent (schema 1), omit `--config`; otherwise pass it explicitly.
- If the copied manifest is absent, omit `--copied-manifest`; otherwise pass it explicitly.
- Use a generous timeout for stopping services and dropping resources.
- The script must be non-interactive and idempotent.
- Do not pass `--purge` here. Purge removes ignored artifacts and runs only after the
  loss gates in Step 5.
- If the target directory is already gone, run the script from the primary with the
  saved path and name.
- The script may remove only the keys it added to `env.file`; if it removes a project
  env file or a copied file, stop and report a script bug.

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
   will be lost. After explicit confirmation, unlock the worktree, run
   `git worktree remove --force`, keep the branch, keep the state file with
   `"teardown": "failed"`, and print the resources that may still exist. Do not delete
   the branch. If force removal leaves a directory behind, use the orphan procedure in
   Step 6 after the same confirmations; do not skip its guards.
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
to delete. Run all gates from the primary with `git -C <target>`. If the target is an
orphan, it has no `.git` file; skip target-local gates (dirty files, submodules), keep
the branch/integration checks that run in the primary, use the state and the orphan
guards in Step 6, and do not pretend a gate ran.

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

**Ignored artifacts**

List the configured `cleanup` paths that exist in the target. They are expected and
`--purge` will remove them. Warn if an ignored file is not in `cleanup` and is not in
`copied_files`; it may be left behind. If a path appears in both `cleanup` and
`copied_files`, stop: the configuration would delete a copied file. `env.file` is not a
purge path; teardown removes only its managed keys, so unmanaged keys survive.

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

Compare the branch with the **integration branch**, not the commit the branch was created
from:

```text
git -C <primary> merge-base --is-ancestor <branch> <integration_branch>
```

A non-zero exit means the branch has work not contained in the integration branch. Do not
delete it without an explicit decision: keep the branch, land it first with
`merge-git-worktree`, or confirm a force delete after the SHA and recovery command are
printed.

For `integration.mode: pull-request`, the local integration branch may be behind. Fetch
the configured remote first and test against `origin/<integration_branch>`. If the fetch
or the remote ref is unavailable, ask the user; do not guess.

If the state says `lifecycle: pr_open`, check the PR state with the configured tool when
available. Without a tool, ask the user to confirm the PR is merged. A PR merged with a
merge commit makes the branch an ancestor of the fetched integration branch. A PR merged
with squash or rebase rewrites the commits, so the ancestor check fails; mark that case
as "merged by PR, commits rewritten", require explicit confirmation, and use `-D` with
the branch SHA printed. The same handling applies when `lifecycle: merged` but the
ancestor check still fails.

**Submodules**

```text
git -C <target> submodule status --recursive
```

Lines beginning with `+`, `-`, or `U` mean the submodule checkout differs or is
uninitialized. Warn and ask before removal.

**Lock**

If the worktree is locked, show the lock reason and ask before unlocking. Do not remove a
locked worktree silently; a lock may mean another session is still active.

If any gate fails, stop before removal. Report exactly what remains and what the user
must resolve. The session stays in the primary, and the worktree stays on disk.

Done when every gate passes or the user chooses to leave.

## Step 6 — Purge and remove the worktree

Only after all gates pass.

First run teardown with purge. This removes the configured `cleanup` paths and is
idempotent:

```text
<runner> <primary>/<scripts.dir>/<teardown> \
  --repo <primary> --worktree <target> --name <name> \
  --config <primary>/<config_file> \
  --copied-manifest <common>/<state_dir>/<name>.copied.json --json --purge
```

If purge fails, report which path is locked and which process may hold it. Do not delete
an unverified path by hand and do not run `git worktree remove` while a cleanup path is
locked; ask the user to stop the process and retry. For schema 1 or a teardown script
that does not support `--purge`, omit `--purge`. Omit `--config` and
`--copied-manifest` when those files do not exist; otherwise pass them explicitly.

If the worktree is registered and locked, unlock it after the user confirmed:

```text
git worktree unlock <target>
```

Then remove:

```text
git worktree remove <target>
```

Use this state machine when the command fails:

1. **Registered and the directory exists**: retry once. If it still fails, ask before
   `git worktree remove --force <target>`. If `--force` still fails, re-read
   `git worktree list --porcelain`: if the target is now unregistered, go to step 3; if
   it is still registered, stop and report the lock instead of deleting the directory.
2. **Registered and the directory is gone**: run `git worktree prune` and treat the
   worktree as removed.
3. **Not registered but the directory exists**: it is an orphan. Use the orphan
   procedure below.
4. **Not registered and the directory is gone**: run `git worktree prune`; done.

**Orphan procedure**

`git worktree remove` may unregister the worktree and then fail to delete the directory,
especially on Windows with `node_modules`. Before deleting an orphan, verify all of the
following and show the evidence to the user:

- the absolute, resolved path is inside the configured storage root;
- the leaf directory name equals the canonical name;
- the path is not the primary worktree and does not contain `..`;
- the branch is merged into the integration branch, or the user accepted a PR-squash
  exception;
- either the dirty-files gate passed earlier in this run, or the user explicitly accepts
  the loss after seeing the directory contents; an orphan has no `.git` file, so
  cleanliness cannot be proven with `git -C <target>`;
- the directory contains no junction or symlink whose target is outside the worktree;
- no process command line contains the absolute path; if a process does, stop it first;
- the user explicitly confirms deleting the directory.

Then:

```text
git worktree prune
```

Delete with a literal path: `Remove-Item -LiteralPath <target> -Recurse -Force` on
Windows, or `rm -rf -- <target>` on Unix. Do not use a glob or a computed path. If the
delete fails because of a locked file, stop and report; do not escalate to deleting a
parent directory.

Verify with `git worktree list --porcelain` that the target no longer appears.

Never run `git clean -x` in the primary worktree. In a linked worktree, `teardown
--purge` is the supported cleanup; do not hand-delete `node_modules` unless the orphan
procedure above applies.

Done when the worktree is no longer registered and its directory is gone, or the user
chose to leave it with a reported reason.

## Step 7 — Delete the branch

Only after the worktree is removed:

```text
git branch -d <branch>
```

- If `-d` refuses, check whether the gate already proved the branch is an ancestor of
  `integration.branch` (or `origin/<integration.branch>` in pull-request mode). If it
  did, the commits are already contained and `-D` is safe. If it did not, stop and ask;
  use `-D` only after explicit confirmation, and print the branch SHA and a recovery
  command first.
- For a PR merged with squash or rebase, the ancestor proof will not hold. Use `-D` only
  after the user confirms the PR merge and the commit rewrite is acceptable; print the
  branch SHA first.
- Do not delete the remote branch.
- If the branch is checked out in another worktree, stop.
- If the branch is the primary branch or the integration branch, stop.

If branch deletion fails, report it. The worktree is already gone; the branch remains
for recovery.

Done when the branch is deleted or deliberately kept.

## Step 8 — Clear state

- Remove `<common>/<state_dir>/<name>.json` only when the worktree was removed and the
  branch was deleted.
- Remove `<common>/<state_dir>/<name>.copied.json` only when the state file is removed.
  Keep both when the state is kept for recovery.
- Before removing it, set `lifecycle: destroyed` and `teardown: "ok"` when the state
  exists; this is the audit record for the last write.
- If the user chose force remove with a failed teardown, or kept the branch, keep the
  state file and mark `"teardown": "failed"` and/or `"branch_kept": true`. Record
  `pr_url` and `merged_commit` when known. That is the record the user needs to finish
  cleanup or recover the branch.
- Keep logs when cleanup failed, the branch was kept, or a PR was squash-merged; they are
  useful for diagnosis.
- Remove empty state directories.
- Run `git worktree prune` to clear stale administrative entries.

Done when the state entry is either cleared or deliberately kept with a reason, and
`git worktree prune` succeeds.

## Step 9 — Report

End the answer with:

```text
This session has switched back to the main worktree.  [in the user's language]
Primary: <primary path>
Branch: <primary branch>
Integration: <integration.branch> (<integration.mode>)
Worktree: removed | left at <path>
Branch: deleted | kept as <branch>
Resources: cleaned | still present: <list>
Cleanup: purged | left: <list>
```

The banner's first line must state that the session has switched back to the main
worktree. The English wording above is canonical; the bracketed marker beside it means
the line is emitted in the language the user is actually writing in, not always in
English. Keep the banner at the end and keep its meaning stable, so users and recovery
paths still recognize it in any language. If cleanup or a gate failed, say
`destroy incomplete` and explain what remains. If an orphan directory was removed
manually, state the verified absolute path and that it was unregistered before deletion.

Done when the final banner is printed and every remaining resource or kept branch is
named.

## Edge cases

- **Setup missing**: stop and direct the user to setup-git-worktree.
- **Schema 1 setup or state**: derive the integration branch from the primary's current
  branch, treat `cleanup` as empty, and upgrade the state to schema 2 on the next write.
  Do not fail only because the repository predates schema 2.
- **No worktrees**: report and stay in the primary.
- **Target is the primary**: refuse.
- **Target path is outside the storage root**: refuse.
- **Target missing from disk**: prune its administrative entry; run teardown from the
  primary with saved metadata if the script needs it.
- **Unregistered directory remains**: use the orphan procedure; do not call
  `git worktree remove` again as if it were registered.
- **Context lost**: list worktrees and ask. Never guess.
- **Multiple worktrees**: show them and ask; do not destroy another session's worktree
  without confirmation.
- **Locked worktree**: show the reason and ask before unlocking. A lock may mean another
  agent is active.
- **Background jobs**: stop jobs whose working directory is the target before teardown
  and removal. Stop the process tree, not only the shell (`taskkill /PID <pid> /T /F`, or
  `kill -- -<pgid>`). Verify the allocated ports, and only stop a listener whose command
  line contains the target path.
- **Global permission denied**: treat as a failure; keep the worktree and report the
  denied path. Do not silently fall back.
- **Teardown script missing**: stop and ask the user to re-run setup.
- **Purge path is locked**: report the path and the likely process; do not delete a
  parent directory or use a glob.
- **PR merged with squash or rebase**: the branch is not an ancestor; require explicit
  confirmation and use `-D` with the SHA printed. Keep the state and log.
- **Windows file locks**: stop dev servers, watchers, and package managers before
  removal; retry once after purge. If it still fails, use the orphan procedure only after
  verification.
- **Windows long paths**: use a literal resolved path; `Remove-Item` may need the
  `\\?\` prefix for very long paths.
- **Concurrent destroy**: if the target disappears between checks, re-read
  `git worktree list` and report the actual state; do not delete a path by name.

## Completion criteria

- [ ] The workflow doc, config (when present), integration mode, and cleanup list were
      read.
- [ ] The target was confirmed by the user, not inferred from cwd alone.
- [ ] Target is not the primary and is inside the storage root.
- [ ] Teardown ran; a failure produced a keep/retry/force decision, not a silent removal.
- [ ] Worktree-owned listeners were stopped as process trees; unrelated listeners were
      left alone and reported.
- [ ] Dirty, ignored-artifact, unpushed, unmerged, submodule, and lock gates were checked,
      or the target-local ones were explicitly skipped for a verified orphan.
- [ ] The branch was compared with the integration branch, or with the fetched remote in
      pull-request mode.
- [ ] The session returned to the primary before removal.
- [ ] `teardown --purge` ran, was omitted for schema 1, or its failure was reported.
- [ ] The worktree was removed, or an orphan was verified and deleted, or the user chose
      to leave it with a reason.
- [ ] The copied manifest and state `copied_files` were read when present; purge did not
      delete a copied path.
- [ ] The branch was deleted after successful removal, or kept with a reason.
- [ ] State and the copied manifest were cleared or deliberately kept with a reason;
      `git worktree prune` ran.
- [ ] The final answer ends with the switch-back banner, rendered in the language the user
      is actually writing in.
