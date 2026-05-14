# Web 管理后台（sop/web）

FastAPI + React（Babel Standalone，**无构建步骤**）。默认入口 **`main.py`**，通过 `bash sop/tools/start-manager.sh` 启动。

## 快速启动

```bash
# 1. 安装依赖
bash sop/tools/install-integrations.sh
# 或仅安装 web 依赖
pip install -r sop/web/requirements.txt

# 2. 配置环境变量（首次）
cp sop/web/.env.example sop/web/.env
# 编辑 .env，至少设置 SECRET_KEY（生产环境必须修改）

# 3. 启动
PROJECT_PATH=/path/to/your-app bash sop/tools/start-manager.sh
# 访问 http://localhost:8765/login.html

# 4. 初始化管理员账号（首次，只能执行一次）
curl -X POST http://localhost:8765/api/v1/auth/init \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"your-password-min-8-chars"}'
# 返回 {"ok":true,...} 即成功，之后用此账号登录
```

> **注意**：系统没有预设账号密码。首次启动后必须调用 **`POST /api/v1/auth/init`** 自行设置管理员账号（密码至少 8 位）。该接口只在数据库为空时有效，之后调用会返回 400 错误。也可以直接访问 `http://localhost:8765/login.html`，页面会提示初始化入口。若**已有账号但遗忘密码**，可在仓库根执行 `python3 sop/tools/reset-admin.py`（见 [sop/tools/SCRIPTS.md](../tools/SCRIPTS.md)）。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PROJECT_PATH` | `.` | 被管理仓库根路径 |
| `SOP_RUNTIME_DIR` | `PROJECT_PATH/.sop-runtime` | 统一运行时根：SQLite、日志、ai-memory 物理目录 |
| `AI_MEMORY_ROOT` | `SOP_RUNTIME_DIR/ai-memory` | 覆盖默认 AI 数据根时使用 |
| `PORT` | `8765` | 监听端口 |
| `DB_TYPE` | `sqlite` | `sqlite`、`mysql` 或 **`oceanbase`**（OceanBase MySQL 模式，连接串同 mysql） |
| `DATABASE_URL` | （自动） | 留空或旧默认时自动指向 `SOP_RUNTIME_DIR/db/sop.db` |
| `VECTOR_DB_TYPE` | `lance` | **`lance`** / **`qdrant`** / **`milvus`** / **`oceanbase`**（RAG；见 `sop/tools/DATA_AND_VECTOR.md`） |
| `LANCE_DB_PATH` | （自动） | 留空时默认 `SOP_RUNTIME_DIR/ai-memory/lancedb` |
| `QDRANT_URL` | `http://localhost:6333` | `VECTOR_DB_TYPE=qdrant` 时使用 |
| `OCEANBASE_VECTOR_URL` | — | 可选；`VECTOR_DB_TYPE=oceanbase` 时优先；否则使用非 sqlite 的 `DATABASE_URL` |
| `OCEANBASE_VECTOR_SCAN_CAP` | `2500` | OB/MySQL JSON 向量检索单 collection 最大扫描行数 |
| `ADMIN_MODE` | `single` | `single`（单项目）或 `saas`（多租户） |
| `SECRET_KEY` | — | JWT 签名密钥，**生产必须修改** |
| `TENANT_ID` | `t-default` | 单项目模式下的租户 ID |
| `PROJECT_ID` | `proj-default` | 单项目模式下的项目 ID |
| （HTTP）`X-Project-Id` | — | 登录后浏览器/API 客户端携带，用于解析「当前项目」磁盘路径与 SQL 上下文（与 JWT 联动；见 `project_scope_middleware`） |
| `LOG_DIR` | （自动） | 留空则使用 `SOP_RUNTIME_DIR/logs` |
| `ANTHROPIC_API_KEY` | — | AI 功能（需求解析/知识库润色） |

完整变量见 `.env.example`。

## Docker 启动

