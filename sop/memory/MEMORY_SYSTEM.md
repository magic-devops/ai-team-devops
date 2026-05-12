# 记忆体系架构

## 记忆层次

```
┌─────────────────────────────────────────────────────┐
│                   记忆体系                            │
├─────────────┬───────────────┬───────────────────────┤
│  工作记忆    │   项目记忆     │      长期记忆           │
│ (上下文内)   │  (LanceDB)    │   (文件系统)            │
│             │               │                       │
│ 当前任务状态  │ 需求向量索引   │ 开发规范               │
│ 读取的文件   │ 代码语义索引   │ 决策记录               │
│ 中间结果     │ 问题/解决方案  │ 事故复盘               │
│ 临时变量     │ 迭代历史       │ 技术债务               │
└─────────────┴───────────────┴───────────────────────┘
```

## LanceDB 项目记忆

### 为什么选择 LanceDB
- 本地运行，无需网络
- 原生向量搜索（语义检索）
- 支持混合查询（向量 + 结构化过滤）
- 零配置，嵌入式使用

### Collection 设计

#### `requirements`（需求库）
```python
schema = {
    "id": str,           # REQ-{timestamp}
    "title": str,
    "description": str,
    "status": str,       # pending|in_progress|done|cancelled
    "priority": str,     # P0|P1|P2|P3
    "sprint": str,
    "created_at": datetime,
    "updated_at": datetime,
    "vector": list[float],  # 语义向量，用于相似需求检索
}
```

#### `tasks`（任务库）
```python
schema = {
    "id": str,           # T-{timestamp}
    "req_id": str,       # 关联需求
    "title": str,
    "description": str,
    "status": str,       # pending|in_progress|done|blocked|cancelled
    "assigned_to": str,  # 智能体角色
    "estimate": str,     # S|M|L
    "actual_hours": float,
    "created_at": datetime,
    "completed_at": datetime,
    "vector": list[float],
}
```

#### `code_changes`（变更库）
```python
schema = {
    "id": str,           # CHG-{timestamp}
    "task_id": str,
    "commit_hash": str,
    "files_changed": list[str],
    "summary": str,      # 变更摘要
    "diff_snippet": str, # 关键 diff 片段
    "created_at": datetime,
    "vector": list[float],  # 用于"找类似变更"
}
```

#### `incidents`（问题库）
```python
schema = {
    "id": str,           # INC-{timestamp}
    "title": str,
    "description": str,
    "root_cause": str,
    "resolution": str,
    "prevention": str,
    "severity": str,     # P0|P1|P2|P3
    "created_at": datetime,
    "resolved_at": datetime,
    "vector": list[float],  # 用于"找类似问题"
}
```

#### `decisions`（决策库）
```python
schema = {
    "id": str,           # DEC-{timestamp}
    "title": str,
    "context": str,      # 决策背景
    "options": list[str],
    "chosen": str,
    "rationale": str,    # 选择理由
    "trade_offs": str,
    "created_at": datetime,
    "vector": list[float],
}
```

## 记忆操作规范

### 写入时机
| 事件 | 写入目标 | 必填字段 |
|------|---------|---------|
| 任务开始 | `tasks` | id, title, status=in_progress |
| 任务完成 | `tasks` | status=done, completed_at |
| 代码提交 | `code_changes` | commit_hash, summary |
| 发现 Bug | `incidents` | title, description, severity |
| 重大决策 | `decisions` | title, context, chosen, rationale |
| 阶段切换 | 文件系统 | phase, timestamp, context |

### 检索时机
| 场景 | 检索目标 | 查询方式 |
|------|---------|---------|
| 开始新任务 | `tasks` | 相似任务（向量搜索） |
| 遇到错误 | `incidents` | 相似问题（向量搜索） |
| 技术选型 | `decisions` | 相关决策（向量搜索） |
| 代码修改 | `code_changes` | 相关变更历史（向量搜索） |

## 文件系统记忆结构

```
memory/
├── project_init.json        # 项目初始化信息
├── current_state.json       # 当前阶段和状态
├── decisions/
│   └── DEC-{id}.md          # 每个重大决策一个文件
├── incidents/
│   └── INC-{id}.md          # 每个问题一个文件
└── sprints/
    └── sprint-{n}.json      # 每个迭代的摘要
```

## 记忆恢复流程

当智能体在新上下文中恢复工作时：

```python
def restore_context(project_id: str, task_id: str):
    # 1. 读取当前状态
    state = read_file("memory/current_state.json")
    
    # 2. 加载当前任务
    task = lancedb.tasks.get(task_id)
    
    # 3. 检索相关历史（向量搜索）
    similar_tasks = lancedb.tasks.search(task.description, limit=3)
    similar_incidents = lancedb.incidents.search(task.description, limit=2)
    
    # 4. 构建最小恢复上下文
    return {
        "current_phase": state.phase,
        "task": task,
        "relevant_history": similar_tasks + similar_incidents,
        "pending_tasks": state.pending_tasks[:5],  # 只加载前5个
    }
```
