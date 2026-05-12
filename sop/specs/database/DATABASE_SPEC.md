# 数据库开发规范

> 版本: v1.1 | 更新: 2026-05-12
> 参考: 阿里巴巴 Java 开发手册 + MySQL 8.0 最佳实践
> 时间字段: MySQL 统一用 `gmt_created`/`gmt_modified`，详见 `TIMESTAMP_CONVENTION.md`

## 1. 规范级别

| 级别 | 适用场景 | 必须遵守 |
|------|---------|---------|
| **L1 快速** | MVP、个人项目、数据量 <100 万 | 基础字段 + 基础索引 |
| **L2 标准** | 企业项目、SaaS、数据量 <1 亿 | L1 + 多租户 + gmt_modified 索引 |
| **L3 严格** | 微服务、大型系统 | L2 + 分库分表 + 归档策略 |

## 2. 标准表结构

### L1 最小必要字段
```sql
CREATE TABLE {table_name} (
    id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
    gmt_created  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                 ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    is_deleted   TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '逻辑删除: 0-否 1-是',

    -- 业务字段 --

    INDEX idx_gmt_modified (gmt_modified)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='表注释';
```

### L2 标准企业字段（推荐）
```sql
CREATE TABLE {table_name} (
    id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
    creator      VARCHAR(64) NOT NULL DEFAULT '' COMMENT '创建人',
    gmt_created  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    modifier     VARCHAR(64) NOT NULL DEFAULT '' COMMENT '更新人',
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                 ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    is_deleted   TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '逻辑删除',

    -- 业务字段 --

    INDEX idx_gmt_modified (gmt_modified)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### L2 多租户字段（SaaS 按需启用）

> 单租户/个人项目不加这两个字段。SaaS 多租户时启用，作为所有查询的最左索引列。

```sql
-- 在 L2 基础上增加（紧跟 id 之后）：
tenant_code   VARCHAR(32) NOT NULL DEFAULT 'default' COMMENT '租户编码',
business_code VARCHAR(32) NOT NULL DEFAULT 'default' COMMENT '业务编码',

-- 索引替换为：
INDEX idx_tenant_biz_modified (tenant_code, business_code, gmt_modified)
```

## 3. 命名规范

```
表名：snake_case，业务前缀，如 order_item、user_profile
字段名：snake_case，如 user_id、created_at
索引名：
  普通索引：idx_{字段名}
  唯一索引：uk_{字段名}
  联合索引：idx_{字段1}_{字段2}
```

## 4. 字段设计规范

| 场景 | 推荐类型 | 说明 |
|------|---------|------|
| 主键 | `BIGINT UNSIGNED AUTO_INCREMENT` | 不用 UUID（性能差） |
| 字符串 | `VARCHAR(n)` | 不用 CHAR（除非固定长度） |
| 文本 | `TEXT` | 不在 TEXT 字段上建索引 |
| 金额 | `DECIMAL(19,4)` | 禁止用 FLOAT/DOUBLE |
| 状态 | `TINYINT` | 配合注释说明枚举值 |
| 时间 | `DATETIME` | 不用 TIMESTAMP（2038 问题） |
| 布尔 | `TINYINT(1)` | 0=false, 1=true |
| JSON | `JSON` | MySQL 5.7.8+ 支持 |

**禁止**：
- 禁止 `NULL` 字段（除非业务确实需要区分 NULL 和空值）
- 禁止 `FLOAT`/`DOUBLE` 存储金额
- 禁止超过 5 个字段的联合索引

## 5. 索引规范

```sql
-- ✅ 必须建索引的场景
-- 1. 外键字段
INDEX idx_user_id (user_id)

-- 2. 频繁查询的过滤字段
INDEX idx_status (status)

-- 3. gmt_modified（增量同步、CDC）
INDEX idx_gmt_modified (gmt_modified)

-- 4. 多租户隔离（最左列，SaaS 按需启用）
INDEX idx_tenant_biz_status (tenant_code, business_code, status)

-- ❌ 不建索引的场景
-- 区分度低的字段（如 is_deleted，只有 0/1）
-- 频繁更新的字段
-- TEXT/BLOB 字段
```

### 联合索引最左前缀原则
```sql
-- 索引 (a, b, c) 可以支持：
-- WHERE a = ?
-- WHERE a = ? AND b = ?
-- WHERE a = ? AND b = ? AND c = ?
-- 不支持：WHERE b = ?  WHERE c = ?
```

## 6. SQL 编写规范

```sql
-- ✅ 使用参数化查询（防 SQL 注入）
SELECT * FROM users WHERE username = ?

-- ✅ 只查需要的字段
SELECT id, username, email FROM users WHERE status = 1

-- ✅ 分页查询
SELECT * FROM orders WHERE user_id = ? LIMIT 20 OFFSET 0

