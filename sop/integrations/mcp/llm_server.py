"""
@module: integrations.mcp.llm_server
@purpose: MCP server — 透传 Manager LLM Gateway，让所有 AI 工具共用同一处配置/计费/缓存
@stable: tool 名 chat / embed / search 稳定
"""
from __future__ import annotations

import json
import sys
from typing import Any

try:
    from sop_sdk import build_default_client  # type: ignore[import-not-found]
except ImportError:
    sys.path.insert(0, ".")
    from sop.tools.manager_client import api_call as _api_call  # type: ignore[import-not-found]

    class _Shim:
        def llm_chat(self, messages, **kw):
            body = {"messages": list(messages), **kw}
            return _api_call("POST", "/api/v1/llm/chat", json_body=body)

        def llm_embeddings(self, inp, model="bge-m3"):
            return _api_call("POST", "/api/v1/llm/embeddings", json_body={"input": inp, "model": model})

        def rag_search(self, q, **kw):
            return _api_call("POST", "/api/v1/rag/search", json_body={"query": q, **kw})

    def build_default_client():  # type: ignore[no-redef]
        return _Shim()


_TOOLS = {
    "chat": (
        "通过统一 LLM Gateway 调模型（自动路由/缓存/计费）",
        {
            "type": "object",
            "required": ["messages"],
            "properties": {
                "messages": {"type": "array"},
                "model": {"type": "string"},
                "task_type": {"type": "string"},
                "temperature": {"type": "number"},
                "cache_ttl": {"type": "integer"},
            },
        },
    ),
    "embed": (
        "调统一 embedding（默认 bge-m3 本地）",
        {"type": "object", "required": ["input"],
         "properties": {"input": {"type": ["string", "array"]}, "model": {"type": "string"}}},
    ),
    "search": (
        "RAG 检索：跨集合（tasks/knowledge/rules）",
        {"type": "object", "required": ["query"],
         "properties": {"query": {"type": "string"}, "limit": {"type": "integer"}}},
    ),
}


def _call(name: str, args: dict) -> Any:
    cli = build_default_client()
    if name == "chat":
        return cli.llm_chat(args.get("messages", []),
                            model=args.get("model"),
                            task_type=args.get("task_type"),
                            temperature=float(args.get("temperature", 0.2)),
                            cache_ttl=args.get("cache_ttl"))
    if name == "embed":
        return cli.llm_embeddings(args.get("input"), model=args.get("model", "bge-m3"))
    if name == "search":
        return cli.rag_search(args.get("query", ""), limit=int(args.get("limit", 8)))
    raise ValueError(f"unknown tool: {name}")


def _resp(req_id, result=None, error=None):
    m = {"jsonrpc": "2.0", "id": req_id}
    if error:
        m["error"] = error
    else:
        m["result"] = result
    return m


def _handle(req):
    method = req.get("method")
    req_id = req.get("id")
    params = req.get("params") or {}
    if method == "initialize":
        return _resp(req_id, {"protocolVersion": "2024-11-05",
                              "serverInfo": {"name": "sop.llm", "version": "2.0"},
                              "capabilities": {"tools": {}}})
    if method == "tools/list":
        return _resp(req_id, {"tools": [
            {"name": n, "description": d, "inputSchema": s}
            for n, (d, s) in _TOOLS.items()
        ]})
    if method == "tools/call":
        name = params.get("name")
        args = params.get("arguments") or {}
        if name not in _TOOLS:
            return _resp(req_id, error={"code": -32601, "message": f"unknown: {name}"})
        try:
            out = _call(name, args)
            return _resp(req_id, {"content": [{"type": "text", "text": json.dumps(out, ensure_ascii=False, default=str)}]})
        except Exception as e:
            return _resp(req_id, error={"code": -32000, "message": str(e)})
    return _resp(req_id, error={"code": -32601, "message": method or ""})


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            sys.stdout.write(json.dumps(_handle(req), ensure_ascii=False) + "\n")
            sys.stdout.flush()
        except Exception as e:  # pragma: no cover
            sys.stdout.write(json.dumps({"jsonrpc": "2.0", "error": {"code": -32700, "message": str(e)}}) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
