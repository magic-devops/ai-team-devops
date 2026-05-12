# 项目约定规范

> 版本: v1.0 | 更新: 2026-05-12
> 所有新项目必须遵循本约定，AI 开发时自动应用。

## 1. 包名约定

**所有 Java 项目包名统一以 `com.magic` 开头**：

```
com.magic.{app}          # MVC 模式
com.magic.{app}.{module} # 多模块/微服务
```

示例：
```
com.magic.superpower
com.magic.superpower.user
com.magic.superpower.order
```

**AI 生成代码时**：自动使用 `com.magic.{appName}` 作为根包，`{appName}` 取自项目名（小写，去除特殊字符）。

## 2. APP 默认命名

**默认 APP 名称为 `Superpower`**，对应：

| 配置项 | 默认值 |
|--------|--------|
| 应用名 | `Superpower` |
| 根包名 | `com.magic.superpower` |
| 数据库名 | `superpower` |
| Spring `spring.application.name` | `superpower` |
| Docker 镜像名 | `magic/superpower` |

### 引导用户修改

AI 在初始化新项目时，**必须询问用户**：

```
当前默认 APP 名称为 "Superpower"，包名为 "com.magic.superpower"。
是否需要修改？
- 直接回车：使用默认值
- 输入新名称：例如 "MyShop" → 包名自动变为 com.magic.myshop
```

用户确认后，AI 自动替换所有相关配置。

## 3. 项目结构约定

### Spring Boot 标准结构
```
{app-name}/
├── src/main/java/com/magic/{app}/
│   ├── {App}Application.java    # 启动类
│   ├── controller/
│   ├── service/
│   ├── mapper/                  # MyBatis（默认）或 repository/（JPA）
│   ├── entity/
│   ├── dto/
│   │   ├── request/
│   │   └── response/
│   ├── config/
│   ├── exception/
│   └── common/
├── src/main/resources/
│   ├── application.yml
│   ├── application-dev.yml
│   └── application-prod.yml
└── pom.xml
```

### 启动类命名
```java
package com.magic.superpower;

@SpringBootApplication
public class SuperpowerApplication {
    public static void main(String[] args) {
        SpringApplication.run(SuperpowerApplication.class, args);
    }
}
```

## 4. 数据库约定

- 数据库名：与 APP 名一致（小写），如 `superpower`
- 表名：`snake_case`，如 `user_profile`
- 所有表必须包含标准字段（见 `database/DATABASE_SPEC.md`）

## 5. API 约定

- 基础路径：`/api/v1/`
- 认证：JWT Bearer Token
- 响应格式：统一 `ApiResponse<T>`（见 `api/API_RESPONSE_SPEC.md`）

## 6. AI 灵活性说明

以上约定是**默认起点**，不是枷锁：
- 用户明确要求不同包名/命名时，以用户要求为准
- 有充分技术理由时可偏离，但需在代码注释或 ADR 中说明
- 规范服务于效率，不应阻碍合理的技术决策
