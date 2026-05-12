# 测试规范

> 版本: v1.0 | 更新: 2026-05-12
> 参考: Google Testing Blog + Martin Fowler + Spring Boot Testing

## 1. 测试金字塔

```
        E2E (10%)      ← 关键业务流程，慢，维护成本高
       集成测试 (20%)   ← 模块间交互，API 测试
      单元测试 (70%)    ← 函数/类，快，维护成本低
```

## 2. 覆盖率要求

| 层次 | 最低要求 | 目标 |
|------|---------|------|
| 整体行覆盖率 | 80% | 90% |
| 安全相关代码 | 95% | 100% |
| 核心业务逻辑 | 90% | 95% |

**CI 门禁**：覆盖率低于 80% 阻止合并。

## 3. 单元测试规范

### AAA 模式（Arrange-Act-Assert）
```java
@Test
void createUser_whenEmailExists_throwsBusinessException() {
    // Arrange
    when(userMapper.existsByEmail("test@example.com")).thenReturn(true);
    var request = new UserCreateRequest("test", "test@example.com", "Pass123!");

    // Act & Assert
    assertThrows(BusinessException.class, () -> userService.create(request));
    verify(userMapper, never()).insert(any());
}
```

### 测试命名规范
```
{方法名}_{场景描述}_{期望结果}

✅ createUser_whenEmailExists_throwsBusinessException
✅ calculateTotal_withDiscount_returnsDiscountedPrice
❌ testCreate
❌ test1
```

### 必须覆盖的场景
- 正常路径（happy path）
- 边界条件（空值、零值、最大值）
- 错误路径（异常、失败）
- 安全相关路径（越权、注入）

## 4. 集成测试规范

```java
// ✅ 使用真实数据库（不 mock）
@SpringBootTest
@Transactional  // 测试后自动回滚
class UserServiceIntegrationTest {

    @Autowired
    private UserService userService;

    @Test
    void createUser_success() {
        var request = new UserCreateRequest("testuser", "test@example.com", "Pass123!");
        var result = userService.create(request);

        assertThat(result.getId()).isNotNull();
        assertThat(result.getEmail()).isEqualTo("test@example.com");
    }
}

// ✅ API 集成测试
@SpringBootTest(webEnvironment = RANDOM_PORT)
class UserControllerTest {

    @Autowired
    private TestRestTemplate restTemplate;

    @Test
    void register_withValidData_returns201() {
        var request = new UserCreateRequest("user", "user@test.com", "Pass123!");
        var response = restTemplate.postForEntity("/api/v1/users", request, ApiResponse.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
    }
}
```

**规范**：
- 集成测试使用真实数据库（H2 内存库或 Testcontainers）
- 禁止 mock 数据库（会掩盖真实问题）
- 每个测试独立，不依赖执行顺序

## 5. 前端测试规范

```typescript
// ✅ 组件测试（Vitest + Testing Library）
import { render, screen, fireEvent } from '@testing-library/vue';
import LoginForm from './LoginForm.vue';

test('提交时调用 onSubmit', async () => {
    const onSubmit = vi.fn();
    render(LoginForm, { props: { onSubmit } });

    await fireEvent.input(screen.getByLabelText('邮箱'), {
        target: { value: 'test@example.com' }
    });
    await fireEvent.click(screen.getByRole('button', { name: '登录' }));

    expect(onSubmit).toHaveBeenCalledWith({
        email: 'test@example.com'
    });
});
```

## 6. E2E 测试规范（Playwright）

```typescript
// ✅ 只测试关键业务流程
test('用户注册登录流程', async ({ page }) => {
    await page.goto('/register');
    await page.fill('[name=email]', 'e2e@test.com');
    await page.fill('[name=password]', 'Pass123!');
    await page.click('button[type=submit]');

    await expect(page).toHaveURL('/dashboard');
    await expect(page.locator('h1')).toContainText('欢迎');
});
```

