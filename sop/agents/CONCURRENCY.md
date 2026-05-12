# 并发冲突管理

## 问题场景

多个 Worker 并行执行时可能发生：
- 同时修改同一文件（写-写冲突）
- 同时读取后修改（读-写冲突）
- 同时写入 LanceDB 同一记录
- Git 分支合并冲突

## 文件级锁机制

### 锁注册表（存储在 LanceDB）

```python
# collection: file_locks
schema = {
    "file_path": str,       # 锁定的文件路径
    "task_id": str,         # 持有锁的任务
    "agent_id": str,        # 持有锁的 Agent 实例
    "acquired_at": datetime,
    "expires_at": datetime, # 防止死锁：最长持有 30 分钟
}
```

### 锁操作

```python
LOCK_TTL_MINUTES = 30

def acquire_file_lock(file_path: str, task_id: str, agent_id: str) -> bool:
    db = lancedb.connect(".ai-memory/lancedb")
    locks = db.open_table("file_locks")
    
    # 清理过期锁
    locks.delete(f"expires_at < '{now()}'")
    
    # 检查是否已被锁定
    existing = locks.search().where(f"file_path = '{file_path}'").to_list()
    if existing:
        return False  # 锁定失败
    
    # 获取锁
    locks.add([{
        "file_path": file_path,
        "task_id": task_id,
        "agent_id": agent_id,
        "acquired_at": now(),
        "expires_at": now() + timedelta(minutes=LOCK_TTL_MINUTES),
    }])
    return True

def release_file_lock(file_path: str, task_id: str):
    db = lancedb.connect(".ai-memory/lancedb")
    db.open_table("file_locks").delete(
        f"file_path = '{file_path}' AND task_id = '{task_id}'"
    )

def with_file_lock(file_path: str, task_id: str, agent_id: str):
    """上下文管理器：自动获取和释放锁"""
    if not acquire_file_lock(file_path, task_id, agent_id):
        raise FileLockConflict(file_path, task_id)
    try:
        yield
    finally:
        release_file_lock(file_path, task_id)
```

## 任务调度冲突预防

Orchestrator 在分配任务前进行冲突检测：

```python
def check_task_conflicts(task: Task, running_tasks: list[Task]) -> list[str]:
    """返回冲突的任务 ID 列表"""
    conflicts = []
    task_files = set(task.files_to_modify)
    
    for running in running_tasks:
        running_files = set(running.files_to_modify)
        if task_files & running_files:  # 有交集
            conflicts.append(running.id)
    
    return conflicts

def schedule_task(task: Task, running_tasks: list[Task]):
    conflicts = check_task_conflicts(task, running_tasks)
    if conflicts:
        # 等待冲突任务完成后再调度
        task.wait_for = conflicts
        queue_task(task)
    else:
        dispatch_task(task)
```

## Git 冲突解决 SOP

### 预防（首选）
- 每个 Worker 在独立分支工作
- 分支命名：`feature/T{id}-{description}`
- 频繁 rebase（每完成一个子步骤）

### 发生冲突时

```
检测到合并冲突
    │
    ▼
冲突文件数量？
    ├── 1-3 个文件 → Worker 自行解决
    │       │
    │       ▼
    │   读取冲突文件
    │   理解两侧变更意图
    │   合并（保留两侧功能）
    │   运行测试验证
    │
    └── >3 个文件 → 上报 Orchestrator 串行处理
```

### 冲突解决原则
1. 理解两侧变更的**意图**，不是机械合并
2. 功能不能丢失（两侧的功能都要保留）
3. 合并后必须运行完整测试
4. 记录冲突原因到 LanceDB incidents

## LanceDB 并发写入

LanceDB 支持多进程并发写入，但需注意：

```python
# 安全：不同 collection 可以并发写入
# 安全：同一 collection 的 add 操作是原子的

# 危险：read-modify-write 模式需要应用层锁
def safe_update_task_status(task_id: str, new_status: str):
    # 使用乐观锁：检查版本号
    task = get_task(task_id)
    if task.status == "completed":
        return  # 已被其他 Agent 完成，跳过
    
    update_task_status(task_id, new_status)
```

## 死锁检测

```python
def detect_deadlock(running_tasks: list[Task]) -> bool:
    """检测循环等待"""
    wait_graph = {t.id: t.wait_for for t in running_tasks}
    
    def has_cycle(node, visited, path):
        visited.add(node)
        path.add(node)
        for neighbor in wait_graph.get(node, []):
            if neighbor not in visited:
                if has_cycle(neighbor, visited, path):
                    return True
            elif neighbor in path:
                return True
        path.discard(node)
        return False
    
    visited = set()
    for task_id in wait_graph:
        if task_id not in visited:
            if has_cycle(task_id, visited, set()):
                return True
    return False
```

死锁发生时：取消等待时间最长的任务，重新调度。
