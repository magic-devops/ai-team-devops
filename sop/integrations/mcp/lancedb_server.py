"""
MCP Server: LanceDB 语义搜索
AI 工具通过 MCP 协议调用 LanceDB 语义搜索能力。
"""
import sys, json, os
sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent.parent.parent))

def handle(req: dict) -> dict:
    method = req.get("method", "")
    params = req.get("params", {})
    rid = req.get("id")

    if method == "initialize":
        return {"jsonrpc":"2.0","id":rid,"result":{
            "protocolVersion":"2024-11-05",
            "serverInfo":{"name":"lancedb","version":"1.0"},
            "capabilities":{"tools":{}}
        }}

    if method == "tools/list":
        return {"jsonrpc":"2.0","id":rid,"result":{"tools":[
            {"name":"semantic_search","description":"语义搜索 LanceDB 表",
             "inputSchema":{"type":"object","properties":{
                 "table":{"type":"string","description":"表名: tasks|requirements|issues|knowledge|rules"},
                 "query":{"type":"string","description":"搜索查询"},
                 "limit":{"type":"integer","default":5}
             },"required":["table","query"]}},
            {"name":"get_task_context","description":"获取任务相关上下文（相似任务+规则+知识）",
             "inputSchema":{"type":"object","properties":{
                 "task":{"type":"string","description":"任务描述"}
             },"required":["task"]}},
            {"name":"add_rule","description":"添加规则到规则库",
             "inputSchema":{"type":"object","properties":{
                 "rule":{"type":"string"},"category":{"type":"string"},
                 "source":{"type":"string"},"confidence":{"type":"number","default":0.7}
             },"required":["rule","category","source"]}},
        ]}}

    if method == "tools/call":
        name = params.get("name")
        args = params.get("arguments", {})
        try:
            from knowledge.lancedb_ops import LanceOps
            ops = LanceOps()
            if name == "semantic_search":
                results = ops.search(args["table"], args["query"], args.get("limit", 5))
                text = json.dumps([{k:v for k,v in r.items() if k!="vector"} for r in results],
                                  ensure_ascii=False, default=str)
            elif name == "get_task_context":
                ctx = ops.get_context_for_task(args["task"])
                text = json.dumps(ctx, ensure_ascii=False, default=str)
            elif name == "add_rule":
                rid2 = ops.add_rule(args["rule"], args["category"], args["source"],
                                    args.get("confidence", 0.7))
                text = f"规则已添加: {rid2}"
            else:
                text = f"未知工具: {name}"
        except Exception as e:
            text = f"错误: {e}"
        return {"jsonrpc":"2.0","id":rid,"result":{"content":[{"type":"text","text":text}]}}

    return {"jsonrpc":"2.0","id":rid,"error":{"code":-32601,"message":"Method not found"}}

if __name__ == "__main__":
    for line in sys.stdin:
        line = line.strip()
        if not line: continue
        try:
            req = json.loads(line)
            resp = handle(req)
            print(json.dumps(resp), flush=True)
        except Exception as e:
            print(json.dumps({"jsonrpc":"2.0","id":None,"error":{"code":-32700,"message":str(e)}}), flush=True)
