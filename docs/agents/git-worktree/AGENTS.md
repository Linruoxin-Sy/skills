# git-worktree — Agent Guide

Maintenance guide for the `git-worktree` skill set, for an agent about to edit one of the
three skills. It records scope, invariants, and the compatibility rules that keep the set
runnable in any agent.

## What the set is

A framework-agnostic Git worktree manager. It teaches an agent to create a worktree and
the isolated environment that worktree needs, then to tear both down cleanly:

| Skill | Role |
| --- | --- |
| [setup-git-worktree](../../../skills/git-worktree/setup-git-worktree/SKILL.md) | Writes the repository's control plane once: pointer block, workflow doc, `.worktreeinclude`, init/teardown scripts. |
| [create-git-worktree](../../../skills/git-worktree/create-git-worktree/SKILL.md) | Takes one requirement, creates a branch plus worktree, copies included files, provisions the environment. |
| [destroy-git-worktree](../../../skills/git-worktree/destroy-git-worktree/SKILL.md) | Runs teardown, checks for work that would be lost, removes the worktree, keeps or deletes the branch. |

Human documentation lives in [docs/readme/git-worktree/](../../readme/git-worktree/) in
English and Chinese. Keep both current.

## Scope: worktrees only

The set manages worktrees and nothing else. It does not own deployment, CI, release
policy, code review, packaging, or how a project is otherwise built. Dependency
installation and database setup appear only as *worktree-local provisioning*: they exist
to make one worktree isolated, never as repository-wide policy.

When editing, reject a step that manages something outside that boundary — even if it
would be convenient. The skills should stay useful in repositories that solve those
problems differently.

## Framework independence

These skills must behave identically in any agent that can run shell commands and read and
write files. Treat that as a hard requirement, not a preference.

- **Describe capabilities, not tools.** Write "run a shell command", "read the file",
  "switch the working directory". Never name a vendor-specific tool (`Bash`, `Read`,
  `apply_patch`, `todo_write`, or similar); a skill that names one is broken for every
  other agent.
- **Never assume a persistent working directory.** A host may not have one. `create`
  already carries the fallback: use the worktree as the per-command working directory and
  absolute paths for file operations. Every new step must follow the same pattern.
- **Never assume session memory.** Each skill re-reads `AGENTS.md` and the workflow doc
  instead of trusting context from an earlier skill. Recovery rules say "ask", never
  "guess".
- **Never assume host features.** Background jobs, subagents, task lists, approval
  prompts, hooks, and structured questions may all be used when a host has them, but a
  skill must still complete on a plain shell-only path. Mark the fallback explicitly when
  you rely on one.
- **No vendor-only frontmatter.** Keep `name`, `description`, and `compatibility` from the
  specification at https://agentskills.io/specification. Nothing else gates loading.
- **The control-plane file is a plain convention.** The workflow block goes into the
  target repository's `AGENTS.md`; the skills then read that file. No step may depend on a
  specific host reading it, because `create` and `destroy` read it directly anyway.

## Cross-skill contract

The three skills are one system. Editing one side without the others produces a workflow
that silently half-works.

- The `<!-- BEGIN worktree-workflow v1 -->` … `<!-- END worktree-workflow v1 -->` block,
  with its `Workflow doc:` line: written by `setup`, parsed by `create` and `destroy`.
- The workflow doc's `<!-- worktree-workflow-doc v1 -->` marker and `yaml worktree-config`
  block with `schema: 1`, including `storage`, `scripts`, `base_ref`, `include_file`,
  `state_dir`, `naming`.
- The script CLI `<runner> <script> --repo … --worktree … --name … --json`, its exit
  codes `0`–`6`, and the final-line JSON.
- The state file `<common>/<state_dir>/<name>.json`, `schema: 1`, with `name`, `branch`,
  `path`, `base_ref`, `base_commit`, `resources`.
- One session, one worktree; branch name equals worktree leaf.
- The closing banners: `create` prints `本次会话已切换到 worktree 环境。`, `destroy` ends
  with `本次会话已切换回 main worktree`. Both are matched by users and by recovery paths.

A change to any item above must land in all three `SKILL.md` files, both READMEs, and this
guide in the same edit.

## Review checklist

- Every step still ends with a `Done when …` sentence, and the completion criteria list
  matches the steps.
- No new step names a specific agent, tool, or host feature without a plain-shell
  fallback.
- Paths stay quoted; Windows long-path limits and file locks remain addressed.
- No gate was relaxed: requirement before creation, no `--force` without confirmation,
  teardown before removal, all loss gates before `git worktree remove`.
- The scope section still holds: worktrees and their local environment only.
