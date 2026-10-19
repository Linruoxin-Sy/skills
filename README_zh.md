<div align="center">

[English](README.md) · **简体中文**

</div>

# Agent Skills

个人维护的 Agent Skills 集合：每个 skill 都是一组可复用的指令，让 agent 按固定流程完成某一类任务。

## Skill 一览

### git-worktree

在隔离的 Git worktree 中并行开发。

| Skill | 作用 |
| --- | --- |
| [setup-git-worktree](skills/git-worktree/setup-git-worktree/SKILL.md) | 初始化仓库的 worktree 控制面：存储位置、文档、脚本和资源隔离。 |
| [create-git-worktree](skills/git-worktree/create-git-worktree/SKILL.md) | 根据用户说明的需求创建 worktree，并把会话切换进去。 |
| [destroy-git-worktree](skills/git-worktree/destroy-git-worktree/SKILL.md) | 清理环境，检查是否有会丢失的工作，然后把会话返回主 worktree。 |

[阅读 git-worktree 文档](docs/readme/git-worktree/README_zh.md) · [English](docs/readme/git-worktree/README.md)

## 使用方式

每个 skill 是一个包含 `SKILL.md` 的目录。把本仓库设为 agent 的 skill source，或把 skill 目录复制到 agent 加载 skill 的位置。这些 skill 都是 model-invoked，由 description 决定何时触发。

每个 skill set 的环境要求和安装说明放在 `docs/readme/` 下对应的 README 中。
