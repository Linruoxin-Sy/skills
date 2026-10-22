---
name: create-git-worktree
description: >-
  Create an isolated git worktree for the user's stated requirement, copy
  .worktreeinclude files, run the worktree init script, lock the worktree, record schema 2
  state, and move the session into the new worktree. Use when the user wants to start a
  new worktree, create an isolated checkout, or develop a feature in parallel. Requires
  the setup-git-worktree workflow.
compatibility: Requires Git 2.17+, a completed worktree setup, and write access to the storage root and the repository's Git directory.
---

# Create a Git Worktree

## Outcome

A new linked worktree exists on a branch with the same canonical name. Ignored local
files from `.worktreeinclude` are copied in, the project init script has succeeded, the
session's working directory is the new worktree, and the session knows the rules that
keep it there.

## Words used in this skill

- **Requirement**: the user's concrete task. No requirement, no worktree.
- **Canonical name**: one lowercase string used for both the branch and the worktree
  leaf directory.
- **Primary worktree**: the main checkout. It holds the control plane.
- **Linked worktree**: the new checkout. It holds the data plane.
- **Gate**: a preflight check that must pass before creating or reporting success.
- **Include copy**: the step that copies files listed in `.worktreeinclude`.

## Step 0 — Read the contract

In the primary worktree, read `AGENTS.md` and find the block:

```text
<!-- BEGIN worktree-workflow v1 -->
...
<!-- END worktree-workflow v1 -->
```

Take the `Workflow doc:` path from that block. Read the doc and its
`yaml worktree-config` block.

If `AGENTS.md` or the doc is missing, stop and tell the user:

> This repository has no worktree workflow yet. Run the setup-git-worktree skill first.

Do not invent paths, scripts, or storage rules. The doc is the single source of truth.

Parse and validate these keys:

```text
schema                 # 2; accept 1 and derive defaults
config_file
storage.mode, storage.root, storage.namespace
scripts.dir, scripts.init, scripts.teardown, scripts.runner
scripts.core_dir, scripts.hooks_dir
scripts.windows.runner/init/teardown   (optional)
scripts.unix.runner/init/teardown      (optional)
base_ref
include_file
state_dir
naming.branch          # must be same-as-worktree
integration.mode, integration.branch, integration.remote
env.file, env.managed_keys             (optional)
cleanup
```

If `schema` is not `1` or `2`, stop and ask the user to re-run setup. If a required key
is missing, stop and report the key. If `naming.branch` is not `same-as-worktree`, stop
and ask the user to re-run setup; this skill requires branch and worktree leaf to match.

If `config_file` is present, read it and verify it agrees with the document block. On a
mismatch, stop; the workflow configuration is inconsistent and setup must resolve it.

For schema 1, derive `integration.branch` from the primary's current branch
(`git -C <primary> rev-parse --abbrev-ref HEAD`), leave `integration.mode` as `direct`,
and treat `cleanup` as empty. Warn that the setup predates schema 2 and offer to re-run
setup before creating.

Resolve the **effective script set**: on Windows use `scripts.windows` when present; on
Unix-like systems use `scripts.unix` when present; otherwise use the top-level
`scripts.runner`, `scripts.init`, and `scripts.teardown`.

Resolve the primary path with `git worktree list --porcelain` (the first `worktree`
record). Determine whether the current directory is the primary or a linked worktree:

```text
git rev-parse --git-dir
git rev-parse --git-common-dir
```

Different values mean linked. If the current directory is already a linked worktree,
stop: this session already owns a worktree. Ask the user to destroy it first, or to
continue working in it.

If the current directory is the primary but the conversation already records a worktree
path for this session, validate it with `git worktree list --porcelain`. If it still
exists, stop and ask whether to switch to it or destroy it. If it is stale, say so and
continue. The one-session-one-worktree rule applies even when the cwd is still primary.

Done when the config is parsed and the primary path is known.

## Step 1 — Get the requirement

Ask:

> What should this worktree implement? Give me one sentence, including a ticket ID or
> the key feature name.

Do not create a worktree without an answer. There is no scratch or random-hash mode.
If the answer is still vague, ask for a short ASCII name and a one-line description.

Done when you have a concrete requirement sentence.

## Step 2 — Derive the canonical name

Build the name from the requirement:

- Lowercase ASCII.
- Allowed characters: `a-z`, `0-9`, `-`.
- 1–40 characters.
- Must start and end with a letter or digit.
- No consecutive hyphens.
- Reject `.`, `..`, `HEAD`, `main`, `master`, the `base_ref` leaf name, the
  `integration.branch` leaf name, and Windows reserved names (`con`, `prn`, `aux`, `nul`,
  `com1`–`com9`, `lpt1`–`lpt9`).
