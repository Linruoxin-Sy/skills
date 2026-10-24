---
name: merge-git-worktree
description: >-
  Land a completed worktree branch with a merge commit or open a pull request using
  the repository's configured mode. Validate fixed commits, serialize landing,
  record checks and recover interrupted operations. Use when the user wants to merge,
  land, or open a pull request for a worktree. Requires the setup-git-worktree workflow.
compatibility: Requires Git 2.17+, a completed worktree setup, write access to the integration branch (direct) or its remote (PR), and the repository's Git directory.
---

# Merge a Git Worktree

## Outcome

The branch is landed with a verified merge commit, or its PR/manual follow-up is recorded
accurately. Git landing and project validation are separate facts. The worktree remains
available for the user to retain or destroy. Never rebase, squash, force-push, or decide
project review/CI policy.

## Step 0 — Read the contract and identify the operation

Read the primary's `AGENTS.md`, its `Workflow doc:`, and the `yaml worktree-config`
block. Read `config_file` when present and require agreement. Validate independently:
`storage`, `scripts`, `base_ref`, `state_dir`, `naming`, `integration`, `cleanup`, and
optional `env`, `operations`, `validation`. Require `same-as-worktree` naming,
`integration.merge: merge-commit`, and PR method `merge`.

Accept schema 1/2; schema 2 requires its config file. Schema 1 derives direct mode and
the primary's current branch, warning about derived settings; detached HEAD requires
an explicit integration branch. Read the workflow's runtime contract for
`contract_version: 1`; reject unknown versions. Legacy configurations remain readable:
use the lock/state/check defaults below, preserve unknown facts, and recommend setup
upgrade without inventing script capabilities. Missing setup stops the workflow.

Find the primary using the first worktree record in `git worktree list --porcelain`.
Use a user-named target or a previously confirmed path, verified against Git. A linked
cwd is a candidate, not ownership proof; list and ask when the target is unclear. Reuse
explicit target/retention/push authorization rather than asking the same question again.

Acquire `<common>/<state_dir>/locks/<name>.lock` atomically before reading mutable
summary/operation records. Use the lock rules in Step 3, with kind `merge`; retain this
lock through preflight, result recording, and release on every normal exit. It protects
the target from concurrent init/teardown, not the primary from other landings.

Read `<name>.json` and `operations/<name>/*.json`. Accept `created`, `init_ok`,
`pr_pending`, `pr_open`, `merged`; `created` requires completed init before new landing.
Schema 1 missing lifecycle can normalize to `init_ok`, but missing validation remains
`pending`. Never stop solely because state says `merged`. Reconcile with Git:

- Matching unfinished merge intent: use the recovery path in Step 3.
- Recorded merge: verify the saved source/merge and current refs; resume missing checks.
- Source changed since its recorded direct landing: retain old operation evidence,
  validate the current source as a new landing request. A previous pass does not cover
  new commits. In PR mode use the PR drift handling below instead of opening a new PR.
- Confirmed open PR: verify its current status in Step 5; do not open a duplicate. If its
  head differs from the recorded source, report the change; do not silently push updates.
- Manual PR pending: first check whether the PR now exists, then follow Step 4 or 5.

Done when setup and one target are validated and the current Git/recorded facts are known.

## Step 1 — Validate a fixed source

Every Git invocation must succeed before interpreting output. In particular, empty
status is clean only with exit 0; ancestor checks mean 0 contained, 1 not contained,
and any other exit a command error. On error stop without classifying it as unmerged.

- The target is registered, not primary, within storage, and branch equals leaf name.
- Resolve the full source commit as `source_sha`; verify target HEAD is that commit and
  `git -C <target> status --porcelain` is clean. Do not commit or stash user changes.
  If the user specified an exact validated source, require the current ref to match it;
  do not silently substitute a newer commit or revalidate broader content without that
  change being within the user's request.
- Resolve the integration ref. Reject unrelated unfinished merge/rebase/cherry-pick/
  revert operations in either checkout. Matching interrupted merge recovery is the
  explicit exception in Step 3; never treat an absent operation lock as a clean index.
