# 错误恢复 SOP

## 错误分类

| 级别 | 描述 | 响应时间 | 处理方式 |
|------|------|---------|---------|
| P0 | 生产中断、数据丢失风险 | 立即 | 中断所有任务，专注修复 |
| P1 | 核心功能损坏 | 1小时内 | 暂停当前 Sprint，插入修复 |
| P2 | 功能降级，有 workaround | 当天 | 加入当前 Sprint |
| P3 | 轻微问题，不影响使用 | 下个 Sprint | 加入 backlog |

## P0 紧急响应流程

```
发现 P0 问题
    │
    ▼
立即通知用户（一句话说清楚影响）
    │
    ▼
暂停所有正在进行的任务
    │
    ▼
创建 INC-{id} 记录
    │
    ▼
快速定位根因（目标：5分钟内）
    │
    ├── 找到根因 → 最小化修复 → 验证 → 部署
    │
    └── 未找到 → 回滚到上一个稳定版本 → 再定位
    │
    ▼
验证修复（生产环境冒烟测试）
    │
    ▼
事后复盘（24小时内）
    │
    ▼
提取预防规则 → 写入规则库
```

## Agent 崩溃恢复

### 场景：Worker 在任务中途崩溃

```python
def recover_crashed_worker(task_id: str):
    task = get_task(task_id)
    
    # 1. 检查任务状态
    if task.status != "in_progress":
        return  # 已经被处理
    
    # 2. 检查是否有交接包
    handoff = get_latest_handoff(task_id)
    
    if handoff and handoff.age_minutes < 60:
        # 从交接包恢复
        resume_from_handoff(handoff.id)
    else:
        # 重置任务，重新执行
        update_task_status(task_id, "pending")
        log_recovery_event(task_id, "reset_to_pending")
```

### 场景：上下文窗口耗尽

```python
def handle_context_exhausted(task_id: str, completed_steps: list, next_step: str):
    # 1. 持久化当前进度
    handoff = create_handoff_package(
        task_id=task_id,
        completed_steps=completed_steps,
        next_step=next_step,
    )
    
    # 2. 通知 Orchestrator
    notify_orchestrator({
        "event": "context_exhausted",
        "task_id": task_id,
        "handoff_id": handoff.id,
        "resume_prompt": handoff.resume_prompt,
    })
    
    # 3. 新实例接续
    # Orchestrator 用 resume_prompt 启动新 Worker
```

### 场景：LanceDB 不可用

```python
def handle_db_unavailable():
    # 降级到文件系统模式
    switch_to_filesystem_backend()
    
    # 记录降级事件
    append_to_file(".ai-memory/degradation.log",
        f"{now()}: LanceDB unavailable, switched to filesystem mode")
    
    # 继续工作（功能降级但不中断）
    log_warning("记忆系统降级：向量搜索不可用，使用文件系统模式")
```

## 数据一致性恢复

### 检测不一致

```python
def check_consistency():
    """检查 LanceDB 状态与 Git 状态是否一致"""
    db_completed = get_completed_task_ids()
    git_commits = get_task_ids_from_git_log()
    
    # 在 DB 中标记完成但没有对应 commit 的任务
    inconsistent = db_completed - git_commits
    
    for task_id in inconsistent:
        log_warning(f"任务 {task_id} 在 DB 中标记完成，但无对应 Git commit")
        # 重置为 pending，重新执行
        update_task_status(task_id, "pending")
```

### 修复不一致

```python
def repair_state():
    """从 Git 历史重建任务状态"""
    commits = get_all_commits_with_task_ids()
    
    for commit in commits:
        task_id = extract_task_id(commit.message)
        if task_id:
            ensure_task_completed(task_id, commit.hash)
```

## 常见错误处理手册

### 错误：测试环境数据库连接失败
```
原因：通常是 Docker 未启动或端口冲突
处理：
  1. 检查 Docker 状态
  2. 检查端口占用
  3. 重启数据库容器
  4. 不要修改代码来绕过
```

### 错误：npm install 失败（网络问题）
```
处理：
  1. 检查网络连接
  2. 尝试使用镜像源
  3. 检查 package.json 中的版本约束
  4. 不要删除 package-lock.json
```

### 错误：Git merge conflict 无法自动解决
```
处理：
  1. 读取冲突文件，理解两侧意图
  2. 手动合并（保留两侧功能）
  3. 运行测试验证
  4. 如果超过 3 个文件冲突，上报用户
```

### 错误：AI 输出不符合预期（连续 2 次）
```
处理：
  1. 停止重试相同方法
  2. 分析根因：是任务描述不清？还是技术障碍？
  3. 重新拆解任务
  4. 如果是技术障碍，记录到 incidents，上报用户
```
