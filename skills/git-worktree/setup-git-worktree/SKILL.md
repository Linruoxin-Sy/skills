---
name: setup-git-worktree
description: >-
  Initialize a repository for parallel agent development with git worktrees. Creates the
  AGENTS.md workflow pointer, workflow doc, machine-readable config, .worktreeinclude,
  and project-specific init/teardown scripts; asks where worktrees are stored, how
  completed branches land, and which resources must be isolated. Use when the user asks to
  set up, install, initialize, or configure git worktree support, or wants parallel
  worktrees in this repository.
compatibility: Requires Git 2.17 or newer and a writable project workspace, including the Git directory for worktree operations.
---

# Set Up Git Worktree Workflow

## Outcome

The repository has a complete worktree control plane: an `AGENTS.md` pointer, a workflow
doc, a machine-readable workflow config, a `.worktreeinclude` file, and init/teardown
scripts split into a stable core and project hooks. Setup verifies the generated scripts,
shows a review report, and commits only after the user accepts it. No worktree is created
by this skill.

This skill is idempotent: running it again reconfigures the same files and preserves
user edits outside the marked sections.

## Words used in this skill

- **Primary worktree**: the main checkout. The control plane lives here.
- **Linked worktree**: a checkout created by `git worktree add`.
- **Control plane**: `AGENTS.md`, the workflow doc, the machine-readable config, scripts,
  and state metadata.
- **Data plane**: the files inside a linked worktree.
- **Setup paths**: the exact files this skill creates or edits.
- **Core and hooks**: the generated scripts have a fixed core for arguments, JSON, logging,
  path guards, and cleanup, and a small project hook for dependency, database, port, and
  service logic.
- **Integration branch**: the branch a completed worktree branch lands on.
- **Ask, don't guess**: any environment fact that cannot be read deterministically is a
  question for the user, not an assumption.

## Step 0 — Establish the primary worktree

Run:

```text
git rev-parse --show-toplevel
git rev-parse --git-dir
git rev-parse --git-common-dir
```

- If the first command fails, the directory is not a Git repository. Continue to Step 1.
- If `--git-dir` differs from `--git-common-dir`, the session is inside a linked
  worktree. Setup belongs in the primary worktree. Resolve the primary path from the
  first `worktree` record of `git worktree list --porcelain` and operate there.
- If the repository is bare, stop and tell the user setup requires a non-bare checkout.

Done when you know the absolute primary path and whether Git exists.

## Step 1 — Ensure a Git repository

- If the directory is not a Git repository, run `git init -b main` in the project root.
  If the installed Git does not support `-b`, run `git init` and rename the branch after
  the first commit. If Git itself is not installed, stop and report it.
- Check `git rev-parse --verify HEAD`. If HEAD is unborn, say plainly:

  > This repository has no baseline commit. Setup can commit its own files, but a new
  > worktree will contain only those files, not your project code. Commit your project
  > first if you want worktrees to contain it.

  Ask whether to continue. Do not commit the user's project files on their behalf.
- Check `git --version` is at least 2.17.

Done when Git exists, the primary path is known, and the baseline-commit warning has
been shown when relevant.

## Step 2 — Ask where worktrees are stored

Ask one question with two choices:

1. **Project-local (recommended)**: `<primary>/.worktrees`.
2. **Global**: `~/.worktrees/<namespace>`.

If the user chooses global, warn before proceeding:

> Global worktrees live outside the agent's normal writable workspace. The agent may
> need elevated/full filesystem access, and each command outside the workspace may ask
> for approval again. If permission is denied, setup stops; it does not silently fall
> back to local.

If global is denied, ask whether to switch to local or abort. Do not continue with a
partial global setup.

For global storage, choose `namespace` from the repository directory name, lowercased
and hyphenated. If that namespace already exists for a different repository, append a
short hash of the primary path.

Done when `storage.mode`, `storage.root`, and `storage.namespace` are known and writable.

## Step 3 — Ask where the workflow document lives

