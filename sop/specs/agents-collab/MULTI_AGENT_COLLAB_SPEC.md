# 多 Agent 协同开发规范

> 版本: v1.0 | 更新: 2026-05-12
> 本文件是 `agents/COORDINATOR.md` 的补充，专注于实际协同场景的操作规范。

## 1. Agent 角色与职责矩阵

| 角色 | 职责 | 可并行数 | 上下文预算 |
|------|------|---------|-----------|
| Orchestrator | 任务分配、进度追踪、用户沟通 | 1 | 50K |
| Planner | 需求分析、任务拆解 | 1 | 30K |
| Coder-Frontend | 前端实现 | 3 | 40K |
| Coder-Backend | 后端实现 | 3 | 40K |
| Coder-Mobile | 移动端实现 | 2 | 40K |
| Reviewer | 代码审查 | 2 | 20K |
| Tester | 测试编写与执行 | 2 | 25K |
| Debugger | 问题诊断 | 1 | 35K |

## 2. 任务分配协议

### Orchestrator → Worker 分配格式
```json
{
  "task_id": "T003",
  "role": "Coder-Frontend",
  "title": "实现用户登录页面",
  "tech_stack": "vue3",
  "specs_to_load": [
    "specs/frontend/FRONTEND_SPEC.md",
    "specs/frontend/VUE3_SPEC.md"
  ],
  "files_to_read": ["src/pages/auth/", "src/api/modules/auth.ts"],
  "context_budget": 40000,
  "done_when": "登录表单提交成功，错误状态正确显示，测试通过",
  "constraints": ["使用现有 TDesign 组件", "不引入新依赖"]
}
```

### Worker → Orchestrator 完成报告
```json
{
  "task_id": "T003",
  "status": "completed",
  "summary": "实现登录页面，含表单验证和错误提示，测试覆盖正常/失败两个路径",
  "files_changed": ["src/pages/auth/LoginPage.vue", "src/pages/auth/LoginPage.test.ts"],
  "unblocked_tasks": ["T005", "T006"]
}
```

## 3. 并行开发场景

### 场景 A：前后端并行开发

```
Planner 输出 API 契约（OpenAPI Spec）
    │
    ├──► Coder-Frontend（基于 Mock 开发）
    │         └── 使用 msw 或 json-server mock API
    │
    └──► Coder-Backend（实现真实 API）
              └── 确保实现符合 OpenAPI Spec

整合阶段：替换 Mock → 联调 → 集成测试
```

**API 契约先行**：Planner 必须先输出 OpenAPI Spec，前后端才能并行。

```yaml
# openapi.yaml（Planner 输出）
paths:
  /api/v1/auth/login:
    post:
      requestBody:
        content:
          application/json:
            schema:
              properties:
                email: { type: string, format: email }
                password: { type: string, minLength: 8 }
      responses:
        '200':
          content:
            application/json:
              schema:
                properties:
                  code: { type: integer }
                  data:
                    properties:
                      token: { type: string }
```

### 场景 B：多端并行开发

```
后端 API 完成
    │
    ├──► Coder-Frontend（Web 端）
    ├──► Coder-Mobile（Flutter 移动端）
    └──► Coder-Mobile（小程序端）

各端独立开发，共享：
  - API 契约（OpenAPI Spec）
  - 业务逻辑规则（来自 Planner 文档）
  - 设计规范（Design Token）
```

### 场景 C：功能模块并行

```
T001: 用户模块（Coder-Backend-1）
T002: 订单模块（Coder-Backend-2）  ← 并行，不同文件
T003: 支付模块（Coder-Backend-3）  ← 并行，不同文件

T004: 用户前端（Coder-Frontend-1）
T005: 订单前端（Coder-Frontend-2）  ← 并行，不同文件
```

**冲突预防**：Orchestrator 在分配前检查 `files_to_modify` 是否重叠。

## 4. 代码审查协同

```
Coder 完成 → 提交 PR → 触发 Reviewer

Reviewer 规则：
- 只读 diff，不读整个代码库
- 对照 specs/quality/QUALITY_GATE_SPEC.md 检查
- 输出：PASS 或 NEEDS_CHANGES（含具体行号）

NEEDS_CHANGES → Coder 修复 → 重新提交 → Reviewer 复查
PASS → Orchestrator 合并 → 更新任务状态
```

## 5. 跨端一致性保障

