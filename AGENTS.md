# AGENTS.md

This is a skills set repository.

## Repository structure

- `skills/` holds all skills. One level of nesting is allowed for grouping. A skill's structure must conform to the specification at [Agents Skills Specification](https://agentskills.io/specification).
- `docs/` holds all kinds of documentation.
- `docs/readme/` holds the README for each skill group, and the root README references them.
- `docs/agents/` holds the AGENTS.md for each skill group, and this file references them.

## Agent guides

Each skill group keeps one agent guide at `docs/agents/<group>/AGENTS.md`, mirroring
`skills/<group>/`. A guide records what the group is, what it must not broaden into, the
invariants an edit must not break, and how its skills stay runnable in any agent. Read it
before changing a skill in that group.

They live under `docs/agents/` rather than inside `skills/` because `skills/` is the
published unit: `npx skills add` copies those directories to users, and
repository-maintenance notes should not travel with them.

## Skill groups

- [git-worktree](docs/agents/git-worktree/AGENTS.md)
