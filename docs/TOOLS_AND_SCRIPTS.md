# 脚本与工具使用指南

> 平台仓 **ai-team-dev-spec** 中 Shell、Make、`sop` CLI、`sop-agentd` 的统一入口说明。  
> 运维脚本细节见 [ai-sop-ops/SCRIPTS.md](../ai-sop-ops/SCRIPTS.md)；Web 后台见 [USER_MANUAL.md](USER_MANUAL.md)。

---

## 一、我该用哪条路径？

| 目标 | 推荐命令 |
|------|----------|
| **只装 `sop` 命令** | `make build-sop` 或 `bash scripts/build-sop.sh --venv .venv` |
| **CLI + agentd + 自检** | `make dev-env` 或 `bash scripts/dev-env.sh` |
| **全量开发（含 Manager 依赖）** | `bash ai-sop-ops/bootstrap-dev.sh` |
| **业务项目初始化** | `sop init <name>` 或 `bash ai-sop-ops/init-ai-project.sh <name>` |
| **启动 Manager API** | `bash ai-sop-ops/start-manager.sh`（:8765） |
| **启动项目侧守护进程** | `sop agentd start`（需先构建 agentd） |
| **端到端健康检查** | `sop doctor` 或 `bash ai-sop-ops/sop-ctl.sh doctor` |
| **日常运维（备份/启停/修复）** | `bash ai-sop-ops/sop-ctl.sh help` |
| **Docker 部署 Manager** | `make deploy-up` 或 `bash scripts/deploy.sh up single` |
| **本地开发栈（Manager 后台）** | `make stack-start` / `make stack-health` |

---

## 二、平台仓脚本（`scripts/` + `Makefile`）

### `scripts/build-sop.sh`

安装 **sop-sdk** + **sop-cli**，可选构建 **sop-agentd**。

```bash
bash scripts/build-sop.sh --help

# 常用
bash scripts/build-sop.sh --venv .venv          # 创建 venv 并安装
bash scripts/build-sop.sh --agentd --verify     # 含 Go 二进制
bash scripts/build-sop.sh --doctor              # 安装后自检
bash scripts/build-sop.sh --start-agentd        # 安装后启动 agentd
bash scripts/build-sop.sh --all                 # agentd + verify + doctor
bash scripts/build-sop.sh --wheel               # 仅打 wheel 到 dist/
bash scripts/build-sop.sh --uv                  # 强制 uv sync
```

**Make 等价：**

| Make | 作用 |
|------|------|
| `make build-sop` | 可编辑安装 + `sop --version` |
| `make build-all` | CLI + agentd 构建 |
| `make wheel-sop` | 构建 wheel |
| `make dev-env` | 调用 `scripts/dev-env.sh` |
| `make doctor` | `sop doctor` |
| `make start-agentd` / `make stop-agentd` | 守护进程启停 |
| `make bootstrap-dev` | `ai-sop-ops/bootstrap-dev.sh` |

### `scripts/dev-env.sh`

本地开发一键准备：**venv + CLI + agentd 构建 + doctor**，可选安装 Manager Python 依赖。

```bash
bash scripts/dev-env.sh
bash scripts/dev-env.sh --start-agentd    # 顺带启动 agentd
bash scripts/dev-env.sh --skip-manager    # 不装 Manager
SOP_DEV_VENV=.venv bash scripts/dev-env.sh
```

### `scripts/deploy.sh`

Docker 部署 Manager（封装 `apps/manager/docker-compose.*.yml`）。

```bash
bash scripts/deploy.sh print single          # 仅打印建议命令
bash scripts/deploy.sh up single             # compose up -d --build
bash scripts/deploy.sh down single
bash scripts/deploy.sh logs single
SECRET_KEY=<强随机> PROJECT_PATH=$(pwd) bash scripts/deploy.sh up saas
```

**Make：** `make deploy-up` / `make deploy-down`（默认 single 模式）。

**sop-ctl 等价：** `bash ai-sop-ops/sop-ctl.sh deploy up single`（兼容旧用法 `deploy single` → print）。

### `scripts/stack.sh`

本地开发栈：Manager 后台启停 + 可选 agentd + 健康检查。

