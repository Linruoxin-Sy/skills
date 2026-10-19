---
name: setup-git-worktree
description: >-
  Initialize a repository for parallel agent development with git worktrees. Creates the
  AGENTS.md workflow pointer, workflow doc, .worktreeinclude, and project-specific
  init/teardown scripts; asks where worktrees are stored and which resources must be
  isolated. Use when the user asks to set up, install, initialize, or
  configure git worktree support, or wants parallel worktrees in this repository.
compatibility: Requires Git 2.17 or newer and a writable project workspace.
---

# Set Up Git Worktree Workflow

## Outcome

The repository has a complete worktree control plane: an `AGENTS.md` pointer, a
workflow doc, a `.worktreeinclude` file, and init/teardown scripts. The setup artifacts
are committed unless the user declines. No worktree is created by this skill.

This skill is idempotent: running it again reconfigures the same files and preserves
user edits outside the marked sections.

## Words used in this skill

- **Primary worktree**: the main checkout. The control plane lives here.
- **Linked worktree**: a checkout created by `git worktree add`.
- **Control plane**: `AGENTS.md`, the workflow doc, scripts, and state metadata.
- **Data plane**: the files inside a linked worktree.
- **Setup paths**: the exact files this skill creates or edits.
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

Done when the document path is known and inside the repository.

## Step 4 — Ask where the scripts live

Default: `scripts/worktree/`.

- The path must be repo-relative and inside the primary worktree.
- Reject paths inside the worktree storage root or inside `.git`.
- If existing scripts are present, ask before replacing them. Preserve user edits and
  offer to regenerate only the files this workflow owns.

Done when the scripts directory is known and inside the repository.

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

Use local/dev resources. Do not provision cloud or production resources. Do not put
credentials in the workflow doc or scripts; read them from env files.

Done when every shared/isolated resource is named and the user has confirmed the
classification.

## Step 8 — Write init and teardown scripts

Choose the script language in this order:

1. Node project: one `.mjs` file for init and one for teardown. Use only Node built-ins.
2. Python project: one `.py` file for init and one for teardown. Use only the standard
   library.
3. Any other project: generate both `init.ps1`/`teardown.ps1` and
   `init.sh`/`teardown.sh`.

If the chosen runtime is unavailable, say so and ask before falling back. When both
platform scripts exist, record a Windows override and a Unix override in the doc so
create can select the right pair by operating system.

Scripts must satisfy this contract:

```text
<runner> <script> --repo <primary> --worktree <path> --name <name> --json
```

- Run from any directory; resolve all paths from the arguments.
- Never prompt. If input is missing, exit with a clear error.
- Be idempotent. A second run must succeed without duplicating resources.
- Print one JSON object on the last stdout line:
  `{"ok":true,"resources":{...}}` or
  `{"ok":false,"code":<n>,"message":"..."}`.
- Exit codes: `0` success, `2` configuration, `3` dependency install, `4` database,
  `5` port, `6` cleanup, `1` other.
- Log to stderr or to `<common-git-dir>/<state_dir>/logs/<name>.log`.
- Do not start long-running services. Prepare them, and leave starting dev servers to
  the developer or a separate command.

Init responsibilities:

- Install dependencies using the detected package manager.
- Create the isolated database/schema and run migrations and seed data if approved.
- Allocate ports from the configured range and write them into an env file the app
  reads. Env vars exported by the script do not persist between shell calls.
- Create or update the worktree-local env file with the isolated database URL, ports,
  Redis prefix/index, Docker project name, and object-storage prefix.
- Treat files copied by `.worktreeinclude` as inputs. Write generated values to a
  separate env file, or update only documented keys; do not silently overwrite copied
  secrets.
- Do not copy `.worktreeinclude`; the create skill does that before init.

Teardown responsibilities:

- Stop processes and containers started for this worktree.
- Drop the isolated database/schema and remove Docker volumes/networks.
- Release ports and remove generated env files.
- Be safe to run twice, and safe when a resource is already gone.
- Guard destructive operations: only act on names derived from this worktree and only
  when they carry the configured prefix. Never drop a shared or production database.

Done when both scripts exist, are executable by their runner, and pass a dry syntax
check: `node --check <file>`, `python -m py_compile <file>`,
`pwsh -NoProfile -Command "[void][scriptblock]::Create((Get-Content -Raw '<file>'))"`,
or `bash -n <file>`.

## Step 9 — Write the workflow document

Write the document at the path chosen in Step 3. Start it with
`<!-- worktree-workflow-doc v1 -->`, then human-readable prose and one machine-readable
configuration block:

