# 需求变更管理

## 变更类型

| 类型 | 描述 | 处理方式 |
|------|------|---------|
| 紧急修复 | 生产 Bug，P0 | 立即中断当前 Sprint，插入修复任务 |
| 需求澄清 | 原需求理解有误 | 更新任务描述，不计入变更 |
| 范围扩展 | 新增功能 | 评估影响，加入 backlog 或下个 Sprint |
| 需求变更 | 已有功能改变 | 评估影响，可能需要回滚已完成工作 |
| 优先级调整 | 任务顺序变化 | 重新排序，不影响已完成任务 |

## 变更影响评估

```python
def assess_change_impact(change: ChangeRequest) -> ChangeImpact:
    affected_tasks = find_affected_tasks(change)
    completed_affected = [t for t in affected_tasks if t.status == "completed"]
    
    return ChangeImpact(
        affected_tasks=affected_tasks,
        completed_tasks_to_redo=completed_affected,
        estimated_extra_work=estimate_work(affected_tasks),
        risk_level="HIGH" if completed_affected else "LOW",
        recommendation=generate_recommendation(change, affected_tasks),
    )
```

## 变更处理 SOP

### Step 1: 接收变更请求
```
记录变更请求到 LanceDB requirements（status=change_requested）
```

### Step 2: 影响评估
```
识别受影响的任务
评估工作量
评估风险
```

### Step 3: 用户确认
```
向用户展示：
- 受影响的任务列表
- 需要重做的已完成工作
- 额外工作量估算
- 建议处理方式

等待用户确认
```

### Step 4: 执行变更
```
如果有已完成任务需要修改：
  1. 创建回滚任务（revert 相关提交）
  2. 更新任务描述
  3. 重置任务状态为 pending

更新 backlog
重新排序任务
通知 Orchestrator 重新调度
```

## 变更记录格式

```json
{
  "change_id": "CHG-{timestamp}",
  "type": "scope_expansion",
  "description": "用户要求添加手机号登录支持",
  "requested_at": "2026-05-12T14:00:00Z",
  "requested_by": "user",
  "impact": {
    "affected_tasks": ["T004", "T005"],
    "completed_tasks_to_redo": [],
    "extra_work_estimate": "M",
    "risk_level": "LOW"
  },
  "status": "approved",
  "approved_at": "2026-05-12T14:05:00Z",
  "new_tasks_created": ["T009", "T010"]
}
```

## 变更冻结期

Sprint 最后 2 天进入变更冻结期：
- 不接受新的范围扩展
- 只接受紧急修复（P0）
- 其他变更加入下个 Sprint backlog

```python
def is_change_freeze() -> bool:
    sprint = get_current_sprint()
    days_remaining = (sprint.end_date - today()).days
    return days_remaining <= 2
```
