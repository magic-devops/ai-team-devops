# 时间字段命名约定

> 版本: v1.1 | 更新: 2026-05-12

## 决策结论

| 存储层 | 字段名 | 理由 |
|--------|--------|------|
| **MySQL / 关系型 DB** | `gmt_created` / `gmt_modified` | 阿里规范，MyBatis-Plus 自动填充，`gmt_modified` 必须建索引用于 CDC/增量同步 |
| **LanceDB / 向量库** | `created_at` / `updated_at` | Python 生态惯例，无 ORM 自动填充，保持简洁 |
| **API 响应 JSON** | `createdAt` / `updatedAt` | camelCase，前端友好 |

**原则**：同一层内保持一致，跨层通过 DTO/序列化转换。

## 租户/业务隔离字段（按需启用）

> **不使用** `tenant_id`（BIGINT）或 `business_id`（BIGINT）。
> 字符串编码更灵活，无需关联查询，直接可读。

| 字段 | 类型 | 适用场景 |
|------|------|---------|
| `tenant_code` | `VARCHAR(32)` | SaaS 多租户，按租户隔离数据 |
| `business_code` | `VARCHAR(32)` | 同租户内多业务线隔离 |

**启用原则**：
- 单租户/个人项目 → **不加**，保持简洁
- SaaS 多租户 → 加 `tenant_code`，作为所有查询的**最左索引列**
- 多业务线 → 同时加 `tenant_code` + `business_code`，组合索引

## MySQL 标准字段

```sql
-- L1 快速（个人/MVP）
gmt_created  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
INDEX idx_gmt_modified (gmt_modified)

-- L2 标准（企业，单租户）
creator      VARCHAR(64) NOT NULL DEFAULT '' COMMENT '创建人',
gmt_created  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
modifier     VARCHAR(64) NOT NULL DEFAULT '' COMMENT '更新人',
gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
INDEX idx_gmt_modified (gmt_modified)

-- L2 多租户（SaaS，在 L2 基础上增加，紧跟 id 之后）
tenant_code   VARCHAR(32) NOT NULL DEFAULT 'default' COMMENT '租户编码',
business_code VARCHAR(32) NOT NULL DEFAULT 'default' COMMENT '业务编码',
-- 索引替换为：
INDEX idx_tenant_biz_modified (tenant_code, business_code, gmt_modified)
```

## LanceDB 字段（保持 created_at/updated_at）

LanceDB 是 AI 记忆层，非业务数据库：
- `created_at` / `updated_at`：Python datetime，无需与 MySQL 对齐
- 按 `project_id` 隔离，不加 `tenant_code`