```bash
cd sop/web

# SQLite（最简）
docker compose up admin -d

# MySQL + Admin
DB_TYPE=mysql DATABASE_URL="mysql+pymysql://sop:sopdev@mysql:3306/sopdb" \
  docker compose up mysql admin -d

# 启用 Milvus 向量库（RAG 与管理面）
docker compose --profile milvus up -d
```

## 数据库架构

```
SQL (SQLite / MySQL / OceanBase MySQL)   ← 结构化业务数据
├── tenants / users / projects / members
├── requirements / tasks / issues / sprints
├── audit_logs / webhook_configs / api_keys
└── 租户+项目隔离 (tenant_id + project_id)

向量层（由 VECTOR_DB_TYPE 选择；RAG 与管理面克隆）
├── lance：本地 LanceDB 目录
├── qdrant / milvus：独立向量服务
└── oceanbase：表 sop_rag_chunks（JSON 向量 + 可配置扫描上限）
```

## 目录结构

```
web/
├── main.py              # 主入口：路由注册、中间件（业务 API 统一 `/api/v1/*`）
├── login.html           # 独立登录页（支持 single/saas 模式）
├── index.html           # 主应用 Shell（React + 侧栏菜单）
├── migrate.py           # LanceDB → SQL 数据迁移工具
├── requirements.txt     # Python 依赖
├── .env.example         # 环境变量模板
├── docker-compose.yml   # Docker 一键启动
├── Dockerfile
├── routers/             # 后端按域拆分（每文件独立）
│   ├── sql_models.py    # SQLAlchemy ORM 模型（所有表定义）
│   ├── db_sql_compat.py # SQL 适配层（兼容旧 LanceDB 接口）
│   ├── auth_sql.py      # JWT 认证 + RBAC + API Key
│   ├── tenants.py       # 租户/业务线/项目/成员 + 模板克隆
│   ├── sprints.py       # Sprint CRUD + 进度统计
│   ├── issues.py        # 问题 CRUD（SQL）
│   ├── audit.py         # 审计日志中间件 + 查询
│   ├── webhook.py       # Webhook 配置 + HMAC 触发
│   ├── health.py        # 健康检查 + Prometheus + 日志查看
│   ├── logger.py        # 标准化日志（滚动/7天/128MB）
│   ├── vector_store.py  # 向量库抽象（LanceDB/Milvus + 项目隔离）
│   ├── db_config.py     # 数据库配置可视化管理
│   ├── requirements.py  # 需求 CRUD + AI 解析 + 原型生成
│   ├── tasks.py         # 任务 CRUD + 看板 UI 状态
│   ├── db.py            # LanceDB（仅知识库/向量数据）
│   └── ...              # agents/skills/mcp/models/orchestration/...
└── pages/               # 前端模块（每文件暴露全局 React 组件）
    ├── i18n.js          # 全局 i18n（zh/en）
    ├── i18n-extend.js   # 模块化 i18n 扩展机制
    ├── tenants.js       # 组织管理（租户/项目/模板克隆/用户）
    ├── sprints_mgr.js   # Sprint 管理（进度/阻塞/回顾）
    ├── audit.js         # 审计日志查看
    ├── webhook.js       # Webhook 配置
    ├── health.js        # 健康监控
    ├── db_config.js     # 数据库配置
    ├── logs_viewer.js   # 日志查看（实时 tail）
    └── ...              # agents/skills/vibe/orchestration/...
```

## 认证流程

1. 访问 `login.html` → 输入用户名/密码 → 获取 JWT token
2. token 存入 `localStorage['sop-token']`
3. 所有业务 API 经 **`apiFetch`**（`index.html`）发起：自动附带 `Authorization`、`X-Project-Id`（来自 `localStorage` 的 `sop-current-project-id`）、默认超时；根相对路径（如 `/tasks/...`）会拼到 **`API` 基址**（默认 `当前 origin + /api/v1`）；若以 **`/api/...`** 开头的绝对路径传入，则按「同源 + 该路径」请求（不重复拼接）。
4. 401 自动清除 token 并跳转 `login.html`；403 会 Toast 提示（含后端 `detail`），并派发 `devdash-api-forbidden`。
5. 顶栏切换项目会写入 `sop-current-project-id` 并广播 `devdash-project-change`，各页 `useFetch` 等会重新拉数。

**项目作用域（后端）**：`routers/project_scope_middleware.py` 在 Bearer JWT 有效时根据 `X-Project-Id` 与 `projects` 表解析 `path_config.resolved_project_path`；**`/api/v1/auth/*`**、**`/api/v1/health*`** 等白名单路径不参与作用域注入。SaaS 下非法项目或无权访问返回 **403/404**。

**角色权限**：`super_admin > tenant_admin > project_admin > developer > viewer`

**API Key**：在「账号管理」页创建；若路由层启用 `X-Api-Key` 校验可配合自动化（当前多数字段路由以 JWT 为主，脚本侧推荐 **`MANAGER_SOP_TOKEN` + `PROJECT_ID`**，见 `sop/tools/manager_client.py`）。

## 本地 Agent 与 Manager 交互

```bash
# 使用 manager_client.py（sop/tools/）
MANAGER_URL=http://localhost:8765 MANAGER_SOP_TOKEN="<登录后 JWT>" PROJECT_ID=my-proj \
  python sop/tools/manager_client.py health

# 或仅 API Key（无 JWT 时中间件不注入请求级项目路径，依赖进程级 PROJECT_PATH）
MANAGER_URL=http://localhost:8765 MANAGER_API_KEY=sop_xxx PROJECT_ID=my-proj \
  python sop/tools/manager_client.py health

# 任务完成上报
python sop/tools/manager_client.py task-done T-123 "实现完成"

# 问题上报
python sop/tools/manager_client.py issue "登录接口 500" P1
```

## 主要 API

| 前缀 | 说明 |
|------|------|
| `POST /api/v1/auth/init` | 首次初始化管理员 |
| `POST /api/v1/auth/login` | 登录获取 token |
| `GET /api/v1/auth/me` | 当前用户信息 |
| `POST /api/v1/auth/api-keys` | 创建 API Key |
| `/api/v1/projects` | 项目 CRUD + 成员管理 |
| `POST /api/v1/projects/{id}/clone` | 从模板克隆项目 |
| `/api/v1/requirements` | 需求 CRUD + AI 解析 |
| `/api/v1/tasks` | 任务 CRUD + 看板 |
| `/api/v1/issues` | 问题 CRUD |
| `/api/v1/sprints` | Sprint CRUD + 进度 |
| `GET /api/v1/audit-legacy` | 审计日志查询（SQL 审计表） |
| `/api/v1/webhooks` | Webhook 配置 |
| `GET /api/v1/health/detail` | 详细健康检查 |
| `GET /metrics` | Prometheus 指标（根路径，非 `/api/v1`） |
| `GET /api/v1/logs` | 日志 tail 查看 |
| `/api/v1/knowledge` | 知识库（向量，`workspace` 路由） |
| `/api/v1/vibe` | Vibe Coding 会话 |

## 数据迁移（LanceDB → SQL）

```bash
cd sop/web
python migrate.py t-default proj-default
```

## 新增页面约定

1. `pages/foo.js` 顶部调用 `window.i18nExtend({zh:{...},en:{...}})`
2. `index.html` 加 `<script type="text/babel" src="pages/foo.js">`
3. `waitForPageModules` 名称列表加组件名
4. `ALL_PAGES` 加 `'foo':<FooPage/>`
5. `MENU_GROUPS` 加菜单项

## 相关文档

- 操作手册：[docs/USER_MANUAL.md](../../docs/USER_MANUAL.md)（含 **§1.3 `sop-ctl.sh`** 统一运维入口）
- 编排工具：[docs/ORCHESTRATION_DEV_TOOLS.md](../../docs/ORCHESTRATION_DEV_TOOLS.md)
- 架构设计：[ARCHITECTURE.md](../../ARCHITECTURE.md)
- 脚本说明：[sop/tools/SCRIPTS.md](../tools/SCRIPTS.md)
