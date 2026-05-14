# manager-api（目标部署单元）

> **角色**：SOP 管理面 **同步 HTTP/WebSocket API** 唯一对外入口。  
> **当前真源**：实现仍位于同仓 `apps/manager/sop_manager/`（见根目录 `apps/manager/README.md`），本目录为 **架构占位与迁移终点**，避免在未完成拆分时双份维护业务代码。

## 职责

- REST `/api/v1/*`、探活、OpenAPI、鉴权、租户/项目作用域、审计写入请求元数据。
- **禁止**在请求线程内执行长耗时编排（应投递任务，见 `apps/manager-worker`）。
- 通过 Redis Streams / Outbox 向 Worker 发布命令；通过只读表或缓存读取任务状态。

## 与 worker 的契约（摘要）

| 项目 | 约定 |
|------|------|
| 任务载荷 | JSON Schema 版本字段 `schema_version`；与 `apis/asyncapi` 或内部 `job_types` 枚举对齐 |
| 关联 ID | `trace_id` / `job_id` / `idempotency_key` 全链路透传 |
| 响应模式 | 长任务：`202` + `job_id`；短任务：同步 `200` |

## 设计文档

详见 **[docs/architecture/PLATFORM_REPOS_AND_MANAGER_SPLIT.md](../../docs/architecture/PLATFORM_REPOS_AND_MANAGER_SPLIT.md)**。