- Reject names ending in a dot or space.
- Detect names that collide case-insensitively with an existing branch or directory;
  Step 3 decides reuse, suffix, or abort.

Prefer a ticket ID plus a short slug: `proj-123-fix-login`. For a Chinese requirement,
extract an ASCII ticket ID or English words. If none exist, ask the user for a short
ASCII name; do not transliterate automatically.

Resolve:

```text
branch = <canonical name>
local path  = <primary>/<storage.root>/<canonical name>
global path = <storage.root>/<storage.namespace>/<canonical name>
```

For project-local storage, `storage.root` is relative to the primary and `namespace` is
ignored. For global storage, expand `~` to the user's home directory and include the
namespace. The leaf directory and the branch must be the same string.

Validate with:

```text
git check-ref-format --branch <name>
```

If the full Windows path would exceed the long-path limit, shorten the slug and append
a short hash, then use the shortened string for both branch and directory.

Done when the name passes Git and filesystem validation.

## Step 3 — Preflight gate

Run every check. Do not create on a failed gate without an explicit user decision.

**Setup artifacts**

- The doc, the configured config file, the include file, and the effective init and
  teardown scripts exist. If `config_file` is configured, it must exist and match the
  document.
- The effective runner is installed (`node --version`, `python --version`,
  `pwsh -v`, `powershell -v`, or `bash --version`).
- If `env.file` is configured, `git check-ignore -q <env.file>` must succeed. A generated
  env file that can be committed is a setup defect; stop and ask the user to re-run
  setup.

**Repository baseline**

- `git rev-parse --verify HEAD` succeeds. If not, warn:

  > This repository has no baseline commit. The worktree will contain only setup files,
  > not project code.

  Ask whether to continue.
- `git ls-tree -r --name-only HEAD` contains project files, not only the setup paths.
  If it contains only setup files, show the same warning.

**Dirty primary**

Run `git status --porcelain` in the primary. If it is not empty, explain:

> The worktree branches from `<base_ref>`. Uncommitted changes in the primary are not
> included.

Ask the user to choose:

1. Continue from `<base_ref>`.
2. Commit first, then continue.
3. Abort.

Do not stash or commit on the user's behalf unless they ask.

**Base ref**

`git -C <primary> rev-parse --verify <base_ref>` must succeed. Resolve and record the
full commit SHA as `<base_commit>`; the state file and the "commits since creation"
display need a fixed commit, not the symbolic `HEAD`. Prefer `integration.branch` as the
base. If `base_ref` is `HEAD`, warn that the worktree will be based on whatever branch is
checked out, not on the integration branch, and ask whether to use `integration.branch`
instead. If it is a remote-tracking ref that is missing, ask the user to fetch or choose
another ref; do not fetch silently.

**Integration target**

The configured `integration.branch` must resolve locally. If it does not, stop and ask
the user to fetch or re-run setup. This skill does not merge; it records the integration
branch for the later `merge-git-worktree` step.

**Name and path collisions**

- Branch exists: offer reuse/attach only if no worktree has it checked out; otherwise
  offer a new suffix or abort.
- Path exists and is a registered worktree: show its branch and ask whether to switch
  to it instead of creating a new one.
- Path exists but is not registered: ask before removing it; never delete a non-empty
  directory without confirmation.
- Branch is checked out in another worktree: stop.

**Storage**

- The storage root is writable.
- For global storage, warn about elevated/full filesystem permission and repeated
  approval prompts. If a write probe is denied, stop; do not fall back silently.

**Existing worktrees**

If the current session has no worktree in context but `git worktree list` shows linked
worktrees, show them and ask:

1. Switch to an existing worktree (resume).
2. Create a new one.

Do not create a duplicate silently. If the user creates a new one, warn that other
worktrees are based on an older integration head and will need to land through
`merge-git-worktree` before or after this one; the order matters and the user owns it.

Done when all gates pass, or the user chooses to resume an existing worktree. On resume,
skip to the resume section instead of creating a new worktree.

## Step 4 — Create the worktree

```text
git -C <primary> worktree add -b <name> <path> <base_commit>
```

Using the resolved SHA keeps the result stable if the primary moves between preflight and
creation.

- Create parent directories first.
- Quote paths with spaces or non-ASCII characters.
- Do not use `--force`.
- If the branch already exists and has no worktree, ask before using
  `git worktree add <path> <name>` instead of `-b`.

