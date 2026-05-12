# 知识蒸馏规范

## 目标

将项目运行过程中积累的经验（规则、决策、模式）提炼为可复用的知识，
注入到 CLAUDE.md 和规则库，让未来的 AI 实例无需重新踩坑。

## 蒸馏时机

| 触发事件 | 蒸馏内容 |
|---------|---------|
| Sprint 结束 | 本 Sprint 新增规则、废弃规则 |
| P0/P1 事故修复后 | 预防规则 |
| 连续 3 次相同错误 | 强制提取规则 |
| 重大技术决策 | 决策记录 + 适用场景 |

## 蒸馏流程

```python
def distill_sprint_knowledge(sprint_id: str):
    # 1. 收集本 Sprint 的信号
    incidents = get_sprint_incidents(sprint_id)
    decisions = get_sprint_decisions(sprint_id)
    review_failures = get_review_failures(sprint_id)
    
    # 2. 提取规则
    new_rules = []
    for incident in incidents:
        rule = extract_rule_from_failure(incident)
        if rule:
            new_rules.append(rule)
    
    # 3. 去重和冲突检测
    new_rules = deduplicate_rules(new_rules)
    
    # 4. 写入规则库
    for rule in new_rules:
        save_rule(rule)
        update_rules_index(rule)
    
    # 5. 更新 CLAUDE.md
    if new_rules:
        update_claude_md_rules_section(new_rules)
    
    # 6. 生成蒸馏报告
    return DistillationReport(
        sprint_id=sprint_id,
        new_rules=len(new_rules),
        deprecated_rules=len(deprecated_rules),
        key_learnings=summarize_learnings(incidents, decisions),
    )
```

## CLAUDE.md 规则注入格式

```markdown
## 项目规则（自动维护，勿手动编辑）

<!-- rules:start -->
### RULE-001 [coding] 置信度:0.85
数据库查询必须使用 QueryBuilder，不能直接拼接 SQL。
来源：INC-003（SQL 注入事故）

### RULE-007 [testing] 置信度:0.78
邮件发送测试必须使用 Mailtrap，不能使用真实 SMTP。
来源：INC-007（测试邮件发送到真实用户）
<!-- rules:end -->
```

## 规则质量评估

```python
def evaluate_rule_quality(rule: Rule) -> float:
    """评估规则质量，决定是否保留"""
    score = 0.0
    
    # 置信度（基于历史验证）
    score += rule.confidence * 0.5
    
    # 适用频率（被触发的次数）
    score += min(rule.trigger_count / 10, 1.0) * 0.3
    
    # 时效性（最近 30 天内有触发）
    days_since_last_trigger = (now() - rule.last_triggered).days
    score += (1.0 if days_since_last_trigger < 30 else 0.5) * 0.2
    
    return score

# 质量分 < 0.4 的规则自动废弃
```

## 跨项目知识迁移

当开始新项目时，从历史项目中迁移高置信度规则：

```python
def migrate_rules_to_new_project(source_project: str, target_project: str,
                                  tech_stack: list[str]):
    source_rules = get_active_rules(source_project)
    
    # 只迁移与目标技术栈相关的规则
    relevant = [
        r for r in source_rules
        if r.confidence >= 0.80
        and any(tech in r.tags for tech in tech_stack)
    ]
    
    for rule in relevant:
        # 降低置信度（新项目需要重新验证）
        rule.confidence *= 0.8
        rule.status = "testing"
        save_rule(rule, project=target_project)
    
    return len(relevant)
```