Default: `docs/worktree.md`.

- The path must be repo-relative and inside the primary worktree.
- Reject paths inside the worktree storage root or inside `.git`.
- If the file exists and does not contain `<!-- worktree-workflow-doc v1 -->`, ask
  before overwriting. Preserve unrelated content when merging.

Choose the machine-readable config path at the same time. Default:
`<doc dir>/worktree.config.json`. It must be repo-relative, inside the primary worktree,
and outside the storage root and `.git`. The document and the config are two views of one
configuration: setup writes both from the same values and verifies they match.

Done when the document and config paths are known and inside the repository.

## Step 4 — Ask where the scripts live

Default: `scripts/worktree/`.

- The path must be repo-relative and inside the primary worktree.
- Reject paths inside the worktree storage root or inside `.git`.
- If existing scripts are present, ask before replacing them. Preserve user edits and
  offer to regenerate only the files this workflow owns.

Plan the generated layout:

```text
scripts/worktree/
  core/init.<ext>        # fixed workflow core
  core/teardown.<ext>
  hooks/init.<ext>       # project-specific logic the user reviews and owns
  hooks/teardown.<ext>
  init.<ext>             # thin entry point
  teardown.<ext>
```

Done when the scripts directory and the core/hooks layout are known and inside the
repository.

## Step 5 — Ignore the local worktree directory

Only when storage is project-local:

```text
git check-ignore -q .worktrees
```

- If already ignored, leave `.gitignore` alone.
- Otherwise add `.worktrees/` to `.gitignore` with a short comment.
- If `.worktrees` is already tracked, stop and explain that ignoring it will not help;
  the user must remove it from the index first.

Done when `git check-ignore -q .worktrees` succeeds and no tracked files live under it.

### Tool ignores

A project-local `.worktrees/` is still visible to build and test tools even when Git
ignores it. For each tool that already has a config file, add the worktrees directory to
its documented ignore/exclude field. Check only files that exist:

| Tool | Field to update |
| --- | --- |
| TypeScript | `exclude` in `tsconfig.json` |
| ESLint | `ignores` in the flat config, or `.eslintignore` |
| Vitest / Jest | `exclude` / `testPathIgnorePatterns` |
| Vite / Webpack | watch ignore |
| VS Code | `files.watcherExclude` |

Do not create a config file just for this. Do not rewrite unrelated settings. Show the
user the proposed diff before applying it, and include changed config files in the setup
commit.

Done when every existing tool config either excludes `.worktrees` or the user has
accepted a documented exception.

## Step 6 — Create `.worktreeinclude`

Create `<primary>/.worktreeinclude` if absent. If present, leave it in place and only
append detected entries with user confirmation.

The file uses `.gitignore` syntax and lists gitignored files that should be copied into
every new worktree. Tracked files are never copied. Untracked-but-not-ignored files are
not copied either; commit them or add them to `.gitignore` first.

Start the file with a comment block:

```text
# Files copied into every new worktree.
# Syntax: .gitignore patterns, relative to the repository root.
# Only files that match a pattern AND are ignored by git are copied.
# Tracked files and untracked-but-not-ignored files are not copied.
#
# Examples:
# .env
# .env.local
# config/secrets.json
```

An empty file is valid. Never put secret values in this file; list file names only.
Run `git check-ignore -q .worktreeinclude`; a non-zero exit means the file is not
ignored, which is what you want.

Done when `.worktreeinclude` exists at the repository root and is not ignored.

## Step 7 — Analyze the environment and classify resources

Read the project before asking questions. Look for:

| Signal | What it implies |
| --- | --- |
| `package.json`, lockfiles | Node package manager and install command |
| `pyproject.toml`, `requirements.txt`, `uv.lock` | Python environment and install command |
| `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle` | native build tooling |
| `docker-compose.yml`, `compose.yaml` | containers, ports, volumes |
| `.env`, `.env.*`, `config/secrets.*` | local files that may need copying |
| migration directories, seed scripts | per-worktree database setup |
| test config | test database or test containers |

