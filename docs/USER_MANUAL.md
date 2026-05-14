# Web 管理后台 · 使用手册

面向**项目经理、开发、AI 辅助工作流**的操作说明。技术实现细节见 [apps/manager/README.md](../apps/manager/README.md)。

## 1. 启动与环境

```bash
# 推荐：先安装 Python 依赖（含 FastAPI / LanceDB / 可选 pypdf 等）
bash ai-sop-ops/install-integrations.sh

# 启动后台（默认端口 8765）
bash ai-sop-ops/start-manager.sh

# 管理「业务代码仓库」而非本规约仓库时，指定路径：
PROJECT_PATH=/path/to/your-app bash ai-sop-ops/start-manager.sh

PORT=9000 PROJECT_PATH=/path/to/app bash ai-sop-ops/start-manager.sh
```

浏览器访问：

- **仅 API / OpenAPI**：`http://127.0.0.1:8765`（根路径为 JSON 说明，`/docs` 为 Swagger）。
- **推荐：前后端分离开发**：另开终端 `cd apps/manager-web && pnpm dev`，Vite 默认在浏览器打开 **`http://127.0.0.1:5173/console.html`**（完整管理台；`/api` 反代到 8765）。轻量 React 壳为 **`http://127.0.0.1:5173/?shell=1`** 或任意带 hash 的路径（如 **`http://127.0.0.1:5173/#/settings`**）；根路径无 hash 时会自动进入完整台，详见 `apps/manager-web/README.md`。
- **完整管理台（主产品）**：`http://127.0.0.1:5173/console.html`；顶栏含「轻量扩展坞」入口。未登录时走 **`http://127.0.0.1:5173/login.html`**（与手册中 `sop-token` / `X-Project-Id` 约定一致）。

**环境变量**

| 变量 | 含义 |
|------|------|
| `PROJECT_PATH` | LanceDB、工作区浏览、规约 `memory/` 的根目录，默认当前工作目录 |
| `SOP_RUNTIME_DIR` | 可选。统一运行时根；默认 `PROJECT_PATH/.sop-runtime`（SQLite、日志、编排/Vibe 等生成的 `ai-memory` 物理目录） |
| `PORT` | Uvicorn 端口 |

### 1.1 脚本与运维工具

运维脚本位于 monorepo 根目录 **`ai-sop-ops/`**（Git submodule）；**规约 Markdown** 位于 **`ai-sop/`**（`magic-devops/ai-sop`）。克隆后须 **`git submodule update --init --recursive`**。可选 **`SOP_SPEC_ROOT` / `SOP_SOP_DIR`** 覆盖规约根；**`SOP_OPS_ROOT`** 覆盖运维根。

**多 IDE 规则文件（与 `.cursorrules` 对齐）**：**`.trae/rules.md`**（Trae）、**`.qoder/context.md`**（Qoder）、**`.windsurfrules`**（Windsurf）。刷新模板可执行：`bash ai-sop-ops/sync-rules.sh`（默认以脚本内嵌模板写入目标项目根；本仓库已提交与 `.cursorrules` 一致的副本）。

**完整索引**（含环境变量与只读规范文档）：[ai-sop-ops/SCRIPTS.md](../ai-sop-ops/SCRIPTS.md)；常用入口摘要：[ai-sop-ops/README.md](../ai-sop-ops/README.md)。

| 场景 | 命令 |
|------|------|
| **统一管控（推荐）** | `bash ai-sop-ops/sop-ctl.sh help`（`--json` / `wait-health` / `url` / `self-check` / `commands` 等，见 §1.3） |
| 健康检查 | `bash ai-sop-ops/health-check.sh` |
| 忘记管理员密码 / 新建管理员 | `python3 ai-sop-ops/reset-admin.py`（交互式）或 `python3 ai-sop-ops/reset-admin.py reset <用户> <新密码>`（见脚本头说明，密码长度等校验） |
| 脚本或 CI 调 Manager API | 配置 `MANAGER_URL`、`PROJECT_ID`（`X-Project-Id`）、**`MANAGER_SOP_TOKEN`**（登录 JWT，推荐）与可选 `MANAGER_API_KEY` 后执行 `python3 ai-sop-ops/manager_client.py`（见文件内用法） |
| 与 `start-manager` 等价的备用入口 | `bash ai-sop-ops/start-dashboard.sh` |

### 1.2 鉴权与多项目（SaaS / 顶栏项目）