- Resolve project checks from `validation.checks`. Each record supplies name, argv,
  repository-relative cwd, phases (`pre_merge`, `post_merge`), and required flag. Reject
  escaping cwd and malformed records. For legacy configs use existing documented project
  commands; record the resolved list first. No checks means `not_configured`, not passed.
  `integration.require_clean_build` defaults true: include the existing build in both
  phases unless the user configured otherwise; if absent, report that scope limitation.
- Run pre-merge checks in the target at `source_sha`. Record command, cwd, checked SHA,
  phase, required flag, start/end times, exit code, and safe log location. Do not design
  tests, create validation databases, or reuse old passes automatically.
- Recheck target HEAD/ref and clean status after checks. Any change invalidates the
  result; stop to revalidate the changed source, never merge it on the old evidence.
- For direct mode, primary must be clean and the integration branch must not be checked
  out elsewhere. Recheck these inside the merge lock; this preflight is not a reservation.
- An already-contained source requires reconciliation, not an empty merge. Locate its
  recorded merge and outstanding validation under the lock. If no unique merge is
  provable, report containment with unknown merge provenance; do not invent a merge SHA.

For recovery of an already-landed source, do not rerun pre-merge checks as a substitute
for missing post-merge checks. Step 3 checks the actual integration snapshot instead.

Done when the exact source and check evidence are known, or a recovery path is selected.

## Step 2 — Use the configured mode

Use `integration.mode`: `direct` proceeds to Step 3, `pull-request` to Step 4/5.
Missing/unknown mode is a setup error; ask for setup correction rather than silently
choosing a policy. Do not edit one config view independently from this skill.

Done when the configured landing mode is valid.

## Step 3 — Direct merge and recovery

### Acquire and recheck

After the target lock, acquire the configured `integration.lock`; resolve relative paths
against primary. If absent, use `<common>/<state_dir>/merge.lock`. Use this same default
for legacy setups. Never proceed unlocked when atomic acquisition is unavailable.

Create locks exclusively with metadata: unique operation ID, kind, target/name, UTC
start time, optional host/PID. IDs coordinate one operation, not session ownership.
Only an already-existing lock is contention. Wait with bounded delay/jitter up to
`operations.lock_wait_seconds` (default 60), then report the holder and stop. Permission
or I/O errors fail immediately. Incomplete metadata is occupied, not free. Reclaim only
with the user's explicit stale-lock decision after inspecting Git, records, and any
available process evidence; recheck the observed identity before removal. Never delete
by age alone. Release only locks whose operation ID still matches yours, in finally
paths; a crash may leave locks for explicit recovery.

After both locks are acquired, reread state and Git. Reject unrelated unfinished Git
operations, dirty primary, or an integration branch checked out elsewhere. Verify source
ref and target HEAD still equal the validated SHA and target is still clean. A changed
source must be revalidated outside the merge lock. Checkout the integration branch
without force and record its exact `integration_before_sha`. A target advance since
preflight is normal; use this locked value for containment and parent checks.

Before any merge, atomically persist an operation intent with both SHAs and
`landing: in_progress` as described in Step 6. A failed intent write stops mutation.

```text
git -C <primary> merge --no-ff <source_sha> -m "Merge branch '<branch>' into <integration.branch>"
```

Never use `--squash`, `--rebase`, `-X ours`, or `-X theirs`. Use `--no-verify` only when
the user explicitly asks to bypass a hook. Do not retry a failed merge blindly.

### Conflicts and interruptions

If conflicted, record `landing: conflicted`, both inputs, and conflicted paths. Resolve
on the integration branch without discarding either side absent the user's decision.
Verify `MERGE_HEAD` equals `source_sha`, HEAD equals `integration_before_sha`, all
unmerged index entries are gone, and both `git diff --check` and
`git diff --cached --check` pass; then commit normally.
If too complex, abort while holding the locks. Verify the abort succeeded and record
`aborted`; on abort failure record the actual unfinished state. Never auto-reset.

