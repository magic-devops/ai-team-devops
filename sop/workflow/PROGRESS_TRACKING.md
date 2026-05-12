# 进度追踪规范

## 进度追踪层次

```
项目级进度（Sprint 维度）
    ↓
功能级进度（需求维度）
    ↓
任务级进度（Task 维度）
    ↓
步骤级进度（当前任务内）
```

## 任务状态机

```
pending ──► in_progress ──► completed
   │              │
   │              ▼
   │           blocked ──► in_progress（解除阻塞后）
   │
   └──────────────────────► cancelled
```

## 状态持久化规范

### current_state.json 格式
```json
{
  "project_id": "my-project",
  "updated_at": "2026-05-12T10:30:00Z",
  "phase": "DEVELOPMENT",
  "sprint": {
    "id": "sprint-3",
    "started_at": "2026-05-05",
    "ends_at": "2026-05-16",
    "goal": "完成用户认证模块"
  },
  "tasks": {
    "completed": ["T001", "T002", "T003"],
    "in_progress": ["T004"],
    "blocked": [
      {
        "id": "T005",
        "reason": "等待 SMTP 配置确认",
        "blocked_since": "2026-05-12T09:00:00Z"
      }
    ],
    "pending": ["T006", "T007", "T008"]
  },
  "metrics": {
    "completion_rate": 37.5,
    "velocity": 3,
    "blockers_count": 1
  }
}
```

### 步骤级进度（工作记忆）
当前任务内的步骤进度存在工作记忆中（不持久化），格式：
```
当前任务：T004 - 实现用户登录 API
步骤：
  [x] 读取相关文件
  [x] 实现 POST /api/auth/login
  [ ] 编写测试
  [ ] 运行验证
```

## 进度报告格式

### 向用户汇报（简洁）
```
Sprint 3 进度：3/8 任务完成（37.5%）
当前：T004 实现用户登录 API（进行中）
阻塞：T005 等待 SMTP 配置（需要您确认）
预计完成：2026-05-16
```

### 向 Orchestrator 汇报（详细）
```json
{
  "reporter": "Worker-1",
  "timestamp": "2026-05-12T10:30:00Z",
  "task_id": "T004",
  "status": "in_progress",
  "progress": "已完成 API 实现，正在编写测试",
  "steps_done": 2,
  "steps_total": 4,
  "eta_minutes": 30,
  "blockers": []
}
```

## 进度检查触发条件

| 触发事件 | 检查内容 | 更新目标 |
|---------|---------|---------|
| 任务完成 | 解锁的任务 | current_state.json |
| 任务阻塞 | 阻塞原因 | current_state.json + LanceDB |
| Sprint 结束 | 完成率、速度 | sprints/sprint-{n}.json |
| 上下文压缩前 | 当前步骤进度 | LanceDB tasks |

## 速度追踪

```python
def calculate_velocity(sprint_id: str) -> float:
    """返回本 Sprint 完成的 Story Points"""
    db = lancedb.connect(".ai-memory/lancedb")
    completed = db.open_table("tasks").search().where(
        f"sprint = '{sprint_id}' AND status = 'done'"
    ).to_list()
    
    points = {"S": 1, "M": 3, "L": 8}
    return sum(points.get(t["estimate"], 1) for t in completed)
```

## 可视化进度（文本格式）

```
Sprint 3 进度条：
████████░░░░░░░░░░░░ 37.5% (3/8)

任务状态：
✓ T001 数据库迁移
✓ T002 注册 API
✓ T003 邮件服务
→ T004 登录 API（进行中）
⚠ T005 邮件验证（阻塞）
○ T006 前端注册表单
○ T007 前端登录表单
○ T008 集成测试
```

## Hermes 增强：迭代追踪（v1.1）

### 需求梳理 SOP

每个迭代开始前，Planner 执行需求梳理：

```
<think>
当前积压需求：[列出所有 pending 需求]
本迭代容量：[基于上次 velocity 估算]
优先级判断：
  P0（必须本迭代）：[影响核心功能/阻塞其他需求]
  P1（应该本迭代）：[重要但不阻塞]
  P2（可延后）：[锦上添花]
决策：选择 [X] 个需求进入本迭代
</think>
```

输出写入 LanceDB `sprints` 表，同时更新 `requirements.sprint_id`。

### 问题记录 SOP

Agent 遇到以下情况时**自动**写入 `issues` 表：

| 触发条件 | issue.type | issue.severity |
|---------|-----------|---------------|
| 自修复第 3 次仍失败 | blocker | P0 |
| 安全漏洞发现 | bug | P0/P1 |
| 依赖缺失/环境问题 | blocker | P1 |
| 置信度 < 0.70 | risk | P2 |
| 技术债务识别 | tech_debt | P2/P3 |

```python
def auto_record_issue(task: Task, trigger: str, agent_role: str):
    issue = {
        "id": f"ISSUE-{timestamp()}",
        "project_id": task.project_id,
        "sprint_id": current_sprint_id(),
        "task_id": task.id,
        "title": f"[{trigger}] {task.title}",
        "type": classify_issue_type(trigger),
        "severity": classify_severity(trigger),
        "status": "open",
        "reported_by": agent_role,
        "created_at": now(),
    }
    db.open_table("issues").add([issue])
    # P0/P1 问题立即通知 Orchestrator
    if issue["severity"] in ("P0", "P1"):
        notify_orchestrator(issue)
```

### 迭代完成度计算

```python
def calc_sprint_completion(sprint_id: str) -> dict:
    tasks = get_sprint_tasks(sprint_id)
    completed = [t for t in tasks if t["status"] == "completed"]
    
    return {
        "completion_rate": len(completed) / len(tasks) * 100,
        "velocity": sum(story_points(t) for t in completed),
        "open_issues": count_open_issues(sprint_id),
        "avg_confidence": avg([t.get("confidence", 0.8) for t in completed]),
        "blocked_tasks": [t for t in tasks if t["status"] == "blocked"],
    }
```

### 人工介入点

以下情况 Orchestrator 主动暂停并等待人工确认：

- P0 问题超过 2 小时未解决
- 连续 3 个任务置信度 < 0.70
- 迭代完成率 < 50% 且距结束 < 2 天
- 需求优先级冲突（多个 P0 互相阻塞）