```bash
bash scripts/stack.sh start
bash scripts/stack.sh start --agentd
bash scripts/stack.sh stop
bash scripts/stack.sh status
bash scripts/stack.sh doctor
```

**Make：** `make stack-start` / `make stack-stop` / `make stack-health` / `make health-check`。

---

## 三、统一 CLI：`sop`

安装后位于 venv 的 `bin/sop`（或 `uv run sop`）。

### 安装验证

```bash
source .venv/bin/activate
which sop
sop --help
sop doctor
```

若 `command not found`：确认已 `source .venv/bin/activate`，或运行 `make build-sop`。

### 推荐工作流（v2）

```bash
# 1. 平台仓准备环境
make dev-env && source .venv/bin/activate

# 2. 启动 Manager（另开终端）
bash ai-sop-ops/start-manager.sh

# 3. 在业务项目目录
cd /path/to/your-app
sop init my-app --manager http://localhost:8765
sop login --pair
sop agentd install    # 可选：macOS launchd / Linux systemd
sop agentd start
sop doctor

# 4. 日常
sop status
sop task list --status pending
sop sync
sop platforms doctor
```

### 子命令速查

| 命令 | 作用 |
|------|------|
| `sop init` | 项目初始化（memory、.ai-memory、多 IDE 配置、agent.toml） |
| `sop login` | 登录 / OAuth 配对 |
| `sop agentd` | 守护进程 start/stop/status/logs/install |
| `sop doctor` | 端到端自检（含 Manager、RAG、agentd IPC、平台 shim） |
| `sop sync` | 触发同步（优先经 agentd IPC） |
| `sop task` | 任务 list/pull/done/fail/issue |
| `sop platforms` | 多 AI 平台 list/doctor/install-shims |
| `sop memory` / `context` / `kb` / `copilot` | v4 记忆与助手 |
| `sop llm` | LLM Gateway：chat/embed/search |

每条支持 `sop <cmd> --help`。详见 [packages/sop-cli/README.md](../packages/sop-cli/README.md)。

### 命令发现与 Shell 补全

```bash
sop commands --examples       # 命令树 + 常用流程
sop completion install bash   # 安装 Tab 补全（bash/zsh/fish）
eval "$(sop completion show bash)"   # 当前会话临时启用
sop completion doctor         # 检查补全是否就绪
```

构建时可选安装补全：`bash scripts/build-sop.sh --completion` 或 `make install-completion`。

### `sop doctor` 检查项与修复

| 检查项 | 常见原因 | 修复 |
|--------|----------|------|
| memory/current_state.json | 未 init | `sop init <project>` |
| .ai-memory/ | 未 init | 同上 |
| AI 工具配置 | 缺少 IDE 配置 | `init-ai-project.sh` 或 `sop init` |
| AI 平台适配 | hook shim 缺失 | `sop platforms install-shims <id>` |
| Manager 连通 | API 未启动 | `start-manager.sh` |
| sync API | 未配对 | `sop login --pair` |
| sop-agentd IPC | agentd 未运行 | `sop agentd start` |
| RAG 向量后端 | Manager 环境变量 | 见 [DATA_AND_VECTOR.md](../ai-sop-ops/DATA_AND_VECTOR.md) |

失败时 `sop doctor` 会打印 **修复建议** 列表。

---

## 四、sop-agentd（Go 守护进程）

路径：`apps/agent-runtime/`。

```bash
# 构建
make build-agentd
# 或
cd apps/agent-runtime && make build

# 运行（须在项目根，或设置 PROJECT_PATH）
export PROJECT_PATH=$(pwd)
./apps/agent-runtime/bin/sop-agentd

# 推荐：经 CLI
sop agentd start
sop agentd status
sop agentd logs -n 100
sop agentd stop
```

**职责：** 心跳上报、sync pull/push、本地 outbox、Unix socket IPC（hooks / `sop sync`）。

IPC socket：`<项目根>/.sop-runtime/agentd.sock`。

详见 [apps/agent-runtime/README.md](../apps/agent-runtime/README.md)、[SYNC_AND_PLATFORMS.md](../ai-sop-ops/SYNC_AND_PLATFORMS.md)。

---

## 五、ai-sop-ops Shell 工具

