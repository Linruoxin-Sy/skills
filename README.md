<div align="center">

**English** · [简体中文](README_zh.md)

</div>

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

[Read the git-worktree documentation](docs/readme/git-worktree/README.md) · [简体中文](docs/readme/git-worktree/README_zh.md)

## Using these skills

Each skill is a directory with a `SKILL.md`. Point your agent's skill source at this
repository, or copy the skill directory into the location your agent loads skills from.
The skills are model-invoked; their descriptions decide when to run them.

Each skill set keeps its own requirements and installation notes in its README under
`docs/readme/`.
