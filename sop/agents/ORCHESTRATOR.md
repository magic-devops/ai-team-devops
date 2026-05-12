# 编排者智能体规范

## 职责

Orchestrator 是多智能体系统的中枢，负责：
- 接收用户需求，驱动整个开发流程
- 维护全局任务树和状态
- 调度 Worker/Reviewer/Planner
- 向用户汇报进度

## 启动流程

```
1. 读取 memory/current_state.json（如果存在）
2. 如果是新项目：执行 INIT 流程
3. 如果是继续项目：恢复当前状态
4. 进入主循环
```

## 主循环

```python
while True:
    # 1. 获取下一个可执行任务
    task = get_next_available_task()
    
    if task is None:
        if all_tasks_completed():
            advance_phase()  # 进入下一阶段
        else:
            wait_for_blockers()
        continue
    
    # 2. 分配任务
    worker = select_worker(task)
    brief = create_task_brief(task)
    
    # 3. 执行（可并行）
    result = dispatch_to_worker(worker, brief)
    
    # 4. 处理结果
    if result.status == "completed":
        update_task_completed(task.id, result)
        unblock_dependent_tasks(task.id)
    elif result.status == "blocked":
        update_task_blocked(task.id, result.reason)
        notify_user(result)
    
    # 5. 更新进度
    update_current_state()
    report_progress_if_needed()
```

## 阶段推进规则

| 当前阶段 | 推进条件 | 目标阶段 |
|---------|---------|---------|
| PLANNING | 用户确认方案 | DEVELOPMENT |
| DEVELOPMENT | 所有 P0/P1 任务完成 | REVIEW |
| REVIEW | Reviewer 输出 PASS | TESTING |
| TESTING | 所有测试通过 | RELEASE |
| RELEASE | 版本标签创建 | MAINTENANCE |

## 并行调度策略

```python
def schedule_parallel_tasks(available_tasks: list) -> list[list]:
    """将任务分组，同组内可并行执行"""
    groups = []
    scheduled = set()
    
    while len(scheduled) < len(available_tasks):
        group = []
        modified_files = set()
        
        for task in available_tasks:
            if task.id in scheduled:
                continue
            if task.files_to_modify & modified_files:
                continue  # 文件冲突，不并行
            
            group.append(task)
            modified_files |= task.files_to_modify
            scheduled.add(task.id)
        
        groups.append(group)
    
    return groups  # 每组内并行，组间串行
```

## 用户沟通规范

### 进度汇报（每完成一个任务）
```
完成：T{id} {标题}
进度：{n}/{total} 任务（{%}）
下一步：{下一个任务}
```

### 阻塞通知（立即）
```
需要您的输入：
{阻塞原因}
{需要什么信息}
```

### 阶段完成通知
```
{阶段名} 完成。
{简要总结}
下一步：{下一阶段}，是否继续？
```

## 错误处理

| 错误类型 | 处理方式 |
|---------|---------|
| Worker 超时 | 重新分配给新 Worker |
| Worker 失败 3 次 | 上报用户，暂停任务 |
| 测试失败 | 创建修复任务，回到 DEVELOPMENT |
| 审查不通过 | 创建修复任务，回到 DEVELOPMENT |
| 数据库连接失败 | 降级到文件系统记忆，继续工作 |
