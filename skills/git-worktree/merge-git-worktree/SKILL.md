---
name: merge-git-worktree
description: >-
  Land a completed worktree branch into the repository's configured integration branch.
  Supports direct merge and pull-request modes, preserves merge commits with --no-ff,
  verifies the build, records the merged commit or PR in schema 2 state, and leaves the
  worktree ready for destroy. Use when the user wants to merge, land, or open a pull
  request for a worktree. Requires the setup-git-worktree workflow.
compatibility: Requires Git 2.17+, a completed worktree setup, and write access to the integration branch (direct mode) or its remote (pull-request mode), plus the repository's Git directory.
---

# Merge a Git Worktree

## Outcome

The worktree branch is landed on the integration branch with a merge commit, or a pull
request is open for it. The build has been verified, schema 2 state records the result,
and the worktree is left in place for `destroy-git-worktree`. This skill never rebases,
squashes, or force-pushes.

## Words used in this skill

- **Landing**: moving a completed worktree branch into the integration branch.
- **Integration branch**: the branch configured by setup, normally `main`.
- **Direct mode**: the agent merges locally with `git merge --no-ff`.
- **Pull-request mode**: the agent pushes the branch and opens a PR; a human or CI merges.
- **Merge commit**: a commit with two parents produced by `--no-ff`; the only landing
  shape this skill accepts.
- **Gate**: a preflight or post-merge check that must pass before reporting success.

## Step 0 — Read the contract

Read `AGENTS.md` and the `Workflow doc:` path. Read the doc's `yaml worktree-config`
block. If `config_file` exists, read it too; the document and the config must agree.
Schema 1 has no config file; use the document block and derive the defaults below.

If the setup is missing, stop:

> This repository has no worktree workflow. Run setup-git-worktree first.

Parse `storage`, `scripts`, `base_ref`, `state_dir`, `naming`, `integration`, `cleanup`,
and optional `env`. Validate `schema` 1 or 2. For schema 2, `config_file` is required.
For schema 1, use `integration.branch` from the primary's current branch,
`integration.mode: direct`, and warn that landing settings were derived.

Reject any configuration that does not preserve merge commits: `integration.merge` must
be `merge-commit`, and `integration.pr_merge_method` must be `merge` in pull-request
mode. If the user wants squash or rebase, stop and ask them to change setup; do not
silently rewrite history.

Resolve the primary from the first `worktree` record of `git worktree list --porcelain`.
Locate the target worktree: cwd if it is linked, otherwise the state file named by the
user, otherwise list and ask. Do not guess.

Read the state file if present. Treat a missing `lifecycle` in schema 1 state as
`init_ok`. Require `lifecycle` `init_ok`, `created`, `pr_open`, or `merged`. If `merged`,
report that landing is already recorded and stop. If `pr_open`, skip to the pull-request
verification section; do not push again or open a second PR.

Done when the config is validated and one target worktree is confirmed.

## Step 1 — Preflight

- Target is registered, not the primary, inside the storage root, and its branch equals
  its leaf name.
- `git -C <target> status --porcelain` is empty. If it is not, ask the user to commit or
  discard; do not commit on their behalf.
- Run the project's configured checks that exist (build, lint, test).
  `integration.require_clean_build` defaults to true. Record the exact commands and
  results.
- `git -C <primary> rev-parse --verify <integration.branch>` succeeds.
- If `git -C <primary> merge-base --is-ancestor <branch> <integration.branch>` already
  succeeds, there is nothing to land. Report that and ask whether to continue to
  `destroy-git-worktree` or stop to fix the integration branch; do not create an empty
  merge commit.
- The primary worktree is clean. If it is dirty, stop; do not stash or commit the user's
  changes.
- The integration branch is not checked out in another worktree. If it is, stop; Git
  cannot check it out twice.
- Warn if other worktrees exist: their base is now older than the integration branch and
  they will need the same landing procedure.

Done when every gate passes.

## Step 2 — Choose the mode

Use `integration.mode`.

- `direct`: continue to Step 3.
- `pull-request`: continue to Step 4.
- Missing or unknown: ask the user which mode the repository uses, then record it in the
  document and, when present, the config before continuing. Do not assume direct.

Done when the mode is known.

## Step 3 — Direct merge

Acquire the merge lock configured at `integration.lock` when it is set; resolve a
relative lock path against the primary and create the containing directory if needed.
Create the lock atomically; if it already exists, read its pid, branch, and timestamp and
ask whether it is stale before removing it. If the host cannot create an atomic lock, ask
the user to confirm no other session is landing, and proceed without the lock; say so in
the report. Release the lock on every exit path, including checkout failures, merge
aborts, and failed post-merge checks.

In the primary worktree:

```text
git -C <primary> checkout <integration.branch>
git -C <primary> merge --no-ff <branch> -m "Merge branch '<branch>' into <integration.branch>"
```

- Do not use `--squash`, `--rebase`, `-X ours`, or `-X theirs`.
- If the switch fails because the primary is dirty or the branch is checked out
  elsewhere, stop. Do not force.
- If the merge conflicts, list the conflicted files. Resolve them on the integration
  branch by editing the files and staging the result. Do not discard either side without
  an explicit user decision.
- After resolving, run `git diff --check` to catch conflict markers, then verify the
  merge with `git rev-parse --verify MERGE_HEAD` and commit with `git commit --no-edit`
  (or the prepared message). Do not use `--no-verify` unless the user asks.
- If the conflict is too complex, run `git merge --abort`, release the lock, and report;
  the worktree is untouched.

Verify the result:

```text
git -C <primary> rev-list --parents -n 1 HEAD
```

