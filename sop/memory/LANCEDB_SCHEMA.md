# LanceDB Schema 与配置指南

## 安装

```bash
pip install lancedb sentence-transformers
# 或 Node.js
npm install @lancedb/lancedb
```

## 初始化项目记忆库

```python
import lancedb
import pyarrow as pa
from datetime import datetime

DB_PATH = ".ai-memory/lancedb"

def init_project_memory(project_id: str):
    db = lancedb.connect(DB_PATH)
    
    schemas = {
        "requirements": pa.schema([
            pa.field("id", pa.string()),
            pa.field("project_id", pa.string()),
            pa.field("title", pa.string()),
            pa.field("description", pa.string()),
            pa.field("status", pa.string()),
            pa.field("priority", pa.string()),
            pa.field("sprint", pa.string()),
            pa.field("created_at", pa.timestamp("us")),
            pa.field("updated_at", pa.timestamp("us")),
            pa.field("vector", pa.list_(pa.float32(), 384)),
        ]),
        "tasks": pa.schema([
            pa.field("id", pa.string()),
            pa.field("project_id", pa.string()),
            pa.field("req_id", pa.string()),
            pa.field("title", pa.string()),
            pa.field("description", pa.string()),
            pa.field("status", pa.string()),
            pa.field("assigned_to", pa.string()),
            pa.field("estimate", pa.string()),
            pa.field("actual_hours", pa.float32()),
            pa.field("created_at", pa.timestamp("us")),
            pa.field("completed_at", pa.timestamp("us")),
            pa.field("vector", pa.list_(pa.float32(), 384)),
        ]),
        "code_changes": pa.schema([
            pa.field("id", pa.string()),
            pa.field("project_id", pa.string()),
            pa.field("task_id", pa.string()),
            pa.field("commit_hash", pa.string()),
            pa.field("files_changed", pa.list_(pa.string())),
            pa.field("summary", pa.string()),
            pa.field("diff_snippet", pa.string()),
            pa.field("created_at", pa.timestamp("us")),
            pa.field("vector", pa.list_(pa.float32(), 384)),
        ]),
        "incidents": pa.schema([
            pa.field("id", pa.string()),
            pa.field("project_id", pa.string()),
            pa.field("title", pa.string()),
            pa.field("description", pa.string()),
            pa.field("root_cause", pa.string()),
            pa.field("resolution", pa.string()),
            pa.field("prevention", pa.string()),
            pa.field("severity", pa.string()),
            pa.field("created_at", pa.timestamp("us")),
            pa.field("resolved_at", pa.timestamp("us")),
            pa.field("vector", pa.list_(pa.float32(), 384)),
        ]),
        "decisions": pa.schema([
            pa.field("id", pa.string()),
            pa.field("project_id", pa.string()),
            pa.field("title", pa.string()),
            pa.field("context", pa.string()),
            pa.field("options", pa.list_(pa.string())),
            pa.field("chosen", pa.string()),
            pa.field("rationale", pa.string()),
            pa.field("trade_offs", pa.string()),
            pa.field("created_at", pa.timestamp("us")),
            pa.field("vector", pa.list_(pa.float32(), 384)),
        ]),
    }
    
    for name, schema in schemas.items():
        if name not in db.table_names():
            db.create_table(name, schema=schema)
    
    return db
```

## 向量化工具

```python
from sentence_transformers import SentenceTransformer

_model = None

def get_embedder():
    global _model
    if _model is None:
        # 轻量模型，384维，本地运行
        _model = SentenceTransformer("all-MiniLM-L6-v2")
    return _model

def embed(text: str) -> list[float]:
    return get_embedder().encode(text).tolist()
```

## CRUD 操作封装

```python
import uuid
from datetime import datetime, timezone

def now():
    return datetime.now(timezone.utc)

def add_task(db, project_id: str, req_id: str, title: str, description: str,
             assigned_to: str, estimate: str = "M"):
    task_id = f"T-{int(now().timestamp())}"
    db.open_table("tasks").add([{
        "id": task_id,
        "project_id": project_id,
        "req_id": req_id,
        "title": title,
        "description": description,
        "status": "pending",
        "assigned_to": assigned_to,
        "estimate": estimate,
        "actual_hours": 0.0,
        "created_at": now(),
        "completed_at": None,
        "vector": embed(f"{title} {description}"),
    }])
    return task_id

def update_task_status(db, task_id: str, status: str):
    table = db.open_table("tasks")
    updates = {"status": status}
    if status == "done":
        updates["completed_at"] = now()
    table.update(where=f"id = '{task_id}'", values=updates)

def search_similar(db, collection: str, query: str, limit: int = 5,
                   project_id: str = None):
    table = db.open_table(collection)
    q = table.search(embed(query)).limit(limit)
    if project_id:
        q = q.where(f"project_id = '{project_id}'")
    return q.to_list()
```

## 索引优化

```python
# 数据量 > 1000 条时创建 IVF_PQ 索引加速搜索
def create_index(db, collection: str):
    table = db.open_table(collection)
    table.create_index(
        metric="cosine",
        num_partitions=256,
        num_sub_vectors=96,
    )
```