Present a short report, then ask only about facts you cannot read:

- Which database does local development use, and may the setup create/drop isolated
  databases or schemas?
- Which ports does the app bind, and what range may worktrees use?
- Which services are shared (for example an email API key) and which must be isolated
  (database, Redis, Docker project, object-storage prefix)?
- Which env files are local-only and should be listed in `.worktreeinclude`?
- May init run migrations and seed data? Which command?
- Are there long-running services init should prepare but not start?
- How should a completed worktree branch land: direct merge or pull request?
- Which branch is the integration branch, and which remote hosts pull requests?
- Does the project already have env configuration? If so, how is it loaded, and which
  values are worktree-specific?
- Which generated or ignored paths may teardown remove with `--purge`?

Default classification:

| Resource | Default |
| --- | --- |
| Email and stateless third-party API keys | shared |
| Database, migrations, seed data | isolated per worktree |
| Redis | isolated DB index or key prefix |
| Ports | isolated per worktree |
| Docker containers, networks, volumes | isolated project name per worktree |
| Object storage | isolated bucket or prefix |
| Package-manager cache | shared |
| Build cache | isolated, or shared only with locking |

### Integration mode

Ask how a completed worktree branch reaches the integration branch. This is repository
policy the user owns; record it, do not decide it.

1. **Direct merge (default)**: the agent merges the feature branch into the integration
   branch with a merge commit.
2. **Pull request**: the agent pushes the branch and opens a pull request; a human or CI
   merges it on the hosting platform.

Record the integration branch, the remote used for pull requests, the PR tool (`gh`,
`glab`, or manual), and whether the agent may push without asking. Every landing preserves
merge commits: `merge: merge-commit` means `--no-ff`, no rebase, and no squash.

### Environment boundary

Ask whether the project already has environment configuration. The workflow must not own
project environment files.

- **No project env configuration**: generate no env file. Init returns allocated values
  in its JSON; the agent passes them to commands that need them.
- **Existing project env configuration**: generate only `env.file` (default
  `.env.worktree`) for values that exist because of the worktree, such as ports, isolated
  database URLs, Redis prefixes, and object-storage prefixes. Never edit `.env`,
  `.env.local`, or any other project env file. The project owns loading `env.file` in its
  own configuration; the workflow does not write project env files.
- If `env.file` is also matched by `.worktreeinclude`, stop: copied files and generated
  files must not collide.

Record `env.file` and `env.managed_keys` in the config only when env configuration
exists. Omit the `env` block entirely otherwise.

When `env.file` is configured, add it to `.gitignore` with a short comment, verify with
`git check-ignore -q <env.file>`, and stop if it is already tracked. A generated env file
must never be committed.

### Cleanup list

Record which generated or ignored paths teardown may remove with `--purge`, for example
`node_modules` and `dist`. Do not list `env.file`: teardown removes only the keys it
manages and may need to preserve unmanaged keys. Only regenerable paths belong in this
list. Never list a file copied by `.worktreeinclude`.

Use local/dev resources. Do not provision cloud or production resources. Do not put
credentials in the workflow doc or scripts; read them from env files.

Done when the resource classification, integration mode, environment boundary, and
cleanup list are named and confirmed by the user.

## Step 8 — Write init and teardown scripts

Choose the script language in this order:

1. Node project: `.mjs`. Use only Node built-ins.
2. Python project: `.py`. Use only the standard library.
3. Any other project: generate both `init.ps1`/`teardown.ps1` and `init.sh`/`teardown.sh`.

If the chosen runtime is unavailable, say so and ask before falling back. When both
platform scripts exist, record a Windows override and a Unix override in the doc so
create can select the right pair by operating system.

Generate a thin core and a small project hook:

