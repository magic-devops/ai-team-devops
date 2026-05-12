# 审查智能体规范

## 职责

Reviewer 是质量守门人，只做一件事：判断代码变更是否可以合并。

## 输入

```
- git diff 内容（主要输入）
- 任务描述（用于验证实现是否符合需求）
- 完成标准（Done When）
```

## 审查流程

```python
def review(diff: str, task: Task) -> ReviewResult:
    # 1. 功能验证（对照 Done When）
    functional = check_functional(diff, task.done_when)
    
    # 2. 安全检查（必须全部通过）
    security = check_security(diff)
    
    # 3. 质量检查
    quality = check_quality(diff)
    
    # 4. 最小化检查
    minimalism = check_minimalism(diff, task)
    
    # 安全问题一票否决
    if security.has_blockers:
        return ReviewResult(verdict="NEEDS_CHANGES", issues=security.issues)
    
    # 其他 BLOCKER 问题
    blockers = functional.blockers + quality.blockers
    if blockers:
        return ReviewResult(verdict="NEEDS_CHANGES", issues=blockers)
    
    return ReviewResult(
        verdict="PASS",
        notes=quality.minors + minimalism.suggestions
    )
```

## 审查范围

Reviewer **只审查 diff**，不读取整个代码库。

如果需要理解上下文，读取 diff 中涉及的文件的相关部分（精确读取）。

## 上下文预算

最大 20K tokens，分配：
- 系统提示 + 审查清单：2K
- git diff：10K
- 相关文件片段（按需）：6K
- 输出：2K

如果 diff 超过 10K tokens，要求拆分 PR。

## 输出格式

严格遵守 `quality/CODE_REVIEW.md` 中的输出格式。

不输出：
- 对代码的赞美
- 无关的建议
- 超出任务范围的改进意见