## 目录约定

```
{project_root}/
└── .ai-memory/
    ├── lancedb/          # LanceDB 数据文件
    │   ├── requirements.lance
    │   ├── tasks.lance
    │   ├── code_changes.lance
    │   ├── incidents.lance
    │   └── decisions.lance
    └── snapshots/        # 定期快照（JSON 格式，便于 git 追踪）
        └── {date}.json
```

将 `.ai-memory/lancedb/` 加入 `.gitignore`，`snapshots/` 可选择提交。

## 扩展 Schema：需求/迭代/问题追踪（v1.1）

### `sprints`（迭代记录）
```python
pa.schema([
    pa.field("id", pa.string()),           # SPRINT-{n}
    pa.field("project_id", pa.string()),
    pa.field("goal", pa.string()),          # 迭代目标
    pa.field("status", pa.string()),        # planning|active|completed
    pa.field("started_at", pa.timestamp("us")),
    pa.field("ends_at", pa.timestamp("us")),
    pa.field("velocity", pa.float32()),     # 实际完成点数
    pa.field("planned_points", pa.int32()), # 计划点数
    pa.field("completion_rate", pa.float32()),
    pa.field("retrospective", pa.string()), # 回顾总结
    pa.field("vector", pa.list_(pa.float32(), 384)),
])
```

### `issues`（问题记录）
```python
pa.schema([
    pa.field("id", pa.string()),           # ISSUE-{timestamp}
    pa.field("project_id", pa.string()),
    pa.field("sprint_id", pa.string()),
    pa.field("task_id", pa.string()),       # 关联任务（可空）
    pa.field("title", pa.string()),
    pa.field("description", pa.string()),
    pa.field("type", pa.string()),          # bug|blocker|risk|tech_debt|question
    pa.field("severity", pa.string()),      # P0|P1|P2|P3
    pa.field("status", pa.string()),        # open|in_progress|resolved|wontfix
    pa.field("reported_by", pa.string()),   # agent_role 或 "human"
    pa.field("resolved_by", pa.string()),
    pa.field("resolution", pa.string()),
    pa.field("created_at", pa.timestamp("us")),
    pa.field("resolved_at", pa.timestamp("us")),
    pa.field("vector", pa.list_(pa.float32(), 384)),
])
```

### `requirements`（需求点，扩展字段）
在原有 schema 基础上增加：
```python
pa.field("acceptance_criteria", pa.list_(pa.string())),  # 验收标准
pa.field("sprint_id", pa.string()),                       # 所属迭代
pa.field("story_points", pa.int32()),                     # 故事点
pa.field("tags", pa.list_(pa.string())),                  # 标签
pa.field("human_notes", pa.string()),                     # 人工备注
pa.field("confidence", pa.float32()),                     # AI 完成置信度
```

### `agent_reflections`（Hermes 反思记录）
```python
pa.schema([
    pa.field("id", pa.string()),
    pa.field("project_id", pa.string()),
    pa.field("task_id", pa.string()),
    pa.field("agent_role", pa.string()),
    pa.field("think_content", pa.string()),    # <think> 内容
    pa.field("reflect_content", pa.string()),  # <reflect> 内容
    pa.field("confidence_before", pa.float32()),
    pa.field("confidence_after", pa.float32()),
    pa.field("retry_count", pa.int32()),
    pa.field("outcome", pa.string()),          # success|escalated|failed
    pa.field("rule_extracted", pa.string()),   # 提取的规则（可空）
    pa.field("created_at", pa.timestamp("us")),
    pa.field("vector", pa.list_(pa.float32(), 384)),
])
```

## 目录约定（更新）

```
{project_root}/
└── .ai-memory/
    ├── lancedb/
    │   ├── requirements.lance
    │   ├── tasks.lance
    │   ├── sprints.lance          # 新增
    │   ├── issues.lance           # 新增
    │   ├── agent_reflections.lance # 新增
    │   ├── code_changes.lance
    │   ├── incidents.lance
    │   └── decisions.lance
    └── snapshots/
        └── {date}.json
```

## Web API 数据接口（供后台读取）

```python
# 项目仪表盘数据（供 Web 后台调用）
def get_dashboard_data(project_id: str) -> dict:
    return {
        "project_id": project_id,
        "current_sprint": get_active_sprint(project_id),
        "requirements": {
            "total": count_reqs(project_id),
            "by_status": count_reqs_by_status(project_id),
            "by_priority": count_reqs_by_priority(project_id),
        },
        "tasks": {
            "total": count_tasks(project_id),
            "completed": count_tasks_by_status(project_id, "completed"),
            "in_progress": count_tasks_by_status(project_id, "in_progress"),
            "blocked": get_blocked_tasks(project_id),
        },
        "issues": {
            "open": get_open_issues(project_id),
            "p0_p1": get_critical_issues(project_id),
        },
        "velocity": get_sprint_velocity_trend(project_id, sprints=5),
        "agent_confidence": get_avg_confidence_trend(project_id, days=14),
    }
```
