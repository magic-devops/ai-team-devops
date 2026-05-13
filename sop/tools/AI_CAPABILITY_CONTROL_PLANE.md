# AI 能力控制平面规范

> 版本: v1.0 | 更新: 2026-05-13

## 定位

本项目不是单一 AI CLI 的配置集合，而是统一 AI 开发流程控制平面。所有 AI Agent、CLI、IDE、App 都应接入同一套 sop 能力模型，由 sop 统一管理、统一调度、统一优化。

## 分层架构

```
sop 控制平面
├── 规约层：AGENTS.md / CLAUDE.md / .cursorrules 等工具入口
├── 能力注册层：.ai-memory/ai_capabilities.json
├── Hook 策略层：sop/tools/sop_ai_hook.py
├── 适配层：.codex/hooks.json / .claude/settings.json / CLI wrapper / IDE rules
├── 调度层：Agent 编排、Vibe Coding、MCP、A2A
└── 优化层：activity.log、规则提取、知识蒸馏、质量门禁
```

## 统一能力模型

| 能力 | 标准语义 | 典型落点 |
|------|----------|----------|
| `context.load` | 启动时加载状态、规则、规约和相关知识 | `SessionStart` / 工具入口文件 |
| `prompt.inspect` | 用户提示提交前做敏感信息、任务分类和上下文补全 | `UserPromptSubmit` |
| `tool.guard` | 工具执行前做安全与路径策略判断 | `PreToolUse` / CLI wrapper |
| `permission.decide` | 权限请求时做二次策略判定 | `PermissionRequest` |
| `tool.audit` | 工具执行后记录审计与质量线索 | `PostToolUse` |
| `state.persist` | 会话结束时持久化状态、快照和交接摘要 | `Stop` / `SessionEnd` |
| `quality.gate` | lint/test/security/review 门禁 | Git hooks / CI / PostToolUse |
| `memory.evolve` | 从成功和失败中提炼规则、样例和知识 | `/evolve` / 定时任务 |

## 工具适配原则

- 工具有原生 hooks：只在工具配置中做事件映射，策略调用 `sop/tools/sop_ai_hook.py`。
- 工具没有 hooks：通过 CLI wrapper、Vibe Coding、Git hooks 或 CI 模拟 `tool.guard`、`tool.audit` 和 `state.persist`。
- 工具有规则入口：入口文件只声明启动检查和规约加载，不复制复杂策略。
- 工具有 MCP/A2A：通过 sop 的 MCP server 和 Agent 编排暴露能力，避免每个工具重复实现。

## 统一事件映射

| sop 事件 | Codex | Claude Code | 无 Hook 工具降级 |
|----------|-------|-------------|------------------|
| `context.load` | `SessionStart` | `SessionStart` / 启动命令 | 入口规则文件 |
| `prompt.inspect` | `UserPromptSubmit` | `UserPromptSubmit` | CLI wrapper prompt preflight |
| `tool.guard` | `PreToolUse` | `PreToolUse` | 受控终端白名单 / Git hooks |
| `permission.decide` | `PermissionRequest` | approval hook / 外部审批 | Web 后台审批流 |
| `tool.audit` | `PostToolUse` | `PostToolUse` | CLI wrapper 执行记录 |
| `state.persist` | `Stop` | `Stop` | wrapper finally / snapshot |

## 统一优化闭环

1. 所有工具事件写入 `.ai-memory/activity.log` 或后续结构化事件表。
2. 失败、阻断、人工审批、测试失败进入 `.ai-memory/rules/` 候选规则。
3. `/evolve` 或定时任务把候选规则升级到活跃规则。
4. Web 后台展示工具使用、阻断、质量门禁与任务完成情况。
5. Agent 编排根据历史表现选择更合适的工具、模型和技能。

