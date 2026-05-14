# 交接协议

## 场景

交接发生在：
1. 上下文窗口耗尽，需要新实例继续
2. 任务从一个 Worker 转移到另一个
3. 跨 Sprint 的任务延续

## 交接包格式

```json
{
  "handoff_id": "HO-{timestamp}",
  "from_agent": "Worker-1",
  "to_agent": "Worker-2",
  "task_id": "T004",
  "created_at": "2026-05-12T11:30:00Z",
  
  "completed_steps": [
    "读取相关文件",
    "实现 POST /api/v1/auth/login 端点",
    "添加输入校验"
  ],
  
  "next_step": "编写集成测试",
  
  "current_state": {
    "files_modified": ["src/auth/login.ts"],
    "files_to_read": ["src/auth/login.test.ts"],
    "build_status": "passing",
    "test_status": "not_run_yet"
  },
  
  "key_decisions": [
    "使用 bcrypt（cost=12）而非 argon2，因为项目已有 bcrypt 依赖",
    "登录失败统一返回 401，不区分用户不存在/密码错误（防枚举）"
  ],
  
  "known_issues": [],
  
  "resume_prompt": "继续任务 T004（用户登录 API）。已完成：实现端点和输入校验。下一步：在 src/auth/login.test.ts 中编写集成测试，覆盖：正常登录、密码错误、用户不存在三个场景。注意：登录失败统一返回 401。"
}
```

## 交接流程

### 发起方（From Agent）

```python
def initiate_handoff(task_id: str, reason: str):
    # 1. 持久化当前进度
    persist_progress(task_id)
    
    # 2. 创建交接包
    handoff = create_handoff_package(task_id)
    
    # 3. 写入 LanceDB
    save_handoff(handoff)
    
    # 4. 更新任务状态（保持 in_progress，不改变）
    add_task_note(task_id, f"交接给新实例，交接包 ID: {handoff.id}")
    
    return handoff
```

### 接收方（To Agent）

```python
def resume_from_handoff(handoff_id: str):
    # 1. 读取交接包
    handoff = load_handoff(handoff_id)
    
    # 2. 验证状态一致性
    task = lancedb.tasks.get(handoff.task_id)
    assert task.status == "in_progress"
    
    # 3. 读取必要文件（只读 next_step 需要的）
    files = read_files(handoff.current_state.files_to_read)
    
    # 4. 从 next_step 继续执行
    execute_from_step(handoff.next_step, handoff.key_decisions)
```

## 交接质量要求

交接包必须满足：
- `resume_prompt` 足够清晰，新实例无需读取历史对话即可继续
- `key_decisions` 包含所有影响后续步骤的决策
- `next_step` 是具体可执行的操作，不是模糊描述
- `files_modified` 列表完整准确

## 交接验证

接收方在开始执行前验证：
- [ ] 交接包中的文件确实存在
- [ ] build_status 与实际构建结果一致
- [ ] key_decisions 没有与项目规范冲突的内容
