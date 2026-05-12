# 技能注册表

## 技能定义格式

```yaml
skill_id: SKILL-{id}
name: 技能名称
description: 一句话描述
trigger: 触发条件
input: 输入格式
output: 输出格式
agent_role: 适用角色
context_budget: 预估 token 消耗
```

## 核心技能库

### SKILL-001: 需求拆解
```yaml
skill_id: SKILL-001
name: 需求拆解
description: 将用户需求拆解为可执行的任务树
trigger: 收到新需求或功能请求
input: 需求描述文本
output: YAML 格式任务树（含依赖、估算、完成标准）
agent_role: Planner
context_budget: 15K
prompt_template: skills/PROMPT_PATTERNS.md#模式5
```

### SKILL-002: 代码实现
```yaml
skill_id: SKILL-002
name: 代码实现
description: 根据任务描述实现代码变更
trigger: 任务状态变为 in_progress
input: 任务详情 + 相关文件列表
output: 代码变更 + 测试 + 验证结果
agent_role: Coder
context_budget: 40K
prompt_template: skills/PROMPT_PATTERNS.md#模式1
```

### SKILL-003: 代码审查
```yaml
skill_id: SKILL-003
name: 代码审查
description: 审查代码变更的正确性、安全性、质量
trigger: PR 创建或代码变更完成
input: git diff 内容
output: PASS 或 NEEDS_CHANGES（含具体意见）
agent_role: Reviewer
context_budget: 20K
prompt_template: skills/PROMPT_PATTERNS.md#模式2
checklist: quality/CODE_REVIEW.md
```

### SKILL-004: 问题诊断
```yaml
skill_id: SKILL-004
name: 问题诊断
description: 诊断 Bug 根因并提出修复方案
trigger: 发现错误或测试失败
input: 错误信息 + 相关代码片段
output: 根因分析 + 修复方案 + 验证方法
agent_role: Debugger
context_budget: 35K
prompt_template: skills/PROMPT_PATTERNS.md#模式3
```

### SKILL-005: 上下文恢复
```yaml
skill_id: SKILL-005
name: 上下文恢复
description: 在新上下文窗口中恢复中断的任务
trigger: 上下文压缩后或新会话开始
input: task_id + project_id
output: 恢复的工作上下文
agent_role: 所有角色
context_budget: 10K
prompt_template: skills/PROMPT_PATTERNS.md#模式4
```

### SKILL-006: Sprint 规划
```yaml
skill_id: SKILL-006
name: Sprint 规划
description: 从 backlog 选取任务，制定 Sprint 计划
trigger: Sprint 开始
input: backlog 任务列表 + 可用时间
output: Sprint 计划（含优先级、并行机会、风险）
agent_role: Orchestrator
context_budget: 20K
prompt_template: skills/PROMPT_PATTERNS.md#模式6
```

### SKILL-007: 记忆检索
```yaml
skill_id: SKILL-007
name: 记忆检索
description: 从 LanceDB 检索相关历史信息
trigger: 开始新任务前、遇到问题时
input: 查询文本 + collection 名称
output: 相关历史记录列表（最多5条）
agent_role: 所有角色
context_budget: 5K
implementation: memory/LANCEDB_SCHEMA.md#search_similar
```

### SKILL-008: 快照创建
```yaml
skill_id: SKILL-008
name: 快照创建
description: 创建项目状态快照，用于回滚和恢复
trigger: Sprint 开始/结束、Release 前
input: project_id
output: 快照文件路径
agent_role: Orchestrator
context_budget: 5K
implementation: workflow/ROLLBACK.md#快照策略
```

## 技能调用规范

```python
def invoke_skill(skill_id: str, input_data: dict) -> dict:
    skill = SKILL_REGISTRY[skill_id]
    
    # 检查上下文预算
    if current_tokens + skill["context_budget"] > context_limit:
        raise ContextBudgetExceeded(skill_id)
    
    # 执行技能
    result = execute_with_prompt(
        template=skill["prompt_template"],
        input=input_data,
        role=skill["agent_role"]
    )
    
    # 记录技能调用
    log_skill_invocation(skill_id, input_data, result)
    
    return result
```

## 技能组合模式

### 新功能开发
```
SKILL-001（需求拆解）
    → SKILL-006（Sprint 规划）
    → SKILL-002（代码实现）× N
    → SKILL-003（代码审查）
```

### Bug 修复
```
SKILL-004（问题诊断）
    → SKILL-002（代码实现）
    → SKILL-003（代码审查）
```

### 上下文恢复
```
SKILL-005（上下文恢复）
    → SKILL-007（记忆检索）
    → 继续当前技能
```

## Hermes 专项技能

### SKILL-009: 结构化工具调用链
```yaml
skill_id: SKILL-009
name: 并行工具调用
description: 识别无依赖操作并行执行，最大化效率
trigger: 需要读取多个文件或执行多个独立检查时
input: 任务描述 + 文件列表
output: 并行工具调用批次
agent_role: Worker/Coder
context_budget: 5K
rule: 无数据依赖的工具调用必须并行，不得串行
```

### SKILL-010: 链式推理决策
```yaml
skill_id: SKILL-010
name: CoT 决策
description: 复杂决策前显式输出 <think> 推理过程
trigger: 架构选型、根因分析、安全评估
input: 问题描述 + 上下文
output: <think>推理</think> + 决策结果
agent_role: Planner/Debugger
context_budget: 10K
format: agents/HERMES_AGENT.md#推理格式
```

### SKILL-011: 自我反思修复
```yaml
skill_id: SKILL-011
name: 自修复循环
description: 执行失败后 <reflect> 分析并自动修正，最多 3 次
trigger: build/test 失败 或 review NEEDS_CHANGES
input: 失败结果 + 原始代码
output: 修正后代码 + 反思记录
agent_role: Worker
context_budget: 20K
max_retries: 3
format: agents/HERMES_AGENT.md#反思格式
```

### SKILL-012: 置信度自评
```yaml
skill_id: SKILL-012
name: 任务置信度评估
description: 完成任务后输出结构化置信度，驱动 Reviewer 触发
trigger: 每次任务完成后
input: 任务结果
output: JSON 置信度报告
agent_role: Worker
context_budget: 2K
threshold_auto_pass: 0.85
threshold_notify_user: 0.70
format: agents/HERMES_AGENT.md#自我评估
```