On reentry with `MERGE_HEAD`, require a uniquely matching recorded intent, unchanged
integration HEAD, matching merge head, expected branch, and user-confirmed target.
Ask whether to resume or abort if that choice was not already supplied. Do not overwrite
unrelated conflict resolutions. If Git has completed but the summary has not, locate
the merge by the saved exact parents on the integration first-parent history. Require
a unique match, or preserve uncertainty and ask. A journal is evidence, not authority
to discard changes. Reject unrelated merges while an unfinished operation remains.

### Record and validate

Immediately capture `merged_commit` and verify exactly two parents, in order:
`integration_before_sha`, `source_sha`. Check containment using the pinned source.
Record `lifecycle: merged`, `landing: merged`, the exact merge SHA/time, and
`validation: {status: pending, verified_sha: null, checks: []}` before running checks.
A parent mismatch is not success; preserve actual Git facts and stop for investigation.

Run configured post-merge checks in primary, still holding both locks. Record the exact
checked SHA; verify HEAD/ref and clean status before and after checks. Never attach a
pass to a snapshot that changed during verification. Required failures record
`validation.status: failed`; the merge remains, and must not be reset automatically.
No checks records `not_configured`. Optional failures are reported explicitly.

If recovering after integration has advanced, first prove the saved merge/source are
contained and run outstanding checks on the current clean integration snapshot under
the lock. Record that newer `verified_sha` and state the scope; never relabel it as a
check of the original merge. Keep the original merge SHA. If source is contained but no
unique original merge can be established, validation may still be recorded for the
current snapshot, but landing provenance stays `unknown`.

Write operation and summary results before releasing either lock. On a result-write
failure, stop further mutation, attempt a separate recovery record, report exact known
SHAs and safe paths, then release only owned locks. Never reread HEAD after release to
fill `merged_commit`. An already-contained branch never gets an empty merge.

Done when Git landing and validation are accurately recorded, or an explicit failure/
recovery report is produced, and both owned locks are released. Full success requires
verified merge provenance and all configured required checks to pass.

## Step 4 — Push and open a pull request

Retain the target operation lock. Confirm the configured remote exists. Use explicit
push authorization already supplied; otherwise follow `integration.auto_push` (`ask` or
true). If declined, stop. Verify source ref/HEAD still equal the checked SHA and status
is clean; push that exact commit without force:

```text
git -C <target> push <remote> <source_sha>:refs/heads/<branch>
```

Verify the remote branch resolves to that SHA. Stop on rejection or changed head; never
force-push or rewrite history. Record `source_sha` before opening the PR so a lost
response can be reconciled. Look for an existing PR matching repository, base, and head
before creating one. Use configured `gh`, `glab`, or manual mode; follow project policy.

For a confirmed PR, save its URL with `lifecycle: pr_open`, `landing: pending`, and null
merge fields. If the tool is unavailable or manual mode is configured, print the compare
URL, base/head, title, and body; record `lifecycle: pr_pending` and null `pr_url`. Printed
instructions are not an open PR. Do not create duplicate PRs after a failed response:
query first, or ask the user when status cannot be determined.

Persist the result and release your target lock. Tell the user that the PR must use a
merge commit. Never merge locally or operate CI in this mode.

Done when the push and confirmed PR, or the pending manual action, are recorded distinctly.

## Step 5 — Verify a pull-request landing

Retain the target lock and fetch the configured remote without checking out primary.
Fetch failure stops verification. Read PR metadata when available, including its actual
merge SHA, repository, base, and merged head SHA. Compare with the recorded source;
changed PR content needs its own evidence, not the old pre-merge pass.

Verify the candidate commit exists, has exactly two parents, has the actual PR head as
second parent, and is an ancestor of the fetched integration ref. Also prove the saved
source is contained. Without platform metadata, locate a unique candidate on the
integration first-parent history with that second parent and the recorded head; if the
identity is ambiguous, retain `landing: unknown` and request confirmation. The latest
remote integration HEAD is never a substitute for the PR's actual merge SHA.

