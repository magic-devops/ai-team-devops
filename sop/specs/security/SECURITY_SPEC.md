# 安全开发规范（精简版）

> 版本: v1.1 | 更新: 2026-05-12
> 参考: OWASP Top 10 2021 + Spring Security 6.x
> AI 开发时自动应用以下安全规范，无需额外提示。

## 1. 必须遵守的安全规则（无例外）

| 规则 | 说明 |
|------|------|
| 参数化查询 | 所有 SQL 使用 `?` 占位符，禁止字符串拼接 |
| 密码哈希 | 使用 BCrypt（强度 12）或 Argon2id，禁止 MD5/SHA1 |
| 密钥外化 | 密钥/密码从环境变量读取，禁止硬编码 |
| 输出编码 | 用户输入输出到 HTML 时必须编码（防 XSS） |
| HTTPS | 生产环境强制 HTTPS，禁止 HTTP 传输敏感数据 |
| 最小权限 | API 默认需要认证，明确标注 `public` 的才公开 |

## 2. SQL 注入防护

```java
// ✅ 正确：参数化查询
String sql = "SELECT * FROM users WHERE username = ?";
jdbcTemplate.queryForObject(sql, User.class, username);

// ✅ JPA 命名参数
@Query("SELECT u FROM User u WHERE u.email = :email")
Optional<User> findByEmail(@Param("email") String email);

// ❌ 禁止：字符串拼接
String sql = "SELECT * FROM users WHERE username = '" + username + "'";

// ⚠️ MyBatis：用 #{} 不用 ${}
// #{username} ← 安全（预编译）
// ${username} ← 危险（直接拼接）
```

## 3. XSS 防护

```typescript
// Vue3/React 默认对插值表达式编码，安全
<div>{{ userContent }}</div>   // ✅ 自动编码

// 使用 v-html / dangerouslySetInnerHTML 前必须清理
import DOMPurify from 'dompurify';
const safeHtml = DOMPurify.sanitize(userHtml);
<div v-html="safeHtml" />     // ✅ 清理后使用
<div v-html="userHtml" />     // ❌ 禁止直接使用
```

## 4. 密码存储

```java
// ✅ BCrypt（推荐）
@Bean
public PasswordEncoder passwordEncoder() {
    return new BCryptPasswordEncoder(12);
}

// 注册时
user.setPasswordHash(passwordEncoder.encode(rawPassword));

// 登录时
boolean valid = passwordEncoder.matches(rawPassword, user.getPasswordHash());
```

## 5. JWT 安全

```yaml
# application.yml
app:
  jwt:
    secret: ${JWT_SECRET}    # 环境变量，≥512 位
    access-expiration: 900   # 15 分钟
    refresh-expiration: 604800  # 7 天
```

```java
// ✅ 使用 HS512 或 RS256
Jwts.builder()
    .id(UUID.randomUUID().toString())  // 支持黑名单
    .subject(username)
    .expiration(new Date(now + expiration))
    .signWith(key, Jwts.SIG.HS512)
    .compact();
```

**前端存储**：访问 Token 存内存，刷新 Token 存 HttpOnly Cookie。

## 6. 认证授权

```java
// ✅ 方法级权限控制
@PreAuthorize("hasRole('ADMIN')")
public void deleteUser(Long id) { ... }

@PreAuthorize("hasRole('ADMIN') or #userId == authentication.principal.id")
public UserVO getProfile(Long userId) { ... }

// ✅ 全局配置
http.authorizeHttpRequests(auth -> auth
    .requestMatchers("/api/v1/public/**").permitAll()
    .anyRequest().authenticated()
);
```

## 7. 敏感数据处理

```java
// ✅ 日志脱敏
log.info("用户登录: email={}", maskEmail(email));  // u****@example.com

// ✅ 响应脱敏
public String getPhone() {
    return phone.substring(0, 3) + "****" + phone.substring(7);
}

// ✅ AES-256-GCM 加密存储（身份证、银行卡）
@Convert(converter = AesEncryptor.class)
private String idCard;
```

