# 测试流程 SOP

## 测试层次

```
E2E 测试（关键路径）
    ↑
集成测试（模块间交互）
    ↑
单元测试（函数/类）
```

原则：单元测试多，集成测试适量，E2E 测试少而精。

## 单元测试规范

### 文件组织
```
src/
├── services/
│   ├── email.ts
│   └── email.test.ts    # 与被测文件同目录
└── utils/
    ├── validator.ts
    └── validator.test.ts
```

### 测试结构（AAA 模式）
```typescript
describe("EmailService.send", () => {
  it("成功发送时返回 message ID", async () => {
    // Arrange
    const service = new EmailService(mockTransport);
    const mail = { to: "user@example.com", subject: "Test", body: "Hello" };

    // Act
    const result = await service.send(mail);

    // Assert
    expect(result.messageId).toBeDefined();
  });

  it("SMTP 连接失败时抛出 EmailError", async () => {
    const service = new EmailService(failingTransport);
    await expect(service.send(mail)).rejects.toThrow(EmailError);
  });
});
```

### 必须覆盖的场景
- 正常路径（happy path）
- 边界条件（空值、零值、最大值）
- 错误路径（异常、失败）
- 安全相关路径（注入、越权）

## 集成测试规范

### 数据库测试
```python
# 使用真实数据库，不 mock
# 每个测试用独立的事务，测试后回滚
@pytest.fixture
def db_session():
    session = Session()
    session.begin()
    yield session
    session.rollback()
    session.close()

def test_create_user(db_session):
    user = UserRepository(db_session).create(
        email="test@example.com",
        name="Test User"
    )
    assert user.id is not None
    assert db_session.query(User).filter_by(id=user.id).first() is not None
```

### API 测试
```python
def test_register_endpoint(client, db_session):
    response = client.post("/api/auth/register", json={
        "email": "new@example.com",
        "password": "SecurePass123!",
        "name": "New User"
    })
    assert response.status_code == 201
    assert response.json()["email"] == "new@example.com"
    assert "password" not in response.json()  # 密码不返回
```

## 测试命令规范

每个项目必须在 `package.json` / `Makefile` / `pyproject.toml` 中定义：

```json
{
  "scripts": {
    "test": "jest",
    "test:coverage": "jest --coverage",
    "test:watch": "jest --watch",
    "test:e2e": "playwright test"
  }
}
```

AI 智能体在验证步骤中使用 `test` 命令，CI 使用 `test:coverage`。

## 覆盖率要求

| 层次 | 最低要求 | 目标 |
|------|---------|------|
| 整体行覆盖率 | 80% | 90% |
| 整体分支覆盖率 | 70% | 85% |
| 安全相关代码 | 95% | 100% |
| 核心业务逻辑 | 90% | 95% |

## 测试数据管理

### 原则
- 测试数据在测试内部创建，不依赖外部数据
- 使用工厂函数创建测试数据
- 敏感数据使用假数据（faker）

### 工厂函数示例
```typescript
const createUser = (overrides = {}) => ({
  id: "user-123",
  email: "test@example.com",
  name: "Test User",
  createdAt: new Date("2026-01-01"),
  ...overrides,
});
```

## CI 测试流程

```yaml
# .github/workflows/test.yml
steps:
  - name: Lint
    run: npm run lint

  - name: Type Check
    run: npm run typecheck

  - name: Unit & Integration Tests
    run: npm run test:coverage

  - name: Coverage Gate
    run: |
      COVERAGE=$(cat coverage/coverage-summary.json | jq '.total.lines.pct')
      if (( $(echo "$COVERAGE < 80" | bc -l) )); then
        echo "Coverage $COVERAGE% is below 80%"
        exit 1
      fi

  - name: Security Scan
    run: npm audit --audit-level=high
```

## 禁止事项

- 禁止 mock 数据库（除非有明确授权）
- 禁止测试依赖执行顺序
- 禁止测试依赖外部网络（使用 mock server）
- 禁止 `test.skip` 或 `xit` 提交到主分支
- 禁止 `console.log` 在测试中（用 logger mock）
