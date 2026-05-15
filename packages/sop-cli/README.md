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
# 1. 初始化项目（写 memory/, .ai-memory/, 多 AI 工具配置, agent.toml 骨架）
sop init my-app --manager https://mgr.example.com

# 2. 配对 Manager（OAuth 浏览器流）
sop login --pair --manager https://mgr.example.com

# 3. 安装 + 启动 agentd 守护进程
sop agentd install
sop agentd start

# 4. 自检（含 Manager、`/api/v1/rag/health` 向量后端探测）
sop doctor

# 5. 状态总览
sop status

# 6. 干活
sop task list --status pending
sop task pull T-123
sop task done T-123 --confidence 0.9

# 6. 通过 Gateway 调 LLM（统一计费/缓存/Fallback）
sop llm chat "总结这次需求" --task-type summarize --cache-ttl 600
sop llm search "JWT 鉴权" -k 8

# 8. 同步与多平台
sop sync                    # agentd 完整同步周期
sop sync pull -o out.json   # 直连 Manager 拉取
sop sync status             # 本地游标 / 实体 / 推送队列
sop platforms doctor        # AI 平台 shim 自检
```

## 数据平面与向量后端

CLI / Agent 与具体向量实现解耦；由 Manager 环境变量控制（`VECTOR_DB_TYPE`、`DATABASE_URL` 等）。  
完整说明见 **[`ai-sop-ops/DATA_AND_VECTOR.md`](../../ai-sop-ops/DATA_AND_VECTOR.md)**（仓库根相对路径）与 **[`docs/architecture/DATA_PLANE.md`](../../docs/architecture/DATA_PLANE.md)**。

## 子命令一览

| 命令 | 作用 |
|------|------|
| `sop init`    | 项目初始化（取代 `init-ai-project.sh`） |
| `sop login`   | 用户名密码登录 / OAuth 配对 |
| `sop status`  | 本地 + Manager 状态总览 |
| `sop agentd`  | 守护进程：start/stop/status/logs/install |
| `sop task`    | 任务：list/pull/done/fail/issue |
| `sop rule`    | 规则：list/propose |
| `sop sync`    | 触发同步（pull+push，需 agentd） |
| `sop sync pull` / `push` / `status` | 直连 Manager 或查看本地状态 |
| `sop platforms` | AI 平台 list / doctor / install-shims |
| `sop memory` / `context` / `kb` / `copilot` | v4 记忆、上下文、知识库、助手 |
| `sop doctor`  | 端到端自检（含 sync、平台） |
| `sop llm`     | LLM Gateway 客户端：chat/embed/search |

每条都支持 `--help`。浏览全部子命令：

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
