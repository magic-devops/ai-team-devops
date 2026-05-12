# 技能体系规范（Skills）

> 版本: v1.0 | 更新: 2026-05-12
> 技能是 Agent 可复用的原子能力单元，支持本地调用和 A2A 远程暴露。

## 技能分层

```
技能层次
├── 内置技能（Built-in）   — 所有 Agent 默认具备
├── 专项技能（Specialized）— 特定角色的专有能力
└── 自定义技能（Custom）   — 从 custom/ 目录加载
```

## 技能注册格式

```yaml
# .ai-memory/skills/{skill_id}.yaml
skill_id: SKILL-001
name: 需求拆解
description: 将用户需求拆解为可执行任务树
agent_role: Planner
input:
  type: text
  description: 需求描述
output:
  type: yaml
  description: 任务树（含依赖、估算、完成标准）
a2a_exposed: true          # 是否通过 A2A 协议暴露给其他 Agent
mcp_tool: false            # 是否注册为 MCP 工具
lancedb_context: true      # 执行前是否查询 LanceDB 获取相关上下文
context_budget: 15000      # token 预算
```

## 内置技能清单

| ID | 名称 | 角色 | A2A | MCP |
|----|------|------|-----|-----|
| SKILL-001 | 需求拆解 | Planner | ✅ | ❌ |
| SKILL-002 | 代码实现 | Coder | ✅ | ❌ |
| SKILL-003 | 代码审查 | Reviewer | ✅ | ❌ |
| SKILL-004 | 问题诊断 | Debugger | ✅ | ❌ |
| SKILL-005 | 上下文恢复 | All | ❌ | ❌ |
| SKILL-009 | 并行工具调用 | Worker | ❌ | ❌ |
| SKILL-010 | CoT 决策 | Planner | ❌ | ❌ |
| SKILL-011 | 自修复循环 | Worker | ❌ | ❌ |
| SKILL-012 | 置信度自评 | Worker | ❌ | ❌ |
| SKILL-013 | 语义搜索 | All | ✅ | ✅ |
| SKILL-014 | 知识库查询 | All | ✅ | ✅ |
| SKILL-015 | 规则提取 | All | ❌ | ❌ |

## SKILL-013: 语义搜索（LanceDB）

```yaml
skill_id: SKILL-013
name: 语义搜索
description: 在 LanceDB 中语义搜索相关历史任务、规则、知识
trigger: 任务开始前，或需要查找相关信息时
execution: |
  python sop/knowledge/lancedb_ops.py context "<任务描述>"
  # 或通过 MCP: semantic_search(table, query)
output: 相似任务列表 + 相关规则 + 知识库文档
lancedb_tables: [tasks, rules, knowledge, incidents]
```

## SKILL-014: 知识库查询

```yaml
skill_id: SKILL-014
name: 知识库查询
description: 查询 custom/ 目录索引的项目特定知识
trigger: 实现功能前，检查是否有相关样例或规范
execution: |
  python sop/knowledge/lancedb_ops.py search knowledge "<查询>"
output: 相关文档片段
```

## SKILL-015: 规则提取（自进化）

```yaml
skill_id: SKILL-015
name: 规则提取
description: 从失败/成功中提取可复用规则，写入规则库
trigger: /evolve 命令 或 连续2次相同失败
execution: |
  # 分析失败模式 → 提取规则文本 → 写入 LanceDB rules 表
  python -c "
  from sop.knowledge.lancedb_ops import LanceOps
  LanceOps().add_rule('<规则文本>', '<分类>', '<来源>', confidence=0.75)
  "
```

## 自定义技能

在 `custom/specs/` 中添加技能定义：

```yaml
# custom/specs/skills/my-skill.yaml
skill_id: CUSTOM-001
name: 我的自定义技能
description: ...
execution: |
  # 执行步骤
```

AI 启动时自动扫描并注册 `custom/specs/skills/` 下的技能。

## 技能与 A2A 集成

通过 A2A 协议，技能可以跨 Agent 调用：

```json
// 调用远程 Agent 的 SKILL-002（代码实现）
{
  "method": "tasks/send",
  "params": {
    "message": {"parts": [{"type":"text","text":"实现用户注册 API"}]},
    "metadata": {"skill_id": "implement-feature"}
  }
}
```
