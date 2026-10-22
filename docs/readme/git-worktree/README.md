<div align="center">

**English** · [简体中文](README_zh.md)

</div>

[← All skills](../../../README.md)

# Git Worktree Skills

Four agent skills for running parallel development work in isolated Git worktrees,
without letting one session's files, branches, or local services collide with another's.
The set covers the whole lifecycle: initialize a repository, create a worktree, land its
branch, and tear it down.

## The skills

| Skill | What it does |
| --- | --- |
| [setup-git-worktree](../../../skills/git-worktree/setup-git-worktree/SKILL.md) | Initializes a repository's worktree workflow. Asks where worktrees, the workflow doc, and scripts live, how branches land, and which resources need isolation; creates `AGENTS.md`, the workflow doc, a machine-readable config, `.worktreeinclude`, and init/teardown scripts split into a fixed core and project hooks; shows a review report and commits only the setup files. |
| [create-git-worktree](../../../skills/git-worktree/create-git-worktree/SKILL.md) | Takes a concrete requirement, derives one canonical name for both the branch and the worktree leaf, creates and locks the worktree, copies included local files, runs the init script, records schema 2 state, and moves the session into the worktree. |
| [merge-git-worktree](../../../skills/git-worktree/merge-git-worktree/SKILL.md) | Lands the branch on the integration branch with a merge commit, or pushes it and opens a pull request, verifies the build, records the merged commit or PR URL, and leaves the worktree ready for destroy. |
| [destroy-git-worktree](../../../skills/git-worktree/destroy-git-worktree/SKILL.md) | Confirms the target instead of trusting the current directory, runs teardown, purges isolated artifacts, checks dirty files, unpushed commits, merge state, submodules, and locks, then returns to the primary worktree, removes the worktree or recovers an orphan, deletes the branch when safe, and clears state. |

## Workflow

Run `setup` once per repository, `create` for each task, `merge` when the work is ready,
and `destroy` when the task is finished.

1. **Set up the repository.** `setup-git-worktree` asks where worktrees live, where the
   workflow document and scripts belong, how completed branches land, and which resources
   need isolation. It writes the control plane, runs script self-checks, shows a review
   report, and commits after the user accepts.
2. **Create a worktree.** `create-git-worktree` requires a concrete requirement. It
   creates a branch and worktree with the same name, locks the worktree, copies
   `.worktreeinclude` files, runs init, and switches the session into the worktree.
3. **Do the work.** The session keeps using the worktree as its command directory and
   absolute paths for file operations.
4. **Land the work.** `merge-git-worktree` either merges with `--no-ff` in direct mode or
   pushes the branch and opens a pull request. It verifies the build and records the
   result. Merge commits are always preserved; the skill never rebases or squashes.
5. **Destroy the worktree.** `destroy-git-worktree` cleans the environment, confirms no
   work would be lost, returns to the primary worktree, removes the worktree, and deletes
   the branch when safe.

## Requirements

- Git 2.17 or newer.
- An agent that supports Agent Skills (`SKILL.md`).
- A writable project workspace, including the repository's Git directory for
  `git worktree add`/`remove` and worktree locks. A sandbox that blocks writes to the Git
  directory will block worktree creation; grant the permission the host requires.
- For generated scripts: Node.js or Python for a single-file core, or PowerShell and Bash
  for platform scripts.
- For pull-request mode: `gh`, `glab`, or manual instructions. The skill falls back to a
  compare URL when no CLI is available.

Existing schema 1 setups remain readable. Re-run `setup-git-worktree` to migrate the
document, config, scripts, and state to schema 2 and to add the landing settings.

## Design choices

- **One requirement, one session, one worktree.** A session creates at most one worktree
  and destroys it before creating another. There is no agent-specific session ID; a Git
  worktree lock and an explicit user confirmation identify the target.
- **Branch equals worktree leaf.** One canonical name is used for the branch and the
  leaf directory, so `git worktree list`, branch operations, and cleanup line up.
- **Requirement first.** A worktree is created only after the user states what it is
  for. There is no random scratch name.
- **Control plane and data plane.** `AGENTS.md`, the workflow document, config, scripts,
  and state metadata live in the primary worktree. The linked worktree holds the code
  being changed.
- **`.worktreeinclude` copies only matching, gitignored files.** Tracked files and
  untracked-but-not-ignored files are not copied. The file is copied after
  `git worktree add` and before init.
- **Copied files are recorded before init.** A manifest under the state directory lists
  every copied path; init and teardown treat those paths as read-only, and purge never
  deletes them.
- **Setup commits only its own files.** It uses `git commit --only` so the user's staged
  changes are not swept into the setup commit. It does not commit the user's business
  code. Generated scripts are a reviewed baseline; project hooks remain the user's.
- **One machine-readable config.** The workflow document's YAML block and
  `worktree.config.json` are written from the same values. Scripts read the config; the
  skills stop when the two disagree.
- **Environment configuration is project-owned.** The workflow writes only
  `env.file` (default `.env.worktree`) and only the keys it manages. It never writes
  `.env`, `.env.local`, or another project env file. The project loads `env.file` in its
  own configuration. If the project has no env configuration, no env file is generated.
- **Landing preserves merge commits.** Direct mode uses `git merge --no-ff`; pull-request
  mode requires the platform to use a merge commit. Rebase and squash are rejected.
- **Destroy is gated.** Cleanup success is not enough. Dirty files, ignored artifacts,
  unpushed commits, unmerged branches, dirty submodules, and locks are checked before
  anything is removed. A failed `git worktree remove` is followed by a verified orphan
  procedure, not an unguarded delete. A listener is stopped as a process tree only when
  its command line references the worktree; an unrelated listener is reported.
- **Shared versus isolated resources.** Stateless external services such as an email API
  key are shared; databases, ports, containers, Redis namespaces, and object-storage
  prefixes are isolated per worktree.

## Installation

Install the `git-worktree` set directly from GitHub with the
[Skills CLI](https://npmx.dev/package/skills):

```bash
npx skills add https://github.com/Linruoxin-Sy/skills/tree/main/skills/git-worktree --list
npx skills add https://github.com/Linruoxin-Sy/skills/tree/main/skills/git-worktree
```

Add `-g` to install at the user level instead of the current project. Install only
selected skills, or target a specific agent:

```bash
npx skills add https://github.com/Linruoxin-Sy/skills/tree/main/skills/git-worktree \
  --skill setup-git-worktree \
  --skill create-git-worktree \
  --skill merge-git-worktree \
  --skill destroy-git-worktree \
  -a claude-code
```

Try a skill without installing it:

```bash
npx skills use https://github.com/Linruoxin-Sy/skills/tree/main/skills/git-worktree \
  --skill setup-git-worktree \
  --agent claude-code
```

Replace `claude-code` with your agent's identifier. The CLI requires Node.js 22.20 or
newer. The four skills are model-invoked: their descriptions tell the agent when to run
them.

## Scope

The skills generate project-specific scripts, docs, config, and state at runtime. Those
files belong to each target repository, not to this repository.
