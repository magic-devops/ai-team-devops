# 并发开发最佳实践

## 并发开发的核心挑战

```
1. 文件冲突：多个 Agent 同时修改同一文件
2. 状态竞争：多个 Agent 同时更新任务状态
3. 依赖违反：Agent B 在 Agent A 完成前就开始依赖 A 的输出
4. 上下文隔离：Agent 之间不应共享上下文（避免污染）
5. 结果整合：多个 Agent 的输出需要一致性合并
```

## 并发安全的任务设计

### 好的并发任务（可以并行）

```yaml
# 修改不同文件，无共享状态
T001:
  files: [src/auth/login.ts, src/auth/login.test.ts]
T002:
  files: [src/email/sender.ts, src/email/sender.test.ts]
T003:
  files: [src/user/profile.ts, src/user/profile.test.ts]
# T001, T002, T003 可以完全并行
```

### 危险的并发任务（必须串行）

```yaml
# 修改同一文件
T004:
  files: [src/config/database.ts]  # ← 冲突！
T005:
  files: [src/config/database.ts]  # ← 冲突！

# 有数据依赖
T006:
  output: "UserService 接口定义"
T007:
  depends_on: [T006]  # 必须等 T006 完成
  input: "UserService 接口"
```

## 并发执行模式

### 模式 1：扇出-扇入（Fan-out / Fan-in）

```
需求
  │
  ▼ 拆解
  ├── T001（独立）──► Worker-1
  ├── T002（独立）──► Worker-2  ──► 整合 ──► 下一阶段
  └── T003（独立）──► Worker-3
```

适用：功能模块相互独立的情况

### 模式 2：流水线（Pipeline）

```
T001 ──► T002 ──► T003 ──► T004
（数据库）（API）（前端）（测试）
```

适用：有严格依赖链的情况，每个阶段可以内部并行

### 模式 3：混合模式（实际最常用）

```
T001（DB迁移）
    │
    ├──► T002（API-1）──► Worker-1 ─┐
    ├──► T003（API-2）──► Worker-2 ─┤──► T006（集成测试）
    └──► T004（邮件）──► Worker-3 ─┘
         │
         └──► T005（前端）──► Worker-4（T002完成后启动）
```

## 并发状态同步

### 乐观并发控制

```python
def complete_task_optimistic(task_id: str, result: TaskResult):
    """使用乐观锁避免并发更新冲突"""
    max_retries = 3
    
    for attempt in range(max_retries):
        task = get_task(task_id)
        
        # 检查状态是否已被其他 Agent 修改
        if task.status == "completed":
            return  # 已完成，跳过
        if task.status != "in_progress":
            raise StateConflict(f"任务状态异常: {task.status}")
        
        try:
            update_task_status(task_id, "completed", version=task.version)
            break
        except VersionConflict:
            if attempt == max_retries - 1:
                raise
            time.sleep(0.1 * (attempt + 1))  # 指数退避
```

## 并发监控仪表板

```
实时状态（每 30 秒刷新）：

Worker 状态:
  Worker-1: [T001] 实现登录 API          ████████░░ 80%
  Worker-2: [T003] 实现邮件服务          ████░░░░░░ 40%
  Worker-3: idle

任务队列:
  待执行: T004, T005, T006 (3个)
  执行中: T001, T003 (2个)
  已完成: T002 (1个)
  阻塞中: 无

文件锁:
  src/auth/login.ts     → T001
  src/email/sender.ts   → T003

预计完成时间: ~45分钟
```

## 并发调试技巧

### 追踪并发问题

```bash
# 查看所有 Agent 的活动日志
tail -f .ai-memory/activity.log | grep -E "DISPATCH|COMPLETE|BLOCKED|CONFLICT"

# 查看文件锁状态
python3 -c "
import lancedb
db = lancedb.connect('.ai-memory/lancedb')
locks = db.open_table('file_locks').search().to_list()
for lock in locks:
    print(f'{lock[\"file_path\"]:50} → {lock[\"task_id\"]}')
"
```

### 常见并发问题诊断

| 症状 | 可能原因 | 解决方法 |
|------|---------|---------|
| 任务长期 in_progress | Worker 崩溃 | 检查 activity.log，重置任务 |
| 文件锁未释放 | Worker 异常退出 | 清理过期锁（TTL 30分钟） |
| 任务重复执行 | 状态同步延迟 | 检查乐观锁实现 |
| 合并冲突频繁 | 任务粒度太粗 | 重新拆分任务，减少文件重叠 |
