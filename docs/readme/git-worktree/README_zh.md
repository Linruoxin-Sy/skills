<div align="center">

[English](README.md) · **简体中文**

</div>

[← 返回全部 Skills](../../../README.md)

# Git Worktree Skills

四个 Agent Skill，用于在隔离的 Git worktree 中并行开发，避免不同会话的文件、分支和本地服务互相干扰。这一组覆盖完整生命周期：初始化仓库、创建 worktree、合并分支、销毁 worktree。

## Skill 一览

| Skill | 作用 |
| --- | --- |
| [setup-git-worktree](../../../skills/git-worktree/setup-git-worktree/SKILL.md) | 初始化仓库的 worktree 工作流。询问 worktree 存放位置、工作流文档和脚本位置、分支如何合并、哪些资源需要隔离；创建 `AGENTS.md`、工作流文档、机器可读配置、`.worktreeinclude`，以及拆分为固定核心和项目 hook 的 init/teardown 脚本；展示 review 报告，只提交 setup 自己产生的文件。 |
| [create-git-worktree](../../../skills/git-worktree/create-git-worktree/SKILL.md) | 根据用户给出的具体需求生成 canonical 名称，branch 与 worktree 叶目录同名；创建并锁定 worktree、复制 `.worktreeinclude` 中的文件、执行 init、记录 schema 2 状态，并把会话切换到 worktree。 |
| [merge-git-worktree](../../../skills/git-worktree/merge-git-worktree/SKILL.md) | 把 worktree 分支合并到集成分支并保留 merge commit，或推送分支并创建 pull request；验证构建、记录 merged commit 或 PR URL，并让 worktree 保持可销毁状态。 |
| [destroy-git-worktree](../../../skills/git-worktree/destroy-git-worktree/SKILL.md) | 不轻信当前目录，先确认目标；执行 teardown、清理隔离产物、检查未提交文件、未推送提交、合并状态、submodule 和 lock；返回主 worktree，删除 worktree 或恢复 orphan 目录，在安全时删除 branch 并清理状态。 |

## 工作流

每个仓库执行一次 `setup`，每个任务执行一次 `create`，工作完成后执行 `merge`，任务结束后执行 `destroy`。

1. **初始化仓库。** `setup-git-worktree` 询问 worktree 存放位置、工作流文档和脚本位置、完成的 branch 如何合并，以及哪些资源需要隔离。它写入控制面文件、运行脚本自检、展示 review 报告，并在用户确认后提交。
2. **创建 worktree。** `create-git-worktree` 要求用户先说明具体需求，然后创建同名 branch 和 worktree，锁定 worktree，复制 `.worktreeinclude` 文件，执行 init，并把会话切换进去。
3. **开发。** 会话后续的命令默认在 worktree 中执行，文件操作使用 worktree 下的绝对路径。
4. **合并。** `merge-git-worktree` 在 direct 模式下用 `--no-ff` 本地合并，或在 PR 模式下推送并创建 pull request；验证构建并记录结果。始终保留 merge commit，不 rebase、不 squash。
5. **销毁 worktree。** `destroy-git-worktree` 清理环境，确认没有会丢失的工作，返回主 worktree，删除 worktree，并在安全时删除 branch。

## 环境要求

- Git 2.17 或更新版本。
- 支持 Agent Skills（`SKILL.md`）的 agent。
- 可写的工作区，**包括仓库的 Git 目录**，因为 `git worktree add`/`remove` 和 worktree lock 都要写 Git 目录。如果 agent 的 sandbox 阻止写 Git 目录，worktree 创建会失败；需要按 host 的要求授权。
- 生成脚本时：Node.js 或 Python 用于单文件核心；其他项目同时生成 PowerShell 和 Bash 脚本。
- PR 模式：`gh`、`glab` 或手动步骤。没有 CLI 时回退为 compare URL。

已有的 schema 1 设置仍可读取；重新运行 `setup-git-worktree` 可以把文档、配置、脚本和状态迁移到 schema 2，并补上合并设置。

## 设计约定

- **一个需求、一个会话、一个 worktree。** 一个会话最多创建一个 worktree，创建下一个之前必须先销毁当前 worktree。不依赖 agent 专属的 session id；用 Git worktree lock 和用户明确确认来识别目标。
- **branch 与 worktree 叶目录同名。** 使用同一个 canonical 名称，方便 `git worktree list`、branch 操作和清理互相对应。
- **先有需求。** 用户说明具体需求后才创建 worktree；没有随机 scratch 名称。
- **控制面与数据面分离。** `AGENTS.md`、工作流文档、配置、脚本和状态元数据放在主 worktree；linked worktree 只放正在修改的代码。
- **`.worktreeinclude` 只复制匹配且被 gitignore 的文件。** tracked 文件和 untracked-but-not-ignored 文件不会复制；复制发生在 `git worktree add` 之后、init 之前。
- **setup 只提交自己的文件。** 使用 `git commit --only`，不会把用户已 staged 的改动一起提交；也不会替用户提交业务代码。生成脚本是 review 过的基线，项目 hook 仍由用户拥有。
- **单一机器可读配置。** 工作流文档的 YAML 块和 `worktree.config.json` 从同一份值生成；脚本读配置，两者不一致时 skill 停止。
- **环境变量归项目所有。** 工作流只写 `env.file`（默认 `.env.worktree`），且只写它管理的 key；绝不写 `.env`、`.env.local` 或其他项目 env 文件。项目在自己的配置里加载 `env.file`。项目本来没有 env 配置时，不生成 env 文件。
- **合并保留 merge commit。** direct 模式使用 `git merge --no-ff`；PR 模式要求平台使用 merge commit。拒绝 rebase 和 squash。
- **destroy 有安全检查。** cleanup 成功不等于可以删除；未提交文件、ignored 产物、未推送提交、未合并 branch、dirty submodule 和 lock 都会先检查。`git worktree remove` 失败后走经过验证的 orphan 流程，而不是无守卫地删除目录。
- **共享与隔离资源。** 邮件 API key 等无状态外部服务可以共享；数据库、端口、容器、Redis 命名空间和对象存储前缀按 worktree 隔离。

## 安装

直接从 GitHub 使用 [Skills CLI](https://npmx.dev/package/skills) 安装 `git-worktree` 这一组 skill：

```bash
npx skills add https://github.com/Linruoxin-Sy/skills/tree/main/skills/git-worktree --list
npx skills add https://github.com/Linruoxin-Sy/skills/tree/main/skills/git-worktree
```

加 `-g` 安装到用户级，而不是当前项目。只安装部分 skill，或指定 agent：

```bash
npx skills add https://github.com/Linruoxin-Sy/skills/tree/main/skills/git-worktree \
  --skill setup-git-worktree \
  --skill create-git-worktree \
  --skill merge-git-worktree \
  --skill destroy-git-worktree \
  -a claude-code
```

不安装、直接试用某个 skill：

```bash
npx skills use https://github.com/Linruoxin-Sy/skills/tree/main/skills/git-worktree \
  --skill setup-git-worktree \
  --agent claude-code
```

把 `claude-code` 换成你的 agent 标识。CLI 需要 Node.js 22.20 或更新版本。四个 skill 都是 model-invoked，由 description 决定何时触发。

## 范围说明

skill 运行时会生成项目专属的脚本、文档、配置和状态；这些内容属于目标仓库，不属于本仓库。
