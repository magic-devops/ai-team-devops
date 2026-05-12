# 上下文压缩策略

## 压缩触发条件

```python
COMPRESS_THRESHOLD = 0.70   # 70% 预算时开始压缩
PERSIST_THRESHOLD = 0.85    # 85% 预算时强制持久化
HARD_LIMIT = 0.95           # 95% 预算时停止新操作
```

## 压缩策略

### 策略 1：对话历史压缩

**保留**（不压缩）：
- 用户的明确指令
- 错误信息和堆栈
- 关键决策点
- 当前任务的完成标准

**压缩**（替换为摘要）：
- 中间推理过程
- 重复的工具调用结果
- 已完成步骤的详细日志

**删除**：
- 已完成任务的完整执行过程
- 重复读取同一文件的结果
- 探索性的失败尝试（保留结论，删除过程）

### 策略 2：代码上下文压缩

```python
# 压缩前：读取整个文件
content = read_file("src/services/email.ts")  # 200行

# 压缩后：只保留相关函数签名
signatures = extract_signatures("src/services/email.ts")
# → "class EmailService { send(mail: Mail): Promise<Result>; ... }"
```

### 策略 3：任务上下文压缩

```python
# 压缩前：完整任务列表（20个任务）
tasks = get_all_tasks()

# 压缩后：只保留关键任务
compressed = {
    "current": get_task(current_task_id),
    "next_3": get_pending_tasks(limit=3),
    "blocked": get_blocked_tasks(),
}
```

## 压缩执行流程

```
检测到 70% 预算
    │
    ▼
压缩对话历史（保留关键信息）
    │
    ▼
检测到 85% 预算？
    │ 是
    ▼
持久化当前状态到 LanceDB
    │
    ▼
创建"续接任务"（包含恢复上下文）
    │
    ▼
完成当前原子操作
    │
    ▼
报告需要新上下文窗口
```

## 续接任务格式

当需要在新上下文中继续时，创建续接任务：

```json
{
  "type": "RESUME",
  "task_id": "T004",
  "checkpoint": {
    "steps_completed": ["读取文件", "实现 API"],
    "next_step": "编写测试",
    "files_modified": ["src/auth/login.ts"],
    "key_decisions": ["使用 bcrypt 而非 argon2，因为项目已有依赖"],
    "pending_issues": []
  },
  "restore_prompt": "继续任务 T004。已完成：读取文件、实现 API。下一步：编写测试。相关文件：src/auth/login.ts"
}
```

## Token 节省技巧

| 技巧 | 节省量 | 适用场景 |
|------|--------|---------|
| grep 定位后精确读取 | 60-80% | 大文件中找特定函数 |
| 子智能体隔离探索 | 100%（主上下文） | 广泛的代码库探索 |
| 函数签名替代函数体 | 70-90% | 只需了解接口时 |
| 增量 Edit 替代 Write | 50-80% | 修改现有文件 |
| 压缩历史对话 | 30-50% | 长对话中 |
| 只加载当前 Sprint 任务 | 60-70% | 任务列表很长时 |

## 压缩质量检验

压缩后验证：
- [ ] 当前任务的完成标准仍然清晰
- [ ] 关键约束条件仍然可见
- [ ] 已完成步骤的结论仍然保留
- [ ] 下一步操作仍然明确
