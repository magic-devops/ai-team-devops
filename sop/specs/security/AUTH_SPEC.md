# 认证授权规范

> 版本: v1.0 | 更新: 2026-05-14
> 覆盖: JWT · OAuth 2.0 · RBAC · 多端认证（Web/移动/小程序）

## 1. 认证方案选型

| 场景 | 推荐方案 |
|------|---------|
| Web SPA | JWT（访问 Token 内存存储，刷新 Token HttpOnly Cookie） |
| 移动端 App | JWT（访问 Token 内存，刷新 Token 安全存储） |
| 微信小程序 | 微信 code → 后端换 JWT |
| 服务间调用 | API Key 或 OAuth 2.0 Client Credentials |
| 第三方登录 | OAuth 2.0 Authorization Code Flow |

## 2. JWT 规范

```java
// Token 有效期
ACCESS_TOKEN_TTL  = 15 分钟   // 短期，内存存储
REFRESH_TOKEN_TTL = 7 天      // 长期，安全存储

// 签名算法：HS512（对称）或 RS256（非对称，微服务推荐）
// 密钥长度：HS512 ≥ 512 位，RS256 ≥ 2048 位

// Payload 只存非敏感信息
{
  "jti": "uuid",          // 支持黑名单
  "sub": "username",
  "userId": 123,
  "roles": ["USER"],
  "iat": 1715500000,
  "exp": 1715500900
}
// 禁止存储：密码、手机号、身份证、银行卡
```

## 3. 多端 Token 存储

```
Web SPA:
  访问 Token → JS 内存变量（页面关闭自动清除）
  刷新 Token → HttpOnly + Secure + SameSite=Lax Cookie

移动端（Flutter）:
  访问 Token → 内存（Provider/BLoC state）
  刷新 Token → flutter_secure_storage（Keychain/Keystore）

微信小程序:
  访问 Token → 内存（全局 app.globalData）
  刷新 Token → wx.setStorageSync（加密存储）

❌ 禁止：
  localStorage / sessionStorage 存储 Token（XSS 可窃取）
  URL 参数传递 Token（日志泄露）
```

## 4. RBAC 权限模型

```
用户（User）→ 角色（Role）→ 权限（Permission）→ 资源（Resource）

角色示例：
  SUPER_ADMIN  超级管理员（所有权限）
  ADMIN        管理员（管理权限）
  USER         普通用户（基础权限）
  GUEST        访客（只读）

权限命名：{资源}:{操作}
  user:read    user:create    user:update    user:delete
  order:read   order:create   order:cancel
```

```java
// Spring Security 方法级权限
@PreAuthorize("hasAuthority('user:delete')")
public void deleteUser(Long id) { ... }

// 数据权限（只能操作自己的数据）
@PreAuthorize("hasRole('ADMIN') or #userId == authentication.principal.id")
public UserVO getProfile(Long userId) { ... }
```

## 5. 微信小程序登录流程

```
小程序端                    后端
  │                          │
  ├── wx.login() ──────────► │
  │   获取 code               │
  │                          ├── 调用微信 jscode2session API
  │                          │   获取 openid + session_key
  │                          │
  │                          ├── 查找或创建用户
  │                          │
  │ ◄── JWT Token ──────────┤
  │                          │
  ├── 存储 Token              │
  ├── 后续请求携带 Token ────► │
```

```typescript
// 后端：微信登录接口
@PostMapping("/api/v1/auth/wx-login")
public ApiResponse<LoginVO> wxLogin(@RequestBody WxLoginRequest req) {
    // 1. 调用微信 API 获取 openid
    WxUserInfo wxUser = wxService.getSessionInfo(req.getCode());

    // 2. 查找或创建用户（openid 只在后端存储）
    User user = userService.findOrCreateByOpenid(wxUser.getOpenid());

    // 3. 生成 JWT
    String token = jwtService.generateAccessToken(user);
    String refreshToken = jwtService.generateRefreshToken(user);

    return ApiResponse.success(new LoginVO(token, refreshToken));
}
```

## 6. OAuth 2.0 第三方登录

```java
// Spring Security OAuth2 Client 配置
spring:
  security:
    oauth2:
      client:
        registration:
          github:
            client-id: ${GITHUB_CLIENT_ID}
            client-secret: ${GITHUB_CLIENT_SECRET}
            scope: [user:email]
          google:
            client-id: ${GOOGLE_CLIENT_ID}
            client-secret: ${GOOGLE_CLIENT_SECRET}
            scope: [email, profile]
```

## 7. 安全检查清单

```markdown
- [ ] 访问 Token 有效期 ≤ 15 分钟
- [ ] 刷新 Token 存储在安全位置（非 localStorage）
- [ ] 登出时将 Token 加入黑名单（Redis）
- [ ] 密码重置后使所有 Token 失效
- [ ] 登录失败次数限制（5次/15分钟）
- [ ] 敏感操作需要重新验证密码
- [ ] openid 只在后端存储，不传给前端
- [ ] OAuth 2.0 state 参数防 CSRF
```

## 8. 附录：SOP Web 管理后台（FastAPI / `sop/web`）

本仓库自带管理后台，认证与项目作用域约定如下（与业务线 Java 规范独立，供脚本与前端对齐）：

| 项 | 约定 |
|----|------|
| 用户登录 | `POST /api/v1/auth/login` → JWT；SPA 存 `localStorage['sop-token']`（实现以仓库代码为准） |
| 业务请求 | `Authorization: Bearer <JWT>` + **`X-Project-Id: <projects.id>`**；由 `project_scope_middleware` 解析 `path_config.resolved_project_path` |
| 公开路径 | `/api/v1/auth/*`、`/api/v1/health*` 等（见 `project_scope_middleware._skip_project_scope`）不参与项目作用域注入 |
| 自动化脚本 | `sop/tools/manager_client.py`：环境变量 **`MANAGER_SOP_TOKEN`**（JWT）+ **`PROJECT_ID`**；可选 `HEALTH_CHECK_TOKEN` + `HEALTH_CHECK_PROJECT_ID` 配合 `health-check.sh` |
| 失败语义 | SaaS 下无效项目或无权访问：**403/404** JSON `detail`，勿假定静默回退到 `PROJECT_PATH` |

详细环境变量与路由见 **`sop/web/README.md`**、**`sop/tools/SCRIPTS.md`**。
