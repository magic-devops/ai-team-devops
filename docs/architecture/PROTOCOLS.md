# 协议契约总览

> 五个通道、一个事实源（`apis/`）

## 1. REST（同步主通道）

- **路径前缀**：`/api/v1/*`（v1 内向后兼容 ≥ 12 月）
- **契约源**：[`apis/openapi/openapi.yaml`](../../apis/openapi/openapi.yaml)
- **认证**（三选一）：
  - `Authorization: Bearer <jwt>`（推荐人类操作）
  - `X-Api-Key: <key>` + `X-Sop-Timestamp` + `X-Sop-Nonce` + `X-Sop-Signature`（推荐自动化/CI）
  - mTLS 客户端证书（企业版可选）
- **必带头**：`X-Project-Id`（多项目作用域）
- **错误格式**（RFC 9457 Problem Details）：

```json
{
  "type": "https://docs.sop.dev/errors/task-not-found",
  "title": "Task not found",
  "status": 404,
  "detail": "task t-123 not found in project proj-x",
  "instance": "/api/v1/tasks/t-123",
  "request_id": "01J....",
  "errors": []
}
```

## 2. WebSocket（实时双向）

- **路径**：`/ws/events?project_id=proj-xxx&token=<jwt>`
- **帧**：NDJSON（一行一帧），帧体遵循 **CloudEvents 1.0**

```json
{
  "specversion": "1.0",
  "id": "01J...",
  "source": "/manager/task",
  "type": "sop.task.status_changed",
  "subject": "t-123",
  "time": "2026-05-14T03:50:00Z",
  "datacontenttype": "application/json",
  "data": { "from": "in_progress", "to": "completed", "confidence": 0.83 }
}
```

- **心跳**：客户端 30s 发 `{"type":"ping"}`，服务端回 `pong`
- **重连**：指数退避（1/2/4/8/16/32/60s），带 `last_event_id` 做断点续传

## 3. MCP（项目本地）

- 由 `sop-agentd` 启动多个 stdio MCP server，AI 工具通过 `mcp.json` 接入
- **标准 server 集**：

| URI | 工具 |
|-----|------|
| `sop.lancedb` / `sop.qdrant` | `semantic_search`, `get_task_context`, `add_rule` |
| `sop.knowledge` | `search_knowledge`, `index_document`, `ai_polish` |
| `sop.tasks` | `list_tasks`, `pull_task`, `update_status`, `report_issue` |
| `sop.files` | `read_file`, `list_dir`（受 path_config 限制） |
| `sop.specs` | `load_spec`, `list_specs`（按需加载，省 token） |
| `sop.rules` | `list_active`, `propose_rule` |
| `sop.llm` | `chat`, `embeddings`, `rerank`（透传 Gateway） |
| `sop.sandbox` | `run_in_docker`, `run_in_e2b` |

详见 [`docs/protocols/MCP.md`](../protocols/MCP.md)。

## 4. A2A（跨 Agent 互通）

- 每个项目在 `http://<host>:7741/.well-known/agent.json` 暴露 Agent Card
- Card 结构（精简版）：

```json
{
  "name": "sop-project-agent",
  "version": "1.0",
  "project_id": "proj-xxx",
  "tenant_id": "t-xxx",
  "description": "ai-team-devops 项目代理",
  "url": "https://agent.proj-x.example.com",
  "skills": [
    {"id":"plan",      "description":"分解需求为任务", "endpoint":"/skills/plan"},
    {"id":"implement", "description":"按规约实现",   "endpoint":"/skills/implement"},
    {"id":"review",    "description":"代码审查",     "endpoint":"/skills/review"},
    {"id":"test",      "description":"运行/编写测试", "endpoint":"/skills/test"},
    {"id":"debug",     "description":"排查问题",     "endpoint":"/skills/debug"}
  ],
  "auth": {"types":["bearer","apikey"]},
  "interaction": {"sync": true, "streaming": "sse"}
}
```

- Manager 维护跨项目 A2A 注册表；跨项目调用走 Manager 中转或点对点

## 5. gRPC（可选高频通道）

- 默认关闭；`agent.toml: transport.grpc=true` 启用
- 契约：[`apis/proto/sop/agent/v1/agent.proto`](../../apis/proto/sop/agent/v1/agent.proto)
- 适用场景：hook 高频事件、长流式（StreamEvents）

## 6. Webhook（出站）

- HMAC-SHA256 签名头 `X-Sop-Signature: t=<unix>,v1=<hex>`
- 重试：指数退避，最大 8 次；失败入 DLQ；连续 24h 失败自动停用
- 事件命名：`<domain>.<action>`，参见 [`apis/asyncapi/asyncapi.yaml`](../../apis/asyncapi/asyncapi.yaml)

## 7. 事件总线（内部，可选 Redis Streams）

- 单机 `single` 模式：进程内 asyncio queue
- `saas` 模式：Redis Streams（自带 consumer group + ack + replay）
- 事件契约：同 WebSocket（CloudEvents 1.0）
- 持久化保留：默认 7 天

## 8. 数据契约版本化

| 维度 | 策略 |
|------|------|
| REST | URL 版本 `/api/v1/`；新增字段允许；删除/改语义须 v2 |
| Event | `data` 内嵌 `schema_version`；消费者按 minor 兼容 |
| Webhook | payload `version` 字段；新版本 24h 双发，旧版本带 `deprecation` |
| gRPC | proto package `sop.agent.v1`；break 升 v2 |
| MCP | tool 的 `inputSchema` 严格校验；新增可选字段不算 break |