The first line must contain three SHAs (the merge commit and two parents). Then run the
project's configured checks again on the integration branch. If a required check fails,
do not claim success and do not reset automatically; report the failure and leave the
merge commit for the user to fix or revert.

Release the lock before continuing, and also release it when reporting a failed
post-merge check. Continue to Step 6 only when the landing state is known.

Done when the merge commit exists, the branch is contained, and the post-merge checks
pass.

## Step 4 — Pull-request mode

- Confirm the configured remote exists: `git remote get-url <remote>`.
- If `integration.auto_push` is `ask`, ask before pushing. If `true`, push without asking.
  If the user declines the push, stop without changing the remote.
- Push the branch without force:

```text
git -C <target> push -u <remote> <branch>
```

- If the push is rejected, stop. Do not force-push, and do not rewrite the branch.
- Open the pull request. If a PR already exists for the branch, report its URL instead of
  creating a duplicate:
  - `pr_tool: gh`: `gh pr create --base <integration.branch> --head <branch> --title <title> --body <body>`.
  - `pr_tool: glab`: the equivalent `glab mr create`.
  - `pr_tool: manual`: print the compare URL, base branch, head branch, and a short
    title and body the user can paste.
- If the configured tool is unavailable, fall back to manual instructions; do not fail
  the landing because a CLI is missing.
- Write the state update from Step 6 with `lifecycle: pr_open`, the PR URL, and
  `merged_commit: null`, then stop. Do not merge locally in this mode.
- Tell the user the PR must be merged with a merge commit, not squash or rebase, to match
  `pr_merge_method: merge`.

Done when the branch is pushed and a PR exists or manual PR instructions are printed.

## Step 5 — Verify a pull-request landing

Run this after the user or CI merges the PR.

```text
git -C <primary> fetch <remote>
git -C <primary> merge-base --is-ancestor <branch> <remote>/<integration.branch>
```

- Zero exit: the branch is contained. Record `merged_commit` as the current
  `<remote>/<integration.branch>` head (or the merge commit found on the ancestry path)
  and set `lifecycle: merged`.
- Non-zero exit: the PR may have been squash-merged or rebased, or it is not merged yet.
  Ask the user to confirm the PR state. If it is merged with rewritten commits, record
  `pr_url`, `merged_commit: null`, `lifecycle: merged`, and warn that the branch cannot
  be proven an ancestor; `destroy` will require `-D` and explicit confirmation.
- If the fetch fails, report it; do not claim the landing is verified.

Done when the landing state is recorded or the user decides to wait.

## Step 6 — Update state

Write the state file under `<common>/<state_dir>/<name>.json` atomically. Preserve the
existing fields and add or update the fields below. If no state exists, also write
`name`, `branch`, `path`, `integration_branch`, `resources`, and `lifecycle` so destroy
can find the worktree.

```json
{
  "schema": 2,
  "lifecycle": "merged",
  "merged_commit": "<sha or null>",
  "merged_at": "<ISO 8601 UTC, milliseconds>",
  "pr_url": "<url or null>",
  "integration_branch": "<branch>"
}
```

For pull-request mode that is still open, use `lifecycle: pr_open`, `merged_commit: null`,
`merged_at: null`, and the PR URL. If the state file cannot be written, warn; Git remains
the source of truth.

Done when the state reflects the actual landing state, or a write warning is reported.

## Step 7 — Report

Report:

- branch and integration branch;
- mode: direct or pull request;
- merge commit SHA, or PR URL and required merge method;
- the configured checks run and their results;
- whether the branch is proven contained; if not, why;
- next step: `destroy-git-worktree` after the merge is confirmed.

```text
Landed: <branch> -> <integration.branch>
Mode: direct | pull-request
Merge: <sha> | PR: <url>
Verified: checks | not verified: <reason>
Next: use destroy-git-worktree after the merge is confirmed.
```

Do not print a success banner when a required check failed or the PR is still open; say
what remains.

Done when the report states the landing state, what was verified, and the next step.

## Edge cases

- **Setup missing**: stop and direct the user to setup-git-worktree.
- **Schema 1**: derive direct mode and the primary's current branch; warn and offer to
  re-run setup.
- **Target is the primary**: refuse; only linked worktrees land.
- **Dirty worktree**: stop; do not commit or stash for the user.
- **Dirty primary**: stop; do not stash or commit for the user.
- **Integration branch checked out elsewhere**: stop; Git cannot check it out twice.
- **Merge conflict**: resolve on the integration branch; abort if too complex; release
  the lock in every path.
- **Build fails after merge**: report; do not auto-reset. The merge commit remains for
  the user to fix or revert.
- **Push rejected**: stop; never force-push.
- **PR tool missing**: print manual instructions; do not fail.
- **PR merged with squash or rebase**: confirm, record the rewrite, and let destroy use
  `-D` with the SHA printed.
- **Concurrent landing**: use the merge lock; if stale, ask before removing it.
- **Windows**: quote paths; stop dev servers and watchers before switching branches.
- **No remote in pull-request mode**: stop and ask the user to configure one.

## Completion criteria

- [ ] `AGENTS.md`, the doc, and the config were read and validated.
- [ ] The target worktree was confirmed by the user.
- [ ] The worktree and primary were clean.
- [ ] Direct mode: the integration branch was checked out in the primary. Pull-request
      mode: the integration branch resolved and the remote existed.
- [ ] The configured checks passed before landing; post-merge checks passed in direct
      mode.
- [ ] Direct mode produced a merge commit with two parents; pull-request mode produced a
      PR URL.
- [ ] The branch is proven contained, or the PR-rewrite exception is recorded.
- [ ] State records `lifecycle`, `merged_commit`, `merged_at`, and `pr_url` as applicable.
- [ ] The merge lock was released.
- [ ] The report states what was verified and what remains.
