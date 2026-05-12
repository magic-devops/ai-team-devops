# Hermes Agent 规范

> 版本: v1.0 | 更新: 2026-05-12
> 基于 NousResearch Hermes 模型能力设计，适用于所有支持结构化工具调用的 LLM。

## 核心能力

Hermes 模型为 Agent 带来三项关键能力，本规范将其系统化：

| 能力 | 描述 | 在 SOP 中的应用 |
|------|------|----------------|
| **结构化工具调用** | 精确的 JSON function calling，支持并行调用 | Worker 执行工具链 |
| **链式推理（CoT）** | 在行动前显式推理，减少错误 | Planner/Debugger 决策 |
| **自我反思** | 执行后评估结果，自动修正 | 质量门禁自修复循环 |

## 1. 结构化工具调用规范

### 工具定义格式（Hermes 风格）

```json
{
  "type": "function",
  "function": {
    "name": "read_file",
    "description": "读取文件内容，支持 offset/limit 精确读取",
    "parameters": {
      "type": "object",
      "properties": {
        "path": { "type": "string", "description": "文件绝对路径" },
        "offset": { "type": "integer", "description": "起始行号" },
        "limit": { "type": "integer", "description": "读取行数" }
      },
      "required": ["path"]
    }
  }
}
```

### 并行工具调用（提升效率）

Hermes 支持单次推理中并行调用多个工具，Agent 应充分利用：

```json
// ✅ 并行调用（推荐）：同时读取多个无依赖文件
[
  { "name": "read_file", "arguments": { "path": "src/service/UserService.java" } },
  { "name": "read_file", "arguments": { "path": "src/mapper/UserMapper.java" } },
  { "name": "grep", "arguments": { "pattern": "UserService", "path": "src/" } }
]

// ❌ 串行调用（低效）：无依赖关系却逐个调用
```

### 工具调用链模式

```
定位阶段（并行）: grep + find → 确定目标文件
读取阶段（并行）: read 多个相关文件
实现阶段（串行）: edit → build → test
验证阶段（并行）: lint + typecheck + security_scan
```

## 2. 链式推理（CoT）规范

Agent 在执行复杂决策前，必须显式输出推理过程：

### 推理格式

```
<think>
问题：[当前需要解决的问题]
已知：[从上下文/工具结果中获取的信息]
选项：
  A. [方案A] → 优点/缺点
  B. [方案B] → 优点/缺点
决策：选择 [A/B]，原因：[简短理由]
</think>
[执行动作]
```

### 必须使用 CoT 的场景

- 架构决策（选择技术方案）
- 调试复杂 Bug（根因分析）
- 任务拆解（依赖关系判断）
- 安全相关代码（风险评估）

### 可跳过 CoT 的场景

- 简单 CRUD 实现
- 格式化/重命名
- 已有明确规范的操作

## 3. 自我反思与自修复循环

### 反思触发条件

```python
def should_reflect(result: ActionResult) -> bool:
    return (
        result.build_failed or
        result.tests_failed or
        result.review_status == "NEEDS_CHANGES" or
        result.confidence < 0.7  # 自评置信度低
    )
```

### 反思格式

```
<reflect>
执行了：[动作描述]
期望结果：[预期]
实际结果：[实际]
差距分析：[为什么不符合预期]
修正方案：[下一步怎么做]
是否需要升级：[否 / 是→上报 Orchestrator]
</reflect>
```

### 自修复循环（最多 3 次）

```
执行 → 验证 → 失败
         ↓
      <reflect>分析原因</reflect>
         ↓
      修正 → 验证 → 失败（第2次）
                ↓
             <reflect>换思路</reflect>
                ↓
             修正 → 验证 → 失败（第3次）
                        ↓
                     上报 Orchestrator（不再自行重试）
```

**关键原则**：第 2 次失败时必须换思路，不能重复同一方案。

## 4. Agent 自我评估（置信度）

每次完成任务后，Agent 输出自评：

```json
{
  "task_id": "T003",
  "confidence": 0.85,
  "confidence_breakdown": {
    "correctness": 0.9,   // 功能是否正确
    "completeness": 0.8,  // 是否覆盖所有要求
    "security": 1.0,      // 安全性
    "test_coverage": 0.75 // 测试覆盖
  },
  "low_confidence_reasons": ["边界条件 X 未完全测试"],
  "recommend_review": true  // confidence < 0.8 时建议人工 Review
}
```

Orchestrator 根据置信度决定是否触发 Reviewer：
- `confidence >= 0.85`：自动通过，跳过 Reviewer
- `0.70 <= confidence < 0.85`：触发 Reviewer
- `confidence < 0.70`：触发 Reviewer + 通知用户

## 5. 多 Agent 协作中的 Hermes 模式

### Orchestrator 使用 Hermes 工具调用分配任务

```json
// Orchestrator → Worker 的结构化任务分配
{
  "name": "dispatch_task",
  "arguments": {
    "task_id": "T003",
    "worker_role": "Coder-Backend",
    "context": {
      "specs": ["specs/backend/JAVA_SPEC.md"],
      "files_to_read": ["src/service/UserService.java"],
      "done_when": "单元测试通过，覆盖率 >= 80%"
    }
  }
}
```

### Worker 使用 CoT 实现复杂逻辑

```
<think>
任务：实现用户注册服务
已知：
  - 需要检查邮箱唯一性
  - 密码需要 BCrypt 加密
  - 需要发送验证邮件
依赖分析：
  - 邮件服务已存在（EmailService）
  - UserMapper 已有 existsByEmail 方法
实现顺序：校验 → 加密 → 持久化 → 发邮件（异步）
</think>
[开始实现代码]
```

### Reviewer 使用结构化输出

```json
{
  "review_result": "NEEDS_CHANGES",
  "issues": [
    {
      "severity": "HIGH",
      "file": "UserService.java",
      "line": 45,
      "issue": "密码未加密直接存储",
      "fix": "使用 passwordEncoder.encode(password)"
    }
  ],
  "approved_after_fix": true
}
```

## 6. 与现有 SOP 的集成点

| 现有文件 | Hermes 增强点 |
|---------|--------------|
| `agents/WORKER.md` | 工具调用链模式 + 自修复循环 |
| `agents/SELF_EVOLUTION.md` | 自我反思触发规则库更新 |
| `quality/CODE_REVIEW.md` | Reviewer 结构化输出格式 |
| `skills/SKILL_REGISTRY.md` | 新增 Hermes 专项技能 |
| `core/PRINCIPLES.md` | P8 自我反思原则 |
