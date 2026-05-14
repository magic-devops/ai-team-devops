# MCP Hub（M9 完成时填充）

agentd 内嵌多个 MCP server（stdio）；AI 工具通过 `.codex/mcp.json` 接入：

```
sop.lancedb   语义搜索
sop.knowledge 知识库
sop.tasks     任务（透传 Manager）
sop.files     项目目录只读
sop.specs     规约按需加载
sop.rules     规则库
sop.llm       透传 LLM Gateway
sop.sandbox   受控代码执行
```

实现策略：

1. agentd 启动时 spawn stdio child processes（也可内嵌为 goroutine + io.Pipe）
2. 每个 server 实现 JSON-RPC 2.0
3. 工具列表与 Manager 同步，支持热更新