```yaml worktree-config
schema: 1
storage:
  mode: local            # local | global
  root: .worktrees       # repo-relative for local; ~/.worktrees for global
  namespace: ""          # required for global; ignored for local
scripts:
  dir: scripts/worktree
  runner: node           # node | python | pwsh | powershell | bash
  init: init.mjs
  teardown: teardown.mjs
  # Optional platform overrides for dual .ps1/.sh scripts:
  # windows: { runner: pwsh, init: init.ps1, teardown: teardown.ps1 }
  # unix:    { runner: bash, init: init.sh, teardown: teardown.sh }
base_ref: HEAD           # ref new worktrees branch from
include_file: .worktreeinclude
state_dir: worktree-workflow
naming:
  branch: same-as-worktree
resources:
  shared: []
  isolated: []
```

Add prose covering:

- The control-plane/data-plane split and the primary-worktree path.
- How create resolves a worktree path: storage root + namespace (global only) + canonical
  name.
- How to run init and teardown, including the full command and argument order, and both
  platform variants when dual scripts exist.
- The resource classification and the prefix/name convention for isolated resources.
- `.worktreeinclude` semantics: only matching and gitignored files are copied.
- Safety rules: never delete the primary worktree, never run `git clean -x` or
  `git clean -X` in the primary, and never touch resources without the worktree prefix.
- The one-session-one-worktree convention and how to identify the current worktree
  from the current directory.
- Troubleshooting: permission denied on global storage, missing runtime, port in use,
  database auth failure, locked worktree, Windows path length.

`state_dir` is relative to `git rev-parse --git-common-dir`. `base_ref` may be `HEAD`,
a branch, or a remote-tracking ref such as `origin/main`.

Done when the document exists, the YAML block parses, and every key above is present.

## Step 10 — Add the AGENTS.md pointer

Create `AGENTS.md` if absent. Insert or replace exactly one block:

```markdown
<!-- BEGIN worktree-workflow v1 -->
## Worktree workflow

- Workflow doc: <doc path chosen in Step 3>
- A session manages at most one worktree. If the current directory is a linked
  worktree, keep working there and do not create a second one.
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

## Step 11 — Commit the setup artifacts

Stage only the paths this workflow owns. Substitute the actual doc and scripts paths
chosen in Steps 3 and 4, quote paths containing spaces, and omit paths that do not
exist:

```text
git add -- AGENTS.md <doc path> <generated script files> .worktreeinclude .gitignore
```

List the script files you generated, not the whole scripts directory. Add any tool config
files you edited in Step 5. Then commit only those paths:

```text
git commit --only -- AGENTS.md <doc path> <generated script files> .worktreeinclude .gitignore
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

## Step 12 — Verify and report

Verify, in the primary worktree:

- `AGENTS.md` has one marked block and the correct doc path.
- The doc exists and its YAML block has `schema`, `storage`, `scripts`, `base_ref`,
  `include_file`, `state_dir`, and `naming`.
- `.worktreeinclude` exists.
- The scripts exist and their runner is installed.
- For local storage, `git check-ignore -q .worktrees` succeeds.
- The setup commit exists, or the user declined it.

Report:

- Storage mode and absolute root.
- Doc path and scripts path.
- Init and teardown commands.
- Resource classification.
- The setup commit hash.
- Any warning about a missing baseline commit.

## Edge cases

- **Already set up**: detect the `AGENTS.md` block. Ask whether to reconfigure. Do not
  overwrite user-edited scripts without confirmation.
- **Global permission denied**: stop before writing setup files. Ask local or abort.
  Do not leave a half-configured global workflow.
- **Path outside the repository**: reject. The control plane must be versioned with the
  code.
- **Path is gitignored**: reject for the doc and scripts; they must be committed.
- **Bare repository**: stop. Setup needs a primary worktree.
- **Linked worktree**: switch to the primary and run there.
- **Windows**: quote paths; keep the full worktree path under the long-path limit; use
  `pwsh` or `powershell` explicitly and account for ExecutionPolicy.
- **Monorepo**: run at the repository root, not a package directory.

## Completion criteria

- [ ] Primary worktree path is known and setup ran there.
- [ ] Storage mode is chosen; global users were warned about permissions.
- [ ] `.gitignore` ignores `.worktrees/` for local storage.
- [ ] `.worktreeinclude` exists with the explanatory header.
- [ ] Resources are classified as shared or isolated and confirmed by the user.
- [ ] Init and teardown scripts exist and follow the CLI/JSON contract.
- [ ] The workflow doc contains the YAML configuration block.
- [ ] `AGENTS.md` contains exactly one worktree block.
- [ ] Setup artifacts are committed, or the user declined the commit.
- [ ] No worktree was created.
