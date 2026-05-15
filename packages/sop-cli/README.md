# sop-cli

> ai-team-devops **统一命令行**：`sop` 一个命令通杀。

## 如何获得 `sop` 命令

`sop` 由本包 `pyproject.toml` 的 `[project.scripts]` 注册，安装 **sop-cli**（依赖 **sop-sdk**）后出现在 Python 环境的 `bin/` 目录。

| 场景 | 命令 |
|------|------|
| **本仓开发（推荐）** | 在仓库根目录：`bash scripts/build-sop.sh --venv .venv && source .venv/bin/activate` |
| **Make 快捷** | `make build-sop` 或 `make install-sop` |
| **uv workspace** | `uv sync`（根目录 `pyproject.toml` 已含 dev 组 sop-cli）后 `source .venv/bin/activate` |
| **一键 bootstrap** | `bash ai-sop-ops/bootstrap-dev.sh` |
| **仅打 wheel** | `bash scripts/build-sop.sh --wheel` → `pip install dist/sop_*.whl` |
| **PyPI / 离线包** | `pip install "sop-cli[all]"`（需已发布或本地 wheel） |

验证：

```bash
which sop          # 例如 .venv/bin/sop
sop --help
sop doctor
```

若 `command not found`：确认已 `source .venv/bin/activate`，或将 `$(python3 -m site --user-base)/bin` 加入 `PATH`。

## 安装

```bash
# 仓库根目录
bash scripts/build-sop.sh

# 或手动 pip 可编辑安装
pip install -e packages/sop-sdk-python -e "packages/sop-cli[all]"
```

## 快速上手

```bash
# 1. 一键初始化并注册到 Manager（推荐新工程使用）
sop register my-app --manager https://mgr.example.com --username admin

# 也可分步初始化项目（写 memory/, .ai-memory/, 多 AI 工具配置, agent.toml 骨架）
sop init my-app --manager https://mgr.example.com

# 2. 分步模式下配对 Manager（OAuth 浏览器流）
sop login --pair --manager https://mgr.example.com

# 3. 安装 + 启动 agentd 守护进程
sop agentd install
sop agentd start

# 4. 自检（含 Manager、`/api/v1/rag/health` 向量后端探测）
sop doctor

# 5. 状态总览
sop status

# 探测远端能力；不可用时 CLI 会尽量使用本地文件兜底
sop context services
sop context manifest --write

# 6. 干活
sop requirement create "统一项目注册流程" --priority P1 --acceptance "sop register 可一键接入"
sop requirement list --priority P1
sop issue create "登录回调异常" --severity P1 --type bug
sop sprint create "MVP 闭环" --points 20
sop work next --local
sop task list --status pending
sop task create "实现登录页 SSO 对接" --priority P1 --assignee Coder
sop task pull T-123
sop task done T-123 --confidence 0.9

# 6. 通过 Gateway 调 LLM（统一计费/缓存/Fallback）
sop llm chat "总结这次需求" --task-type summarize --cache-ttl 600
sop llm search "JWT 鉴权" -k 8

# 8. 同步与多平台
sop sync                    # agentd 完整同步周期
sop sync doctor             # 本地同步自检
sop sync repair --dry-run   # 预览队列修复
sop sync compact            # 压缩本地离线队列
sop sync flush              # 直连 Manager 冲刷本地离线队列
sop sync enqueue-file specs docs/spec.md --remote-path demo/spec.md
sop sync pull --direct --materialize  # 直连拉取并物化到 .sop-runtime/sync/entities
sop sync pull -o out.json   # 直连 Manager 拉取
sop sync status             # 本地游标 / 实体 / 推送队列
sop platforms init all      # 按 registry 生成 CLI/IDE/Agent 接入文件
sop platforms doctor        # AI 平台 shim 自检
sop ops health              # health-check.sh
sop ops stack doctor        # 本地栈 + sop doctor
```

## 数据平面与向量后端

CLI / Agent 与具体向量实现解耦；由 Manager 环境变量控制（`VECTOR_DB_TYPE`、`DATABASE_URL` 等）。  
完整说明见 **[`ai-sop-ops/DATA_AND_VECTOR.md`](../../ai-sop-ops/DATA_AND_VECTOR.md)**（仓库根相对路径）与 **[`docs/architecture/DATA_PLANE.md`](../../docs/architecture/DATA_PLANE.md)**。

## 子命令一览

