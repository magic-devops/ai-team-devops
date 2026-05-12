# A2A（Agent-to-Agent）协议规范

> 版本: v1.0 | 更新: 2026-05-12
> 基于 Google A2A 开放标准，实现 Agent 间标准化通信与任务委托。

## 核心概念

| 概念 | 说明 |
|------|------|
| **Agent Card** | Agent 能力声明（`/.well-known/agent.json`），供其他 Agent 发现 |
| **Task** | Agent 间委托的工作单元，有完整生命周期 |
| **Skill** | Agent 暴露的单项能力，可被远程调用 |
| **Transport** | HTTP/HTTPS + JSON-RPC 2.0 |

## Agent Card 格式

每个 Agent 在 `/.well-known/agent.json` 发布自身能力：

```json
{
  "name": "Coder-Backend",
  "description": "Java/Spring Boot 后端代码实现 Agent",
  "version": "1.0.0",
  "url": "http://localhost:8001",
  "capabilities": {
    "streaming": true,
    "pushNotifications": false
  },
  "skills": [
    {
      "id": "implement-feature",
      "name": "实现功能",
      "description": "根据任务描述实现 Java 后端代码",
      "inputModes": ["text"],
      "outputModes": ["text", "file"]
    },
    {
      "id": "write-tests",
      "name": "编写测试",
      "description": "为指定代码编写单元测试",
      "inputModes": ["text", "file"],
      "outputModes": ["file"]
    }
  ]
}
```

## 任务生命周期

```
submitted → working → [input-required] → completed
                    ↘ failed / canceled
```

## 任务委托格式（JSON-RPC 2.0）

```json
// Orchestrator → Worker Agent
{
  "jsonrpc": "2.0",
  "method": "tasks/send",
  "id": "req-001",
  "params": {
    "id": "T003",
    "message": {
      "role": "user",
      "parts": [
        {
          "type": "text",
          "text": "实现用户注册 API，包含邮箱验证，参考 sop/specs/backend/JAVA_SPEC.md"
        }
      ]
    },
    "metadata": {
      "skill_id": "implement-feature",
      "specs": ["specs/backend/JAVA_SPEC.md"],
      "done_when": "单元测试通过，覆盖率 >= 80%"
    }
  }
}
```

## 任务结果格式

```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "result": {
    "id": "T003",
    "status": { "state": "completed" },
    "artifacts": [
      {
        "type": "file",
        "parts": [{ "type": "text", "text": "// UserController.java\n..." }],
        "metadata": { "confidence": 0.88, "files_changed": ["UserController.java"] }
      }
    ]
  }
}
```

## 本项目 A2A 集成

### Agent 端口约定

| Agent | 端口 | 职责 |
|-------|------|------|
| Orchestrator | 8000 | 任务分配、进度追踪 |
| Coder-Backend | 8001 | Java/Spring Boot 实现 |
| Coder-Frontend | 8002 | Vue3/React 实现 |
| Reviewer | 8003 | 代码审查 |
| Tester | 8004 | 测试编写与执行 |

### 与 MCP 的关系

```
AI 工具（Claude/Cursor）
    │
    ├── MCP → 工具调用（文件读写、Shell、数据库）
    │
    └── A2A → Agent 委托（把子任务交给专门的 Agent）
```

MCP 处理工具调用，A2A 处理 Agent 间协作，两者互补。

## 快速启动 A2A Agent

```bash
# 安装
pip install a2a-sdk fastapi uvicorn --break-system-packages

# 启动 Coder-Backend Agent
python sop/integrations/agents/coder_backend.py --port 8001
```
