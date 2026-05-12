# 数据库迁移规范

> 版本: v1.0 | 更新: 2026-05-12
> 工具: Flyway（Java）· Liquibase · Alembic（Python）· golang-migrate

## 1. 核心原则

- **只增不改**：迁移文件提交后禁止修改，只能新增
- **向前兼容**：新迁移不能破坏旧版本应用的运行
- **可回滚**：每个迁移必须有对应的 undo 脚本
- **幂等性**：迁移脚本可以安全地重复执行

## 2. Flyway 规范（Java 项目推荐）

### 文件命名
```
db/migration/
├── V1__init_schema.sql           # 初始化
├── V2__create_users_table.sql    # 创建表
├── V3__add_email_to_users.sql    # 添加字段
├── V4__create_orders_table.sql   # 新表
└── V5__add_index_on_email.sql    # 添加索引

格式：V{版本}__{描述}.sql
版本：整数，单调递增
描述：下划线分隔，描述变更内容
```

### 迁移文件模板
```sql
-- V3__add_email_to_users.sql
-- 描述：为 users 表添加 email 字段
-- 作者：AI / 开发者
-- 日期：2026-05-12

-- 向前迁移
ALTER TABLE users
    ADD COLUMN email VARCHAR(255) NOT NULL DEFAULT '' COMMENT '邮箱',
    ADD UNIQUE KEY uk_email (email);

-- 验证（可选）
-- SELECT COUNT(*) FROM users WHERE email IS NULL;
```

### 配置
```yaml
spring:
  flyway:
    enabled: true
    locations: classpath:db/migration
    baseline-on-migrate: true   # 已有数据库时使用
    validate-on-migrate: true   # 启动时验证
    out-of-order: false         # 禁止乱序执行
```

## 3. 高风险迁移操作

### 添加 NOT NULL 列（大表）
```sql
-- ❌ 危险：直接添加 NOT NULL 列会锁表
ALTER TABLE orders ADD COLUMN status VARCHAR(20) NOT NULL;

-- ✅ 安全：分三步
-- Step 1: 添加可空列
ALTER TABLE orders ADD COLUMN status VARCHAR(20) NULL;

-- Step 2: 回填数据（分批）
UPDATE orders SET status = 'pending' WHERE status IS NULL LIMIT 10000;
-- 重复执行直到完成

-- Step 3: 设置 NOT NULL
ALTER TABLE orders MODIFY COLUMN status VARCHAR(20) NOT NULL DEFAULT 'pending';
```

### 删除列（向前兼容）
```sql
-- ✅ 先废弃（应用层停止使用），再删除（下个版本）
-- V10__deprecate_old_field.sql（应用层停止使用 old_field）
-- V11__drop_old_field.sql（确认无引用后删除）
ALTER TABLE users DROP COLUMN old_field;
```

### 重命名列
```sql
-- ✅ 不直接重命名，用添加+迁移+删除三步
-- V10: 添加新列
ALTER TABLE users ADD COLUMN new_name VARCHAR(100);
-- V11: 迁移数据
UPDATE users SET new_name = old_name;
-- V12: 删除旧列（确认应用已切换）
ALTER TABLE users DROP COLUMN old_name;
```

## 4. 迁移前检查清单

```markdown
- [ ] 在 staging 环境验证迁移成功
- [ ] 验证 undo 脚本可以回滚
- [ ] 大表操作（>100万行）已分批处理
- [ ] 迁移时间估算（避免超过维护窗口）
- [ ] 已备份数据库
- [ ] 应用层已做向前兼容处理
```

## 5. 紧急回滚

```bash
# Flyway 回滚到指定版本
flyway -url=jdbc:mysql://... undo -target=2

# 手动回滚（执行 undo SQL）
mysql -u root -p mydb < undo_V3.sql
```
