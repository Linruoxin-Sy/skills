# Agent Skills

A personal collection of Agent Skills: reusable instructions that give an agent a
repeatable workflow for a specific kind of task.

[github.com/Linruoxin-Sy/skills](https://github.com/Linruoxin-Sy/skills)

## Skill sets

### git-worktree

Run parallel development sessions in isolated Git worktrees.

| Skill | What it does |
| --- | --- |
| [setup-git-worktree](skills/git-worktree/setup-git-worktree/SKILL.md) | Initializes a repository's worktree control plane: storage, docs, scripts, and resource isolation. |
| [create-git-worktree](skills/git-worktree/create-git-worktree/SKILL.md) | Creates a worktree from a stated requirement and moves the session into it. |
| [destroy-git-worktree](skills/git-worktree/destroy-git-worktree/SKILL.md) | Cleans the environment, checks for work that would be lost, and returns the session to the primary worktree. |

[Read the git-worktree documentation](docs/readme/git-worktree/README.md)

## Using these skills

This repository is a skills source for the [Skills CLI](https://npmx.dev/package/skills)
(`npx skills`), which supports Claude Code, Codex, Cursor, OpenCode, and other agents.

Install every skill in the collection directly from GitHub:

```bash
npx skills add Linruoxin-Sy/skills --list
npx skills add Linruoxin-Sy/skills
```

Add `-g` to install at the user level instead of the current project. Target a specific
agent with `-a`:

```bash
npx skills add Linruoxin-Sy/skills -g -a claude-code
```

Replace `claude-code` with your agent's identifier. The CLI requires Node.js 22.20 or
newer. The skills are model-invoked; their descriptions decide when to run them.

To install only one skill set or a specific skill, use that set's README. Each set keeps
its own requirements and installation notes under `docs/readme/`.
