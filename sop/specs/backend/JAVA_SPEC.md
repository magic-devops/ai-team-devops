# Java / Spring Boot 开发规范

> 版本: v1.1 | 更新: 2026-05-12
> 参考: 阿里巴巴 Java 开发手册 2024 + Spring Boot 3.x 最佳实践
> **包名约定**: 所有项目根包统一为 `com.magic.{app}`，默认 app=`superpower`，见 `specs/PROJECT_CONVENTIONS.md`

## 1. 架构模式选择

| 模式 | 适用场景 | 选择条件 |
|------|---------|---------|
| **MVC（快速）** | MVP、CRUD 为主 | 团队 ≤3 人，周期 <6 月 |
| **DDD（领域驱动）** | 复杂业务、微服务 | 团队 ≥5 人，长期演进 |

**原则**：不强制 DDD，能用 MVC 解决的不引入 DDD 复杂度。

## 2. 包结构规范

### MVC 模式
```
com.magic.{app}
├── controller/      # HTTP 入口，只做参数校验和响应封装
├── service/         # 业务逻辑（接口 + 实现）
├── mapper/          # 数据访问（MyBatis）或 repository/（JPA）
├── entity/          # 数据库实体
├── dto/
│   ├── request/     # 入参 DTO
│   └── response/    # 出参 VO
├── config/          # 配置类
├── exception/       # 异常定义
└── common/          # 通用工具
```

### DDD 模式
```
com.magic.{app}
├── interfaces/      # 接口层（Controller、消息消费者）
├── application/     # 应用层（用例编排，无业务逻辑）
├── domain/          # 领域层（实体、值对象、领域服务、仓储接口）
└── infrastructure/  # 基础设施层（仓储实现、外部服务）
```

## 3. Controller 规范

```java
@RestController
@RequestMapping("/api/v1/users")
@RequiredArgsConstructor
@Tag(name = "用户管理")
public class UserController {

    private final UserService userService;

    @GetMapping
    @Operation(summary = "用户列表")
    public ApiResponse<PageResult<UserVO>> list(@Valid UserListQuery query) {
        return ApiResponse.success(userService.list(query));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "创建用户")
    public ApiResponse<UserVO> create(@Valid @RequestBody UserCreateRequest req) {
        return ApiResponse.success(userService.create(req));
    }
}
```

**规范**：
- Controller 只做：参数校验（`@Valid`）、调用 Service、封装响应
- 禁止在 Controller 写业务逻辑
- 禁止在 Controller 直接操作数据库

## 4. Service 规范

```java
public interface UserService {
    PageResult<UserVO> list(UserListQuery query);
    UserVO create(UserCreateRequest req);
    UserVO update(Long id, UserUpdateRequest req);
    void delete(Long id);
}

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)  // 默认只读事务
public class UserServiceImpl implements UserService {

    private final UserMapper userMapper;

    @Override
    @Transactional  // 写操作显式声明
    public UserVO create(UserCreateRequest req) {
        // 1. 业务校验
        if (userMapper.existsByEmail(req.getEmail())) {
            throw new BusinessException(ErrorCode.EMAIL_EXISTS);
        }
        // 2. 构建实体
        User user = UserConverter.toEntity(req);
        user.setPasswordHash(passwordEncoder.encode(req.getPassword()));
        // 3. 持久化
        userMapper.insert(user);
        // 4. 返回 VO
        return UserConverter.toVO(user);
    }
}
```

## 5. 异常处理规范

```java
// 业务异常（可预期）
public class BusinessException extends RuntimeException {
    private final int code;
    public BusinessException(ErrorCode errorCode) {
        super(errorCode.getMessage());
        this.code = errorCode.getCode();
    }
}

// 全局异常处理
@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

    @ExceptionHandler(BusinessException.class)
    public ApiResponse<?> handleBusiness(BusinessException e) {
        return ApiResponse.error(e.getCode(), e.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ApiResponse<?> handleValidation(MethodArgumentNotValidException e) {
        String msg = e.getBindingResult().getFieldErrors().stream()
            .map(f -> f.getField() + ": " + f.getDefaultMessage())
            .collect(Collectors.joining("; "));
        return ApiResponse.error(1000, msg);
    }

    @ExceptionHandler(Exception.class)
    public ApiResponse<?> handleUnknown(Exception e) {
        log.error("未知异常", e);
        // 不暴露内部细节
        return ApiResponse.error(5000, "服务器内部错误");
    }
}
```

## 6. 数据校验规范

```java
@Data
public class UserCreateRequest {

    @NotBlank(message = "用户名不能为空")
    @Size(min = 3, max = 50)
    @Pattern(regexp = "^[a-zA-Z0-9_]+$", message = "用户名只能包含字母、数字、下划线")
    private String username;

    @NotBlank
    @Email(message = "邮箱格式不正确")
    private String email;

    @NotBlank
    @Size(min = 8, max = 128)
    private String password;
}
```

## 7. 日志规范

