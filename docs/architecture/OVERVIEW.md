# 总体架构（v2）

> 版本: 2.1 · 状态: 多仓库与 Manager 拆分设计已定稿（见 [PLATFORM_REPOS_AND_MANAGER_SPLIT.md](PLATFORM_REPOS_AND_MANAGER_SPLIT.md)） · 日期: 2026-05-14

## 设计目标

| 维度 | 目标 |
|------|------|
| **AI 高效** | 所有结构都为"AI 改单个 < 500 行模块准确率最大化"设计 |
| **降人管成本** | 主动上报、自动同步、自动分类/总结/告警；人工只在决策点介入 |
| **长期演进** | API/Schema/协议都版本化 + 12 个月向后兼容承诺；插件化避免硬 fork |
| **企业化** | 多租户隔离、SSO/ABAC、审计哈希链、列加密、备份恢复、多区域 |
| **产品化** | Manager 一键部署、CLI 一等公民、内嵌 AI Copilot、规约/技能市场 |

## 三层 + 五通道

```
┌────────────── 工具层（Codex / Claude / Cursor / Vibe / 自建 Agent）──────────────┐
│  通过 hooks + MCP + A2A + CLI 与 sop-agentd 对话                                 │
└──────────────────────────────┬──────────────────────────────────────────────────┘
                               │ IPC / stdio / HTTP
┌──────────────────────────────▼──────────────────────────────────────────────────┐
│                   项目运行时（apps/agent-runtime, Go 二进制）                    │
│  Reporter · Puller · Watcher · Outbox · MCP Hub · A2A Node · Hook Bus           │
└────────────────┬───────────────────────────────────────────────┬────────────────┘
                 │  HTTPS REST  WSS  gRPC  Webhook  ...           │ stdio MCP
                 ▼                                                ▼
┌────────────────────────────── Manager 管理面（manager-api + manager-worker） ────┐
│  API：同步 REST/WS；Worker：队列 + Temporal/批处理 + 外呼 LLM/向量                 │
│  详见 docs/architecture/PLATFORM_REPOS_AND_MANAGER_SPLIT.md                       │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 五通道一表

| 通道 | 用途 | 协议 | 默认开启 |
|------|------|------|---------|
| REST `/api/v1/*` | 同步 CRUD | HTTPS + JWT/HMAC | ✅ |
| WebSocket `/ws/events` | 推送/订阅 | WSS + JWT | ✅ |
| MCP（stdio/sse） | AI 工具调能力 | JSON-RPC | ✅ |
| A2A | Agent 互发现/委托 | HTTPS + Agent Card | ✅ |
| gRPC `:9090` | 高频低延迟 | gRPC + mTLS/ApiKey | ⚪ 可选 |
| Webhook 出站 | 通知外部 | HMAC-SHA256 | ✅ |
| Event Bus（Redis Streams） | 内部事件广播 | Redis | ⚪ saas 模式 |

## 仓库布局

### 目标形态（多仓库 + 本仓运行时）

| 仓库 | 说明 |
|------|------|
| **magic-devops/ai-sop** | AI 规约、模板、Agent 协作 Markdown **独立发版**；本仓通过 submodule / Release / `SOP_SPEC_ROOT` 消费 |
| **magic-devops/ai-sop-ops**（建议） | 原 `sop/tools` 中 **可执行运维与本地编排**；`pipx` / OCI 镜像交付 |
| **本仓 ai-team-devops** | `apis/`、`apps/manager-api`（规划）、`apps/manager-worker`（规划）、`apps/manager`（当前 API 实现）、`apps/manager-web`、`apps/agent-runtime`、`packages/*`、`plugins/` |

详见 **[PLATFORM_REPOS_AND_MANAGER_SPLIT.md](PLATFORM_REPOS_AND_MANAGER_SPLIT.md)**。

### 当前 monorepo 目录（过渡）

```
ai-team-devops/
├── apps/
│   ├── manager/               ← 当前：FastAPI 实现（sop_manager），将演进为 manager-api 真源
│   ├── manager-api/           ← 目标：仅 API 进程（README 占位）
│   ├── manager-worker/        ← 目标：异步任务 / 工作流（README 占位）
│   ├── manager-web/           ← 管理 UI（Vite + React）
│   └── agent-runtime/         ← sop-agentd（Go）
├── packages/
│   ├── sop-cli/
│   └── sop-sdk-python/
├── apis/
├── plugins/
├── sop/                       ← 过渡：规约树；长期迁移至 ai-sop 后以 submodule 替换
│   ├── tools/                 ← 过渡：运维脚本；长期迁移至 ai-sop-ops
│   ├── specs/ agents/ knowledge/ skills/ templates/ custom/ ...
├── docs/
│   └── architecture/          ← 含 PLATFORM_REPOS_AND_MANAGER_SPLIT.md
└── pyproject.toml
```

## 关键设计原则（强制）

| 编号 | 原则 | 说明 |
|------|------|------|
| P1 | 文件 < 500 行 / 函数 < 60 行 | AI 改大文件出错率显著上升；CI 强制 |
| P2 | 领域分包 | 一个 domain 自包含 models/service/router/schemas/tests |
| P3 | Schema-First | OpenAPI/Proto/AsyncAPI 为单一事实源，代码生成 |
| P4 | Ports & Adapters | LLM/Vector/EventBus/Storage 统一接口 + 多 adapter |
| P5 | 可观测即代码 | 每个 service 默认带 trace/log；关键变更必发 domain event |
| P6 | Feature Flags | 新功能灰度，紧急 kill switch |
| P7 | 12 月向后兼容 | API/事件 schema 变更 deprecation 周期 |
| P8 | 安全默认 ON | 鉴权/签名/审计/限流默认启用，关闭需显式 |
| P9 | i18n 全栈 | 后端错误码 + 前端文案 + 文档全部支持 zh/en 起步 |
| P10 | AI-friendly | 每模块顶部带"AI 修改入口注释"：可改/不可改/影响面 |

## 长期演进路线

| 里程碑 | 主题 | 目标交付 |
|--------|------|---------|
| M1 ✅ | 目录拆分骨架 | apps/packages/apis/plugins/docs 就位 |
| M2 | Schema-First | openapi.yaml 单源 + SDK 生成 |
| M3 | sop CLI + SDK | `sop` 命令统一入口 |
| M4 | sop-agentd | Go 守护进程心跳/outbox/WS |
| M5 | LLM Gateway + RAG | 统一 LLM 路由 + 检索流水线 |
| M6 | DDD 模块切薄 | 大文件 → domains/ 包结构 |
| M7 | 可观测性 | OTel + /metrics + 审计哈希链 |
| M8 | 工作流引擎 | Temporal/Hatchet 长流程 |
| M9 | 协议完备 | WS/MCP/A2A/gRPC 五通道齐全 |
| M10 | 安全硬化 | HMAC+ts+nonce + 列加密 + 密钥轮换 |
| M11 | 插件 + 市场 + Copilot | entry_points + ⌘K + NLQ |
| M12 | 新前端 + 企业版 | Vite/TS/shadcn + SSO/SAML/HA |

详见 [`EVOLUTION.md`](EVOLUTION.md)。
