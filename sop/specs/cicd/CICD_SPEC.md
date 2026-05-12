# CI/CD 规范

> 版本: v1.0 | 更新: 2026-05-12
> 参考: GitHub Actions 最佳实践 + DORA Metrics

## 1. 流水线结构

```
PR 提交
  └── PR Pipeline（每次 push 触发）
        ├── lint          代码格式检查
        ├── typecheck     类型检查
        ├── test          单元 + 集成测试
        ├── coverage      覆盖率门禁（≥80%）
        ├── security      依赖安全扫描
        └── build         构建验证

合并到 main
  └── Deploy Pipeline
        ├── e2e           端到端测试
        ├── deploy-staging 部署到 staging
        ├── smoke-test    冒烟测试
        └── deploy-prod   手动审批后部署生产
```

## 2. GitHub Actions 标准模板

```yaml
# .github/workflows/pr.yml
name: PR Checks
on:
  pull_request:
    branches: [main, develop]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Java
        uses: actions/setup-java@v4
        with:
          java-version: '21'
          distribution: 'temurin'
          cache: 'maven'

      - name: Lint & Type Check
        run: mvn checkstyle:check

      - name: Test with Coverage
        run: mvn test jacoco:report

      - name: Coverage Gate
        run: |
          COVERAGE=$(python3 -c "
          import xml.etree.ElementTree as ET
          tree = ET.parse('target/site/jacoco/jacoco.xml')
          root = tree.getroot()
          counter = next(c for c in root.findall('counter') if c.get('type') == 'LINE')
          covered = int(counter.get('covered'))
          missed = int(counter.get('missed'))
          print(f'{covered/(covered+missed)*100:.1f}')
          ")
          echo "Coverage: $COVERAGE%"
          python3 -c "assert float('$COVERAGE') >= 80, 'Coverage below 80%'"

      - name: Security Scan
        run: mvn dependency-check:check -DfailBuildOnCVSS=7

      - name: Build
        run: mvn package -DskipTests
```

## 3. 质量门禁（CI 强制）

| 检查项 | 标准 | 失败处理 |
|--------|------|---------|
| 代码格式 | 0 错误 | 阻止合并 |
| 类型检查 | 0 错误 | 阻止合并 |
| 单元测试 | 100% 通过 | 阻止合并 |
| 覆盖率 | ≥80% | 阻止合并 |
| 安全扫描 | 无高危漏洞（CVSS≥7） | 阻止合并 |
| 构建 | 成功 | 阻止合并 |

## 4. 分支策略

```
main          生产分支（保护，只接受 PR）
develop       集成分支（可选）
feature/T{id}-{desc}   功能分支
fix/T{id}-{desc}       修复分支
release/v{x.y.z}       发布分支
```

**规则**：
- `main` 分支保护，禁止直接 push
- PR 必须通过所有 CI 检查才能合并
- PR 合并后自动删除功能分支

## 5. 部署规范

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy-staging:
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v4
      - name: Build Docker Image
        run: docker build -t app:${{ github.sha }} .
      - name: Deploy to Staging
        run: |
          docker push registry/app:${{ github.sha }}
          kubectl set image deployment/app app=registry/app:${{ github.sha }}

  deploy-prod:
    needs: deploy-staging
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://app.example.com
    steps:
      - name: Deploy to Production
        run: kubectl set image deployment/app app=registry/app:${{ github.sha }}
```

## 6. 环境变量管理

```
开发环境：.env.local（不提交 git）
测试环境：GitHub Secrets（CI 注入）
生产环境：密钥管理服务（AWS Secrets Manager / Vault）
```

**规范**：
- 禁止在代码中硬编码任何密钥
- 禁止将 `.env` 文件提交到 git
- 生产密钥只有 CI/CD 系统可以访问

## 7. Docker 规范

```dockerfile
# 多阶段构建（减小镜像体积）
FROM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline  # 缓存依赖
COPY src ./src
RUN mvn package -DskipTests

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=builder /app/target/*.jar app.jar
# 非 root 用户运行（安全）
RUN addgroup -S app && adduser -S app -G app
USER app
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

## 8. DORA 指标目标

| 指标 | 目标 |
|------|------|
| 部署频率 | ≥1 次/天 |
| 变更前置时间 | <1 天 |
| 变更失败率 | <15% |
| 恢复时间 | <1 小时 |

## 9. Jenkins Pipeline 规范

```groovy
// Jenkinsfile
pipeline {
    agent any
    parameters {
        choice(name: 'ENV', choices: ['dev', 'staging', 'prod'], description: '部署环境')
    }
    stages {
        stage('测试') {
            steps { sh 'mvn clean test' }
            post { always { junit 'target/surefire-reports/*.xml' } }
        }
        stage('构建') {
            steps { sh 'mvn clean package -DskipTests' }
        }
        stage('部署 Dev') {
            when { environment name: 'ENV', value: 'dev' }
            steps { sh './deploy.sh dev' }
        }
        stage('部署 Staging') {
            when { environment name: 'ENV', value: 'staging' }
            steps {
                input message: '批准部署到 Staging?'
                sh './deploy.sh staging'
            }
        }
        stage('部署 Prod') {
            when { environment name: 'ENV', value: 'prod' }
            steps {
                input message: '批准部署到生产环境?'
                sh './deploy.sh prod'
            }
        }
    }
    post {
        failure { mail to: 'team@example.com', subject: "❌ 构建失败: ${env.JOB_NAME}", body: "${env.BUILD_URL}" }
    }
}
```

## 10. 多环境部署规范

| 环境 | 触发方式 | 审批 | 回滚策略 |
|------|---------|------|---------|
| dev | push main | 自动 | 自动 |
| staging | 手动触发 | 1人审批 | 手动 |
| prod | 手动触发 | 2人审批 | 蓝绿切换 |

## 11. 回滚机制

```bash
# 快速回滚（切换到上一个稳定版本）
./deploy.sh prod --rollback

# 指定版本回滚
./deploy.sh prod --version v1.2.3

# Docker 回滚
docker service update --rollback my-service
```

**回滚触发条件**：
- 错误率 > 1%（5分钟内）
- P99 响应时间 > 2s
- 健康检查连续失败 3 次
