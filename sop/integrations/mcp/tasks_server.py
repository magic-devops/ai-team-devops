"""
@module: integrations.mcp.tasks_server
@purpose: MCP server (stdio JSON-RPC 2.0) — 把 Manager 任务/反思接口暴露给 AI 工具
@stable: tool 名 list_tasks / pull_task / update_task / report_issue / add_reflection 稳定
@ai_safe_edit:
  - 新增 tool：加 _TOOLS 注册项 + 实现函数（接受 dict→返回 dict）
  - 改鉴权：替换 build_default_client（统一走 sop_sdk）
"""
from __future__ import annotations

import json
import sys
from typing import Any, Callable

try:
    from sop_sdk import build_default_client  # type: ignore[import-not-found]
except ImportError:
    # fallback：直接复用旧 manager_client
    sys.path.insert(0, ".")
    from sop.tools.manager_client import api_call as _api_call  # type: ignore[import-not-found]

    class _ShimClient:
        def list_tasks(self, **kw):
            return _api_call("GET", "/api/v1/tasks", params=kw)

        def pull_task(self, task_id):
            return _api_call("POST", f"/api/v1/tasks/{task_id}:pull")

        def update_task(self, task_id, body):
            return _api_call("PATCH", f"/api/v1/tasks/{task_id}", json_body=body)

        def _request(self, method, path, **kw):
            return _api_call(method, path, **kw)

    def build_default_client():  # type: ignore[no-redef]
        return _ShimClient()


_TOOLS: dict[str, tuple[str, dict, Callable[[dict], dict]]] = {}


def tool(name: str, description: str, schema: dict) -> Callable:
    def deco(fn: Callable[[dict], dict]) -> Callable[[dict], dict]:
        _TOOLS[name] = (description, schema, fn)
        return fn
    return deco


@tool("list_tasks", "列出当前项目的任务",
      {"type": "object", "properties": {
          "status": {"type": "string"},
          "priority": {"type": "string"},
          "limit": {"type": "integer", "default": 20},
      }})
def _list_tasks(args: dict) -> dict:
    cli = build_default_client()
    return cli.list_tasks(status=args.get("status"), priority=args.get("priority"),
                          size=int(args.get("limit", 20)))


@tool("pull_task", "认领并领取任务详情",
      {"type": "object", "required": ["task_id"],
       "properties": {"task_id": {"type": "string"}}})
def _pull_task(args: dict) -> dict:
    return build_default_client().pull_task(args["task_id"])


@tool("update_task", "更新任务状态/进度/置信度",
      {"type": "object", "required": ["task_id"],
       "properties": {
           "task_id": {"type": "string"},
           "status": {"type": "string"},
           "confidence": {"type": "number"},
           "human_notes": {"type": "string"},
       }})
def _update_task(args: dict) -> dict:
    tid = args.pop("task_id")
    return build_default_client().update_task(tid, args)


@tool("report_issue", "上报问题（缺陷/阻塞/风险）",
      {"type": "object", "required": ["title"],
       "properties": {
           "title": {"type": "string"},
           "severity": {"type": "string", "enum": ["P0", "P1", "P2", "P3"], "default": "P2"},
           "description": {"type": "string"},
       }})
def _report_issue(args: dict) -> dict:
    cli = build_default_client()
    return cli._request("POST", "/api/v1/issues", json_body=args)


@tool("add_reflection", "记录反思（成功/失败/教训）",
      {"type": "object", "required": ["content"],
       "properties": {
           "content": {"type": "string"},
           "category": {"type": "string", "default": "general"},
           "confidence": {"type": "number", "default": 0.7},
       }})
def _add_reflection(args: dict) -> dict:
    """写入知识库 daily 分类（与 manager_client.report_reflection 一致），供检索与蒸馏。"""
    cli = build_default_client()
    content = str(args.get("content") or "").strip()
    if not content:
        return {"ok": False, "error": "content required"}
    category = str(args.get("category") or "general").strip()
    confidence = float(args.get("confidence") or 0.7)
    body = {
        "title": f"[反思] {category}",
        "content": content,
        "category": "daily",
        "tags": ["reflection", category, f"conf:{confidence:.2f}"],
    }
    return cli._request("POST", "/api/v1/knowledge", json_body=body)


# ── JSON-RPC loop ──────────────────────────────────────────────
def _jsonrpc_response(req_id: Any, result: Any = None, error: dict | None = None) -> dict:
    msg: dict[str, Any] = {"jsonrpc": "2.0", "id": req_id}
    if error:
        msg["error"] = error
    else:
        msg["result"] = result
    return msg


def _handle(req: dict) -> dict:
    method = req.get("method")
    req_id = req.get("id")
    params = req.get("params") or {}
    if method == "initialize":
        return _jsonrpc_response(req_id, {
            "protocolVersion": "2024-11-05",
            "serverInfo": {"name": "sop.tasks", "version": "2.0"},
            "capabilities": {"tools": {}},
        })
    if method == "tools/list":
        tools = [
            {"name": n, "description": d, "inputSchema": s}
            for n, (d, s, _) in _TOOLS.items()
        ]
        return _jsonrpc_response(req_id, {"tools": tools})
    if method == "tools/call":
        name = params.get("name")
        args = params.get("arguments") or {}
        if name not in _TOOLS:
            return _jsonrpc_response(req_id, error={"code": -32601, "message": f"unknown tool: {name}"})
        _, _, fn = _TOOLS[name]
        try:
            out = fn(args)
            return _jsonrpc_response(req_id, {
                "content": [{"type": "text", "text": json.dumps(out, ensure_ascii=False, default=str)}]
            })
        except Exception as e:
            return _jsonrpc_response(req_id, error={"code": -32000, "message": str(e)})
    return _jsonrpc_response(req_id, error={"code": -32601, "message": f"method not found: {method}"})


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            resp = _handle(req)
            sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
            sys.stdout.flush()
        except Exception as e:  # pragma: no cover
            err = _jsonrpc_response(None, error={"code": -32700, "message": f"parse error: {e}"})
            sys.stdout.write(json.dumps(err) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