| 脚本 | 说明 |
|------|------|
| [bootstrap-dev.sh](../ai-sop-ops/bootstrap-dev.sh) | 全量开发环境（CLI + Manager 依赖 + agentd + doctor） |
| [sop-ctl.sh](../ai-sop-ops/sop-ctl.sh) | 统一管控：init、backup、start-bg、health、doctor、bootstrap… |
| [start-manager.sh](../ai-sop-ops/start-manager.sh) | 启动 Manager API |
| [health-check.sh](../ai-sop-ops/health-check.sh) | 仓库与依赖检查（`sop-ctl doctor` 无 CLI 时降级） |
| [init-ai-project.sh](../ai-sop-ops/init-ai-project.sh) | 业务项目 AI 配置初始化 |
| [install-integrations.sh](../ai-sop-ops/install-integrations.sh) | Python 集成依赖（LanceDB 等） |

```bash
bash ai-sop-ops/sop-ctl.sh help
bash ai-sop-ops/sop-ctl.sh doctor
bash ai-sop-ops/sop-ctl.sh bootstrap --start-agentd
```

完整表：[ai-sop-ops/SCRIPTS.md](../ai-sop-ops/SCRIPTS.md)。

---

## 六、Python SDK

包：`packages/sop-sdk-python/`。

```python
from sop_sdk import build_default_client, AgentdIpcClient

cli = build_default_client()
print(cli.health())

ipc = AgentdIpcClient()
if ipc.available():
    print(ipc.health())
```

详见 [packages/sop-sdk-python/README.md](../packages/sop-sdk-python/README.md)。

---

## 七、环境变量（常用）

| 变量 | 说明 |
|------|------|
| `PROJECT_PATH` | 被管理项目根目录（agentd、Manager 默认） |
| `SOP_PLATFORM_ROOT` | 平台 monorepo 根（ai-sop-ops 脚本解析用） |
| `MANAGER_URL` | Manager 基址，默认 `http://localhost:8765` |
| `MANAGER_SOP_TOKEN` | JWT（脚本调 API） |
| `PROJECT_ID` / `X-Project-Id` | 项目作用域 |
| `VECTOR_DB_TYPE` | 向量后端（Manager 侧） |

完整列表：[ai-sop-ops/docs/ENVIRONMENT.md](../ai-sop-ops/docs/ENVIRONMENT.md)。

---

## 八、故障排查速查

### `sop: command not found`

```bash
make build-sop
source .venv/bin/activate
# 或
uv run sop doctor
```

### `sop doctor` — sop-agentd IPC 失败

```bash
make build-agentd    # 若无二进制
sop agentd start
sop agentd status
sop doctor
```

### `sync API` 被跳过

属正常：未配对 `project_id`。执行 `sop login --pair` 后重跑 `sop doctor`。

### Web 后台「项目不存在」

**不是服务宕机**（API 在线即可排除）。常见原因：本地 `memory/current_state.json` 的 `project_id`（如 `sop-dev`）未写入 Manager 的 `projects` 表。

- **single 模式**：重启 Manager 后会按 `memory/` 自动注册；或刷新控制台后顶栏选择项目。
- 手动：`sop login --pair` 或登录后调用 `POST /api/v1/auth/pair`。

### Manager 不可达

```bash
bash ai-sop-ops/start-manager.sh
curl -s http://localhost:8765/api/v1/health | head
```

### 平台 hook shim 缺失

```bash
sop platforms list
sop platforms doctor
sop platforms install-shims cursor
```

---

## 九、相关文档

| 文档 | 内容 |
|------|------|
| [README.md](../README.md) | 仓库总览与快速开始 |
| [USER_MANUAL.md](USER_MANUAL.md) | Web 管理后台 |
| [SYNC_AND_PLATFORMS.md](../ai-sop-ops/SYNC_AND_PLATFORMS.md) | 同步与多平台 |
| [DATA_AND_VECTOR.md](../ai-sop-ops/DATA_AND_VECTOR.md) | 数据平面与向量库 |
| [TOOL_INTEGRATION.md](../ai-sop-ops/TOOL_INTEGRATION.md) | 多 IDE 集成 |
| [apis/README.md](../apis/README.md) | OpenAPI 契约 |
