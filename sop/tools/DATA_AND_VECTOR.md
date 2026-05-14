# 数据平面：SQL、向量库与 RAG（权威说明）

本页描述 **可配置、可扩展** 的存储分层、环境变量与选型建议。实现入口：

| 能力 | 代码入口 |
|------|-----------|
| 业务 SQL（租户/项目/任务等） | `sop/web/routers/sql_models.py`（`DB_TYPE` / `DATABASE_URL`） |
| RAG 向量读写（嵌入 + 检索） | `sop/web/routers/vector_store_iface.py` → `get_store()`（`VECTOR_DB_TYPE`） |
| 管理面向量表（克隆、统计、`/db-config/vector/tables`） | `sop/web/routers/vector_store.py` → `get_vector_store()` |
| HTTP RAG | `POST /api/v1/rag/search`、`POST /api/v1/rag/index`、`GET /api/v1/rag/health` |
| 连接探测（需管理员 JWT） | `POST /api/v1/db-config/vector/test`、`POST /api/v1/db-config/sql/test` |

## 1. SQL 层（结构化 / 「多模态」元数据）

- **`DB_TYPE`**：`sqlite`（默认）| `mysql` | **`oceanbase`**  
  `oceanbase` 与 `mysql` 共用 **MySQL 协议** 连接池（`mysql+pymysql://…` 指向 OceanBase 租户）。
- **`DATABASE_URL`**：留空时由 `path_config` 落到 `SOP_RUNTIME_DIR/db/sop.db`。

**OceanBase**：同一连接既可承载业务表，也可在选用 `VECTOR_DB_TYPE=oceanbase` 时承载 RAG 表 `sop_rag_chunks`（见下）。生产建议 **读写分离连接串** 与连接池参数调优。

## 2. 向量层（RAG / 语义检索）

**`VECTOR_DB_TYPE`** 控制 `vector_store_iface.get_store()`：

| 值 | 依赖（extras） | 适用场景 |
|----|----------------|----------|
| `lance`（默认） | `vector-lance` | 单机/边缘、零运维、与现有 Lance 工具链一致 |
| `qdrant` | `vector-qdrant` | 横向扩展、过滤丰富、与 `docker-compose.saas.yml` 对齐 |
| `milvus` | `vector-milvus` | 大规模向量、分区与混合检索演进 |
| **`oceanbase`** | `mysql`（pymysql） | 中小语料、希望 **向量与事务数据同库**；实现为 JSON 存 float 向量 + 可配置扫描上限内 **余弦相似度内存排序** |

### 环境变量速查

```bash
# 通用
VECTOR_DB_TYPE=lance          # lance | qdrant | milvus | oceanbase
LANCE_DB_PATH=                # 默认 SOP_RUNTIME_DIR/ai-memory/lancedb
QDRANT_URL=http://localhost:6333
MILVUS_URI=http://localhost:19530
MILVUS_TOKEN=

# OceanBase / MySQL 向量（RAG）
OCEANBASE_VECTOR_URL=         # 可选；缺省用 DATABASE_URL（勿 sqlite）
OCEANBASE_VECTOR_SCAN_CAP=2500   # 单次检索扫描行上限（性能与安全）
```

**性能提示**：`oceanbase` 模式适合 **万级以内 chunk** 或可接受扫描上限的场景；更大规模请用 **Milvus / Qdrant**，或 OceanBase 原生 VECTOR 索引（后续可插拔同一接口）。

## 3. Agent / CLI 开发体验

1. **`sop doctor`**：检查本地 memory、`.ai-memory`、Manager、`GET /api/v1/rag/health` 报告的后端类型。  
2. **`sop task` / `sop llm` / `sop rule`**：统一走 Manager v1 API 与 Gateway。  
3. **MCP**：`sop/integrations/mcp/tasks_server.py`、`llm_server.py` 使用 `sop_sdk` 或 `manager_client`，与向量后端解耦。

## 4. 与旧文档关系

- 本地 Lance 目录与嵌入模型选型仍可参考下文「附录」；**详细目录与备份**以 `sop/memory/LANCEDB_SCHEMA.md` 与 `path_config` 为准。  
- 历史文件 `LANCEDB_SETUP.md` 已收缩为指针，避免与不存在模块冲突。

### 附录：嵌入模型（lancedb_ops / 本地脚本）

| 模型 | 维度 | 说明 |
|------|------|------|
| all-MiniLM-L6-v2 | 384 | 默认 |
| paraphrase-multilingual-MiniLM-L12-v2 | 384 | 中文友好 |

RAG 路径使用的向量维度由 **LLM Gateway 嵌入接口** 返回长度决定，与各后端 `ensure_collection(dim)` 对齐。
