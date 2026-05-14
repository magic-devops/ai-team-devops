# sop/tools 脚本与工具

本目录**权威清单**见下表；文末为可选 **Hook 示例片段**（非仓库内置可执行文件），仅供自定义 hooks 参考。

## 仓库内可执行与核心文件（权威清单）

路径均相对于仓库根目录 `sop/tools/`。

### Shell

| 文件 | 用途 |
|------|------|
| `install-integrations.sh` | 创建/使用虚拟环境，按 `integrations-requirements.txt` 安装 FastAPI、LanceDB、pypdf 等；支持 `SOP_PYTHON`、`INSTALL_INTEGRATIONS_RECREATE`、`WRITE_INTEGRATIONS_LOCK` 等；`--help` 查看变量 |
| `start-manager.sh` | 启动 Web 后台：`uvicorn main:app`；环境变量 `PROJECT_PATH`（被管理仓库根）、`PORT`（默认 8765）、`ADMIN_MODE`（`single` / `saas`）；启动前会执行 `path_config.apply_startup_defaults()` 创建/迁移 `.sop-runtime/` |
| `start-dashboard.sh` | 与 `start-manager.sh` 等价入口，同样启动 **`main:app`**（历史命名保留） |
| `health-check.sh` | 仓库与依赖健康检查；可选探测带鉴权的 API（见脚本头环境变量） |
| `cleanup-legacy-runtime.sh` | 在数据已迁移到 `PROJECT_PATH/.sop-runtime/` 后，可选清理遗留的 `sop/web/sop.db*`、空日志目录等；默认 dry-run，`--apply` 真正删除（见脚本头） |
| `snapshot.sh` | LanceDB / 状态快照相关导出（见脚本头注释） |
| `sync-rules.sh` | 将规则同步到各工具可读位置 |

**运行时目录（环境变量，由 Web `path_config` 与 `start-manager.sh` 使用）**

| 变量 | 说明 |
|------|------|
| `SOP_RUNTIME_DIR` | 可选。统一运行时根；默认 `PROJECT_PATH/.sop-runtime`（内含 `db/sop.db`、`logs/`、`ai-memory/`、`reinit-backups/`） |
| `AI_MEMORY_ROOT` | 可选。覆盖默认的 `SOP_RUNTIME_DIR/ai-memory` |
| `SOP_RUNTIME_NO_SYMLINK` | 设为 `1` 时不在项目根创建 `.ai-memory` → `.sop-runtime/ai-memory` 符号链接（Unix） |
| `ADMIN_MODE` | `single`（默认）或 `saas`；与 `sop/web/.env` 一致。SaaS 下须维护租户/项目/成员；请求级作用域见下 |

**HTTP 请求级项目作用域（Web 与脚本共用后端约定）**

- 已登录请求：`Authorization: Bearer <JWT>` + `X-Project-Id: <projects.id>`，由 `routers/project_scope_middleware.py` 解析并写入 `path_config` 的 ContextVar（`resolved_project_path` 等）；无效项目 / 无成员权限在 SaaS 下返回 **403/404**，不再静默落盘到错误目录。
- 浏览器控制台统一经 **`apiFetch`**（`index.html`）：自动注入上述头、超时、`/foo` → `…/api/foo` 路径解析；403 会 Toast。
- 公开接口（无需项目上下文）：`/api/auth/*`、`/api/health` 等；详见中间件源码中 `_NO_SCOPE_PATHS` 与 `path.startswith("/api/auth")`。

**health-check.sh 可选变量**

| 变量 | 说明 |
|------|------|
| `PORT` | Manager 端口，默认 8765 |
| `HEALTH_CHECK_TOKEN` | 若设置：额外 `curl` `GET /api/health/detail`，带 `Authorization: Bearer` 与 `X-Project-Id`（需同时设 `HEALTH_CHECK_PROJECT_ID`） |
| `HEALTH_CHECK_PROJECT_ID` | 与 `HEALTH_CHECK_TOKEN` 配对，作为 `X-Project-Id` |

### Python

| 文件 | 用途 |
|------|------|
| `sop_ai_hook.py` | 统一 AI hook 策略引擎；Codex / Claude 等 adapter 调用 |
| `reset-admin.py` | **管理员账号**：交互式或 `create` / `reset` 子命令；默认 SQLite（读 `sop/web/.env`）；用法见文件头 docstring |
| `manager_client.py` | 程序化调用 Manager HTTP API：`MANAGER_URL`、`PROJECT_ID`（`X-Project-Id`）、`MANAGER_SOP_TOKEN`（JWT，与登录 token 同源，**推荐**以启用请求级项目作用域）、`MANAGER_API_KEY`（可选 HMAC）、`TENANT_ID` 等（见文件头 docstring） |

### 数据与配置

| 文件 | 用途 |
|------|------|
| `integrations-requirements.txt` | Web / LanceDB 等 Python 依赖清单（由 `install-integrations.sh` 消费） |
| `AI_CAPABILITY_REGISTRY.json` | 标准能力与工具适配注册表模板 |

### 规范与集成文档（只读）