- 登录后浏览器保存 **`sop-token`**（JWT）与 **`sop-current-project-id`**（当前项目）。业务请求须同时携带 **`Authorization`** 与 **`X-Project-Id`**，后端中间件才能把数据与文件路径落到正确项目（见 `apps/manager/sop_manager/routers/project_scope_middleware.py`）。
- **单项目模式**（`ADMIN_MODE=single`）：未选项目时服务端可用环境变量 `PROJECT_ID` 作为默认项目上下文。
- **脚本 / CI**：推荐 `MANAGER_SOP_TOKEN` + `PROJECT_ID` 调用 `ai-sop-ops/manager_client.py`；可选 `HEALTH_CHECK_TOKEN` + `HEALTH_CHECK_PROJECT_ID` 跑 `health-check.sh` 验证鉴权链路（见 [ai-sop-ops/SCRIPTS.md](../ai-sop-ops/SCRIPTS.md)）。

### 1.3 统一管控（`sop-ctl.sh` + 可选 `sop` Python CLI）

不依赖 `pip install` 时，用仓库内 **`bash ai-sop-ops/sop-ctl.sh`** 作为统一入口（与零散脚本等价，便于记忆）。

**全局参数**（必须写在子命令之前）：`-y` / `--yes`（与 `reinit` 联用时若子命令未带 `-y` 会自动注入）、`--json`（在 `status`、`env`、`version`、`wait-health`、`self-check` 等子命令上输出**单行 JSON**，便于 CI/`jq`；需可用的 `python3`）、`--project-path`（或 `=DIR`）、`--port`（或 `=N`，默认 8765）、`-h` / `--help`（仅单独使用时打印帮助）。示例：`bash ai-sop-ops/sop-ctl.sh --project-path /path/to/app --port 9000 start-bg`；`bash ai-sop-ops/sop-ctl.sh --json status`。

| 场景 | 命令 |
|------|------|
| 查看子命令 | `bash ai-sop-ops/sop-ctl.sh help` |
| Bash Tab 补全 | 先 `alias sopctl='bash <本仓库绝对路径>/ai-sop-ops/sop-ctl.sh'`，再 `source <本仓库绝对路径>/ai-sop-ops/sop-ctl.completion.bash`；或一次性：`eval "$(bash <路径>/ai-sop-ops/sop-ctl.sh complete bash)"`（Zsh 可先 `autoload bashcompinit; bashcompinit` 再 `source` 同上补全文件，见 `complete zsh` 说明） |
| 快速初始化 | `bash ai-sop-ops/sop-ctl.sh init <项目名>` |
| 备份 | `bash ai-sop-ops/sop-ctl.sh backup`（LanceDB 快照）；`backup --full` 另打包 `memory/` + `.sop-runtime/` 到 `PROJECT_PATH/.sop-backups/` |
| 重新初始化 | `bash ai-sop-ops/sop-ctl.sh reinit [与 init-ai-project.sh 相同选项]`；非交互可 `bash ai-sop-ops/sop-ctl.sh -y reinit …` |
| 清理旁路运行时文件 | `bash ai-sop-ops/sop-ctl.sh clean` / `clean --apply` |
| 前台启动 Manager | `bash ai-sop-ops/sop-ctl.sh start`（参数同 `start-manager.sh`，如 `--port 9000`） |
| 后台启动 / 重启 / 停止 / 状态 | `start-bg`（可选 `--port N`、`--no-reload`）· **`restart-bg`**（先 `stop-bg --force` 再 `start-bg`）· `stop-bg` 或别名 **`stop`**（可加 `--force`）· `status`（人类可读；加 **`--json`** 输出 PID/健康等 JSON）；环境变量 `PORT` 仍可与全局 `--port` 配合使用 |
| 安装依赖 | `bash ai-sop-ops/sop-ctl.sh install` |
| 健康检查 | `bash ai-sop-ops/sop-ctl.sh health`（支持 `HEALTH_CHECK_TOKEN` + `HEALTH_CHECK_PROJECT_ID`，见 [SCRIPTS.md](../ai-sop-ops/SCRIPTS.md)） |
| 智能修复 | `bash ai-sop-ops/sop-ctl.sh repair`（依次 `install-integrations` + `health-check`）；CI 若要 **install 失败即失败** 用 **`repair --strict`** |
| 部署提示 | `bash ai-sop-ops/sop-ctl.sh deploy single` 或 `deploy saas`（打印 `docker compose` 示例） |
| systemd 单元模板 | `bash ai-sop-ops/sop-ctl.sh register > /tmp/sop-manager.service`（再按需修改 User/ExecStart） |
| 深度自检 | `bash ai-sop-ops/sop-ctl.sh doctor`（若 PATH 中已有 `sop` 则执行 `sop doctor`；否则尝试源码树 `sop_cli`；再否则降级为 `health-check.sh`） |
| 规约同步到各工具可读位置 | `bash ai-sop-ops/sop-ctl.sh sync` |
| 管理员账号（SQLite 等） | `bash ai-sop-ops/sop-ctl.sh reset-admin`（透传 `reset-admin.py` 子命令，见 [SCRIPTS.md](../ai-sop-ops/SCRIPTS.md)） |
| 程序化调 Manager API | `bash ai-sop-ops/sop-ctl.sh manager`（`manager_client.py`，需 `MANAGER_URL` / `MANAGER_SOP_TOKEN` 等） |
| 全量开发环境引导 | `bash ai-sop-ops/sop-ctl.sh bootstrap`（`bootstrap-dev.sh`） |
| 版本与路径快照 | `version` · `env`（可加 **`--json`** 输出结构化字段） |
| 查看后台 Manager 日志 | `logs` / `logs 200` / **`logs -f`**（`tail -f` `start-bg` 的 `manager-nohup.log`） |
| 本机 URL / 打开浏览器 | **`url`** 打印根地址与 `/api/health`；**`open`** 在 macOS `open` / Linux `xdg-open` 打开根 URL |
| 等待服务就绪 | **`wait-health`**（默认 60s 轮询 `GET /api/health`；**`--timeout SEC`**；可与 **`--json`** 联用输出 `{ok,waitedSec,port}`） |
| 脚本自检 / 子命令列表 | **`self-check`**（`bash -n` + 补全文件存在；支持 **`--json`**）；**`commands`** 每行一条子命令，供 shell 脚本枚举 |

