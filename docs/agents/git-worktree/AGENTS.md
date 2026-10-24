# git-worktree — Agent Guide

Maintenance guide for the `git-worktree` skill set, for an agent about to edit one of the
four skills. It records scope, invariants, and the compatibility rules that keep the set
runnable in any agent.

## What the set is

A framework-agnostic Git worktree manager. It teaches an agent to create a worktree and
the isolated environment that worktree needs, land its branch, and tear both down
cleanly:

| Skill | Role |
| --- | --- |
| [setup-git-worktree](../../../skills/git-worktree/setup-git-worktree/SKILL.md) | Writes the repository's control plane once: pointer block, workflow doc, machine-readable config, `.worktreeinclude`, and init/teardown scripts with project hooks; runs self-checks, shows a report, and commits after review. |
| [create-git-worktree](../../../skills/git-worktree/create-git-worktree/SKILL.md) | Takes one requirement, creates a branch plus worktree, copies included files, provisions the environment, locks the worktree, and records schema 2 state. |
| [merge-git-worktree](../../../skills/git-worktree/merge-git-worktree/SKILL.md) | Lands the branch on the integration branch with a merge commit, or opens a pull request, verifies the build, and records the result. |
| [destroy-git-worktree](../../../skills/git-worktree/destroy-git-worktree/SKILL.md) | Confirms ownership, runs teardown, purges isolated artifacts, checks for work that would be lost, removes the worktree, and keeps or deletes the branch. |

Human documentation lives in [docs/readme/git-worktree/](../../readme/git-worktree/) in
English and Chinese. Keep both current.

## Scope: worktrees and landing

The set owns worktrees, their local environment, and **landing their branches** using the
repository's configured mode. It does not own deployment, CI, release policy, code
review, packaging, or how a project is otherwise built. Dependency installation and
database setup appear only as *worktree-local provisioning*: they exist to make one
worktree isolated, never as repository-wide policy.

Landing is in scope only because a worktree's lifecycle ends with its branch either
merged or discarded. The **mode** — direct merge or pull request — is chosen by the user
during setup and recorded in the config. The merge skill executes that choice; it does
not decide review policy, required checks, or who may merge.

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
- **Never assume session memory or a session ID.** Each skill re-reads `AGENTS.md` and the
  workflow doc instead of trusting context from an earlier skill. Ownership is confirmed
  by the user and by a Git worktree lock, never by a session identifier. Recovery rules
  say "ask", never "guess".
- **Never assume host features.** Background jobs, subagents, task lists, approval
  prompts, hooks, and structured questions may all be used when a host has them, but a
  skill must still complete on a plain shell-only path. Mark the fallback explicitly when
  you rely on one.
- **No vendor-only frontmatter.** Keep `name`, `description`, and `compatibility` from the
  specification at https://agentskills.io/specification. Nothing else gates loading.
- **The control-plane file is a plain convention.** The workflow block goes into the
  target repository's `AGENTS.md`; the skills then read that file. No step may depend on a
  specific host reading it, because `create`, `merge`, and `destroy` read it directly
  anyway.
- **Environment configuration is project-owned.** The workflow may write only
  `env.file` (default `.env.worktree`) and only the keys it manages. It never writes
  `.env`, `.env.local`, or another project env file.

## Cross-skill contract

The four skills are one system. Editing one side without the others produces a workflow
that silently half-works.

- The `<!-- BEGIN worktree-workflow v1 -->` … `<!-- END worktree-workflow v1 -->` block,
  with its `Workflow doc:` line and the landing and ownership rules: written by `setup`,
  parsed by `create`, `merge`, and `destroy`.
- The workflow doc's `<!-- worktree-workflow-doc v1 -->` marker and `yaml worktree-config`
  block with `schema: 2`, including `config_file`, `storage`, `scripts`, `base_ref`,
  `include_file`, `state_dir`, `naming`, `integration`, `cleanup`, and the optional `env`
  block.
- The machine-readable config file named by `config_file`. It mirrors the document block;
  setup writes both and the skills stop when they disagree. New setups add
  `contract_version: 1`, `operations.lock_wait_seconds`, and `validation.checks`.
  Both config views must independently pass the contract, including same-name/1–40
  character naming; equality alone is insufficient. Missing contract version denotes
  legacy input, not evidence that new script capabilities exist.
- The script CLI
  `<runner> <script> --repo … --worktree … --name … --json [--config …] [--copied-manifest …] [--operation-id …] [--purge] [--check] [--dry-run]`,
  its exit codes `0`–`6`, and the final-line JSON. The generated scripts separate a fixed
  core from project hooks.
