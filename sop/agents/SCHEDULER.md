# 并发调度器规范

## 调度器架构

```
┌─────────────────────────────────────────────────────────┐
│                    Scheduler                             │
│                                                         │
│  Task Queue (优先级队列)                                  │
│  ┌─────┬─────┬─────┬─────┬─────┐                       │
│  │ P0  │ P0  │ P1  │ P1  │ P2  │  ...                  │
│  └─────┴─────┴─────┴─────┴─────┘                       │
│                                                         │
│  Worker Pool                                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐               │
│  │ Worker-1 │ │ Worker-2 │ │ Worker-3 │               │
│  │ [T001]   │ │ [T003]   │ │  idle    │               │
│  └──────────┘ └──────────┘ └──────────┘               │
│                                                         │
│  Conflict Map: {file_path → task_id}                   │
└─────────────────────────────────────────────────────────┘
```

## 调度算法

```python
class Scheduler:
    MAX_WORKERS = 3
    
    def __init__(self, db_path: str):
        self.db = lancedb.connect(db_path)
        self.running: dict[str, Task] = {}   # task_id → Task
        self.file_locks: dict[str, str] = {} # file_path → task_id
    
    def tick(self):
        """调度循环，每次选取可执行任务"""
        if len(self.running) >= self.MAX_WORKERS:
            return  # Worker 已满
        
        available = self._get_available_tasks()
        
        for task in available:
            if len(self.running) >= self.MAX_WORKERS:
                break
            
            if self._can_schedule(task):
                self._dispatch(task)
    
    def _get_available_tasks(self) -> list[Task]:
        """获取依赖已满足、未被调度的任务，按优先级排序"""
        all_pending = get_pending_tasks(self.db)
        completed_ids = get_completed_task_ids(self.db)
        
        available = [
            t for t in all_pending
            if all(dep in completed_ids for dep in t.depends_on)
            and t.id not in self.running
        ]
        
        # 优先级排序：P0 > P1 > P2 > P3，同优先级按创建时间
        return sorted(available, key=lambda t: (t.priority, t.created_at))
    
    def _can_schedule(self, task: Task) -> bool:
        """检查文件冲突"""
        for f in task.files_to_modify:
            if f in self.file_locks:
                return False
        return True
    
    def _dispatch(self, task: Task):
        """分配任务给 Worker"""
        # 注册文件锁
        for f in task.files_to_modify:
            self.file_locks[f] = task.id
        
        self.running[task.id] = task
        update_task_status(self.db, task.id, "in_progress")
        
        # 启动 Worker（子智能体）
        spawn_worker(task)
    
    def on_task_complete(self, task_id: str, result: TaskResult):
        """Worker 完成回调"""
        task = self.running.pop(task_id)
        
        # 释放文件锁
        for f in task.files_to_modify:
            self.file_locks.pop(f, None)
        
        # 更新状态
        update_task_status(self.db, task_id, "completed")
        
        # 触发下一轮调度
        self.tick()
```

## 调度策略

### 关键路径优先（CPM）

```python
def calculate_critical_path(tasks: list[Task]) -> list[str]:
    """计算关键路径，优先调度关键路径上的任务"""
    # 计算每个任务的最晚开始时间
    # 最晚开始时间最早的任务在关键路径上
    ...
```

### 工作窃取（Work Stealing）

当某个 Worker 空闲而其他 Worker 繁忙时：
- 空闲 Worker 可以"窃取"繁忙 Worker 队列中的独立子任务
- 前提：子任务没有文件冲突

## 调度监控

```python
def get_scheduler_status() -> dict:
    return {
        "running_tasks": len(scheduler.running),
        "queued_tasks": len(get_pending_tasks()),
        "blocked_tasks": len(get_blocked_tasks()),
        "file_locks": len(scheduler.file_locks),
        "throughput": tasks_completed_last_hour(),
        "avg_wait_time_minutes": avg_queue_wait_time(),
    }
```

## 调度日志格式

```
[SCHEDULER] 2026-05-12T10:00:00Z DISPATCH T003 → Worker-2 (files: src/email.ts)
[SCHEDULER] 2026-05-12T10:00:01Z SKIP T004 (conflict: src/email.ts locked by T003)
[SCHEDULER] 2026-05-12T10:45:00Z COMPLETE T003 (45min, locks released)
[SCHEDULER] 2026-05-12T10:45:01Z DISPATCH T004 → Worker-2 (unblocked)
```