```text
scripts/worktree/
  core/init.<ext>        # fixed: args, JSON, logging, path guards, cleanup, env merge
  core/teardown.<ext>    # fixed: same, plus --purge
  hooks/init.<ext>       # project-specific: dependencies, database, migrations, ports
  hooks/teardown.<ext>   # project-specific: stop services, drop database, release resources
  init.<ext>             # entry point: loads core and hook
  teardown.<ext>         # entry point: loads core and hook
```

The core is the part setup keeps stable across projects. The hook is the part the user
reviews and owns. If the user prefers one file per script, keep the same separation as
two functions and mark the project-specific section with a comment.

Scripts must satisfy this contract:

```text
<runner> <script> --repo <primary> --worktree <path> --name <name> --json [--config <path>] [--copied-manifest <path>] [--purge] [--check] [--dry-run]
```

- Run from any directory; resolve all paths from the arguments and `--config`.
- If `--config` is omitted, default to the config path recorded in the document, or to
  `docs/worktree.config.json`. For schema 1, fall back to the document block.
- `--copied-manifest` points to a JSON file listing files copied by `.worktreeinclude`.
  Treat every listed relative path as read-only: never create, overwrite, or delete it.
- Never prompt. If input is missing, exit with a clear error.
- Be idempotent. A second run must succeed without duplicating resources.
- Print one JSON object on the last stdout line:
  `{"ok":true,"resources":{...}}` or
  `{"ok":false,"code":<n>,"message":"..."}`.
- Exit codes: `0` success, `2` configuration, `3` dependency install, `4` database,
  `5` port, `6` cleanup, `1` other.
- Log to stderr or to `<common-git-dir>/<state_dir>/logs/<name>.log`.
- `--check` validates config, paths, and runtime without side effects.
- `--dry-run` prints planned actions without changing anything.
- `--purge` is teardown-only: remove the paths in the config's `cleanup` list. Init exits
  `2` if it receives `--purge`.
- Validate arguments before acting:
  - `--repo` is the repository root.
  - `--worktree` is an absolute path under the configured storage root and is not the
    primary worktree.
  - `--name` equals the worktree leaf directory name.
  - Reject `..`, `.git`, and paths outside the storage root.
- Do not start long-running services. Prepare them, and leave starting dev servers to
  the developer or a separate command.

Init responsibilities:

- Install dependencies using the detected package manager.
- Create the isolated database/schema and run migrations and seed data if approved.
- Allocate ports from the configured range and return them in JSON.
- If `env.file` is configured, write only that file and only the keys listed in
  `env.managed_keys`. Preserve unmanaged keys. Never write `.env`, `.env.local`, or
  another project env file.
- Treat files copied by `.worktreeinclude` as inputs. Never overwrite a copied file; if
  `env.file` is also matched by `.worktreeinclude`, stop and report the conflict.
- Read `--copied-manifest` when provided, and treat every listed path as read-only. If the
  manifest is absent, compute the copied set from `.worktreeinclude` and the repository's
  ignore rules before writing anything.
- Do not copy `.worktreeinclude`; the create skill does that before init.

Teardown responsibilities:

- Stop processes and containers started for this worktree. Before stopping a listener,
  resolve its PID and command line; only stop a process whose command line references the
  worktree. Terminate the process tree, not just the shell
  (`taskkill /PID <pid> /T /F` on Windows, `kill -- -<pgid>` or the equivalent process
  group on POSIX).
- Drop the isolated database/schema and remove Docker volumes/networks.
- Release ports and remove only the keys this workflow added to `env.file`; delete the
  file only when it contains no unmanaged keys.
- Read `--copied-manifest` when provided, and never delete a listed path.
- Be safe to run twice, and safe when a resource is already gone.
- Guard destructive operations: only act on names derived from this worktree and only
  when they carry the configured prefix. Never drop a shared or production database.
- With `--purge`, remove the config's `cleanup` list after the safety gates. Never remove
  a path outside the worktree, never remove a file recorded as copied, and never purge
  `env.file` wholesale; remove only its managed keys.