Verify:

```text
git -C <path> rev-parse --show-toplevel
git -C <path> rev-parse --abbrev-ref HEAD
```

The first must equal `<path>`; the second must equal `<name>`.

Lock the worktree to this session:

```text
git -C <primary> worktree lock --reason "worktree-workflow: <name>" <path>
```

The lock is a signal, not a security boundary: destroy must show the reason and ask
before unlocking. If the lock cannot be written because the host blocks writes to the
Git directory, warn that another session could remove the worktree and continue; do not
fail the creation for that reason alone.

Done when the worktree is registered, checked out on the expected branch, and preferably
locked.

## Step 5 — Copy the include file

Read `<primary>/<include_file>` (default `.worktreeinclude`). If it is missing, stop and
tell the user setup is incomplete. If it is empty or comments only, skip the copy loop
but still write the empty manifest described below before running init.

Copy rules:

1. Patterns use `.gitignore` syntax relative to the repository root.
2. Copy only files that match a pattern **and** are ignored by Git.
3. Never copy tracked files.
4. Never copy untracked-but-not-ignored files; tell the user to commit or ignore them.
5. Prefer this candidate list:

   ```text
   git -C <primary> ls-files -z -o -i --exclude-from=<include_file>
   ```

   If that command does not behave as expected, list ignored files with
   `git ls-files -z -o -i --exclude-standard` and match them against the include file
   using the same Git ignore semantics. Do not invent looser matching.

   A candidate from the include-pattern list is copied only if the repository also
   ignores it. Confirm each candidate with
   `git -C <primary> check-ignore -q <relative path>` and skip it if that check fails.

6. A pattern starting with `**/` does not reach files inside a wholly ignored directory
   unless the directory itself matches or the first name after `**/` names a path
   component. When in doubt, name the directory explicitly in the pattern.
7. Reject absolute paths, `..`, `.git`, `.worktrees`, and the storage root.
8. Copy regular files. For a symlink, recreate it only when its target stays inside the
   repository; otherwise skip and warn. Do not follow links outside the repository.
9. Skip a destination that already exists. Create parent directories as needed.
10. If a non-comment pattern matches nothing, warn. The environment may be missing a
    file that init expects.
11. After copying, verify each copied file is still ignored in the new worktree:

    ```text
    git -C <worktree> check-ignore -q <relative path>
    ```

    If a file is not ignored, warn. It may show as untracked and could be committed by
    mistake.
12. Record every copied relative path in `<copied_files>`. State and destroy use the
    list to avoid deleting copied files during cleanup.
13. Never copy `env.file` (default `.env.worktree`); it is generated by init, not
    copied. If `env.file` matches an include pattern, stop and report the setup conflict;
    a generated file and a copied file must not share a path.

Before init, resolve `<common>` with `git -C <primary> rev-parse --git-common-dir` and
make it absolute. Create `<common>/<state_dir>` if needed, then write
`<common>/<state_dir>/<name>.copied.json` atomically:

```json
{"schema": 1, "name": "<name>", "files": ["<relative path>", "..."]}
```

Use an empty `files` array when nothing was copied. This manifest is the read-only input
for init and teardown; it is not committed. If it cannot be written, stop before init:
the scripts cannot protect copied files without it.

If a matched file cannot be copied, stop. The isolation may depend on it. Remove the
worktree only after asking; otherwise leave it for inspection.

Done when every matched file is copied, `<copied_files>` is recorded, and the manifest
exists; the include file may be a no-op.

## Step 6 — Run init

Run the control-plane init script from the new worktree, using the effective runner and
init filename resolved in Step 0:

```text
<runner> <primary>/<scripts.dir>/<init> \
  --repo <primary> --worktree <path> --name <name> \
  --config <primary>/<config_file> \
  --copied-manifest <common>/<state_dir>/<name>.copied.json --json
```

- Set the command working directory to `<path>`.
- If `config_file` is absent (schema 1), omit `--config`; the script reads its own
  defaults. If `config_file` is present, pass it explicitly.
- Pass `--copied-manifest` even when it lists no files. The script must treat every listed
  path as read-only; if it writes one, stop and report a script bug.
- Quote the config and manifest paths when they contain spaces.
- Capture stdout and stderr. Keep the log path.
- Use a generous timeout for dependency installation. If the command times out, treat it
  as a failure and inspect the log.
