"""本地项目 Agent 与 Manager 交互客户端
- 安全：API Key 认证 + HMAC 签名验证
- 稳定：连接池 + 超时 + 重试
- 自动恢复：指数退避重试，断线重连
"""
from __future__ import annotations
import os, json, time, hashlib, hmac, uuid
from typing import Any, Optional
from pathlib import Path
import urllib.request, urllib.error

MANAGER_URL = os.getenv("MANAGER_URL", "http://localhost:8765")
MANAGER_API_KEY = os.getenv("MANAGER_API_KEY", "")
PROJECT_ID = os.getenv("PROJECT_ID", "")
TENANT_ID = os.getenv("TENANT_ID", "t-default")
_TIMEOUT = int(os.getenv("MANAGER_TIMEOUT", "30"))
_MAX_RETRIES = int(os.getenv("MANAGER_MAX_RETRIES", "3"))


def _headers(body: str = "") -> dict:
    h = {"Content-Type": "application/json", "X-Project-Id": PROJECT_ID}
    if MANAGER_API_KEY:
        h["X-Api-Key"] = MANAGER_API_KEY
        if body:
            sig = hmac.new(MANAGER_API_KEY.encode(), body.encode(), hashlib.sha256).hexdigest()
            h["X-Sop-Signature"] = "sha256=" + sig
    return h


def _request(method: str, path: str, data: Any = None, retries: int = _MAX_RETRIES) -> dict:
    url = MANAGER_URL.rstrip("/") + path
    body = json.dumps(data).encode() if data is not None else None
    headers = _headers(body.decode() if body else "")
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    last_err = None
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            if e.code in (401, 403, 404):
                raise RuntimeError(f"Manager API {e.code}: {e.reason}")
            last_err = e
        except Exception as e:
            last_err = e
        if attempt < retries:
            time.sleep(min(2 ** attempt, 30))
    raise RuntimeError(f"Manager 请求失败 ({retries+1} 次): {last_err}")


# ── 任务上报 ──────────────────────────────────────────────────────
def report_task_status(task_id: str, status: str, notes: str = "", confidence: float = 0.0):
    return _request("PATCH", f"/api/tasks/{task_id}", {
        "status": status, "human_notes": notes, "confidence": confidence
    })


def create_task(title: str, description: str = "", priority: str = "P1",
                req_id: str = "", assigned_to: str = "AI") -> str:
    r = _request("POST", "/api/tasks", {
        "title": title, "description": description, "priority": priority,
        "req_id": req_id, "assigned_to": assigned_to,
        "project_id": PROJECT_ID,
    })
    return r.get("id", "")


# ── 问题上报 ──────────────────────────────────────────────────────
def report_issue(title: str, description: str = "", severity: str = "P2",
                 task_id: str = "", type: str = "bug") -> str:
    r = _request("POST", "/api/issues", {
        "title": title, "description": description, "severity": severity,
        "task_id": task_id, "type": type, "project_id": PROJECT_ID,
    })
    return r.get("id", "")


# ── 需求查询 ──────────────────────────────────────────────────────
def get_requirements(status: str = "pending", priority: str = "") -> list:
    q = f"?project_id={PROJECT_ID}&status={status}&size=100"
    if priority: q += f"&priority={priority}"
    return _request("GET", f"/api/requirements{q}").get("items", [])


# ── 健康检查（本地 Agent 启动时验证 Manager 可达）────────────────
def check_manager_health() -> bool:
    try:
        r = _request("GET", "/api/health", retries=1)
        return r.get("ok", False)
    except Exception:
        return False


# ── 反思记录上报 ──────────────────────────────────────────────────
def report_reflection(task_id: str, content: str, confidence: float = 0.8,
                      category: str = "execution"):
    """Agent 执行完成后上报反思，写入向量库供后续学习"""
    try:
        _request("POST", "/api/knowledge", {
            "title": f"[反思] {task_id}",
            "content": content,
            "category": "daily",
            "tags": ["reflection", category, task_id],
        })
    except Exception:
        pass  # 反思上报失败不影响主流程


# ── 项目状态同步 ──────────────────────────────────────────────────
def sync_state(phase: str = None, sprint_id: str = None, extra: dict = None):
    patch = {}
    if phase: patch["phase"] = phase
    if sprint_id: patch["sprint"] = sprint_id
    if extra: patch.update(extra)
    if patch:
        try: _request("PATCH", "/api/state", patch)
        except Exception: pass


# ── CLI 入口（供 shell hook 调用）────────────────────────────────
if __name__ == "__main__":
    import sys
    cmd = sys.argv[1] if len(sys.argv) > 1 else "health"
    if cmd == "health":
        ok = check_manager_health()
        print("ok" if ok else "down")
        sys.exit(0 if ok else 1)
    elif cmd == "task-done" and len(sys.argv) >= 3:
        report_task_status(sys.argv[2], "completed", notes=sys.argv[3] if len(sys.argv) > 3 else "")
        print("ok")
    elif cmd == "task-fail" and len(sys.argv) >= 3:
        report_task_status(sys.argv[2], "blocked", notes=sys.argv[3] if len(sys.argv) > 3 else "")
        print("ok")
    elif cmd == "issue" and len(sys.argv) >= 3:
        iid = report_issue(sys.argv[2], severity=sys.argv[3] if len(sys.argv) > 3 else "P2")
        print(iid)
    else:
        print(f"Usage: {sys.argv[0]} health|task-done <id> [notes]|task-fail <id> [notes]|issue <title> [severity]")