已安装 **`pip install -e "packages/sop-cli[all]"`**（及 `sop-sdk`）时，推荐使用 Typer 命令：`sop init`、`sop doctor`、`sop agentd`、`sop task` 等；全量开发环境可执行 `bash ai-sop-ops/bootstrap-dev.sh`。详见 `packages/sop-cli` 与 [ai-sop-ops/bootstrap-dev.sh](../ai-sop-ops/bootstrap-dev.sh)。

## 2. 菜单与职责速览

| 分组 | 入口 | 用途 |
|------|------|------|
| 项目管理 | 总览 | Sprint、任务完成率、阻塞与问题告警 |
| 项目管理 | **研发全流程** | 单接口聚合状态、阶段跳转、低 Token 提示模板复制 |
| 项目管理 | 需求 / 执行计划 / 迭代 / Sprint / 问题 / 搜索 | 需求全生命周期与任务、迭代、缺陷 |
| 开发工具 | **Vibe Coding** | 会话与记忆、附件与多模态 LLM、Markdown/代码/页面预览、项目目录只读浏览 |
| 开发工具 | 规范编辑、环境管理（Docker）、CLI 工具 | 本地规范、容器与 CLI 配置；CLI 工具包含 Codex CLI |
| 知识与规范 | 技术方案、知识库、规范文档、规则库 | 方案版本、文档导入与 AI 润色、规范只读 |
| AI 能力 | Agent / 技能 / **编排** / MCP / 模型 | 多 Agent、专家组；**编排**含开发工具目录、**本机环境**独立子页、AI 安装方案与受控一键安装（详见 §4.5） |
| 系统设置 | 通知、配置、系统、账号 | 运维与账号 |

## 3. 推荐工作流（省 Token）

1. 打开 **研发全流程**，查看 KPI 与**质量建议**（无需问模型）。  
2. 用阶段卡片跳转到 **需求** → **技术方案** → **执行计划**，在界面内完成结构化数据。  
3. 在 **研发全流程** 复制「低 Token 提示模板」，粘贴到 **Vibe Coding** 或外部 Agent；用 **需求 ID / 任务 ID** 代替贴全文。  
4. 需要看图或长文档时：在 Vibe 中上传附件或「文档抽取」，规范全文仍在「规范文档」页打开，不复制进提示词。

## 4. 核心页面说明

### 4.1 研发全流程

- 调用 `GET /api/v1/dev-flow/summary` 聚合需求、任务、问题、Sprint、技术方案数量、Agent/专家组数量及仓库线索。  
- **进入枢纽**也可从「总览」页横幅进入。  
- 任意页面可通过内部事件切换到其它 Tab（与侧栏等价）。

### 4.2 Vibe Coding（AI 开发 IDE）

- **会话**：左侧列表、筛选、重命名、导出 JSON、删除；记忆区防抖保存。  
- **项目目录**：只读树，点击文件在右侧「项目文件」查看（受大小与 UTF-8 限制）。  
- **右侧视图**：原始输出、Markdown 渲染、代码块高亮、图片、PDF/文本附件、HTML 沙箱预览。  
- **直接调用 LLM**：支持图片等多模态（需 `ANTHROPIC_API_KEY`）；CLI 模式无法传图。
- **Codex CLI**：项目初始化后会生成 `AGENTS.md`、`.codex/config.toml`、`.codex/hooks.json`；首次启用 hook 时需在 Codex 中审查并信任。