- The script must not prompt. If it asks for input, stop and report a script bug.
- Parse the last JSON line. Success requires exit code `0` and `"ok": true`.
- If `env.file` is configured, the script may write only that file and only
  `env.managed_keys`. It must not write `.env`, `.env.local`, or any other project env
  file. If it does, stop and report a script bug.
- If no `env.file` is configured, the script must not create an env file. Use the values
  returned in the JSON (for example a port) when running project commands.
- Do not treat the port or env values as persistent shell exports; pass them to each
  command or let the project load `env.file`.

Done when init exits 0 with `"ok": true`.

## Step 7 — Handle init failure

Classify from the exit code and log:

| Exit | Likely cause |
| --- | --- |
| 2 | missing config, env file, or runtime |
| 3 | dependency install, network, registry auth |
| 4 | database connection, permissions, migration |
| 5 | port already in use |
| 6 | cleanup or filesystem lock |
| 1 | other; read the log |

Attempt at most two reversible fixes. Ask before:

- editing tracked files,
- installing system or global packages,
- dropping or resetting a database,
- changing permissions or firewall rules.

If unresolved, report:

- the exact command,
- exit code and last 20 log lines,
- what failed (dependency, database, port, permission),
- concrete next steps.

Then ask whether to:

1. Keep the worktree for debugging.
2. Remove it.

If removing, unlock first (`git worktree unlock <path>`), run teardown when possible, then
`git worktree remove --force`. After the worktree is gone, remove
`<common>/<state_dir>/<name>.copied.json`. If removal leaves a directory behind, follow
the `destroy-git-worktree` orphan procedure; do not recursively delete an unverified path.
Keep the branch unless the user explicitly asks to delete it. Do not write a success
state.

Done when the user chooses keep or remove and the chosen action completes.

## Step 8 — Record state and switch

Resolve the common Git directory and make it absolute:

```text
git -C <primary> rev-parse --git-common-dir
```

If the result is relative, resolve it against `<primary>`. Write
`<common>/<state_dir>/<name>.json` atomically:

```json
{
  "schema": 2,
  "name": "<name>",
  "branch": "<actual branch from git>",
  "path": "<absolute worktree path>",
  "repo_root": "<primary>",
  "primary_root": "<primary>",
  "integration_branch": "<integration.branch>",
  "base_ref": "<base_ref>",
  "base_commit": "<full SHA resolved from base_ref in the primary>",
  "requirement": "<one-line requirement>",
  "created_at": "<ISO 8601 UTC, milliseconds>",
  "lifecycle": "init_ok",
  "init": "ok",
  "teardown": null,
  "merged_commit": null,
  "merged_at": null,
  "pr_url": null,
  "copied_files": ["<relative path>", "..."],
  "pids": [],
  "owner_label": null,
  "resources": {}
}
```

Fill `resources` from the init JSON. Set `copied_files` from Step 5. `pids` is optional:
record background job PIDs when the host exposes them; otherwise leave it empty.
`owner_label` is optional and human-readable, for example the requirement or a name the
user gives; it is never a session ID and never an authorization check. Use absolute paths
with forward slashes and UTC milliseconds so state files are comparable across hosts.

If state cannot be written, continue but warn; Git remains the source of truth for
worktree existence.

Switch the session's working directory to `<path>`. If the agent has no persistent `cd`,
use `<path>` as the working directory for every subsequent shell command and absolute
paths for every file tool.

End the answer with:

```text
This session has switched to the worktree environment.  [in the user's language]
Worktree: <path>
Branch: <actual branch>
Base: <base_ref> (<base_commit short>)
Integration: <integration.branch> (<integration.mode>)
Isolation: <ports / database / containers / other resources>
Land: use the merge-git-worktree skill when the work is ready.
Return: use the destroy-git-worktree skill when finished.
```

The banner's first line must state that the session has switched to the worktree
environment. The English wording above is canonical; the bracketed marker beside it means
the line is emitted in the language the user is actually writing in, not always in
English. Keep the banner at the end and keep its meaning stable, so users and recovery
paths still recognize it in any language.

Done when the state file exists and the session cwd is the worktree.

## Step 9 — Apply the session constraint

From this point until the worktree is destroyed:

- Every shell command uses the worktree as its working directory.
- Every file tool uses an absolute path under the worktree.
- Every Git command uses `git -C <worktree>` for code operations. Only control-plane
  commands (`git worktree list/lock/unlock/remove`, `git branch`) may target the primary.
  Landing is not a create operation: when the user asks to merge, land, push, or open a
  pull request, load the `merge-git-worktree` skill instead of merging from here.
- Every subagent receives the worktree as its `cwd`, and its prompt includes the
  absolute worktree path.
