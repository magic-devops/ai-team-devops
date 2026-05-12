# Agent 自进化机制

## 核心思想

AI 智能体通过系统性地从错误和成功中学习，持续改进自身行为。
进化的载体是**规则库**（Rules），而非模型权重。

## 进化循环

```
执行任务
    │
    ▼
收集信号（成功/失败/用户反馈）
    │
    ▼
提取规则（从信号中归纳可复用规则）
    │
    ▼
验证规则（在历史案例上回测）
    │
    ▼
写入规则库
    │
    ▼
下次执行时应用规则
```

## 信号收集

### 负向信号（触发规则提取）
- 代码审查 NEEDS_CHANGES
- 测试失败
- 用户明确纠正（"不对"、"不要这样"）
- 任务阻塞超过 2 次
- 回滚事件

### 正向信号（强化规则）
- 代码审查 PASS（首次）
- 用户明确认可（"对"、"就是这样"）
- 任务按时完成（估算准确）

## 规则库结构

```
.ai-memory/rules/
├── RULES.md              # 规则索引（AI 每次启动时读取）
├── coding/
│   ├── rule_001.md       # 具体规则文件
│   └── rule_002.md
├── testing/
├── security/
└── workflow/
```

### 规则文件格式

```markdown
---
rule_id: RULE-001
category: coding
confidence: 0.85      # 0-1，基于历史验证
created_at: 2026-05-12
source: incident INC-003
status: active        # active | deprecated | testing
---

## 规则

在此项目中，数据库查询必须使用 QueryBuilder，不能直接拼接 SQL 字符串。

## 触发条件

当需要执行数据库查询时。

## 原因

INC-003：直接拼接 SQL 导致 SQL 注入漏洞，影响生产环境。

## 示例

错误：`db.query("SELECT * FROM users WHERE id = " + userId)`
正确：`db.query().where("id", userId).first()`

## 验证历史

- 2026-05-12：从 INC-003 提取，回测 5 个历史案例，4/5 符合
- 2026-05-15：应用于 T012，审查通过，confidence +0.05
```

## 规则提取 SOP

### 从失败中提取

```python
def extract_rule_from_failure(incident: Incident) -> Rule | None:
    """
    分析失败事件，提取可复用规则。
    返回 None 表示这是一次性问题，不值得提取规则。
    """
    # 判断是否可泛化
    if incident.is_one_time_issue:
        return None
    
    rule = Rule(
        category=classify_incident(incident),
        trigger=extract_trigger(incident),
        rule=extract_rule_text(incident),
        reason=incident.root_cause,
        example_wrong=incident.bad_code,
        example_correct=incident.fix_code,
        confidence=0.70,  # 初始置信度
        source=f"incident {incident.id}",
    )
    
    # 在历史案例上回测
    historical_cases = get_similar_incidents(incident, limit=10)
    matches = sum(1 for c in historical_cases if rule_applies(rule, c))
    rule.confidence = matches / len(historical_cases) if historical_cases else 0.70
    
    return rule if rule.confidence >= 0.60 else None
```

### 规则冲突检测

```python
def check_rule_conflicts(new_rule: Rule, existing_rules: list[Rule]) -> list[Rule]:
    """检测新规则是否与现有规则冲突"""
    conflicts = []
    for rule in existing_rules:
        if rule.category == new_rule.category:
            similarity = semantic_similarity(rule.rule, new_rule.rule)
            if similarity > 0.8:  # 高度相似，可能冲突
                conflicts.append(rule)
    return conflicts
```

## 规则应用

### 启动时加载

```python
def load_applicable_rules(task: Task) -> list[Rule]:
    """加载与当前任务相关的规则"""
    rules = load_all_active_rules()
    
    # 按相关性过滤
    relevant = [
        r for r in rules
        if r.category in task.categories
        and r.confidence >= 0.65
    ]
    
    # 按置信度排序
    return sorted(relevant, key=lambda r: r.confidence, reverse=True)[:10]
```

### 注入到任务 Prompt

```
## 适用规则（来自历史经验）

1. [RULE-001] 数据库查询必须使用 QueryBuilder（置信度 0.85）
2. [RULE-007] 邮件发送失败必须记录到 incidents（置信度 0.78）
```

## 规则生命周期

```
testing（新规则，观察期）
    │ 连续 3 次应用成功
    ▼
active（正式规则）
    │ 连续 2 次应用失败 或 被更好规则替代
    ▼
deprecated（废弃）
```

## 知识蒸馏

每个 Sprint 结束时，将本 Sprint 的规则变化提炼为 CLAUDE.md 更新：

```python
def distill_sprint_knowledge(sprint_id: str):
    new_rules = get_rules_created_in_sprint(sprint_id)
    deprecated_rules = get_rules_deprecated_in_sprint(sprint_id)
    
    if new_rules or deprecated_rules:
        update_claude_md(new_rules, deprecated_rules)
        commit_knowledge_update(sprint_id)
```

## Hermes 增强：反思驱动进化

### 反思 → 规则的自动路径

每次 `<reflect>` 输出后，Agent 判断是否值得提取规则：

```python
def reflect_to_rule(reflect_output: str, task: Task) -> Rule | None:
    # 连续 2 次相同反思 → 强制提取规则
    similar = find_similar_reflections(reflect_output, limit=5)
    if len(similar) >= 2:
        return extract_rule_from_pattern(similar)
    return None
```

### 置信度趋势追踪

```python
# 每个 Agent 维护置信度历史，识别系统性弱点
def track_confidence_trend(agent_role: str, task_type: str, confidence: float):
    history = get_confidence_history(agent_role, task_type, days=14)
    avg = sum(history) / len(history) if history else confidence
    
    if avg < 0.75:  # 系统性低置信度
        # 触发知识蒸馏：这类任务需要新规则
        trigger_knowledge_distill(agent_role, task_type)
```

### 自进化触发矩阵

| 信号 | 频率 | 动作 |
|------|------|------|
| 同类反思 ≥ 2 次 | 任意 | 提取规则 |
| 置信度连续 3 次 < 0.75 | 同类任务 | 触发知识蒸馏 |
| Review NEEDS_CHANGES | 同一问题 ≥ 2 次 | 更新 CODE_REVIEW 清单 |
| 自修复成功 | 第 2-3 次才成功 | 记录修复模式为规则 |
