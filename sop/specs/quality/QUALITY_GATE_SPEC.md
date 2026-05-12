# 质量门禁规范

> 版本: v1.1 | 更新: 2026-05-12
> 参考: SonarQube Quality Gate + Google Engineering Practices + ISO 9001
> AI 可自主执行所有门禁检查，无需等待人工确认。

## 1. 门禁层次

```
代码提交前（本地）
  └── pre-commit hook：lint + typecheck

PR 合并前（CI）
  └── 全量检查：lint + test + coverage + security + build

发布前（Release Gate）
  └── E2E + 性能测试 + 安全扫描
```

## 2. 各阶段门禁标准

### 代码提交门禁（pre-commit）
```yaml
checks:
  - lint: 0 errors
  - typecheck: 0 errors
  - no_hardcoded_secrets: true
```

### PR 合并门禁（CI）
```yaml
checks:
  unit_tests:
    pass_rate: 100%
  coverage:
    line: ">= 80%"
    branch: ">= 70%"
  security:
    critical_vulnerabilities: 0
    high_vulnerabilities: 0
  build:
    success: true
  code_review:
    approvals: ">= 1"
    no_blockers: true
```

### 发布门禁（Release）
```yaml
checks:
  e2e_tests:
    pass_rate: 100%
  performance:
    p95_response_time: "< 500ms"
    error_rate: "< 1%"
  security_scan:
    owasp_top10: pass
  changelog:
    updated: true
```

## 3. 机器可读门禁配置

```yaml
# .quality-gate.yml（放在项目根目录）
version: "1.0"
gates:
  pr:
    required: true
    checks:
      - id: test_coverage
        tool: jacoco
        threshold:
          line: 80
          branch: 70
        on_fail: block

      - id: security_scan
        tool: dependency-check
        threshold:
          cvss_score: 7.0
        on_fail: block

      - id: code_review
        min_approvals: 1
        on_fail: block

  release:
    required: true
    checks:
      - id: e2e_tests
        pass_rate: 100
        on_fail: block

      - id: performance
        p95_ms: 500
        error_rate_pct: 1
        on_fail: warn
```

## 4. AI 自检清单

AI 智能体在提交代码前必须自检：

```markdown
## 代码提交自检清单

### 功能正确性
- [ ] 实现符合任务描述
- [ ] 边界条件处理正确
- [ ] 错误路径有合理处理

### 安全性（必须全部通过）
- [ ] 无 SQL 注入风险
- [ ] 无 XSS 风险
- [ ] 无硬编码密钥
- [ ] 敏感数据不写入日志

### 代码质量
- [ ] 函数长度 ≤ 50 行
- [ ] 无重复代码
- [ ] 无死代码（未使用的变量/函数）
- [ ] 符合项目代码风格

### 测试
- [ ] 新功能有对应测试
- [ ] Bug 修复有回归测试
- [ ] 覆盖率不低于现有水平

### 最小化
- [ ] 没有超出任务范围的变更
- [ ] 没有未请求的重构
- [ ] 没有未使用的新依赖
```

## 5. 门禁不通过处理流程

```
门禁不通过
    │
    ▼
分析失败原因
    │
    ├── 代码问题 → 修复代码 → 重新提交
    ├── 测试失败 → 修复代码或测试 → 重新提交
    ├── 覆盖率不足 → 补充测试 → 重新提交
    ├── 安全漏洞 → 修复漏洞（不可跳过）→ 重新提交
    └── 误报 → 记录原因 → 申请豁免（需人工审批）
```

**禁止**：
- 禁止 `--no-verify` 跳过 pre-commit hook
- 禁止修改 CI 配置来绕过检查
- 禁止在 CI 失败时强制合并

## 6. 质量趋势追踪

每个 Sprint 记录质量指标：
```json
{
  "sprint": "sprint-3",
  "date": "2026-05-12",
  "metrics": {
    "test_coverage_line": 85,
    "test_coverage_branch": 72,
    "security_vulnerabilities": 0,
    "code_smells": 12,
    "technical_debt_hours": 4,
    "first_pass_review_rate": 73
  }
}
```

## 7. AI 自主执行规范

AI 在完成每个任务后**自动触发**门禁检查，无需等待人工指令：

```
任务完成 → 自动运行 lint/typecheck → 自动运行测试 → 自动检查安全
    ↓
全部通过 → 提交代码，更新任务状态为 completed
    ↓
任何失败 → 自动修复（最多 2 次重试）→ 仍失败则上报用户
```

**AI 不得跳过任何门禁**，即使用户未明确要求检查。

## 8. 多 Agent 门禁协作

- **Worker Agent**：执行代码提交门禁（lint + test）
- **Reviewer Agent**：执行 PR 合并门禁（覆盖率 + 安全扫描）
- **Orchestrator**：汇总门禁结果，决定是否推进到下一阶段
- 任何 Agent 发现 Critical 安全漏洞，立即暂停流程并上报

## 9. 各阶段门禁量化标准（来自 ai-docs）

### 需求阶段出口
- 需求描述 ≥ 200 字，核心功能 ≥ 3 项
- 技术栈已明确（或选用默认方案）
- 模糊需求（如"做个系统"）→ 阻断

### 架构设计出口
- 技术选型有明确理由
- 数据库设计符合规范（含标准字段）
- API 接口设计已完成（OpenAPI Spec）

### 任务规划出口
- 任务依赖无循环
- 80% 任务估算 ≤ 8h
- 已定义 ≥ 2 个里程碑

### 代码开发过程门禁（每个任务完成时）

```yaml
checks:
  lint:        0 errors, ≤ 5 warnings
  coverage:    line ≥ 80%，核心模块 = 100%
  duplication: < 5%
  security:    0 高危，≤ 2 中危
  build:       success
```

### 测试阶段出口

```yaml
checks:
  unit_tests:   pass_rate: 100%
  integration:  pass_rate: 100%
  e2e:          pass_rate: 100%
  performance:  p95 < 500ms，error_rate < 1%
```

### 发布门禁

```yaml
checks:
  changelog:    updated: true
  rollback_plan: defined: true
  monitoring:   configured: true
```

## 10. 通用代码开发检查清单

```markdown
### 功能正确性
- [ ] 实现符合任务描述和验收标准
- [ ] 边界条件处理正确（空值、最大值、并发）
- [ ] 错误路径有合理处理和日志

### 安全性（全部必须通过）
- [ ] 无 SQL 注入（使用 #{} 参数绑定）
- [ ] 无 XSS 风险（输出编码）
- [ ] 无硬编码密钥/密码
- [ ] 敏感数据不写入日志

### 代码质量
- [ ] 方法长度 ≤ 50 行
- [ ] 无重复代码（DRY 原则）
- [ ] 命名清晰（见名知意）
- [ ] 复杂逻辑有注释

### 数据库
- [ ] 新表包含标准字段（gmt_created/gmt_modified/is_deleted）
- [ ] gmt_modified 已建索引
- [ ] 使用参数化查询，禁止字符串拼接

### 测试
- [ ] 新功能有对应单元测试（AAA 模式）
- [ ] Bug 修复有回归测试
- [ ] 覆盖率不低于现有水平

### 最小化
- [ ] 没有超出任务范围的变更
- [ ] 没有未使用的新依赖
```