| 文件 | 说明 |
|------|------|
| `AI_CAPABILITY_CONTROL_PLANE.md` | 统一 AI 能力控制平面 |
| `TOOL_INTEGRATION.md` | 多工具（Codex / Cursor / Claude 等）集成总览 |
| `CODEX_CLI.md` | Codex CLI、AGENTS.md、hooks |
| `MCP_INTEGRATION.md` | MCP 接入说明 |
| `LANCEDB_SETUP.md` | LanceDB 与向量相关 |
| `AUTOMATION_TRIGGERS.md` | 自动化触发约定 |
| `CI_CD.md` | CI/CD 相关 |
| `GIT_WORKFLOW.md` | Git 工作流 |

入口索引另见 [README.md](README.md)。

---

## Hook 示例片段（仅供参考，非本仓库内置文件）

以下 Python 块为**示例实现思路**，文件名如 `persist_state.py` 等**不一定存在于本仓库**；复制到自有 hooks 时请自行校验路径与依赖。

## persist_state.py（示例）
# 在 Claude Code Stop hook 中调用，持久化当前状态

```python
#!/usr/bin/env python3
"""持久化当前会话状态到记忆系统"""
import json
import os
from datetime import datetime, timezone
from pathlib import Path

STATE_FILE = Path("memory/current_state.json")

def persist():
    if not STATE_FILE.exists():
        return
    
    state = json.loads(STATE_FILE.read_text())
    state["updated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    STATE_FILE.write_text(json.dumps(state, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    persist()
```

## check_budget.py（示例）
# 在 PreToolUse hook 中调用，检查 token 预算

```python
#!/usr/bin/env python3
"""检查 token 预算，超限时发出警告"""
import json
import os
from pathlib import Path
from datetime import date

BUDGET_FILE = Path(".ai-memory/token_budget.json")
DAILY_LIMIT = int(os.environ.get("AI_DAILY_TOKEN_LIMIT", "1000000"))

def check():
    today = date.today().isoformat()
    
    if BUDGET_FILE.exists():
        budget = json.loads(BUDGET_FILE.read_text())
    else:
        budget = {}
    
    used = budget.get(today, 0)
    remaining_pct = (DAILY_LIMIT - used) / DAILY_LIMIT * 100
    
    if remaining_pct < 10:
        print(f"[BUDGET WARNING] Token 预算剩余 {remaining_pct:.1f}%，请注意节省")
    elif remaining_pct < 25:
        print(f"[BUDGET NOTICE] Token 预算剩余 {remaining_pct:.1f}%")

if __name__ == "__main__":
    check()
```

## snapshot.py（示例）
# 定时调用，创建记忆快照

```python
#!/usr/bin/env python3
"""创建项目记忆快照"""
import json
from datetime import datetime, timezone
from pathlib import Path

def snapshot():
    state_file = Path("memory/current_state.json")
    if not state_file.exists():
        return
    
    state = json.loads(state_file.read_text())
    
    # 收集快照数据
    snapshot_data = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "state": state,
        "decisions": load_decisions(),
        "incidents": load_incidents(),
    }
    
    # 写入快照
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    snapshot_path = Path(f".ai-memory/snapshots/{ts}.json")
    snapshot_path.parent.mkdir(parents=True, exist_ok=True)
    snapshot_path.write_text(json.dumps(snapshot_data, indent=2, ensure_ascii=False))
    
    print(f"快照已创建: {snapshot_path}")
    
    # 清理 30 天前的快照
    cleanup_old_snapshots(days=30)

def load_decisions():
    decisions_dir = Path("memory/decisions")
    if not decisions_dir.exists():
        return []
    return [json.loads(f.read_text()) for f in decisions_dir.glob("*.json")]

def load_incidents():
    incidents_dir = Path("memory/incidents")
    if not incidents_dir.exists():
        return []
    return [json.loads(f.read_text()) for f in incidents_dir.glob("*.json")]

def cleanup_old_snapshots(days: int):
    from datetime import timedelta
    cutoff = datetime.now() - timedelta(days=days)
    for f in Path(".ai-memory/snapshots").glob("*.json"):
        if datetime.fromtimestamp(f.stat().st_mtime) < cutoff:
            f.unlink()

if __name__ == "__main__":
    snapshot()
```

## check_blockers.py（示例）
# 定时调用，检查长期阻塞任务

```python
#!/usr/bin/env python3
"""检查超时阻塞任务，发出告警"""
import json
from datetime import datetime, timezone
from pathlib import Path

BLOCKER_TIMEOUT_HOURS = 4

def check_blockers():
    state_file = Path("memory/current_state.json")
    if not state_file.exists():
        return
    
    state = json.loads(state_file.read_text())
    blocked_tasks = state.get("tasks", {}).get("blocked", [])
    
    now = datetime.now(timezone.utc)
    alerts = []
    
    for task in blocked_tasks:
        if isinstance(task, dict) and "blocked_since" in task:
            blocked_since = datetime.fromisoformat(task["blocked_since"].replace("Z", "+00:00"))
            hours_blocked = (now - blocked_since).total_seconds() / 3600
            
            if hours_blocked > BLOCKER_TIMEOUT_HOURS:
                alerts.append(
                    f"[ALERT] 任务 {task['id']} 已阻塞 {hours_blocked:.1f} 小时: {task.get('reason', '原因未知')}"
                )
    
    for alert in alerts:
        print(alert)

if __name__ == "__main__":
    check_blockers()
```
