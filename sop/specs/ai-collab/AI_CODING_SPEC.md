# AI 编码协作规范

> 版本: v1.0 | 更新: 2026-05-12
> 适用于所有 AI 智能体参与的编码任务。

## 1. 核心原则

AI 编码不限定技术栈，但必须遵守以下原则：

| 原则 | 说明 |
|------|------|
| **理解优先** | 修改前先读懂现有代码，不盲目生成 |
| **最小变更** | 只改解决问题所需的最少代码 |
| **风格一致** | 匹配项目现有风格，不引入新模式 |
| **验证必须** | 每次修改后运行构建和测试 |
| **安全默认** | 安全问题是默认要求，不是可选项 |

## 2. 开始编码前

```python
# 必须完成的准备步骤
def before_coding(task):
    # 1. 读取任务详情
    task_detail = TaskGet(task.id)
    
    # 2. 确认依赖已完成
    assert all_dependencies_done(task.depends_on)
    
    # 3. 读取相关代码（精确读取，不全量）
    grep_locate_relevant_code()
    read_relevant_sections()
    
    # 4. 确认构建和测试命令
    confirm_build_command()
    confirm_test_command()
    
    # 5. 加载适用规范（按需）
    load_applicable_specs(task.type, task.tech_stack)
```

## 3. 规范加载策略

AI 根据任务类型按需加载规范，不全量加载：

```python
SPEC_MAP = {
    "frontend_vue":    ["specs/frontend/FRONTEND_SPEC.md", "specs/frontend/VUE3_SPEC.md"],
    "frontend_react":  ["specs/frontend/FRONTEND_SPEC.md", "specs/frontend/REACT_SPEC.md"],
    "backend_java":    ["specs/backend/JAVA_SPEC.md", "specs/api/API_RESPONSE_SPEC.md"],
    "database":        ["specs/database/DATABASE_SPEC.md"],
    "security":        ["specs/security/SECURITY_SPEC.md"],
    "testing":         ["specs/testing/TESTING_SPEC.md"],
    "review":          ["specs/quality/QUALITY_GATE_SPEC.md"],
}
```

## 4. 技术选型灵活性

AI **不限定**使用特定技术栈。选型原则：

1. **优先使用项目现有技术**：读取 `package.json`/`pom.xml` 确认现有依赖
2. **不引入未经授权的新依赖**：需要新依赖时先上报 Orchestrator
3. **记录技术决策**：重大选型写入 `memory/decisions/`

```python
def select_technology(requirement):
    # 1. 检查项目现有技术
    existing = read_project_dependencies()
    
    # 2. 优先复用现有技术
    if can_solve_with_existing(requirement, existing):
        return existing_solution
    
    # 3. 需要新技术时上报
    report_to_orchestrator(f"需要引入新依赖: {proposed_lib}")
    wait_for_approval()
```

## 5. 代码生成规范

### 禁止生成的代码
- 过度抽象（"以后可能用到"的接口/工厂）
- 防御性代码（内部调用不需要过度校验）
- 注释说明 WHAT（代码本身应该自解释）
- 未使用的代码（dead code）

### 必须生成的代码
- 对应的测试（新功能/Bug 修复）
- 安全校验（用户输入边界）
- 错误处理（系统边界）

### 注释规范
```java
// ✅ 只注释 WHY（非显而易见的原因）
// bcrypt 强度 12：在安全性和性能间的平衡点，低于 10 不安全，高于 14 太慢
return new BCryptPasswordEncoder(12);

// ❌ 禁止注释 WHAT（代码已经说明了）
// 创建用户
User user = new User();
user.setUsername(request.getUsername());
```

## 6. 错误处理规范

```
系统边界（用户输入、外部 API）→ 必须验证和处理
内部调用 → 信任，不过度防御
已知不可能发生的情况 → 不添加防御代码
```

## 7. 完成编码后

```python
def after_coding(task):
    # 1. 运行构建（必须）
    result = run_build()
    assert result.success, f"构建失败: {result.error}"
    
    # 2. 运行测试（必须）
    result = run_tests()
    assert result.all_passed, f"测试失败: {result.failures}"
    
    # 3. 检查安全问题
    check_no_hardcoded_secrets()
    check_no_sql_injection()
    
    # 4. 更新任务状态
    TaskUpdate(task.id, status="completed")
    
    # 5. 记录变更
    record_code_change(task.id, changed_files, summary)
```

## 8. 阻塞处理

遇到以下情况立即上报，不沉默：
- 需求不清晰（无法确定实现方向）
- 技术障碍（连续 2 次尝试失败）
- 需要新依赖（未经授权）
- 发现安全漏洞（需要立即修复）
- 上下文预算不足（需要新窗口）
