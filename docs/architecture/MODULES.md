# 模块边界与命名

> "AI 改单文件不影响别人"的具体落地

## 顶层包

| 包 | 角色 | 主要技术 | 行数上限 |
|----|------|---------|---------|
| `apps/manager` | SaaS 后端 | FastAPI / SQLAlchemy / Pydantic | 单文件 < 500 |
| `apps/agent-runtime` | 项目侧守护 | Go 1.22 | 单文件 < 400 |
| `packages/sop-cli` | 统一 CLI | Python Typer + Rich/Textual | 单文件 < 400 |
| `packages/sop-sdk-python` | 项目侧 SDK | Python 3.10 + httpx | 单文件 < 400 |
| `sop/` | 规约 + 工具脚本 | Markdown + Bash + Python | — |
| `apis/` | 契约源 | YAML/Proto | — |
| `plugins/` | 第三方扩展 | 各包独立 | — |

## Manager 内部 domains（M6 目标结构）

```
apps/manager/sop_manager/
├── core/
│   ├── config.py            ← Pydantic Settings
│   ├── db.py                ← engine/session/alembic
│   ├── security/            ← jwt, hmac, casbin policy
│   ├── observability/       ← otel, metrics, logging
│   ├── events/              ← 内部 event bus + outbox
│   ├── i18n/                ← gettext + locale loader
│   └── plugin/              ← entry_points loader
├── domains/
│   ├── tenant/              ← models / service / router / schemas
│   ├── project/
│   ├── requirement/
│   ├── task/
│   ├── sprint/
│   ├── issue/
│   ├── agent/
│   ├── skill/
│   ├── llm/                 ← AI Gateway（LiteLLM 集成）
│   ├── rag/                 ← 检索流水线
│   ├── workflow/            ← Temporal Workflows
│   ├── vibe/                ← 多模态会话
│   ├── webhook/
│   ├── audit/
│   ├── plugin/              ← 插件管理（管理面）
│   ├── marketplace/         ← 规约/技能市场
│   └── copilot/             ← Manager 内嵌 AI Copilot
├── platform/
│   ├── notify/              ← 钉钉/企微/Slack/Email
│   ├── storage/             ← S3/MinIO 抽象
│   ├── search/              ← 全文 + 向量 + Hybrid
│   └── sandbox/             ← Docker/E2B 代码沙箱
└── api/
    ├── v1/                  ← 路由聚合
    └── openapi_export.py    ← 生成 openapi.yaml
```

### 每个 domain 内部固定四件套

```
domains/<name>/
├── __init__.py
├── models.py        ← SQLAlchemy ORM（仅本域表）
├── schemas.py       ← Pydantic 入出参（与 openapi.yaml 对齐）
├── service.py       ← 业务逻辑（无 HTTP / DB 直接依赖）
├── repository.py    ← DB 访问（接口 + 实现）
├── router.py        ← FastAPI 路由（薄，仅参数绑定 + 调 service）
├── events.py        ← 本域 domain events 定义
└── tests/
```

**强约束**：跨域调用只能通过 service 接口 / event bus，**不许**跨域 import models/repository。

## sop-agentd（Go）内部包

```
apps/agent-runtime/
├── cmd/sop-agentd/main.go        ← 入口（< 80 行）
└── internal/
    ├── daemon/                   ← 主循环 + 调度
    ├── config/                   ← agent.toml + keyring
    ├── reporter/                 ← 心跳 + 状态上报
    ├── puller/                   ← 增量拉取
    ├── watcher/                  ← fsnotify 监听 memory/
    ├── outbox/                   ← SQLite outbox + DLQ
    ├── transport/
    │   ├── http/                 ← REST + 签名
    │   ├── ws/                   ← gorilla/websocket
    │   └── grpc/                 ← 可选
    ├── mcp/                      ← 内置 MCP servers（lancedb/knowledge/tasks/files）
    ├── a2a/                      ← Agent Card + skill router
    ├── ipc/                      ← unix socket（hook → daemon）
    └── security/                 ← hmac+ts+nonce + keyring
```

## AI 修改入口注释（每文件必备）

每个源文件顶部添加：

```python
"""
@module: sop_manager.domains.task
@purpose: 任务领域：状态机、依赖关系、Sprint 关联
@stable: 模型字段、router 路径在 v1 内稳定
@ai_safe_edit:
  - 增加新字段：需同步 schemas + alembic 迁移
  - 修改状态机：先改 service.STATE_MACHINE，再改 tests
  - 跨域调用：只允许通过 service 接口
@deps_in:  core.db, core.events, domains.project.service (read-only)
@deps_out: events.TaskCreated, events.TaskStatusChanged
@size_budget: 480 lines
"""
```

CI 强制：
- 单文件 > 500 行 → 红线
- 跨域 import models/repository → 红线
- 缺 `@ai_safe_edit` 注释 → 黄线

## 命名约定

| 实体 | 风格 | 例 |
|------|------|------|
| 包 / 模块 | `snake_case` | `sop_manager.domains.task` |
| 类 | `PascalCase` | `TaskService` |
| 函数 / 变量 | `snake_case` | `assign_task_to_user` |
| 常量 | `UPPER_SNAKE` | `TASK_STATUS_TRANSITIONS` |
| Pydantic Schema | `<Resource><Action>` | `TaskCreate`, `TaskUpdate`, `TaskOut` |
| Event 类 | `<Past tense>` | `TaskCreated`, `TaskStatusChanged` |
| Table | 复数 snake | `tasks`, `project_members` |
| API path | kebab + 复数 | `/api/v1/tasks`, `/api/v1/agent-runs` |
| ID 前缀 | 短小写 | `t-`（task）`req-`（req）`agent-` |
| Webhook event | `domain.action` | `task.status_changed` |
