# Runtime contract

Read this when generating or upgrading the workflow. Include this contract in the
workflow document after its configuration block, adapting examples to the chosen paths
and runtime. Create, merge, and destroy read that document directly; they must not need
this installed skill's files at runtime. Generate implementations in the project's
selected runtime, using its standard library. These are lifecycle mechanisms, not a
project build policy or a cloud provisioning framework.

## Configuration and compatibility

Keep config and state `schema: 2`. New setups add `contract_version: 1` to config.
An absent contract version denotes a legacy setup, not version 1. Reject an unknown
version before mutation. The document and machine config must agree, and each must
independently satisfy the contract; equal invalid configurations are still invalid.

- `naming.branch` is `same-as-worktree`. Canonical names contain 1–40 lowercase ASCII
  letters, digits, or hyphens; start/end with a letter or digit; and have no consecutive
  hyphens. Reject `head`, `main`, `master`, base/integration ref leaf names, Windows
  device names (`con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`), and
  case-insensitive collisions. Branch templates and a larger maximum are unsupported.
- Retain required config fields, merge-commit mode, path guards, copied-file protection,
  and managed-env-key ownership. Validate cleanup against copied paths and `env.file`.
- Optional `operations.lock_wait_seconds` defaults to 60; require a finite nonnegative
  number. This is one total acquisition budget, not a budget renewed by each retry.
- Optional `validation.checks` is a list of unique `{name, argv, cwd, phases, required}`
  records. `argv` is a nonempty string array, `cwd` is a repository-relative directory
  (default `.`), `phases` contains `pre_merge` and/or `post_merge`, and `required` is a
  boolean. Resolve cwd inside the checkout being tested; reject escaping paths/symlinks.
  Use argv without implicit shell evaluation; a project may explicitly configure its
  shell as argv. Record only existing project commands or commands the user supplies.
- `integration.require_clean_build` retains its default of true. If the project has a
  build command, require it in both phases unless the user configures otherwise. If no
  applicable check exists, report `not_configured`, never invent a command or claim a
  build passed. An empty list is explicit; an absent list uses documented legacy checks
  and existing project instructions, recording the resolved commands before execution.

Schema 1 documents/states remain readable with the established integration and cleanup
defaults. New cores normalize schema 1 input in memory before validation; without a
machine config, read the document's block using a parser appropriate to the recorded
format, or report an unsupported parser during `--check`, before side effects. Never
silently apply a different config. Upgrade on an authorized setup, not by rewriting a
project's control plane from create/merge/destroy. Old scripts may use the legacy path
described in those skills; they must not be reported as implementing this contract.

## CLI and capability check

Keep the existing CLI and add optional `--operation-id <id>` for a caller-held lock:

```text
<runner> <script> --repo <primary> --worktree <path> --name <name> --json
  [--config <path>] [--copied-manifest <path>] [--operation-id <id>]
  [--check] [--dry-run] [--purge]
```

`--check` and `--dry-run` are side-effect-free: no locks, logs, state, dependency
installation, or resource calls. They support a prospective worktree path that does not
yet exist. Validate config, name, safe resolved paths, runtime and supported arguments;
do not require a copied manifest that create has not written yet. An existing manifest
must parse and satisfy the guards. Live runs require the target/manifest checks already
specified by the skills. The last stdout line on a successful check includes
`{"ok":true,"contract_version":1}`. Missing/unsupported capability is detected before
provisioning. `--purge` on init is a configuration error, including during checks.

The copied manifest is an object, not an array:
`{"schema":1,"name":"<canonical name>","files":["<relative path>"]}`. Require schema 1,
matching name, and a string array of safe paths. Empty copies still use `files: []`.
Reject malformed objects, raw arrays, name mismatches, and paths outside the worktree.
Every listed path is read-only for init/teardown/purge; validate before side effects.

## Locks and resource ownership

Resolve `<common>` with `git rev-parse --git-common-dir` and make it absolute. All
operation metadata lives under `<common>/<state_dir>`:

