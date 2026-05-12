# E2E 测试规范

> 版本: v1.0 | 更新: 2026-05-12
> 工具: Playwright（Web）· Detox（React Native）· Flutter Integration Test

## 1. 测试范围

E2E 只覆盖**关键业务流程**，不测试 UI 细节：

```
✅ 必须覆盖：
  - 用户注册 / 登录 / 登出
  - 核心业务流程（下单、支付、核心功能）
  - 权限控制（无权限时正确拒绝）

❌ 不测试：
  - 颜色、字体、间距
  - 动画效果
  - 已有单元测试覆盖的逻辑
```

## 2. Playwright（Web E2E）

### 项目结构
```
e2e/
├── fixtures/
│   ├── auth.ts          # 登录 fixture
│   └── test-data.ts     # 测试数据工厂
├── pages/               # Page Object Model
│   ├── LoginPage.ts
│   └── DashboardPage.ts
├── tests/
│   ├── auth.spec.ts
│   └── order.spec.ts
└── playwright.config.ts
```

### Page Object Model
```typescript
// e2e/pages/LoginPage.ts
export class LoginPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/login');
  }

  async login(email: string, password: string) {
    await this.page.fill('[data-testid=email]', email);
    await this.page.fill('[data-testid=password]', password);
    await this.page.click('[data-testid=submit]');
  }

  async expectError(message: string) {
    await expect(this.page.locator('[data-testid=error]')).toContainText(message);
  }
}
```

### 测试用例
```typescript
// e2e/tests/auth.spec.ts
test.describe('用户认证', () => {
  test('正常登录流程', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login('test@example.com', 'Pass123!');
    await expect(page).toHaveURL('/dashboard');
  });

  test('密码错误时显示错误提示', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login('test@example.com', 'wrong');
    await loginPage.expectError('账号或密码错误');
  });
});
```

### 配置
```typescript
// playwright.config.ts
export default defineConfig({
  testDir: './e2e/tests',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 14'] } },
  ],
});
```

## 3. Flutter Integration Test（移动端 E2E）

```dart
// integration_test/app_test.dart
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('登录流程', (tester) async {
    app.main();
    await tester.pumpAndSettle();

    // 找到登录页面
    expect(find.byKey(Key('login-page')), findsOneWidget);

    // 输入凭据
    await tester.enterText(find.byKey(Key('email')), 'test@example.com');
    await tester.enterText(find.byKey(Key('password')), 'Pass123!');
    await tester.tap(find.byKey(Key('submit')));
    await tester.pumpAndSettle();

    // 验证跳转到首页
    expect(find.byKey(Key('home-page')), findsOneWidget);
  });
}
```

## 4. 测试数据管理

```typescript
// ✅ 使用独立测试账号，不污染生产数据
// ✅ 每次测试前重置状态
// ✅ 测试后清理创建的数据

// fixtures/auth.ts
export const test = base.extend<{ loggedInPage: Page }>({
  loggedInPage: async ({ page }, use) => {
    // 通过 API 直接创建测试用户（跳过 UI）
    await request.post('/api/test/users', { data: testUser });
    await page.goto('/login');
    await page.fill('[data-testid=email]', testUser.email);
    await page.fill('[data-testid=password]', testUser.password);
    await page.click('[data-testid=submit]');
    await page.waitForURL('/dashboard');
    await use(page);
    // 清理
    await request.delete(`/api/test/users/${testUser.id}`);
  },
});
```

## 5. CI 集成

```yaml
# .github/workflows/e2e.yml
- name: Install Playwright
  run: npx playwright install --with-deps chromium

- name: Run E2E Tests
  run: npx playwright test
  env:
    E2E_BASE_URL: http://localhost:3000

- name: Upload Test Report
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: playwright-report
    path: playwright-report/
```

## 6. 禁止事项

- 禁止 E2E 测试依赖生产数据
- 禁止 E2E 测试中使用 `page.waitForTimeout`（用 `waitForSelector`）
- 禁止测试 UI 样式细节
- 禁止 E2E 测试覆盖已有单元测试的逻辑
