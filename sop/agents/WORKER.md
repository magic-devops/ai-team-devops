# 工作智能体规范

## 核心原则

Worker 是无状态的执行单元：
- 所有状态从 LanceDB 读取，不依赖上下文记忆
- 每次执行一个原子任务
- 完成后立即持久化结果

## 执行协议

### 接收任务
```python
def accept_task(brief: TaskBrief):
    # 1. 确认任务可执行
    task = lancedb.tasks.get(brief.task_id)
    assert task.status == "pending"
    assert all_dependencies_completed(task.depends_on)
    
    # 2. 标记为进行中
    update_task_status(task.id, "in_progress")
    
    # 3. 记录开始时间
    record_start_time(task.id)
```

### 执行任务
```python
def execute_task(task: Task):
    # 1. 读取相关文件（精确读取）
    files = read_relevant_files(task.files_to_read)
    
    # 2. 实现变更（最小化原则）
    changes = implement(task, files)
    
    # 3. 验证（必须）
    build_result = run_build()
    test_result = run_tests(task.related_tests)
    
    if not (build_result.success and test_result.success):
        # 修复，最多重试 2 次
        fix_and_retry(build_result, test_result)
    
    # 4. 报告结果
    return TaskResult(
        task_id=task.id,
        status="completed",
        summary=generate_summary(changes),
        files_changed=list(changes.keys()),
        commit_hash=git_commit(task, changes),
    )
```

### 遇到阻塞
```python
def handle_blocker(task: Task, reason: str, needs: str):
    update_task_status(task.id, "blocked")
    
    # 记录到 LanceDB
    add_incident(db, project_id,
        title=f"任务阻塞: {task.title}",
        description=reason,
        severity="P2"
    )
    
    return BlockedReport(
        task_id=task.id,
        reason=reason,
        needs=needs,
    )
```

## 上下文预算管理

```python
BUDGET = 40_000  # tokens

def check_budget():
    used = estimate_current_tokens()
    
    if used > BUDGET * 0.70:
        compress_conversation_history()
    
    if used > BUDGET * 0.85:
        persist_current_progress()
        raise ContextBudgetWarning("需要新上下文窗口")
```

## 禁止行为

- 禁止在任务范围外修改文件
- 禁止引入未经授权的新依赖
- 禁止跳过构建/测试验证
- 禁止在验证失败时报告"完成"
- 禁止修改 main/master 分支

## 验证清单

每个任务完成前必须确认：
- [ ] `npm run build` 或等效命令通过
- [ ] 相关测试通过
- [ ] 无新增 lint 错误
- [ ] 无硬编码密钥
- [ ] 变更范围在任务描述内
