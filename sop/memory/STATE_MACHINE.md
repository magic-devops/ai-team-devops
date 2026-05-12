# 状态机规范

## 项目状态机

```
INIT
  │ 任务树创建完成
  ▼
PLANNING
  │ 方案确认
  ▼
DEVELOPMENT ◄──────────────────┐
  │ 所有任务完成                │
  ▼                            │
REVIEW                         │
  │ 审查通过                   │ 发现问题
  ▼                            │
TESTING                        │
  │ 测试通过                   │
  ▼                            │
RELEASE ───────────────────────┘
  │ 发布完成
  ▼
MAINTENANCE
  │ 新需求/新 Sprint
  ▼
PLANNING（下一迭代）
```

## 任务状态机

```
pending
  │ 依赖完成，开始执行
  ▼
in_progress
  │ 完成          │ 遇到阻塞
  ▼               ▼
completed       blocked
                  │ 阻塞解除
                  ▼
              in_progress
```

## 状态转换规则

### 项目状态转换

| 当前状态 | 触发事件 | 目标状态 | 前置条件 |
|---------|---------|---------|---------|
| INIT | 任务树创建 | PLANNING | 项目记忆初始化完成 |
| PLANNING | 方案确认 | DEVELOPMENT | 用户/负责人确认 |
| DEVELOPMENT | 所有任务完成 | REVIEW | tasks.pending = 0 |
| REVIEW | 审查通过 | TESTING | Reviewer 输出 PASS |
| REVIEW | 发现问题 | DEVELOPMENT | 创建修复任务 |
| TESTING | 测试通过 | RELEASE | 所有测试绿色 |
| TESTING | 测试失败 | DEVELOPMENT | 创建修复任务 |
| RELEASE | 发布完成 | MAINTENANCE | 版本标签创建 |
| MAINTENANCE | 新需求 | PLANNING | 需求记录到 LanceDB |

### 任务状态转换

| 当前状态 | 触发事件 | 目标状态 | 执行者 |
|---------|---------|---------|--------|
| pending | 开始执行 | in_progress | Worker |
| in_progress | 完成验证 | completed | Worker |
| in_progress | 遇到阻塞 | blocked | Worker |
| blocked | 阻塞解除 | in_progress | Orchestrator |
| pending/in_progress | 需求取消 | cancelled | Orchestrator |

## 状态持久化

每次状态转换必须：
1. 更新 `memory/current_state.json`
2. 更新 LanceDB 对应记录
3. 记录转换时间戳

```python
def transition_state(entity_type: str, entity_id: str,
                     from_state: str, to_state: str, reason: str = ""):
    # 验证转换合法性
    assert is_valid_transition(entity_type, from_state, to_state), \
        f"非法状态转换: {from_state} → {to_state}"
    
    # 更新 LanceDB
    db = lancedb.connect(".ai-memory/lancedb")
    db.open_table(entity_type + "s").update(
        where=f"id = '{entity_id}'",
        values={
            "status": to_state,
            "updated_at": now(),
        }
    )
    
    # 更新 current_state.json
    update_current_state(entity_type, entity_id, to_state)
    
    # 记录转换日志
    log_transition(entity_type, entity_id, from_state, to_state, reason)
```

## 非法状态检测

以下状态组合表示系统异常，需要人工介入：

- 任务 `in_progress` 超过 4 小时无更新
- 任务 `blocked` 超过 24 小时未解除
- 项目 `DEVELOPMENT` 阶段超过 2 个 Sprint 无进展
- `completed` 任务数量减少（不允许，只能 revert）
