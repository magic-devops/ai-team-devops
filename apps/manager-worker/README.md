# manager-worker（目标部署单元）

> **角色**：异步任务、批处理、工作流推进、对外部 LLM/向量库的 **长连接与重试**。  
> **当前真源**：逻辑仍在 `apps/manager/sop_manager/routers/*` 内同步执行；迁移时按任务类型逐步下沉到本进程。

## 职责

- 消费队列（默认设计：Redis Streams；可选 PostgreSQL 队列表）。
- 幂等执行、指数退避、死信队列（DLQ）、可观测指标（处理延迟、重试次数）。
- 可选集成 **Temporal**：长流程、定时、人工节点、补偿事务。

## 非职责

- 不对外暴露公网 HTTP（仅集群内 gRPC/HTTP 健康检查，或经 sidecar）。
- 不替代 `sop-agentd`（项目侧守护）；Worker 服务 **管理面** 后台任务。

## 与 API 的协作

1. API 校验权限后写入任务记录 + 队列消息。  
2. Worker 领取任务 → 更新 `running/succeeded/failed`。  
3. API/WebSocket 向客户端暴露状态（轮询或推送）。

## 设计文档

详见 **[docs/architecture/PLATFORM_REPOS_AND_MANAGER_SPLIT.md](../../docs/architecture/PLATFORM_REPOS_AND_MANAGER_SPLIT.md)**。