- `locks/<name>.lock`: one worktree operation at a time, including initialization,
  landing, teardown, purge, and removal. Acquire before reading mutable workflow state.
- `allocation.lock`: short shared allocation/reservation updates only, when needed.
- The configured `integration.lock`: serialize changes to the primary checkout during
  direct landing. Resolve an existing relative setting against the primary; when absent,
  use `<common>/<state_dir>/merge.lock`. All invocations use the same resolved path.

Acquire the target lock first, then the merge or allocation lock; never the reverse.
Do not hold allocation.lock during dependency installation or independent per-worktree
provisioning. The merge lock covers Git changes, post-merge checks, and result recording.
Git's worktree lock is a separate removal signal, not an operation mutex.

Use atomic exclusive creation (exclusive file open or atomic directory creation).
Metadata records `operation_id`, `kind`, `name`, absolute target path, UTC `started_at`,
and optional host/PID for diagnosis. IDs are unique per operation, not session IDs or
authorization proof. While occupied, wait with a small bounded delay/jitter, report the
holder, and stop at the total budget. Only an already-existing lock is contention;
permission and I/O errors fail immediately. An unreadable or incomplete lock is not free.
No supported atomic primitive means stop, not silently continue unlocked.

Never reclaim on age/PID alone. Inspect the process when available, journal, and Git
state, then obtain the user's explicit stale-lock decision. Re-read the observed lock
identity immediately before removal; if it changed, do not remove it. Release only the
lock whose operation ID is still yours, in a finally path. On abrupt termination the
lock may remain; recovery must inspect it rather than assume the operation finished.

A caller retaining a lock across shell calls passes `--operation-id`; the core verifies
that the matching lock exists and leaves it for the caller to release. Delegated init/
teardown adds stages/results to that operation record, preserving the caller's identity
and prior stages; it must not replace the record with an unrelated script-only record.
Without that
argument a standalone script generates its own ID, acquires its lock, and releases it.
An explicit ID with a missing or mismatched lock is an error, never permission to adopt
another operation. This permits shell-only orchestration without a persistent process.

After acquiring a lock, reread state and resource reservations. Persist a resource
reservation/creation intent before provision, then its actual identity and status before
the next step. Repeated init reconciles the same intent with the resource's actual
identity; it never assumes that a failed response means nothing was created. Uncertain
ownership stops for a user decision. Never adopt by name alone or delete a shared
resource. Teardown accepts partial initialization and already-absent owned resources.

## State and operation records

The summary remains `<name>.json`; preserve existing fields and unknown additive fields.
Keep the copied-files manifest at `<name>.copied.json`. Store each operation separately
at `operations/<name>/<operation_id>.json` and safe logs at
`logs/<name>/<operation_id>.log`. Keep prior attempts, including failures. Resource
records must be durable and reachable from the summary or operation record; secrets
belong in the managed env file, never in these diagnostic records.

Atomic writes use a unique sibling temporary file and same-filesystem replacement. If
replacement fails, keep the old file and report the temporary/recovery path; do not
truncate or unlink the old file first. Serialize writes with the target lock. Write the
operation record first, then the summary; these are recoverable writes, not a multi-file
transaction. Preserve the precise Git/resource facts in memory for reporting on error.

| Field | Meaning |
| --- | --- |
| `lifecycle` | `created`, `init_ok`, `pr_pending`, `pr_open`, `merged`, or `destroyed` |
| `init` | `pending`, `failed`, or `ok`; failed initialization stays `created` |
| `operation_id` | Current/latest operation; earlier records remain available |
| `landing` | `pending`, `in_progress`, `conflicted`, `aborted`, `merged`, `unknown`, or `rewritten` |
| `source_sha` | Exact source commit attempted/landed, not a moving branch name |
| `integration_before_sha` | Target commit captured under the merge lock, or null if unknown |
| `merged_commit`, `merged_at`, `pr_url` | Existing fields; only observed merge/PR facts |
| `validation` | `{status, verified_sha, checks}` for post-merge validation |
| `checks` | Append-only evidence within an operation, including pre-merge checks |