多端并行开发时，必须保证业务逻辑一致性：

```
业务规则文档（Planner 维护）
    │
    ├── Web 端实现（Coder-Frontend）
    ├── 移动端实现（Coder-Mobile）
    └── 小程序实现（Coder-Miniprogram）

Reviewer 检查：
  - 各端的业务规则实现是否一致
  - 错误处理是否一致
  - 数据格式是否一致
```

## 6. 知识共享机制

```python
# 一个 Agent 发现的问题，自动共享给其他 Agent
def share_knowledge(incident: Incident, affected_agents: list[str]):
    # 写入 LanceDB incidents
    add_incident(db, incident)

    # 通知相关 Agent（通过 Orchestrator）
    for agent_id in affected_agents:
        notify_agent(agent_id, {
            "type": "knowledge_update",
            "incident_id": incident.id,
            "summary": incident.title,
            "prevention": incident.prevention,
        })
```

**示例**：Backend Agent 发现某 API 返回格式与 OpenAPI Spec 不符，
立即通知 Frontend Agent 和 Mobile Agent，避免他们基于错误假设开发。

## 7. 冲突解决优先级

当多个 Agent 对同一问题有不同方案时：

```
1. 查阅 specs/ 规范（规范有明确规定则遵循）
2. 查阅 memory/decisions/（历史决策）
3. 上报 Orchestrator（Orchestrator 决策并记录 ADR）
4. 等待用户确认（重大架构决策）
```

## 8. Agent 间通信格式

所有 Agent 间通信通过 LanceDB 和文件系统，不直接通信：

```python
# 发布消息（写入 LanceDB）
def publish_message(from_agent: str, to_agent: str, msg_type: str, content: dict):
    db.open_table("agent_messages").add([{
        "id": f"MSG-{timestamp()}",
        "from": from_agent,
        "to": to_agent,
        "type": msg_type,  # task_complete | blocked | knowledge_update | request_review
        "content": json.dumps(content),
        "created_at": now(),
        "read": False,
    }])

# 消费消息（Orchestrator 轮询）
def poll_messages(agent_id: str) -> list:
    return db.open_table("agent_messages").search().where(
        f"to = '{agent_id}' AND read = false"
    ).to_list()
```

## 9. 多端项目规范加载策略

```python
MULTI_PLATFORM_SPECS = {
    "web_vue3":      ["specs/frontend/FRONTEND_SPEC.md", "specs/frontend/VUE3_SPEC.md"],
    "web_react":     ["specs/frontend/FRONTEND_SPEC.md", "specs/frontend/REACT_SPEC.md"],
    "mobile_flutter":["specs/mobile/FLUTTER_SPEC.md"],
    "mobile_rn":     ["specs/mobile/MOBILE_CROSSPLATFORM_SPEC.md"],
    "miniprogram_taro":   ["specs/miniprogram/MINIPROGRAM_SPEC.md"],
    "miniprogram_uniapp": ["specs/miniprogram/MINIPROGRAM_SPEC.md"],
    "backend_java":  ["specs/backend/JAVA_SPEC.md", "specs/api/API_RESPONSE_SPEC.md"],
    "database":      ["specs/database/DATABASE_SPEC.md"],
}

def load_specs_for_task(task: Task) -> list[str]:
    specs = MULTI_PLATFORM_SPECS.get(task.tech_stack, [])
    # 安全相关任务额外加载安全规范
    if task.involves_auth or task.involves_payment:
        specs.append("specs/security/SECURITY_SPEC.md")
    return specs
```

## 10. 项目约定集成

所有 Agent 在初始化任务时自动应用项目约定：

```python
def init_task_context(task: Task) -> dict:
    return {
        "package_prefix": "com.magic",
        "app_name": task.app_name or "superpower",  # 默认 Superpower
        "root_package": f"com.magic.{(task.app_name or 'superpower').lower()}",
        "db_name": (task.app_name or "superpower").lower(),
        "api_base": "/api/v1",
    }
```

**Orchestrator 职责**：项目启动时询问用户确认 APP 名称，确认后广播给所有 Worker Agent。

## 11. AI 灵活性原则

规范是**默认起点**，不是枷锁：
- Agent 可根据任务上下文自主判断最优实现方案
- 有充分理由偏离规范时，在 commit message 或注释中说明原因
- 规范冲突时，以**更高效、更安全**的方案为准
- 不因规范限制而降低开发效率或代码质量