**E2E 测试原则**：
- 只覆盖核心业务流程（注册、登录、核心功能）
- 不测试 UI 细节（颜色、字体）
- 使用独立测试账号，不污染生产数据

## 7. 测试数据管理

```java
// ✅ 工厂方法创建测试数据
public class UserFactory {
    public static User create(Consumer<User> customizer) {
        var user = new User();
        user.setUsername("testuser");
        user.setEmail("test@example.com");
        user.setPasswordHash("$2a$12$...");
        customizer.accept(user);
        return user;
    }
}

// 使用
var admin = UserFactory.create(u -> u.setRole(Role.ADMIN));
```

**规范**：
- 测试数据在测试内部创建，不依赖外部数据
- 使用 faker 生成随机数据（避免硬编码）
- 禁止测试依赖执行顺序

## 8. 禁止事项

- 禁止 `@Disabled` / `test.skip` 提交到主分支
- 禁止测试中使用 `Thread.sleep`（用 Awaitility）
- 禁止测试依赖外部网络（用 WireMock）
- 禁止 mock 数据库（用 Testcontainers 或 H2）

## 9. 单元测试完整模板（AAA 模式）

```java
@ExtendWith(MockitoExtension.class)
class UserServiceTest {

    @Mock private UserMapper userMapper;
    @InjectMocks private UserServiceImpl userService;

    private UserCreateRequest validRequest;

    @BeforeEach
    void setUp() {
        validRequest = new UserCreateRequest();
        validRequest.setUsername("testuser");
        validRequest.setEmail("test@example.com");
        validRequest.setPassword("Test1234");
    }

    @Test
    @DisplayName("创建用户 - 输入有效 - 返回 UserVO")
    void createUser_withValidInput_returnsUserVO() {
        // Arrange
        when(userMapper.selectByUsername(anyString())).thenReturn(null);
        when(userMapper.insert(any(User.class))).thenReturn(1);

        // Act
        UserVO result = userService.createUser(validRequest);

        // Assert
        assertThat(result).isNotNull();
        assertThat(result.getUsername()).isEqualTo("testuser");
        verify(userMapper, times(1)).insert(any(User.class));
    }

    @Test
    @DisplayName("创建用户 - 用户名重复 - 抛出 BusinessException")
    void createUser_withDuplicateUsername_throwsBusinessException() {
        // Arrange
        when(userMapper.selectByUsername("testuser")).thenReturn(new User());

        // Act & Assert
        assertThatThrownBy(() -> userService.createUser(validRequest))
            .isInstanceOf(BusinessException.class)
            .hasMessageContaining("用户名已存在");
        verify(userMapper, never()).insert(any());
    }
}
```

**命名规范**：`方法名_场景_期望结果`，如 `createUser_withValidInput_returnsUserVO`

## 10. Mock 使用规范

```java
// ✅ 只 Mock 必要的依赖
when(userMapper.selectById(userId)).thenReturn(user);

// ✅ 验证关键调用
verify(userMapper, times(1)).insert(any(User.class));
verify(emailService, never()).sendEmail(any());  // 验证未调用

// ❌ 禁止 Mock 被测类本身
// ❌ 禁止在单元测试中真实访问数据库
```

## 11. 测试数据管理

```java
// ✅ 使用 Builder 模式构建测试数据
User user = User.builder()
    .id(1L).username("test").email("test@example.com")
    .status(1).isDeleted(0).build();

// ✅ 集成测试使用 @Sql 初始化数据
@Sql("/sql/test-users.sql")
@Test
void testGetUser() { ... }

// ✅ 每个测试后清理（@Transactional 自动回滚）
@SpringBootTest
@Transactional
class UserIntegrationTest { ... }
```

## 12. 集成测试规范

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
class UserControllerTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;

    @Test
    void createUser_returnsCreated() throws Exception {
        UserCreateRequest req = new UserCreateRequest("test", "test@example.com", "Test1234");

        mockMvc.perform(post("/api/v1/users")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(req)))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.code").value(0))
            .andExpect(jsonPath("$.data.username").value("test"));
    }
}
```
