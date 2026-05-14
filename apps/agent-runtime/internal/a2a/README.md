# A2A Node（M9 完成时填充）

每个项目 agentd 暴露 `http://<host>:7741/.well-known/agent.json` 作为 Agent Card。

Card 由 agentd 在启动时根据 `agent.toml.transport.a2a_port` 渲染：

```json
{
  "name": "sop-project-agent",
  "version": "1.0",
  "project_id": "proj-xxx",
  "tenant_id":  "t-xxx",
  "skills": [
    {"id":"plan","endpoint":"/skills/plan"},
    {"id":"implement","endpoint":"/skills/implement"},
    {"id":"review","endpoint":"/skills/review"}
  ],
  "auth": {"types":["bearer","apikey"]}
}
```

Skill 路由：转发到 Manager 对应的 Agent / Workflow（Temporal）。

Manager 端维护跨项目 A2A 注册表，处理"项目 A 的 Reviewer 调项目 B 的 Coder"等委托。
