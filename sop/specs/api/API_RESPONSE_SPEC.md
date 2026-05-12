# RESTful API 设计规范

> 版本: v1.0 | 更新: 2026-05-12
> 适用于所有后端 API 设计，与技术栈无关。

## 1. URL 设计

### 资源命名
```
✅ 名词复数，小写，连字符分隔
GET    /api/v1/users              # 列表
GET    /api/v1/users/{id}         # 详情
POST   /api/v1/users              # 创建
PUT    /api/v1/users/{id}         # 全量更新
PATCH  /api/v1/users/{id}         # 部分更新
DELETE /api/v1/users/{id}         # 删除

✅ 嵌套资源（最多两层）
GET    /api/v1/users/{id}/orders  # 用户的订单列表
GET    /api/v1/orders/{id}/items  # 订单的商品列表

❌ 禁止动词
/api/v1/getUsers
/api/v1/createUser
/api/v1/deleteUser?id=1
```

### 版本控制
```
URL 路径版本：/api/v1/、/api/v2/
不使用 Header 版本（对 AI 和工具不友好）
```

### 查询参数
```
分页：?page=1&pageSize=20
排序：?sortBy=createdAt&sortOrder=desc
过滤：?status=active&role=admin
搜索：?keyword=张三
```

## 2. HTTP 方法语义

| 方法 | 语义 | 幂等 | 安全 |
|------|------|------|------|
| GET | 读取 | ✅ | ✅ |
| POST | 创建 | ❌ | ❌ |
| PUT | 全量替换 | ✅ | ❌ |
| PATCH | 部分更新 | ❌ | ❌ |
| DELETE | 删除 | ✅ | ❌ |

## 3. 统一响应格式

```json
{
  "code": 0,
  "message": "success",
  "data": {},
  "timestamp": 1715500000000,
  "traceId": "abc-123"
}
```

### code 约定
```
0        成功
1xxx     客户端错误（参数、权限）
2xxx     业务错误（业务逻辑失败）
5xxx     服务端错误

常用 code：
1000  参数错误
1001  未认证（需要登录）
1003  无权限
1004  资源不存在
2001  业务规则冲突（如邮箱已存在）
5000  服务器内部错误
```

### 分页响应
```json
{
  "code": 0,
  "data": {
    "list": [],
    "total": 100,
    "page": 1,
    "pageSize": 20,
    "totalPages": 5
  }
}
```

## 4. HTTP 状态码

```
200 OK              成功（GET/PUT/PATCH）
201 Created         创建成功（POST）
204 No Content      删除成功（DELETE）
400 Bad Request     参数错误
401 Unauthorized    未认证
403 Forbidden       无权限
404 Not Found       资源不存在
409 Conflict        资源冲突
422 Unprocessable   业务规则错误
429 Too Many Req    限流
500 Internal Error  服务器错误
```

**原则**：HTTP 状态码反映 HTTP 层面的结果，业务结果用 `code` 字段。

## 5. 错误响应

```json
{
  "code": 1000,
  "message": "参数错误",
  "data": {
    "errors": [
      { "field": "email", "message": "邮箱格式不正确" },
      { "field": "password", "message": "密码长度至少 8 位" }
    ]
  }
}
```

## 6. 安全规范

- 所有 API 默认需要认证（除明确标注 `public` 的）
- 认证方式：`Authorization: Bearer {token}`
- 敏感操作（删除、支付）需要二次确认或额外权限
- 接口限流：默认 100 req/min/user，敏感接口 10 req/min

## 7. API 文档规范

使用 OpenAPI 3.0（Swagger）自动生成文档。

```java
// Spring Boot 示例
@Operation(summary = "创建用户", description = "注册新用户账号")
@ApiResponse(responseCode = "201", description = "创建成功")
@PostMapping("/users")
public ResponseEntity<ApiResponse<UserVO>> createUser(
    @Valid @RequestBody UserCreateRequest request) { ... }
```

## 8. 版本演进规则

- 新增字段：向后兼容，直接在当前版本添加
- 修改字段类型/删除字段：必须新建版本（v2）
- 废弃接口：先标记 `@deprecated`，保留至少 6 个月后删除
