# 持久化脚本集

## Shell 脚本索引（sop/tools/）

| 脚本 | 用途 |
|------|------|
| `install-integrations.sh` | 创建/使用虚拟环境，按 `integrations-requirements.txt` 安装 FastAPI、LanceDB、pypdf 等；支持 `SOP_PYTHON`、`INSTALL_INTEGRATIONS_RECREATE`、`WRITE_INTEGRATIONS_LOCK` 等环境变量 |
| `init-ai-project.sh` | 初始化业务项目：生成 CLAUDE.md、各 IDE 规则、`memory/`、`.ai-memory/` 等 |
| `start-manager.sh` | 启动 Web 后台：`uvicorn main:app`，支持 `PROJECT_PATH`、`PORT` |
| `start-dashboard.sh` | 兼容/备用启动入口（若存在） |
| `health-check.sh` | 仓库与依赖健康检查 |
| `snapshot.sh` | LanceDB / 状态快照导出 |
| `sync-rules.sh` | 将规则同步到各工具可读位置 |

详细参数见各脚本文件头注释（`install-integrations.sh` 支持 `--help`）。

---

## persist_state.py
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

## check_budget.py
# 在 PreToolUse hook 中调用，检查 token 预算

```python
#!/usr/bin/env python3
"""检查 token 预算，超限时发出警告"""
import json
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

## snapshot.py
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

## check_blockers.py
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