-- ✅ 批量插入
INSERT INTO users (username, email) VALUES (?, ?), (?, ?), (?, ?)

-- ❌ 禁止
SELECT * FROM users                    -- 全表扫描
SELECT * FROM users WHERE id IN (...)  -- IN 超过 1000 个值
DELETE FROM users WHERE status = 0     -- 物理删除（用逻辑删除）
```

## 7. 数据库迁移规范

使用 Flyway 或 Liquibase 管理迁移。

```
db/migration/
├── V1__init_schema.sql
├── V2__add_users_table.sql
├── V3__add_orders_table.sql
└── V4__add_index_on_email.sql
```

**规范**：
- 每次变更一个独立的迁移文件
- 文件名格式：`V{版本}__{描述}.sql`
- 迁移文件提交后禁止修改（只能新增）
- 生产环境迁移前必须在 staging 验证

## 8. 逻辑删除规范

```java
// MyBatis-Plus 配置
@TableLogic
private Integer isDeleted;

// 查询时自动过滤已删除记录
// 删除时自动设置 is_deleted = 1
```

**注意**：逻辑删除后，唯一索引可能冲突（如 email 唯一）。
解决方案：唯一索引改为 `uk_email_deleted (email, is_deleted)`，或删除时将 email 改为 `email_deleted_{id}`。

## 9. ORM 映射规范（MyBatis-Plus）

### DO 类设计规范

```java
@Data
@TableName("mc_user")
public class McUserDO {
    @TableId(type = IdType.AUTO)
    private Long id;

    private String tenantCode;       // VARCHAR(32) → String
    private String businessCode;     // VARCHAR(32) → String
    private Integer version;         // INT UNSIGNED → Integer（乐观锁）
    private String creator;
    private LocalDateTime gmtCreated;
    private String modifier;
    private LocalDateTime gmtModified;
    private Integer isDeleted;       // 不用 Boolean，避免 is 前缀序列化问题

    // 业务字段
    private String username;
    private String email;
}
```

**禁止**：
- `private Integer id` — BIGINT 必须用 `Long`
- `private Boolean isDeleted` — 不得以 `is` 开头，用 `Integer`
- `private Date gmtCreated` — 用 `LocalDateTime`

### MyBatis-Plus 规则

| 规则 | 级别 |
|------|------|
| 禁止使用 `${}` 拼接 SQL | 【强制】 |
| 参数绑定使用 `#{}` | 【强制】 |
| 必须使用 `<resultMap>`，禁止 `resultClass` | L2 强制 |
| 查询结果集禁止用 `HashMap` | L2 强制 |

### 乐观锁（version 字段）

L2/L3 表推荐加 `version` 字段防并发更新：

```sql
version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '行级乐观锁版本号',
```

```java
@Version
private Integer version;  // MyBatis-Plus 自动处理 CAS 更新
```

## 10. 完整建表示例

### L1 快速（个人/MVP）

```sql
CREATE TABLE mc_user (
    id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
    gmt_created  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    is_deleted   TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    username     VARCHAR(50) NOT NULL COMMENT '用户名',
    email        VARCHAR(255) NOT NULL COMMENT '邮箱',
    INDEX idx_gmt_modified (gmt_modified)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';
```

### L2 标准（企业，单租户）

```sql
CREATE TABLE mc_user (
    id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
    version      INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '乐观锁版本号',
    creator      VARCHAR(64) NOT NULL DEFAULT '' COMMENT '创建人',
    gmt_created  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    modifier     VARCHAR(64) NOT NULL DEFAULT '' COMMENT '更新人',
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    is_deleted   TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    username     VARCHAR(50) NOT NULL COMMENT '用户名',
    email        VARCHAR(255) NOT NULL COMMENT '邮箱',
    UNIQUE KEY uk_email (email),
    INDEX idx_gmt_modified (gmt_modified)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';
```

### L2 多租户（SaaS）

```sql
CREATE TABLE mc_user (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
    tenant_code   VARCHAR(32) NOT NULL DEFAULT 'default' COMMENT '租户编码',
    business_code VARCHAR(32) NOT NULL DEFAULT 'default' COMMENT '业务编码',
    version       INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '乐观锁版本号',
    creator       VARCHAR(64) NOT NULL DEFAULT '' COMMENT '创建人',
    gmt_created   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    modifier      VARCHAR(64) NOT NULL DEFAULT '' COMMENT '更新人',
    gmt_modified  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    is_deleted    TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    username      VARCHAR(50) NOT NULL COMMENT '用户名',
    email         VARCHAR(255) NOT NULL COMMENT '邮箱',
    UNIQUE KEY uk_tenant_email (tenant_code, email),
    INDEX idx_tenant_biz_modified (tenant_code, business_code, gmt_modified)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';
```