## 8. 安全配置检查清单

提交代码前检查：
- [ ] 无硬编码密钥/密码（`grep -r "password\s*=" src/`）
- [ ] 所有 SQL 使用参数化查询
- [ ] 密码使用 BCrypt 哈希
- [ ] JWT 密钥从环境变量读取
- [ ] 生产环境 `show-sql: false`
- [ ] 错误响应不暴露堆栈信息
- [ ] 敏感字段在日志/响应中脱敏

## 9. AI 安全开发自动规则

AI 生成代码时**自动应用**以下规则，无需额外提示：

| 场景 | 自动应用规则 |
|------|------------|
| 数据库查询 | 使用 MyBatis `#{}` 或 JPA 参数化，禁止字符串拼接 |
| 密码处理 | 自动使用 `BCryptPasswordEncoder`，禁止 MD5/SHA1 |
| JWT | 密钥从 `${JWT_SECRET}` 环境变量读取，有效期 ≤ 24h |
| 日志 | 自动脱敏 email/phone/idCard，禁止记录密码 |
| 异常响应 | 生产环境不暴露堆栈，统一返回 `ApiResponse.error()` |
| 输入校验 | Controller 层自动加 `@Valid`，DTO 加约束注解 |
| 配置 | 密钥/密码/URL 统一从环境变量读取 |

## 10. CSRF 防护规范

**REST API（无状态）**：使用 JWT + CORS 白名单，可禁用 CSRF Token。
**传统 Web 表单**：必须启用 CSRF Token。

```java
// REST API 配置（禁用 CSRF，依赖 JWT）
http.csrf(csrf -> csrf.disable())
    .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS));

// 前端 Axios 自动携带 XSRF-TOKEN（双重提交 Cookie 模式）
axios.interceptors.request.use(config => {
    const token = getCookie('XSRF-TOKEN');
    if (token) config.headers['X-XSRF-TOKEN'] = token;
    return config;
});
```

**CSRF 防护检查清单**：
- [ ] Cookie 设置 `SameSite=Lax`、`HttpOnly=true`、`Secure=true`
- [ ] 所有状态变更操作（POST/PUT/DELETE）需要 CSRF Token 或 JWT
- [ ] 敏感操作（转账、改密）增加二次确认

## 11. 敏感数据加密规范

```java
// AES-256-GCM 加密存储（身份证、银行卡）
@Convert(converter = AesEncryptor.class)
private String idCard;

// 传输加密：强制 HTTPS，禁止 HTTP 明文传输
// 密钥管理：从环境变量或配置中心读取，禁止硬编码
```

**数据分级**：
- 高敏感（密码、密钥）→ 单向哈希（BCrypt）
- 中敏感（身份证、银行卡）→ AES-256-GCM 加密存储
- 低敏感（手机号、邮箱）→ 脱敏展示（`138****8888`）

## 12. RBAC 权限控制规范

```java
// 角色定义
public enum Role { ROLE_USER, ROLE_ADMIN, ROLE_SUPER_ADMIN }

// 方法级权限控制
@PreAuthorize("hasRole('ADMIN')")
public void deleteUser(Long id) { ... }

@PreAuthorize("hasRole('USER') and #userId == authentication.principal.id")
public UserProfile getProfile(Long userId) { ... }
```

**权限设计原则**：最小权限原则，默认拒绝，显式授权。

## 13. 安全工具推荐

| 工具 | 用途 | 集成方式 |
|------|------|---------|
| OWASP Dependency-Check | 依赖漏洞扫描 | Maven/Gradle 插件 |
| SonarQube | 代码安全分析 | CI/CD 集成 |
| Snyk | 依赖安全监控 | GitHub Actions |
| Trivy | 容器镜像扫描 | Docker 构建后 |
