# 多智能体协调协议

## 通信模型

```
用户
 │
 ▼
Orchestrator ──── 全局任务树 ────► LanceDB
 │
 ├──► Planner（规划子任务）
 ├──► Worker-1（执行任务 A）
 ├──► Worker-2（执行任务 B，并行）
 └──► Reviewer（审查完成的任务）
```

## 任务分配协议

### Orchestrator → Worker 分配格式
```json
{
  "task_id": "T003",
  "title": "实现邮件发送服务",
  "context": {
    "files_to_read": ["src/services/email.ts", "src/config/email.ts"],
    "related_tasks_done": ["T001", "T002"],
    "constraints": ["使用现有 nodemailer 依赖，不引入新包"],
    "done_when": "send() 函数测试通过，支持 HTML 模板"
  },
  "context_budget": 40000,
  "timeout_minutes": 60
}
```

### Worker → Orchestrator 完成报告格式
```json
{
  "task_id": "T003",
  "status": "completed",
  "summary": "实现了 EmailService.send()，支持 HTML 模板，测试覆盖正常/失败两个路径",
  "files_changed": ["src/services/email.ts", "src/services/email.test.ts"],
  "commit_hash": "abc1234",
  "unblocked_tasks": ["T005"]
}
```

### Worker → Orchestrator 阻塞报告格式
```json
{
  "task_id": "T003",
  "status": "blocked",
  "reason": "SMTP 配置缺失，.env 中没有 MAIL_HOST 变量",
  "needs": "确认 SMTP 服务器地址和认证方式",
  "suggestion": "可以先用 Mailtrap 测试账号"
}
```

## 并行执行规则

### 可以并行的条件
- 任务之间无依赖关系
- 修改不同的文件/模块
- 不共享可变状态

### 禁止并行的情况
- 修改同一文件
- 有依赖关系（B 依赖 A 的输出）
- 数据库迁移任务（必须串行）

### 并行度限制
- 最大并行 Worker 数：3
- 超过时按优先级排队

## 上下文传递规范

### 最小上下文原则
Orchestrator 给 Worker 的上下文只包含：
1. 任务描述（必须）
2. 需要读取的文件列表（必须）
3. 相关约束（必须）
4. 完成标准（必须）
5. 相关历史（可选，从 LanceDB 检索，最多 3 条）

**不传递**：完整的项目代码、其他任务的详细内容、历史对话

### 结果摘要原则
Worker 返回给 Orchestrator 的结果只包含：
1. 状态（completed/blocked/failed）
2. 一句话摘要
3. 变更的文件列表
4. 解锁的任务列表

**不返回**：完整的代码内容、详细的执行日志

## 冲突解决

### 文件冲突
两个 Worker 同时修改同一文件时：
1. 后完成的 Worker 负责合并
2. 合并后重新运行测试
3. 如果合并复杂，上报 Orchestrator 串行处理

### 决策冲突
两个 Worker 对同一问题有不同方案时：
1. 上报 Orchestrator
2. Orchestrator 记录决策到 LanceDB decisions
3. 统一执行一个方案

## 智能体生命周期

```
创建 → 接收任务 → 执行 → 报告 → 等待/销毁
         │                │
         ▼                ▼
      持久化状态        持久化结果
      到 LanceDB       到 LanceDB
```

智能体实例是无状态的，所有状态存在 LanceDB 中。
同一任务可以由不同的智能体实例接续执行。