Record the exact merge SHA. Only record its timestamp if obtained from reliable PR/Git
evidence; otherwise keep it null. PR creation/merge does not prove project checks ran.
Use explicit evidence tied to a checked SHA or leave validation pending; this skill does
not operate remote CI or silently alter the primary to execute post-merge checks.

Ancestor exit 1 means not contained, not necessarily squash/rebase. If metadata or the
user confirms an external rewritten merge, record `landing: rewritten`, null
`merged_commit`, the PR URL, and the exception; never call it a verified merge-commit
landing. Destroy still requires its loss gates and explicit force-delete authorization.
Errors other than exit 1 stop. A still-open PR remains open; do not infer its status from
containment alone or create a second PR.

Persist results and release your target lock. New source commits after the PR's recorded
head remain outstanding, even if the PR itself is merged.

Done when the exact PR outcome or remaining uncertainty is recorded without claiming
unobserved verification.

## Step 6 — Persist each transition

This step is used at the transition points above, not after releasing locks. Use schema 2
and preserve the existing identity, base, copied-file, resource, and unknown fields.
If no summary exists, reconstruct only observed identity fields; missing original base
or creation times remain unknown. Never synthesize ownership from the state file.

Write `operations/<name>/<operation_id>.json` first, then `<name>.json`, using unique
sibling temporary files and atomic replacement. Never delete/truncate the prior record
before replacement. A recovery operation records `resumes_operation_id`; preserve old
attempts and check evidence. The workflow doc defines the full record; legacy summaries
can gain these additive fields:

```json
{
  "schema": 2,
  "lifecycle": "merged",
  "operation_id": "<unique operation id>",
  "landing": "merged",
  "source_sha": "<validated source sha>",
  "integration_before_sha": "<locked target sha or null>",
  "merged_commit": "<proven merge sha or null>",
  "merged_at": "<known ISO 8601 UTC milliseconds or null>",
  "pr_url": null,
  "integration_branch": "<configured branch>",
  "validation": {"status": "pending", "verified_sha": null, "checks": []}
}
```

`lifecycle: merged` records Git landing, not validation success. Validation statuses are
`pending`, `passed`, `failed`, and `not_configured`. Missing legacy evidence normalizes
to pending. Unknown provenance uses `landing: unknown`; never fabricate a successful
merge result. Keep checks with their own phase/SHA, cwd, argv, timestamps, exit code,
required flag, and redacted log path. Failed attempts must survive later successes.

Intent-write failure stops mutation. Result-write failure attempts a separate recovery
record and reports the exact known facts; do not claim the workflow is fully recorded.
No file format provides a transaction with Git: recovery always checks Git facts.

Done when the transition is durably recorded or a precise persistence failure is reported.

## Step 7 — Report

Report target and integration branches, mode, fixed source SHA, actual merge SHA or
confirmed PR URL/manual action, containment/provenance, checks and their checked SHA,
validation scope/failures, recovery paths, and any lock/persistence limitations.

Do not claim success when required checks failed, evidence is unknown, or the PR is still
pending/open. If no checks exist, explicitly say validation was not configured. Respect
a user request to retain the worktree; mention destroy only as the authorized next step.

Done when the user can distinguish landed work, verified work, and outstanding actions.

## Completion criteria

- [ ] Config and target were verified; existing authorization was reused where applicable.
- [ ] Source validation was bound to an exact clean commit, or recovery selected explicitly.
- [ ] The configured mode was used; no rebase, squash, force-push, or unsolicited CI policy.
- [ ] Direct mode rechecked Git under target/merge locks and verified both exact parents.
- [ ] PR mode recorded a confirmed URL or pending manual action; verification used the
      actual PR merge commit, never an unrelated later HEAD.
- [ ] Landing and validation facts, failures, and checked SHAs were recorded separately.
- [ ] Recovery reconciled Git/resource facts without duplicating operations or auto-reset.
- [ ] Operation and summary writes preceded release; only owned locks were released.
- [ ] The final report states verification limits, remaining actions, and retention choice.