`validation.status` is `pending`, `passed`, `failed`, or `not_configured`. Each check
record contains `name`, `argv` (with secrets omitted), absolute `cwd`, `phase`,
`checked_sha`, `required`, UTC `started_at`/`finished_at`, `exit_code` (null on launch
failure), and safe `log_path`. Aggregate `passed` means every required check for that phase passed against that
SHA; explicitly report optional failures. With no checks, use `not_configured`. Never
reuse an old pass after code, config, or the relevant environment changes.

Record `created` before copying/provisioning; advance `init` only after actual results.
Before direct merge, persist `landing: in_progress` and both inputs. Once Git produces a
verified merge commit, immediately record `lifecycle: merged`, `landing: merged`, exact
`merged_commit`, and `validation.status: pending`; checks then update validation. A failed
check does not undo the merge fact. Manual PR instructions use `pr_pending`, with null
`pr_url`/merge fields; only a confirmed PR gets `pr_open`.

Legacy records without evidence mean validation is unknown (normalize to `pending`),
not passed. A missing schema 1 lifecycle may be read as `init_ok` for compatibility, but
does not prove a landing. Before new work, reconcile summary, operation records, Git
registration/refs/MERGE_HEAD, and actual resource identities. Do not fabricate missing
base SHAs, timestamps, ownership, or validation results. If an interrupted operation can
be identified uniquely, resume it under a new lock and record `resumes_operation_id`;
otherwise ask. IDs and state alone never establish user ownership.

If recording intent fails, stop before mutation. If recording an actual result fails,
stop further mutation, attempt a separate recovery record, and report the exact known
SHAs/resource identities and paths without secrets. Never report full workflow success
or retry provisioning/merge blindly. Release only owned locks after this attempt; Git
and resource facts remain authoritative when metadata is incomplete.

## Errors and retry budget

Keep exit codes `0`–`6` and the final-line JSON envelope. Failures retain `ok`, `code`,
and `message`, adding `stage`, `operation`, `category`, `retryable`, `operation_id`, and
`log_path`. A child exit code is `child_exit_code`, not the workflow exit code. A lock
wait exhaustion is code 6/category `lock_busy`; invalid config is code 2. Unclassified
failures are not automatically retryable.

Use allowlisted diagnostics for sensitive commands: preserve stage/category and safe
service error codes, but never forward raw stdout/stderr, connection strings, passwords,
tokens, authorization headers, or secret argv to logs or the final JSON. Redaction must
occur before persistence. For an unsafe message, replace it with a safe summary; do not
rerun a secret-bearing command merely to display raw output.

Read every command's exit status before interpreting output. Empty Git output is clean
only after a successful status command. `merge-base --is-ancestor` has three outcomes:
0 contained, 1 not contained, anything else a command error that stops the gate.

One invocation permits at most two transient retries with bounded backoff and at most
two reversible repairs; count them separately from lock waiting and diagnostics.
Before retrying an operation with possible side effects, reconcile its intent and
actual resources. Deterministic configuration/permission/unsupported-option errors
require a changed condition, not another identical attempt. User authorization for
tracked changes or destructive recovery remains necessary when not already provided.

## Setup verification

In a temporary local repository with fake local hooks, verify config/name rejection,
schema 1 normalization, side-effect-free checks, final JSON/exit codes, partial init
recovery, safe diagnostics, three concurrent allocations, same-target init/teardown
exclusion, bounded waits, and preservation of copied files/unmanaged env keys. Inject
an operation-record write failure and ensure provisioning has not begun. Exercise a
result-write failure and verify recoverable facts remain without a false success.
Do not use real cloud or production resources. Report which runtime/platform variants
were actually exercised and which were only inspected; do not infer portability from
one host's successful run.