- Every background job uses the worktree as its working directory. Record the job ID and,
  when the host exposes it, the process ID. Before destroy, stop the process tree rather
  than only the shell, and verify the allocated ports have no listener.
  - Windows: `taskkill /PID <pid> /T /F`.
  - POSIX: `kill -- -<pgid>`, or terminate the process group that owns the job.
  - Resolve a listener before stopping it (`Get-NetTCPConnection -LocalPort <port>` plus
    `Get-CimInstance Win32_Process`, or `lsof -nP -iTCP:<port> -sTCP:LISTEN`), and stop
    it only when its command line contains the worktree path.
- Do not edit `.env`, `.env.local`, or any project env file. Only `env.file` is
  workflow-owned.
- Before a new task, verify `git rev-parse --show-toplevel` equals the worktree. If not,
  switch back.
- After context loss, recover the path from the create banner or state file. If neither
  is available, list the worktrees and ask. Do not guess.
- Do not create a second worktree in this session. Destroy the current one first.

Done when the next command runs in the worktree, not the primary.

## Resuming an existing worktree

If the user chooses an existing worktree at the preflight gate:

- Confirm it is registered by `git worktree list --porcelain` and is not the primary.
- Switch to it.
- Do not rerun init unless the user asks or the script is documented as safe to rerun.
- If it is not locked, lock it with the workflow reason. If it is locked with a different
  reason, show the reason and ask before changing it.
- Refresh its state file to schema 2 when possible; preserve `base_commit`, `resources`,
  and `copied_files` if the old state has them.
- Print the same switch banner.

Do not create a new worktree just because the requirement name is similar.

Done when the session is in the resumed worktree, its lock is correct, its state is
refreshed, and the switch banner is printed.

## Edge cases

- **Setup missing**: stop and direct the user to setup-git-worktree.
- **Invalid or stale doc**: stop and ask the user to re-run setup. Do not edit the doc
  from this skill.
- **Doc and config disagree**: stop. The workflow configuration is inconsistent; setup
  must resolve it before a worktree is created.
- **Schema 1 setup**: derive the integration branch from the primary's current branch,
  warn that the setup predates schema 2, and offer to re-run setup. Do not silently
  invent `integration` or `cleanup` values.
- **Env file in `.worktreeinclude`**: stop and report the setup conflict; a generated
  file and a copied file must not share a path.
- **Env file not ignored**: stop and ask the user to re-run setup. A generated env file
  that can be committed is a setup defect.
- **Copied manifest cannot be written**: stop before init. Without the manifest, init
  cannot guarantee that copied files stay read-only.
- **Bare repository**: stop. A primary checkout is required.
- **Unborn HEAD**: warn that the worktree will be empty; require confirmation.
- **Dirty primary**: explain that uncommitted changes are not in the worktree; ask.
- **Name collision**: reuse, attach, suffix, or abort. Do not overwrite.
- **Global permission denied**: stop; report the denied path and the option to grant
  elevated access. Do not silently switch to local.
- **Include copy failure**: stop; keep the worktree for inspection unless the user asks
  to remove it.
- **Init failure**: follow Step 7; no success banner.
- **Lock failure**: warn that another session could remove the worktree; continue. Do
  not fail creation because the host blocks Git-directory writes.
- **Locked worktree**: `git worktree list --porcelain` shows `locked`; show the reason
  and ask before unlocking or removing.
- **Windows**: quote paths, watch path length, and account for file locks from dev
  servers and package managers.
- **Concurrent creation**: another session may create the same name. If the branch or
  path appears between checks, stop and ask; do not retry with `--force`.

## Completion criteria

- [ ] `AGENTS.md`, the workflow doc, and the config were read and validated.
- [ ] A concrete requirement was captured; no random or scratch name was used.
- [ ] Branch and worktree leaf share one canonical name.
- [ ] Every preflight gate passed or the user chose to resume.
- [ ] `git worktree add` succeeded and the worktree is on the expected branch.
- [ ] The worktree is locked, or a lock warning was reported.
- [ ] Files from the configured include file were copied and recorded in
      `copied_files`, or the file was a no-op; the copied manifest existed before init.
- [ ] Init succeeded and its JSON was parsed, or this is a resume and init was
      deliberately skipped.
- [ ] No project env file was written; only `env.file` was touched when configured.
- [ ] Schema 2 state was written under `<common>/<state_dir>/`, or a write warning was
      reported.
- [ ] The session cwd is the worktree, and the switch banner was printed at the end.
