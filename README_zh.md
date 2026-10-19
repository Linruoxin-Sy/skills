# Git Worktree Skills

三个 Agent Skill，用于在隔离的 Git worktree 中并行开发，避免不同会话的文件、分支和本地服务互相干扰。

## Skill 一览

| Skill | 作用 |
| --- | --- |
| [setup-git-worktree](skills/setup-git-worktree/SKILL.md) | 初始化仓库的 worktree 工作流。询问 worktree 存放位置、工作流文档位置和脚本位置；创建 `AGENTS.md`、工作流文档、`.worktreeinclude` 以及项目专属的 init/teardown 脚本；区分共享资源和隔离资源；只提交 setup 自己产生的文件。 |
| [create-git-worktree](skills/create-git-worktree/SKILL.md) | 根据用户给出的具体需求生成一个 canonical 名称，branch 与 worktree 叶目录同名；创建 worktree、复制 `.worktreeinclude` 中的文件、执行 init、记录状态，并把会话切换到 worktree。 |
| [destroy-git-worktree](skills/destroy-git-worktree/SKILL.md) | 定位当前会话的 worktree，执行 teardown，检查未提交文件、未推送提交、合并状态、submodule 和 lock，然后返回主 worktree、删除 worktree，并在安全时删除 branch、清理状态。 |

## 工作流

每个仓库执行一次 `setup`，每个任务执行一次 `create`，任务结束后执行 `destroy`。

1. **初始化仓库。** `setup-git-worktree` 询问 worktree 存放位置、工作流文档和脚本位置，以及哪些资源需要隔离。它写入控制面文件并提交。
2. **创建 worktree。** `create-git-worktree` 要求用户先说明具体需求，然后创建同名 branch 和 worktree，复制 `.worktreeinclude` 文件，执行 init，并把会话切换进去。
3. **开发。** 会话后续的命令默认在 worktree 中执行，文件操作使用 worktree 下的绝对路径。
4. **销毁 worktree。** `destroy-git-worktree` 清理环境，确认没有会丢失的工作，返回主 worktree，删除 worktree，并在安全时删除 branch。

## 目录结构

```text
.
├── README.md
├── README_zh.md
└── skills/
    ├── setup-git-worktree/
    │   └── SKILL.md
    ├── create-git-worktree/
    │   └── SKILL.md
    └── destroy-git-worktree/
        └── SKILL.md
```

每个 skill 是一个目录，里面有一个包含 YAML frontmatter 和 Markdown 指令的 `SKILL.md`。本仓库不保存项目专属脚本；这些脚本由 `setup-git-worktree` 在目标项目中生成。

## 环境要求

- Git 2.17 或更新版本。
- 支持 Agent Skills（`SKILL.md`）的 agent。
- 可写的工作区。推荐项目本地 worktree；全局 worktree 存储在工作区之外，可能需要 elevated/full filesystem 权限，写入被拒时 setup 会停止。
- 生成脚本时：Node.js 或 Python 用于单文件脚本；其他项目同时生成 PowerShell 和 Bash 脚本。

## 设计约定

- **一个会话一个 worktree。** 一个会话最多创建一个 worktree，创建下一个之前必须先销毁当前 worktree。不依赖 agent 专属的 session id；通过当前目录和会话上下文识别 worktree。
- **branch 与 worktree 叶目录同名。** 使用同一个 canonical 名称，方便 `git worktree list`、branch 操作和清理互相对应。
- **先有需求。** 用户说明具体需求后才创建 worktree；没有随机 scratch 名称。
- **控制面与数据面分离。** `AGENTS.md`、工作流文档、脚本和状态元数据放在主 worktree；linked worktree 只放正在修改的代码。
- **`.worktreeinclude` 只复制匹配且被 gitignore 的文件。** tracked 文件和 untracked-but-not-ignored 文件不会复制；复制发生在 `git worktree add` 之后、init 之前。
- **setup 只提交自己的文件。** 使用 `git commit --only`，不会把用户已 staged 的改动一起提交；也不会替用户提交业务代码。
- **destroy 有安全检查。** cleanup 成功不等于可以删除；未提交文件、未推送提交、未合并 branch、dirty submodule 和 lock 都会先检查。
- **共享与隔离资源。** 邮件 API key 等无状态外部服务可以共享；数据库、端口、容器、Redis 命名空间和对象存储前缀按 worktree 隔离。

## 安装

把 `skills/` 下的三个目录放到 agent 加载 skill 的目录，或让 skill source 指向本仓库。三个 skill 都是 model-invoked，由 description 决定何时触发。

## 范围说明

skill 运行时会生成项目专属的脚本、文档和状态；这些内容属于目标仓库，不属于本仓库。
