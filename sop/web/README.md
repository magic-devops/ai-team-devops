# Web 管理后台（sop/web）

FastAPI + React（Babel Standalone，**无构建步骤**）。默认入口 **`main.py`**，通过 `bash sop/tools/start-manager.sh` 启动。

## 启动

```bash
bash sop/tools/install-integrations.sh   # 推荐：先装依赖
PROJECT_PATH=/path/to/your-app bash sop/tools/start-manager.sh
# http://localhost:8765
```

| 变量 | 说明 |
|------|------|
| `PROJECT_PATH` | 业务仓库根；LanceDB、`.ai-memory/`、Vibe 上传与会话、工作区浏览均相对此路径 |
| `PORT` | 监听端口，默认 `8765` |

前端 `index.html` 顶部常量 **`API`** 须与访问端口一致（默认 `http://localhost:8765/api`）。

## 目录结构

```
web/
├── main.py              # ★ 主入口：注册各 router、兼容旧 /api、静态文件最后挂载
├── api.py               # 备用：单体 FastAPI（部分环境仍引用）
├── index.html           # Shell：React、全局组件、侧栏菜单、ALL_PAGES、useFetch、事件总线
├── routers/             # 后端按域拆分
│   ├── db.py            # LanceDB 连接与 rows()/table()
│   ├── requirements.py
│   ├── tasks.py
│   ├── issues.py
│   ├── agents.py
│   ├── skills.py
│   ├── mcp_mgr.py
│   ├── auth.py
│   ├── system.py
│   ├── models.py
│   ├── orchestration.py
│   ├── docker_env.py
│   ├── skill_repo.py
│   ├── cli_wrapper.py
│   ├── vibe.py          # Vibe 会话/上传/LLM/工作区只读
│   ├── design_docs.py   # 技术方案 Markdown 与版本
│   └── dev_flow.py      # GET /summary 研发流聚合
└── pages/               # 前端模块化（每文件暴露全局函数组件）
    ├── agents.js
    ├── skills.js
    ├── mcp.js
    ├── system.js
    ├── auth.js
    ├── models.js
    ├── orchestration.js
    ├── docker.js
    ├── skill_repo.js
    ├── vibe.js
    ├── design_docs.js
    ├── dev_flow.js      # 研发全流程枢纽 DevFlowHub
    ├── notify.js
    └── cli.js
```

## 主导航与页面注册

- 菜单定义于 `index.html` 内 `MENU_GROUPS` + `ALL_PAGES`。  
- 新增页面：`pages/foo.js` 暴露组件 → `index.html` 增加 `<script type="text/babel" src="pages/foo.js">` → `waitForPageModules` 名称列表 → `ALL_PAGES`。

## 跨页导航（无 props 穿透）

- 派发：`window.dispatchEvent(new CustomEvent('app-set-tab', { detail: { tab: 'requirements' } }))`  
- `AppV3` 内监听并 `setTab`，供「研发全流程」、总览横幅等跳转。

## 关键 API 摘要

| 前缀 | 用途 |
|------|------|
| `/api/requirements` | 需求 CRUD、文档解析等 |
| `/api/tasks` | 任务 |
| `/api/issues` | 问题 |
| `/api/agents` | Agent 与专家组 JSON |
| `/api/design-docs` | 技术方案索引与内容 |
| `/api/vibe` | 模板、运行、LLM、**sessions**、**upload**、**workspace**、history |
| `/api/dev-flow` | **`GET /summary`** 聚合驾驶舱数据 |
| `/api/orchestration` | **Agent 编排**：开发工具 CRUD/隐藏、默认工具、`/environment-checks`、AI 安装方案 v1/v2、**受控安装**、安装日志；详见 [docs/ORCHESTRATION_DEV_TOOLS.md](../../docs/ORCHESTRATION_DEV_TOOLS.md) |
| `/api/env` | Docker / 环境检查（编排页环境区委托同源内置检查） |
| `/api/knowledge` | 知识库、**extract-text**（PDF 需 pypdf）、ai-polish |
| `/api/dashboard` 等 | 见 `main.py` 保留接口 |

## Agent 编排（`routers/orchestration.py` + `pages/orchestration.js`）

- **前端**：宽屏下编排左侧为子模块导航（开发工具 / 工作流 / 质量 / 版本）；开发工具页内 **分类 + 搜索**；环境区 **仅刷新 / AI 方案 / 定位工具**；AI 弹窗展示白名单步骤的 **`argv_shell`**；文案在 `pages/i18n.js` 的 `orch_*`。  
- **后端**：`/api/orchestration/*`；状态在 **`PROJECT_PATH/.ai-memory/orchestration/`**（`dev_tools_state.json`、`config.json`、`install_logs.jsonl` 等）。  
- **API 表、安全约束、新特性列表**：[docs/ORCHESTRATION_DEV_TOOLS.md](../../docs/ORCHESTRATION_DEV_TOOLS.md)。

## 静态资源与路由顺序

**`StaticFiles` 必须挂在所有 `/api` 路由之后**，否则静态根会拦截 API。当前 `main.py` 采用「先 API、后 mount `/`」。

## 前端依赖（CDN）

`index.html` 可引入 marked、DOMPurify、highlight.js（供 Vibe Markdown/代码块）。加载顺序：依赖库 → `pages/vibe.js`。

## AI 修改约定（仍建议遵守）

| 类型 | 建议 | 说明 |
|------|------|------|
| 新 API | 新建 `routers/xxx.py` + `include_router` | 避免 `main.py` 无限膨胀 |
| 新页面 | 新建 `pages/xxx.js` + 注册 | 超大页面可再拆文件（需同步 Babel 加载） |
| 改动范围 | 单文件增量编辑 | 与仓库 `sop/QUICK_REF.md` 一致 |

## 相关文档

- 操作者向：[docs/USER_MANUAL.md](../../docs/USER_MANUAL.md)（含编排 §4.5）  
- **编排与受控安装**：[docs/ORCHESTRATION_DEV_TOOLS.md](../../docs/ORCHESTRATION_DEV_TOOLS.md)  
- 架构：[ARCHITECTURE.md](../../ARCHITECTURE.md)  
- 脚本：[sop/tools/SCRIPTS.md](../tools/SCRIPTS.md)、[install-integrations.sh](../tools/install-integrations.sh)
