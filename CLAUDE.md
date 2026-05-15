# sop-dev

## AI 开发规约

本项目使用 sop 规约体系。规约 Markdown 建议放在 **`ai-sop/`**（Git submodule）；运维脚本可参考 **`ai-sop-ops/`**。

### 启动检查清单

1. 读取 `memory/current_state.json` 了解当前状态
2. 读取 `.ai-memory/rules/RULES.md` 加载项目规则
3. 按需查阅 **`ai-sop/specs/`** 等规范；IDE 规则见 **`.cursorrules`**、**`.trae/rules.md`**、**`.qoder/context.md`**
4. 确认当前阶段和待处理任务

### 核心原则

- 最小化：只写解决问题所需的最少代码
- 状态外化：进度持久化到 memory/ 目录
- 可追溯：commit 格式 `type(scope): desc [T-id]`
- 安全优先：用户输入必须验证，禁止硬编码密钥

### 技术栈

（在此填写项目技术栈）

### 构建命令

```bash
# 构建
# npm run build

# 测试
# npm test

# 代码检查
# npm run lint
```
