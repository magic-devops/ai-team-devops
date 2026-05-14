# Agent 编排 · 开发工具与受控安装

说明 **Web 管理后台** 中「AI 能力 → Agent / 编排 / MCP / 模型」里的 **编排** 模块：开发工具管理、本机环境检查、AI 安装方案与 **白名单受控执行**。实现代码：`apps/manager/sop_manager/routers/orchestration.py`、`apps/manager/sop_manager/pages/orchestration.js`；环境检查委托 `apps/manager/sop_manager/routers/docker_env.py` 的 `env_check()`。

操作速览仍见 [USER_MANUAL.md §4.5](USER_MANUAL.md)。

**鉴权**：编排相关 `fetch` 均经控制台 **`apiFetch`**，须已登录且（多项目时）顶栏选定项目，请求自动带 **`Authorization`** 与 **`X-Project-Id`**。直接 `curl` 编排 API 时请携带同上请求头。

---

## 1. 界面结构

| 区域 | 说明 |
|------|------|
| **左侧子导航**（宽屏） | 「开发工具 / **本机环境** / 工作流 / 质量配置 / 版本管理」垂直切换；开发工具页内左侧另有 **分类筛选**（Agent CLI / IDE / 助手 / 链路与运行时）。 |
| **开发工具 · 默认** | 展示当前默认 Agent 工具 id（`config.json` 的 `default_tool`）。 |
| **补充说明** | 参与 AI 安装方案上下文；内容会 **持久化到浏览器** `localStorage` 键 `sop_orch_ai_goal`。 |
| **工具列表** | 支持 **按名称/命令/说明搜索**与 **清空搜索**；每条可设默认、编辑（内置为覆盖）、AI 安装说明、受控一键安装（若有配方）、隐藏内置、删除自定义。 |
| **安装与执行控制台** | 展示最近一次受控命令输出；可刷新历史、弹窗查看、复制。 |
| **本机环境**（独立子页） | 与 Docker 页同源；可 **仅刷新检查**；缺失项可 **AI 方案**；若检查名与内置工具 id 一致可 **定位工具**（切换到「开发工具」并滚动到对应行）；受控安装仍从开发工具页发起。 |
| **已隐藏的内置工具** | 单条恢复或 **恢复全部内置工具显示**。 |

界面语言：`apps/manager/sop_manager/pages/i18n.js` 中 `orch_*` 词条（中/英切换随全局语言）。

---

## 2. 新特性摘要（相对早期仅列表形态）

1. **分类 + 搜索**：左侧分类计数；列表上方搜索框过滤。  
2. **AI 安装方案 v2**：`POST .../ai-install-plan-v2` 返回 Markdown + `actions[]`；每项含 `recipe_id`、`label`、**`argv_shell`**（`shlex.quote` 后的真实白名单命令预览）。  
3. **受控一键安装**：仅允许服务端固定的 `GUARD_INSTALL_RECIPES`（npm / pip 全局或 `--user` 等）；`POST .../install-guarded` / `POST .../ai-auto-install`。  
4. **安装日志**：`install_logs.jsonl`；失败时 API 带 **`error_code`**（`timeout` / `cmd_not_found`）及 **`exe`**；前端在日志顶部附人类可读说明（与 i18n 一致）。  
5. **环境 ↔ 工具联动**：在「本机环境」子页；环境行与内置工具 id 对齐时（如 `java`、`mvn`、`docker-compose`）支持 **定位工具**；缺失行一键打开 AI 方案。  
6. **内置工具扩展**：含 Docker Compose、curl、npx 等；环境检查含 `npx`、`curl`、**`pre_commit`**（`pre-commit --version`）、**`tsx`** 等（见 `docker_env._builtin_checks_dict`）。  
7. **v1 AI 纯 Markdown 方案**：`POST .../ai-install-plan`（需 `ANTHROPIC_API_KEY`）；无构建链时仍可用。  
8. **`docker-compose` 可用性**：列表中的「已安装」对 `docker-compose` 以 **`docker compose version`** 判定，而非仅检测 `docker` 是否在 PATH。  
9. **工作流创建校验**：`POST /workflows` 校验 id 格式（小写字母开头、`a-z0-9_-`、长度）；**409** 若 `wf_{id}.json` 已存在；列表展示 **工作流 id**（`code` 行）。  
10. **质量配置**：页头说明阈值写入 `config.json` 的 `quality_config`（消费方式依项目而定）。  
11. **AI 弹窗**：白名单步骤可 **一键复制 `argv_shell`**。  
12. **版本标签创建**：HTTP 错误时展示服务端 `detail` 文案（如 Git 未初始化、tag 已存在）。

---

## 3. 持久化路径（均在 `PROJECT_PATH` 下）