| 命令 | 作用 |
|------|------|
| `sop init`    | 项目初始化（取代 `init-ai-project.sh`） |
| `sop register` | 一键初始化、注册 Manager、生成各 CLI/IDE/Agent 接入配置 |
| `sop login`   | 用户名密码登录 / OAuth 配对 |
| `sop status`  | 本地 + Manager 状态总览 |
| `sop agentd`  | 守护进程：start/stop/status/logs/install |
| `sop requirement` | 需求：list/create/update/delete；Manager 不可用时写本地离线队列 |
| `sop issue`   | 问题/缺陷：list/create/update/resolve/delete；支持本地离线队列 |
| `sop sprint`  | 迭代：list/create/update/complete/progress/delete；支持本地离线队列 |
| `sop work`    | 聚合工作台：summary/list/next；支持远端优先和本地离线视图 |
| `sop task`    | 任务：list/create/update/pull/done/fail/delete/issue；支持本地离线队列 |
| `sop rule`    | 规则：list/propose |
| `sop sync`    | 触发同步（pull+push，需 agentd） |
| `sop sync pull` / `push` / `enqueue` / `push-file` / `enqueue-file` / `doctor` / `repair` / `compact` / `flush` / `status` | 直连 Manager、离线入队、物化远端数据、自检/修复/压缩/冲刷本地队列或查看本地状态 |
| `sop platforms` | AI 平台 list / init / doctor / install-shims |
| `sop memory` / `context` / `kb` / `copilot` | v4 记忆、上下文、知识库、助手；memory 支持 add/search/recent/forget/summarize/attach-run |
| `sop ops` | 运维：health/stack/deploy/snapshot/notify/worker |
| `sop doctor`  | 端到端自检（含 sync 本地队列、manifest、平台） |
| `sop llm`     | LLM Gateway 客户端：chat/embed/search |

每条都支持 `--help`。浏览全部子命令：

本地优先与远端增强：`sop requirement`、`sop task`、`sop issue`、`sop sprint`、`sop kb search/add`、`sop rule list/propose` 会优先调用 Manager；远端不可达时自动回退到 `.sop-runtime/local/`、`sop/custom/`、`.ai-memory/rules/`、`ai-sop/` 等本地资产。连接 Manager 后可用 `sop sync`、`sop sync enqueue-file`、`sop sync doctor`、`sop sync repair`、`sop sync compact`、`sop sync flush`、`sop sync pull --materialize`、`sop sync push-file` 或 `sop kb index` 更新远端数据。各 IDE/CLI/Agent 可读取 `sop context manifest --write` 生成的 `.sop-runtime/project_manifest.json` 完成标准接入。

```bash
sop commands              # 表格
sop commands --examples   # 含常用流程
sop commands --json       # 机器可读
```

## Shell 自动补全

支持 **bash / zsh / fish**（Typer/Click 动态补全 + 可选静态 bash 增强）。

```bash
# 持久安装（写入 shell 配置）
sop completion install bash
sop completion install zsh

# 当前终端临时启用
eval "$(sop completion show bash)"

# 静态增强（子命令 / 常用 flag，仅 bash）
source packages/sop-cli/sop_cli/completions/sop.bash

# 检查补全环境
sop completion doctor
```

顶层 Typer 选项（**自动检测当前 shell**，不接收 bash/zsh 参数）：

```bash
sop --install-completion    # 写入 ~/.bashrc 等
sop --show-completion       # 打印当前 shell 的补全脚本
```

指定 shell 时请用 `sop completion install bash` / `sop completion show bash`。

完整同步与多平台说明见 **[`ai-sop-ops/SYNC_AND_PLATFORMS.md`](../../ai-sop-ops/SYNC_AND_PLATFORMS.md)**。

## 故障排查

| 现象 | 处理 |
|------|------|
| `sop: command not found` | `make build-sop` 后 `source .venv/bin/activate` |
| doctor — **sop-agentd IPC** 失败 | `make build-agentd && sop agentd start` |
| doctor — **sync API** 跳过 | 正常；执行 `sop login --pair` 启用 sync |
| doctor — **Manager 连通** 失败 | `bash ai-sop-ops/start-manager.sh` |
| `sop sync` 提示 agentd 未运行 | `sop agentd start` |

失败时 `sop doctor` 会列出修复建议。完整说明：**[`docs/TOOLS_AND_SCRIPTS.md`](../../docs/TOOLS_AND_SCRIPTS.md)**。