- Setup's [runtime contract](../../../skills/git-worktree/setup-git-worktree/references/runtime-contract.md)
  is included in the target workflow document. Consumers read it there, not through a
  sibling skill installation. New cores advertise `contract_version: 1` in a
  side-effect-free `--check` that accepts prospective worktree paths. Legacy readers
  preserve schema 1/2 and report unsupported script capabilities before provisioning.
- Per-target operation locks cover init, landing, and teardown/removal. Shared allocation
  locks are short; merge locks cover primary changes, post-merge checks, and recording.
  Acquire target first, then shared lock; reread state under locks. Atomic acquisition,
  bounded waits, error classification, caller-held operation IDs, identity-checked
  release, and explicit stale-lock recovery are required. These are not Git worktree
  locks or session ownership tokens.
- The copied-files manifest `<common>/<state_dir>/<name>.copied.json`, schema 1, with
  `name` and `files`. Create writes it before init and passes it to both scripts; every
  listed path is read-only for init and teardown. Destroy removes it with the state file.
- The state file `<common>/<state_dir>/<name>.json`, `schema: 2`, with `name`, `branch`,
  `path`, `integration_branch`, `base_ref`, `base_commit`, `lifecycle`, `copied_files`,
  `resources`, and the optional `pids`/`owner_label`. Readers accept schema 1 and derive
  the missing integration and cleanup values.
- Additive state fields `init`, `operation_id`, `landing`, `source_sha`,
  `integration_before_sha`, and `validation` distinguish progress, Git landing, and check
  evidence. `created` may have pending/failed init; `pr_pending` means only manual
  instructions; `merged` does not imply passed checks. Missing legacy evidence remains
  unknown/pending. Operation records at `operations/<name>/<id>.json` and safe logs at
  `logs/<name>/<id>.log` survive failures. Write intent before mutation and results before
  releasing locks, using unique temporary files and atomic replacement. Recovery checks
  Git/resource identities; it never invents a base SHA or trusts status alone.
- One requirement, one session, one worktree; branch name equals worktree leaf. Create
  locks the worktree; destroy confirms the target with the user and shows the lock reason
  before unlocking.
- Landing preserves merge commits: `integration.merge: merge-commit`, `--no-ff`, no
  rebase, no squash. Direct mode merges locally; pull-request mode pushes and opens a PR.
  `merge` records `lifecycle: merged` or `pr_open`, `merged_commit`, `merged_at`, and
  `pr_url` only for proven facts; manual instructions use `pr_pending` and null `pr_url`.
  Direct landing pins the validated source, rechecks under locks, and verifies both exact
  parents. PR landing records the actual PR merge, never an unrelated later remote HEAD.
- `validation.checks` records only project-owned commands (`name`, `argv`, `cwd`,
  `phases`, `required`). Evidence includes the checked SHA and safe logs; no checks means
  `not_configured`. The group does not design application tests or operate CI. Git exit
  errors must not be interpreted as clean status or an ordinary negative ancestor result.
- Existing user choices and retention instructions are reused after current-fact checks;
  uncertain ownership and new loss decisions still require confirmation. Retention does
  not permit a second worktree in the same session or bypass destroy gates.
- The closing banners: `create` prints `This session has switched to the worktree
  environment.`, `destroy` ends with `This session has switched back to the main
  worktree.` Both lines carry a marker to render them in the language the user is actually
  writing in; their English wording is canonical. Both are matched by users and by recovery
  paths, so keep their meaning and position stable even when translated.

A change to any item above must land in all four `SKILL.md` files, the root README, both
group READMEs, and this guide in the same edit.

## Tests

[`tests/git-worktree/env-file-regression.mjs`](../../../tests/git-worktree/env-file-regression.mjs)
is a scratch-worktree fixture for the env contract. It writes `FOO=bar` plus the first
managed key into `env.file`, runs init and teardown, and asserts that the unmanaged key
survives while the managed key is added and removed. It lives in the repository's `tests/`
tree, not next to this guide, so it does not ship with the skills; run it manually against
a target worktree.

## Review checklist

- Every step still ends with a `Done when …` sentence, and the completion criteria list
  matches the steps.
- No new step names a specific agent, tool, host feature, or session ID without a
  plain-shell fallback.
- Paths stay quoted; Windows long-path limits and file locks remain addressed.
- No gate was relaxed: requirement before creation, no `--force` without confirmation,
  teardown before removal, all loss gates before `git worktree remove`, and no rebase or
  squash on landing.
- Environment ownership still holds: only `env.file` is written, and only its managed
  keys.
- The config, document block, and state schema still agree; schema 1 remains readable.
- Config equality is not a substitute for contract validation. Recorded landing and
  validation SHAs remain accurate after interruption or another branch lands.
- The scope section still holds: worktrees, their local environment, and landing only.