编排/Vibe 等生成的 JSON 与 SQLite **物理目录**为 **`PROJECT_PATH/.sop-runtime/ai-memory/`**（Unix 上项目根 `.ai-memory` 多为指向该目录的符号链接；可用 `SOP_RUNTIME_DIR` / `AI_MEMORY_ROOT` 覆盖，见 `path_config`）。

| 路径 | 用途 |
|------|------|
| `.sop-runtime/ai-memory/orchestration/dev_tools_state.json` | `custom[]`、`hidden[]`、内置 `overrides{}` |
| `.sop-runtime/ai-memory/orchestration/config.json` | `default_tool` 等 |
| `.sop-runtime/ai-memory/orchestration/install_logs.jsonl` | 受控安装历史（截断后的 log / stderr / error_code 等） |
| `.sop-runtime/ai-memory/orchestration/wf_*.json` | 工作流定义（编排页「工作流」子页） |
| `.sop-runtime/ai-memory/orchestration/version` 相关 | 见 `GET/POST /versions`（版本管理子页） |

---

## 4. API 一览（前缀 **`/api/v1/orchestration`**）

下列路径均接在该前缀之后（完整 URL 示例：`GET /api/v1/orchestration/tools`）。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/tools` | 合并内置+自定义+覆盖；`available` 对多数工具为 PATH 首段检测，**`docker-compose`** 等为子命令探测（见 `TOOL_AVAILABILITY_ARGV`） |
| GET | `/tools/meta` | `hidden`、`custom`、`overrides` |
| POST | `/tools` | 新增自定义工具 |
| PUT | `/tools/{tool_id}` | 覆盖内置或改自定义 |
| DELETE | `/tools/{tool_id}` | 仅删除自定义 |
| POST | `/tools/hide` | 隐藏内置 `{ "id" }` |
| POST | `/tools/unhide` | 恢复单条内置显示 `{ "id" }` |
| POST | `/tools/unhide-all` | 清空 `hidden` |
| POST | `/tools/ai-install-plan` | v1：仅 Markdown（Anthropic） |
| POST | `/tools/ai-install-plan-v2` | v2：`{ markdown, actions[] }`，`actions` 经白名单过滤并带 `argv_shell` |
| POST | `/tools/install-guarded` | `{ "recipe_id" }` 执行固定 argv |
| POST | `/tools/ai-auto-install` | `{ "tool_id" }` 按 `TOOL_TO_RECIPE` 执行 |
| GET | `/tools/install-logs?limit=40` | 最近安装历史 |
| GET | `/environment-checks` | 委托 `docker_env.env_check()` |
| GET/PUT | `/config` | 读/写默认工具、`quality_config` 等 |
| GET | `/workflows` | 列出全部工作流 JSON |
| POST | `/workflows` | 新建；id 须符合 `^[a-z][a-z0-9_-]{1,40}$`，且不得与已有 `wf_*.json` 冲突 |
| DELETE | `/workflows/{id}` | 删除 `wf_{id}.json` |
| GET | `/versions` | 列出最近 Git tags |
| POST | `/versions` | 创建带注释 tag（需 Git 仓库） |

请求体字段以 `orchestration.py` 内 Pydantic 模型为准。

---

## 5. 依赖与约束

- **AI 规划**：需配置 **`ANTHROPIC_API_KEY`**；可选 `ORCH_AI_MODEL`。未配置时 v2 可能退化为无 `actions` 或依赖其他回退逻辑（见代码分支）。  
- **安全**：受控安装 **禁止** 任意 shell；仅 `GUARD_INSTALL_RECIPES` 内固定参数；模型输出的 `recipe_id` 服务端再次过滤。  
- **静态资源**：`index.html` 对 `orchestration.js`、`i18n.js` 使用查询串版本号；改前端后应 bump 以免浏览器缓存旧脚本。

---

## 6. 相关文档

| 文档 | 内容 |
|------|------|
| [USER_MANUAL.md](USER_MANUAL.md) | Web 操作手册（含 §4.5） |
| [../apps/manager/README.md](../apps/manager/README.md) | Web 工程与路由总览 |
| [../ARCHITECTURE.md](../ARCHITECTURE.md) | 系统架构与 Web 扩展 |
| [../ai-sop-ops/TOOL_INTEGRATION.md](../ai-sop-ops/TOOL_INTEGRATION.md) | 多工具适配与共享状态 |
| [../ai-sop-ops/SCRIPTS.md](../ai-sop-ops/SCRIPTS.md) | **`ai-sop-ops/`**（submodule）脚本与工具完整索引 |
| [../ai-sop-ops/README.md](../ai-sop-ops/README.md) | 常用脚本入口摘要 |
