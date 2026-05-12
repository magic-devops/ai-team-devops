# MCP 工具集成规范

## 什么是 MCP

Model Context Protocol（MCP）是 Anthropic 定义的标准协议，允许 AI 智能体调用外部工具服务。
Claude Code、Cursor、Windsurf 等工具均支持 MCP。

## 推荐 MCP 工具集

### 代码智能
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/project"],
      "description": "文件系统操作，支持读写、搜索"
    },
    "git": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-git", "--repository", "."],
      "description": "Git 操作：log、diff、blame、branch"
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" },
      "description": "GitHub API：PR、Issues、Actions"
    }
  }
}
```

### 数据库与搜索
```json
{
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sqlite", "--db-path", ".ai-memory/tasks.db"],
      "description": "SQLite 任务数据库（LanceDB 的轻量替代）"
    },
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": { "BRAVE_API_KEY": "${BRAVE_API_KEY}" },
      "description": "网络搜索，用于查找文档和解决方案"
    }
  }
}
```

### 开发工具
```json
{
  "mcpServers": {
    "puppeteer": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-puppeteer"],
      "description": "浏览器自动化，用于 E2E 测试和 UI 验证"
    },
    "sequential-thinking": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"],
      "description": "结构化推理，用于复杂问题分析"
    }
  }
}
```

## Claude Code 配置（`.claude/settings.json`）

```json
{
  "permissions": {
    "allow": [
      "Bash(npm run *)",
      "Bash(git *)",
      "Bash(grep *)",
      "Bash(find *)",
      "Bash(python *)",
      "Bash(pytest *)"
    ]
  },
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "npm run lint --silent 2>&1 | head -20"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python .ai-memory/scripts/persist_state.py"
          }
        ]
      }
    ]
  }
}
```

## Cursor Rules（`.cursorrules`）

```
# AI 开发规约（Cursor）

## 核心规则
- 只写解决当前问题所需的最少代码
- 修改文件前先读取，理解现有实现
- 每次修改后运行构建验证
- 不引入未经确认的新依赖

## 任务追踪
- 开始任务前读取 .ai-memory/current_state.json
- 完成任务后更新任务状态
- 遇到阻塞立即记录，不沉默

## 代码风格
- 遵循项目现有风格（读 .eslintrc / pyproject.toml）
- 函数长度 ≤ 50 行
- 无硬编码密钥

## 安全
- 用户输入必须在系统边界验证
- SQL 使用参数化查询
- 命令执行前验证输入
```

## Windsurf / Copilot 配置（`.github/copilot-instructions.md`）

```markdown
# GitHub Copilot 开发指令

遵循 sop/ 目录下的开发规约。

关键原则：
1. 最小化：只写必要代码
2. 安全优先：防注入、防 XSS
3. 可追溯：commit 关联 task ID
4. 状态外化：进度写入 .ai-memory/

当前项目状态：读取 .ai-memory/current_state.json
```

## MCP 工具调用规范

### 优先级
```
专用 MCP 工具 > Bash 命令 > 通用文本处理
```

### 工具选择矩阵
| 操作 | 推荐工具 | 备注 |
|------|---------|------|
| 读写文件 | filesystem MCP | 比 Bash cat/echo 更安全 |
| Git 操作 | git MCP | 结构化输出，易解析 |
| GitHub PR/Issue | github MCP | 避免手动拼接 API |
| 网络搜索 | brave-search MCP | 查文档、找解决方案 |
| 数据库查询 | sqlite MCP | 任务状态查询 |
| 浏览器测试 | puppeteer MCP | UI 验证 |

## 自定义 MCP 服务器（项目级）

```python
# .ai-memory/mcp_server.py
# 暴露项目记忆系统为 MCP 工具

from mcp.server import Server
from mcp.types import Tool

server = Server("ai-memory")

@server.tool()
async def get_current_state() -> dict:
    """获取项目当前状态"""
    return load_json(".ai-memory/current_state.json")

@server.tool()
async def search_similar_tasks(query: str, limit: int = 5) -> list:
    """语义搜索相似任务"""
    return search_similar(db, "tasks", query, limit)

@server.tool()
async def update_task(task_id: str, status: str) -> bool:
    """更新任务状态"""
    update_task_status(db, task_id, status)
    return True
```
