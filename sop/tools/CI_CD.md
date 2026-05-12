# CI/CD 集成规范

## 流水线结构

```yaml
# 每次 PR 触发
pr-pipeline:
  stages:
    - lint          # 代码格式检查
    - typecheck     # 类型检查
    - test          # 单元 + 集成测试
    - coverage      # 覆盖率门禁
    - security      # 依赖安全扫描
    - build         # 构建验证

# 合并到 main 后触发
deploy-pipeline:
  stages:
    - e2e           # 端到端测试
    - deploy-staging
    - smoke-test    # 冒烟测试
    - deploy-prod   # 手动审批后
```

## GitHub Actions 模板

```yaml
name: PR Checks
on:
  pull_request:
    branches: [main, develop]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - run: npm ci
      
      - name: Lint
        run: npm run lint
      
      - name: Type Check
        run: npm run typecheck
      
      - name: Test with Coverage
        run: npm run test:coverage
      
      - name: Coverage Gate
        run: |
          LINES=$(cat coverage/coverage-summary.json | jq '.total.lines.pct')
          [ $(echo "$LINES >= 80" | bc) -eq 1 ] || (echo "Coverage $LINES% < 80%" && exit 1)
      
      - name: Security Audit
        run: npm audit --audit-level=high
```

## AI 智能体与 CI 的交互

### 提交前（本地验证）
AI 智能体在提交前必须本地运行：
```bash
npm run build    # 构建
npm test         # 测试
npm run lint     # 格式
```

CI 是最后防线，不是第一道防线。

### CI 失败处理
```
CI 失败
  │
  ▼
读取失败日志（精确读取，不读整个日志）
  │
  ▼
定位根因
  │
  ├── 代码问题 → 修复，重新提交
  ├── 环境问题 → 上报，等待修复
  └── 测试不稳定 → 记录，重新运行
```

### 禁止行为
- 禁止 `--no-verify` 跳过 pre-commit hooks
- 禁止修改 CI 配置来绕过检查
- 禁止在 CI 失败时强制合并

## 环境变量管理

```
开发环境：.env.local（不提交）
测试环境：CI secrets
生产环境：密钥管理服务（AWS Secrets Manager / Vault）
```

AI 智能体禁止读取包含真实密钥的 `.env` 文件内容，只读取变量名。
