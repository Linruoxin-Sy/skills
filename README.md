<div align="center">

**English** · [简体中文](README_zh.md)

</div>

# Git Worktree Skills

Three agent skills for running parallel development work in isolated Git worktrees,
without letting one session's files, branches, or local services collide with another's.

## The skills

| Skill | What it does |
| --- | --- |
| [setup-git-worktree](skills/git-worktree/setup-git-worktree/SKILL.md) | Initializes a repository's worktree workflow. Asks where worktrees, the workflow doc, and scripts live; creates `AGENTS.md`, the workflow doc, `.worktreeinclude`, and project-specific init/teardown scripts; classifies shared versus isolated resources; commits only the setup files. |
| [create-git-worktree](skills/git-worktree/create-git-worktree/SKILL.md) | Takes a concrete requirement, derives one canonical name for both the branch and the worktree leaf, creates the worktree, copies included local files, runs the init script, records state, and moves the session into the worktree. |
| [destroy-git-worktree](skills/git-worktree/destroy-git-worktree/SKILL.md) | Locates the session's worktree, runs teardown, checks dirty files, unpushed commits, merge state, submodules, and locks, then returns to the primary worktree, removes the worktree, deletes the branch when safe, and clears state. |

## Workflow

Run `setup` once per repository, `create` for each task, and `destroy` when the task is
finished.

1. **Set up the repository.** `setup-git-worktree` asks where worktrees live, where the
   workflow document and scripts belong, and which resources need isolation. It writes
   the control plane and commits it.
2. **Create a worktree.** `create-git-worktree` requires a concrete requirement. It
   creates a branch and worktree with the same name, copies `.worktreeinclude` files,
   runs init, and switches the session into the worktree.
3. **Do the work.** The session keeps using the worktree as its command directory and
   absolute paths for file operations.
4. **Destroy the worktree.** `destroy-git-worktree` cleans the environment, checks that
   no work would be lost, returns to the primary worktree, removes the worktree, and
   deletes the branch when safe.

## Requirements

- Git 2.17 or newer.
- An agent that supports Agent Skills (`SKILL.md`).
- A writable project workspace. Project-local worktrees are recommended. Global
  worktree storage lives outside the workspace and may require elevated/full filesystem
  permission; setup stops if writes are denied.
- For generated scripts: Node.js or Python for a single-file script; otherwise
  PowerShell and Bash.

## Design choices

- **One session, one worktree.** A session creates at most one worktree and destroys
  that worktree before creating another. There is no agent-specific session ID; the
  current directory and the conversation context identify the worktree.
- **Branch equals worktree leaf.** One canonical name is used for the branch and the
  leaf directory, so `git worktree list`, branch operations, and cleanup line up.
- **Requirement first.** A worktree is created only after the user states what it is
  for. There is no random scratch name.
- **Control plane and data plane.** `AGENTS.md`, the workflow document, scripts, and
  state metadata live in the primary worktree. The linked worktree holds the code being
  changed.
- **`.worktreeinclude` copies only matching, gitignored files.** Tracked files and
  untracked-but-not-ignored files are not copied. The file is copied after
  `git worktree add` and before init.
- **Setup commits only its own files.** It uses `git commit --only` so the user's staged
  changes are not swept into the setup commit. It does not commit the user's business
  code.
- **Destroy is gated.** Cleanup success is not enough. Dirty files, unpushed commits,
  unmerged branches, dirty submodules, and locks are checked before anything is removed.
- **Shared versus isolated resources.** Stateless external services such as an email API
  key are shared; databases, ports, containers, Redis namespaces, and object-storage
  prefixes are isolated per worktree.

## Installation

Place the three directories under `skills/git-worktree/` where your agent loads skills
from, or point your skill source at this repository. The skills are model-invoked: their descriptions
tell the agent when to run them.

## Scope

The skills generate project-specific scripts, docs, and state at runtime. Those files
belong to each target repository, not to this repository.
