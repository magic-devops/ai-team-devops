"""
A2A Agent: Coder-Backend
Java/Spring Boot 后端代码实现 Agent，通过 A2A 协议接收任务。
"""
import argparse, json, sys
from datetime import datetime
from pathlib import Path

try:
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse
    import uvicorn
    HAS_FASTAPI = True
except ImportError:
    HAS_FASTAPI = False

AGENT_CARD = {
    "name": "Coder-Backend",
    "description": "Java/Spring Boot 后端代码实现 Agent",
    "version": "1.0.0",
    "capabilities": {"streaming": False, "pushNotifications": False},
    "skills": [
        {"id": "implement-feature", "name": "实现功能",
         "description": "根据任务描述实现 Java 后端代码，遵循 sop 规范",
         "inputModes": ["text"], "outputModes": ["text"]},
        {"id": "write-tests", "name": "编写测试",
         "description": "为指定代码编写 JUnit 单元测试",
         "inputModes": ["text"], "outputModes": ["text"]},
    ]
}

def create_app(port: int):
    app = FastAPI(title="Coder-Backend A2A Agent")
    AGENT_CARD["url"] = f"http://localhost:{port}"

    @app.get("/.well-known/agent.json")
    def agent_card():
        return AGENT_CARD

    @app.post("/")
    async def handle_task(request: Request):
        body = await request.json()
        method = body.get("method", "")
        rid = body.get("id")
        params = body.get("params", {})

        if method == "tasks/send":
            task_id = params.get("id", f"T-{int(datetime.utcnow().timestamp())}")
            message = params.get("message", {})
            text = " ".join(p.get("text","") for p in message.get("parts",[]) if p.get("type")=="text")

            try:
                sys.path.insert(0, str(Path(__file__).parent.parent.parent))
                from knowledge.lancedb_ops import LanceOps
                ctx = LanceOps().get_context_for_task(text)
                context_hint = f"\n相似历史任务: {len(ctx['similar_tasks'])} 个\n相关规则: {len(ctx['relevant_rules'])} 条"
            except Exception:
                context_hint = ""

            result_text = (
                f"[Coder-Backend] 已接收任务 {task_id}\n"
                f"任务描述: {text[:200]}\n"
                f"{context_hint}\n"
                f"状态: working — 请在 AI 工具中执行，遵循 sop/specs/backend/JAVA_SPEC.md"
            )
            return JSONResponse({"jsonrpc":"2.0","id":rid,"result":{
                "id": task_id,
                "status": {"state": "completed"},
                "artifacts": [{"type":"text","parts":[{"type":"text","text":result_text}]}]
            }})

        return JSONResponse({"jsonrpc":"2.0","id":rid,"error":{"code":-32601,"message":"Method not found"}})

    return app

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8001)
    args = parser.parse_args()
    if not HAS_FASTAPI:
        print("请安装: pip install fastapi uvicorn --break-system-packages"); sys.exit(1)
    print(f"🤖 Coder-Backend Agent: http://localhost:{args.port}")
    uvicorn.run(create_app(args.port), host="0.0.0.0", port=args.port)