Done when both scripts exist, the core and project-hook logic is present (separate files
or clearly separated functions), `--check` passes for both, and a dry syntax check
passes: `node --check <file>`, `python -m py_compile <file>`,
`pwsh -NoProfile -Command "[void][scriptblock]::Create((Get-Content -Raw '<file>'))"`,
or `bash -n <file>`.

## Step 9 — Write the workflow document

Write the document at the path chosen in Step 3. Start it with
`<!-- worktree-workflow-doc v1 -->`, then human-readable prose and one machine-readable
configuration block:

```yaml worktree-config
schema: 2
config_file: docs/worktree.config.json
storage:
  mode: local            # local | global
  root: .worktrees       # repo-relative for local; ~/.worktrees for global
  namespace: ""          # required for global; ignored for local
scripts:
  dir: scripts/worktree
  runner: node           # node | python | pwsh | powershell | bash
  init: init.mjs
  teardown: teardown.mjs
  core_dir: scripts/worktree/core
  hooks_dir: scripts/worktree/hooks
  # Optional platform overrides for dual .ps1/.sh scripts:
  # windows: { runner: pwsh, init: init.ps1, teardown: teardown.ps1 }
  # unix:    { runner: bash, init: init.sh, teardown: teardown.sh }
base_ref: main           # ref new worktrees branch from
include_file: .worktreeinclude
state_dir: worktree-workflow
naming:
  branch: same-as-worktree
integration:
  mode: direct           # direct | pull-request
  branch: main
  remote: origin         # used only by pull-request
  merge: merge-commit    # fixed: --no-ff; no rebase or squash
  require_clean_build: true
  lock: .git/worktree-workflow/merge.lock
  pr_tool: manual        # gh | glab | manual
  pr_merge_method: merge # must be a merge commit
  auto_push: ask         # ask | true
# env:                   # uncomment when the project has env configuration
#   file: .env.worktree
#   managed_keys: []
resources:
  shared: []
  isolated: []
cleanup:                 # removed by teardown --purge
  - node_modules
  - dist
```

Write the same values to the machine-readable config at the path chosen in Step 3. The
document block and the JSON file must be identical in meaning; if they differ, setup is
not complete. The example above uses the default paths; substitute the paths the user
chose in Steps 3 and 4.

Add prose covering:

- The control-plane/data-plane split and the primary-worktree path.
- The document and config are two views of one configuration; the config file is the
  machine-readable source scripts read.
- How create resolves a worktree path: storage root + namespace (global only) + canonical
  name.
- How to run init and teardown, including the full command and argument order, `--config`,
  `--check`, `--dry-run`, and `--purge`, and both platform variants when dual scripts
  exist.
- The resource classification and the prefix/name convention for isolated resources.
- `.worktreeinclude` semantics: only matching and gitignored files are copied.
- The environment boundary: the workflow owns only `env.file`; project env files are the
  project's responsibility.
- Integration mode (direct merge or pull request), the integration branch, and the rule
  that every landing preserves merge commits.
- Landing through the `merge-git-worktree` skill; create and destroy do not merge.
- Safety rules: never delete the primary worktree, never run `git clean -x` or
  `git clean -X` in the primary, never touch resources without the worktree prefix, and
  use `teardown --purge` only after the loss gates pass.
- The one-requirement, one-session, one-worktree convention, worktree locks, and the rule
  that destroy must confirm the target instead of trusting the current directory.
- Orphan recovery after a failed `git worktree remove`: verify the path, the registration,
  the branch merge state, and the absence of processes before deleting a leftover
  directory.
- Troubleshooting: permission denied on global storage or the Git directory, missing
  runtime, port in use, database auth failure, locked worktree, Windows path length.

`state_dir` is relative to `git rev-parse --git-common-dir`. `base_ref` is normally the
integration branch; it may also be a remote-tracking ref such as `origin/main`.

Done when the document exists, the YAML block parses, every key above is present, the
config file matches, and the prose covers integration, environment, cleanup, and orphan
recovery.

## Step 10 — Add the AGENTS.md pointer

Create `AGENTS.md` if absent. Insert or replace exactly one block:

```markdown
<!-- BEGIN worktree-workflow v1 -->
## Worktree workflow

- Workflow doc: <doc path chosen in Step 3>
- One requirement, one session, one worktree. Create it at the start and destroy it in
  the same session.
- A session manages at most one worktree. If the current directory is a linked
  worktree, keep working there and do not create a second one.
- Land completed work with the `merge-git-worktree` skill. Do not merge directly from
  `create-git-worktree` or `destroy-git-worktree`.
- Do not destroy a worktree you did not create unless the user names it and confirms the
  path and branch.
- At the start of a worktree task, verify the worktree root with
  `git rev-parse --show-toplevel`. Use absolute paths for file tools and the worktree
  as the working directory for shell commands.
- Never run `git clean -x`, `git clean -X`, or `git clean -fdx` in the primary
  worktree; `.worktrees/` may contain other worktrees.
- Ask before destroying a worktree. Never delete the primary worktree.
<!-- END worktree-workflow v1 -->
```

Replace the angle-bracket placeholder with the doc path chosen in Step 3. Preserve all
content outside the markers. If the file already has a block with the same markers,
replace only that block.

Done when `AGENTS.md` contains exactly one marked block pointing at the chosen document.

## Step 11 — Generate the setup report and review gate

Write a short report. Print it, and optionally save it next to the workflow document as
`worktree-setup-report.md`; do not commit the report unless the user asks.

The report must list:

- files created or modified;
- the exact init and teardown commands, including platform variants;
- the config path and the workflow document path;
- resources init creates and teardown removes, and what teardown deliberately leaves;
- the `cleanup` list used by `--purge`;
- the integration mode and integration branch, and the PR tool in pull-request mode;
- the environment boundary: whether `env.file` exists and which keys are managed;
- how the scripts consume `--copied-manifest` and which paths are read-only;
- self-check results from `--check` and `--dry-run` on both scripts;
- known assumptions and a short review checklist.

Run the self-checks before asking. Do not claim the generated scripts are correct; say
plainly that they are a reviewed baseline and that the project hooks are the user's to
own. If a check fails, fix the script or report the failure; do not offer the commit while
a self-check fails.

Ask: "Review the report and the project hooks. Commit the setup artifacts?" If the user
declines, leave the files uncommitted and report their paths.

Done when the report is shown, self-checks have run, and the user has chosen commit or
no-commit.

## Step 12 — Commit the setup artifacts

If the user declined the commit in Step 11, skip this step and continue to Step 13;
report the uncommitted setup paths.

Stage only the paths this workflow owns. Substitute the actual doc, config, and scripts
paths chosen in Steps 3 and 4, quote paths containing spaces, and omit paths that do not
exist:

```text
git add -- AGENTS.md <doc path> <config path> <generated script files> .worktreeinclude .gitignore
```

List the script files you generated, including the core and hook files, not the whole
scripts directory. Add any tool config files you edited in Step 5. Then commit only those
paths:

```text
git commit --only -- AGENTS.md <doc path> <config path> <generated script files> .worktreeinclude .gitignore
```

`--only` keeps the user's already-staged changes out of the commit. Rules:

- New files must be added before the commit.
- If any setup path is ignored, stop; the control plane must be committed.
- If the user has local edits to `AGENTS.md` or `.gitignore`, those edits are included;
  tell the user.
- If a pre-commit hook, commit-msg hook, signing, or missing `user.name`/`user.email`
  blocks the commit, report it. Ask before using `--no-verify`.
- Refuse in a detached HEAD, during a merge/rebase/cherry-pick, or with an index lock.
- Use the message `chore(worktree): initialize worktree workflow` unless the user
  chooses another.
- If there is nothing to commit, verify the setup paths are already in HEAD. If they are
  not, setup is incomplete; say so.
- If the user declines the commit, warn that new worktrees will not contain `AGENTS.md`
  or the workflow doc; create can still read them from the primary, but agents inside
  the worktree will not see them.
- Do not push.

