# Agent Skills

A personal collection of Agent Skills: reusable instructions that give an agent a
repeatable workflow for a specific kind of task.

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

This repository is installable with the [Skills CLI](https://npmx.dev/package/skills)
(`npx skills`), which supports Claude Code, Codex, Cursor, OpenCode, and other agents.

List the skills in the `git-worktree` set:

```bash
npx skills add ./skills/git-worktree --list
```

Install the set into the current project. Add `-g` to install at the user level instead:

```bash
npx skills add ./skills/git-worktree
```

Install selected skills, or target a specific agent:

```bash
npx skills add ./skills/git-worktree \
  --skill setup-git-worktree \
  --skill create-git-worktree \
  --skill destroy-git-worktree \
  -a claude-code
```

Try a skill without installing it:

```bash
npx skills use ./skills/git-worktree \
  --skill setup-git-worktree \
  --agent claude-code
```

Replace `claude-code` with your agent's identifier. The CLI requires Node.js 22.20 or
newer. The skills are model-invoked; their descriptions decide when to run them.

If you prefer not to use the CLI, each skill is a directory containing a `SKILL.md`;
place the directory where your agent loads skills from.

Each skill set keeps its own requirements and installation notes in its README under
`docs/readme/`.
