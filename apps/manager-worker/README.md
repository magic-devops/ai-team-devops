# manager-worker（异步任务进程）

> **角色**：管理面后台任务（嵌入、批处理、工作流）；与 `apps/manager` API 进程分离，便于水平扩展与故障隔离。

## 当前交付（v4 骨架）

可安装包 **`sop-manager-worker`**（本目录 `pyproject.toml`）：

| 能力 | 说明 |
|------|------|
| HTTP 健康 | 默认 `127.0.0.1:8790/health`（`WORKER_HEALTH_HOST` / `WORKER_HEALTH_PORT` 可覆盖） |
| Redis Streams | 设置 `REDIS_URL` 且 `pip install 'sop-manager-worker[redis]'` 后消费 `WORKER_TASK_STREAM`（默认 `sop:tasks`），消费者组 `WORKER_TASK_GROUP`，消费者名 `WORKER_CONSUMER_NAME` |

```bash
# 自仓开发（需在 monorepo 根执行 uv sync 后）
uv run --project apps/manager-worker sop-worker --port 8790
```

API 进程通过 `POST /api/v1/worker/jobs` 写入 Stream（或本地 job 文件）后，由本进程消费并回写 `PATCH /api/v1/worker/jobs/{id}`。

| 任务类型 | 行为 |
|----------|------|
| `kb.index` / `kb.reindex` | 回调 Manager `POST /api/v1/knowledge/index` |
| `memory.summarize` | 拉取 recent 记忆并生成预览摘要 |
| `rag.warmup` | 调用 Manager RAG health/search，可选 index docs 后预热热门集合；失败可重试并进入 DLQ |

失败治理：

- `WORKER_MAX_RETRIES`：单条 Redis Stream 消息最大重试次数，默认 `2`。
- `WORKER_DLQ_STREAM`：失败超过重试次数后的死信 Stream，默认 `${WORKER_TASK_STREAM}:dlq`。
- 健康接口返回 `metrics.received/completed/failed/retried/dlq`，便于 Prometheus/日志侧采集。

Worker 需配置 `MANAGER_URL`、`MANAGER_BEARER`（或 `SOP_BEARER_TOKEN`）、`PROJECT_ID`（及可选三码头）。

## 设计权威

- [PLATFORM_REPOS_AND_MANAGER_SPLIT.md](../../docs/architecture/PLATFORM_REPOS_AND_MANAGER_SPLIT.md)
- [UPGRADE_v4_ENGINEERING.md](../../docs/architecture/UPGRADE_v4_ENGINEERING.md)
