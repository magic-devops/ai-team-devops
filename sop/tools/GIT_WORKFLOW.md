# Git 工作流规范

## 分支策略

```
main（保护分支，只接受 PR）
  ├── develop（集成分支）
  │     ├── feature/T001-user-registration
  │     ├── feature/T002-email-service
  │     └── fix/T007-session-not-cleared
  └── release/v1.2.0（发布分支）
```

## 分支命名规范

```
feature/{task-id}-{kebab-case-description}
fix/{task-id}-{kebab-case-description}
refactor/{task-id}-{kebab-case-description}
chore/{task-id}-{kebab-case-description}
release/v{major}.{minor}.{patch}
```

## Commit 规范

```
格式：{type}({scope}): {description} [{task-id}]

type（必须）:
  feat      新功能
  fix       Bug 修复
  refactor  重构
  test      测试
  chore     构建/工具/依赖
  docs      文档
  revert    回滚

scope（可选）: 模块名，如 auth, email, user

description: 祈使句，不超过 72 字符，不加句号

task-id: 关联任务 ID，如 [T004]

示例：
  feat(auth): 实现 JWT token 生成和验证 [T002]
  fix(email): 修复 HTML 模板渲染时特殊字符未转义 [T007]
  test(auth): 添加登录 API 集成测试 [T005]
```

## PR 规范

### PR 标题
```
{type}({scope}): {description}（≤70字符）
```

### PR 描述模板
```markdown
## 变更摘要

[1-3 个要点]

## 关联任务

- T{id}: {任务标题}

## 测试

- [ ] 单元测试通过
- [ ] 集成测试通过
- [ ] 手动验证：[验证步骤]

## 注意事项

[可选：部署注意事项、配置变更等]
```

### PR 规则
- 每个 PR 对应一个或一组相关任务
- PR 大小：≤400 行变更（不含测试和生成代码）
- 必须有至少一个 Reviewer 审查通过
- CI 必须全部通过
- 禁止直接 push 到 main/develop

## 标签规范

```
v{major}.{minor}.{patch}

major: 不兼容的 API 变更
minor: 向后兼容的新功能
patch: 向后兼容的 Bug 修复

示例：v1.2.3
```

## 常用命令

```bash
# 创建功能分支
git checkout -b feature/T001-user-registration

# 提交（使用规范格式）
git add src/auth/jwt.ts src/auth/jwt.test.ts
git commit -m "feat(auth): 实现 JWT token 生成和验证 [T002]"

# 推送并创建 PR
git push -u origin feature/T001-user-registration
gh pr create --title "feat(auth): 实现 JWT token 生成和验证" --body "..."

# 安全回滚（不破坏历史）
git revert {commit_hash}
git push origin feature/T001-user-registration
```

## 禁止操作

```bash
# 禁止：破坏历史
git push --force origin main
git reset --hard HEAD~3

# 禁止：跳过检查
git commit --no-verify

# 禁止：直接推送主分支
git push origin main
```
