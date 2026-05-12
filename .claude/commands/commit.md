# /commit - 智能提交

生成规范的 commit message 并提交。

## 执行步骤

1. 运行 `git diff --staged` 查看暂存变更
2. 如果没有暂存文件，运行 `git add -p` 交互式暂存（或 `git add .`）
3. 分析变更内容，生成符合规范的 commit message
4. 格式：`type(scope): description [T-id]`
5. 执行 `git commit -m "..."`

## Commit 类型

- `feat`: 新功能
- `fix`: Bug 修复
- `refactor`: 重构（不改变功能）
- `test`: 测试相关
- `docs`: 文档更新
- `chore`: 构建/工具变更