Done when `git log -1` contains the setup paths, or the user explicitly declined the
commit. If the commit fails, setup did not complete; do not report success.

## Step 13 — Verify and report

Verify, in the primary worktree:

- `AGENTS.md` has one marked block and the correct doc path.
- The doc exists and its YAML block has `schema: 2`, `config_file`, `storage`, `scripts`,
  `base_ref`, `include_file`, `state_dir`, `naming`, `integration`, and `cleanup`; the
  optional `env` block is present only when the project has env configuration.
- The config file exists and matches the document block.
- `.worktreeinclude` exists.
- The scripts exist with the core and project-hook logic, either as separate files or as
  clearly separated functions; their runner is installed, and `--check` passes for both.
- The scripts accept `--copied-manifest` and document which paths they treat as read-only.
- When `env.file` is configured, it is ignored and not tracked.
- For local storage, `git check-ignore -q .worktrees` succeeds.
- The setup commit exists, or the user declined it.

Report:

- Storage mode and absolute root.
- Doc, config, and scripts paths.
- Init and teardown commands, including `--check`, `--dry-run`, and `--purge`.
- Resource classification, integration mode, environment boundary, and cleanup list.
- The setup commit hash.
- Any warning about a missing baseline commit or a failed self-check.

Done when the verification passes and the report is shown. If the user declined the
commit, say so explicitly and list the uncommitted setup paths.

## Edge cases

- **Already set up**: detect the `AGENTS.md` block. Ask whether to reconfigure. Do not
  overwrite user-edited scripts without confirmation.
- **Schema 1 workflow**: read the old doc and state, derive the integration branch from
  the primary's current branch, and offer to migrate the doc, config, scripts, and state
  to schema 2. Do not silently rewrite a working setup.
- **Doc and config disagree**: stop and show the differing keys. The user must choose
  which value is correct before setup continues.
- **Env file in `.worktreeinclude`**: reject the overlap. A copied file and a generated
  file must not share a path.
- **Self-check fails**: report the exact command and output. Leave the generated files in
  place for inspection; do not commit them as ready.
- **Merge skill unavailable**: setup can still write the workflow, but warn that landing
  has no skill and that the user must merge manually.
- **Global permission denied**: stop before writing setup files. Ask local or abort.
  Do not leave a half-configured global workflow.
- **Path outside the repository**: reject. The control plane must be versioned with the
  code.
- **Path is gitignored**: reject for the doc, config, and scripts; they must be committed.
- **Bare repository**: stop. Setup needs a primary worktree.
- **Linked worktree**: switch to the primary and run there.
- **Windows**: quote paths; keep the full worktree path under the long-path limit; use
  `pwsh` or `powershell` explicitly and account for ExecutionPolicy.
- **Monorepo**: run at the repository root, not a package directory.

## Completion criteria

- [ ] Primary worktree path is known and setup ran there.
- [ ] Storage mode is chosen; global users were warned about permissions.
- [ ] `.gitignore` ignores `.worktrees/` for local storage and `env.file` when configured.
- [ ] `.worktreeinclude` exists with the explanatory header.
- [ ] Resources are classified as shared or isolated and confirmed by the user.
- [ ] Integration mode, integration branch, environment boundary, and cleanup list are
  recorded and confirmed by the user.
- [ ] Init and teardown scripts exist with the core and project-hook logic, either as
  separate files or clearly separated functions, and follow the CLI/JSON contract.
- [ ] The scripts accept `--copied-manifest` and treat every listed path as read-only.
- [ ] `--check` passes for both scripts; `--dry-run` was exercised.
- [ ] The workflow doc contains the schema 2 YAML configuration block.
- [ ] The machine-readable config exists and matches the document block.
- [ ] `AGENTS.md` contains exactly one worktree block, including the landing and
  ownership rules.
- [ ] The setup report was shown, and the user chose commit or no-commit.
- [ ] Setup artifacts are committed, or the user declined the commit.
- [ ] No worktree was created.