### 4.3 需求与技术方案

- 需求：手动录入、文档批量导入、优先级与详情维护（以实际 `requirements` 路由为准）。  
- 技术方案：多文档、版本、落盘 `.ai-memory/tech_design/`（详见设计文档路由）。

### 4.4 环境管理（Docker）

- 环境检查、`docker ps` / `images` 等（以 `docker_env` 路由为准）；与「研发全流程」中的 Dockerfile 线索互补。

### 4.5 Agent 编排与开发工具

入口：**AI 能力 → Agent / 编排 / MCP / 模型**（编排模块内再选子页：开发工具、**本机环境**、工作流、质量配置、版本管理）。

**开发工具**

- **宽屏**：编排左侧为子模块导航；「开发工具」页左侧为 **分类**（Agent CLI / IDE / 助手 / 链路与运行时），右侧为工具列表。  
- **搜索**：列表上方可按名称、命令、说明过滤。  
- **默认工具**：每条可「设为默认」，供工作流等读取（存于 `.sop-runtime/ai-memory/orchestration/config.json`；项目根 `.ai-memory` 在 Unix 上多为符号链接）。  
- **内置工具**：可改显示名/命令/说明（覆盖配置）、**隐藏**；已隐藏区可单条恢复或 **恢复全部内置工具**。  
- **自定义工具**：添加 / 编辑 / 删除（仅自定义可删）。  
- **补充说明**：参与 AI 安装上下文，自动保存在本机浏览器（`localStorage` 键 `sop_orch_ai_goal`）。  
- **AI 安装说明**：打开弹窗展示 Markdown 步骤；若有 **白名单配方**，列出可点击的「执行此步骤」（实际调用受控安装 API，仅允许服务端固定 npm/pip 等命令）。弹窗内展示 **`argv_shell`** 便于核对后再执行。  
- **受控一键安装**：仅对部分带 `guard_install_recipe` 且未检测到 PATH 的工具显示；需确认后执行。  
- **安装控制台与历史**：查看完整输出、复制、打开弹窗；历史来自 `.sop-runtime/ai-memory/orchestration/install_logs.jsonl`。

**本机环境**（编排侧栏独立子页）

- 与 Docker 页 **同源** 内置检查（`python3`、`node`、`java`、`mvn`、`docker compose` 等）。  
- **仅刷新检查**：不整页重载。  
- 状态为 **Missing** 时：**AI 方案** 会预填目标并请求安装说明；若检查项 id 与内置工具 id 一致（如 `java`），可 **定位工具** 切换到「开发工具」并滚动到对应行；受控一键安装仍在「开发工具」页执行。

**API 与持久化、白名单安全** 见 **[ORCHESTRATION_DEV_TOOLS.md](ORCHESTRATION_DEV_TOOLS.md)**。

## 5. 常见问题

**Q：数据存在哪里？**  
A：默认在 `PROJECT_PATH/.sop-runtime/ai-memory/lancedb` 与各 JSON 索引中（项目根 `.ai-memory` 在 Unix 上多为指向该目录的符号链接）；Vibe 会话在 `ai-memory/vibe_sessions.json`，上传附件在 `ai-memory/vibe_uploads/`。

**Q：PDF 知识库抽取失败？**  
A：需安装 `pypdf`（`install-integrations.sh` 或手动 `pip install pypdf`）。

**Q：静态资源打不开 API？**  
A：生产入口须保证 **`StaticFiles` 挂载在 API 路由之后**，否则 **`/api/v1/*`**（及 `/metrics` 等）会被静态文件吞掉；参考当前 `main.py` 顺序。

## 6. 相关文档

| 文档 | 内容 |
|------|------|
| [ARCHITECTURE.md](../ARCHITECTURE.md) | 体系架构与 Web 扩展 |
| [ai-sop/QUICK_REF.md](../ai-sop/QUICK_REF.md) | AI 速查与 Token 策略 |
| [TUTORIAL.md](../TUTORIAL.md) | 全流程教程含 Web 章节 |
| [apps/manager/README.md](../apps/manager/README.md) | 路由、页面模块、开发约定 |
| [ORCHESTRATION_DEV_TOOLS.md](ORCHESTRATION_DEV_TOOLS.md) | Agent 编排、开发工具、受控安装 API 与持久化 |
| [ai-sop-ops/CODEX_CLI.md](../ai-sop-ops/CODEX_CLI.md) | Codex CLI / hooks 集成规范 |
| [ai-sop-ops/SCRIPTS.md](../ai-sop-ops/SCRIPTS.md) | 本目录脚本与工具完整清单 |