```java
// ✅ 使用 @Slf4j（Lombok）
@Slf4j
@Service
public class UserService {

    public void create(UserCreateRequest req) {
        log.info("创建用户: email={}", req.getEmail());  // 不记录密码
        // ...
        log.info("用户创建成功: userId={}", user.getId());
    }
}

// ✅ 日志级别
// DEBUG: 开发调试信息
// INFO:  关键业务操作（创建、更新、删除）
// WARN:  可恢复的异常（重试、降级）
// ERROR: 需要人工介入的错误

// ❌ 禁止
log.info("密码: {}", password);          // 敏感信息
log.error("错误", e.getMessage());       // 应该传 e 对象
System.out.println("debug info");        // 禁止 sysout
```

## 8. 配置规范

```yaml
# application.yml
spring:
  datasource:
    url: ${DB_URL}           # 从环境变量读取
    username: ${DB_USERNAME}
    password: ${DB_PASSWORD}
  jpa:
    show-sql: false          # 生产环境关闭
    hibernate:
      ddl-auto: validate     # 生产环境不自动建表

app:
  jwt:
    secret: ${JWT_SECRET}    # 从环境变量读取
    expiration: 900          # 15分钟（秒）
```

**规范**：
- 密钥、密码、URL 必须从环境变量读取
- 禁止硬编码任何密钥
- 生产环境 `ddl-auto: validate`，禁止 `create`/`update`

## 9. 性能规范

```java
// ✅ 分页查询（禁止全量查询）
Page<User> page = userMapper.selectPage(
    new Page<>(query.getPage(), query.getPageSize()),
    wrapper
);

// ✅ 批量操作（禁止循环单条）
userMapper.batchInsert(users);  // 而非 for (user) { insert(user) }

// ✅ 只查需要的字段
userMapper.selectList(
    new LambdaQueryWrapper<User>()
        .select(User::getId, User::getUsername, User::getEmail)
        .eq(User::getStatus, 1)
);

// ✅ 缓存热点数据
@Cacheable(value = "user", key = "#id")
public UserVO getById(Long id) { ... }
```

## 10. 代码风格

- 类名：`PascalCase`
- 方法/变量：`camelCase`
- 常量：`UPPER_SNAKE_CASE`
- 包名：全小写，无下划线
- 方法长度：≤ 50 行（超过则拆分）
- 类长度：≤ 500 行（超过则拆分）

## 11. 事务管理规范

| 规则 | 级别 | 说明 |
|------|------|------|
| `@Transactional` 必须指定 `rollbackFor = Exception.class` | 【强制】 | 默认只回滚 RuntimeException |
| 事务方法必须是 `public` | 【强制】 | Spring AOP 限制 |
| 禁止同类内自调用事务方法 | 【强制】 | 自调用事务不生效 |
| 只读操作加 `readOnly = true` | 【推荐】 | 提升性能 |
| 避免长事务（> 500ms） | 【推荐】 | 减少锁持有时间 |

```java
// ✅ 写操作
@Transactional(rollbackFor = Exception.class)
public void createOrder(OrderCreateRequest req) { ... }

// ✅ 只读操作
@Transactional(readOnly = true)
public OrderVO getById(Long id) { ... }

// ✅ 独立事务（日志不随主事务回滚）
@Transactional(propagation = Propagation.REQUIRES_NEW, rollbackFor = Exception.class)
public void saveAuditLog(AuditLog log) { ... }
```

## 12. 开发顺序（自底向上）

```
1. 数据库设计 → 建表 SQL
2. Entity/DO 层 → 对应数据库表
3. Mapper 层 → CRUD 接口
4. Service 层 → 业务逻辑 + @Transactional
5. Controller 层 → @Valid 参数校验 + ApiResponse 封装
6. 测试 → 单元测试（Mockito）+ 接口测试（Postman）
```

## 13. MyBatis-Plus 配置规范

```yaml
# application.yml
mybatis-plus:
  mapper-locations: classpath:mapper/*.xml
  type-aliases-package: com.magic.{app}.entity
  configuration:
    map-underscore-to-camel-case: true
    log-impl: org.apache.ibatis.logging.stdout.StdOutImpl  # 开发环境
  global-config:
    db-config:
      id-type: auto
      logic-delete-field: isDeleted
      logic-delete-value: 1
      logic-not-delete-value: 0
```

## 14. 多环境配置规范

```yaml
# application.yml（通用）
spring:
  profiles:
    active: dev
  jackson:
    date-format: yyyy-MM-dd HH:mm:ss
    time-zone: GMT+8
    default-property-inclusion: NON_NULL

# application-dev.yml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/{db}?useUnicode=true&characterEncoding=utf-8&serverTimezone=Asia/Shanghai
logging:
  level:
    com.magic: debug

# application-prod.yml
spring:
  datasource:
    url: jdbc:mysql://${DB_HOST}:3306/{db}?useSSL=true&serverTimezone=Asia/Shanghai
    username: ${DB_USERNAME}
    password: ${DB_PASSWORD}
springdoc:
  api-docs.enabled: false   # 生产关闭 Swagger
logging:
  level:
    com.magic: info
```
