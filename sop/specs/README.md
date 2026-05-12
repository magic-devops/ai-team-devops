# specs/ 开发规范体系

> 独立维护的开发规范集合，每个规范文件独立管理，AI 可按需加载。
> 与 `sop/` 的关系：SOP 是流程，specs 是标准。
> **项目约定**：包名 `com.magic.*`，APP 默认名 `Superpower`，见 `PROJECT_CONVENTIONS.md`。

## 目录

```
specs/
├── README.md                              # 本文件：规范体系入口
│
├── frontend/                              # Web 前端
│   ├── FRONTEND_SPEC.md                   # 通用规范（技术栈无关）
│   ├── VUE3_SPEC.md                       # Vue3 专项
│   ├── REACT_SPEC.md                      # React 专项
│   └── MICROFRONTEND_SPEC.md              # 微前端（Wujie/qiankun）
│
├── mobile/                                # 移动端 & 跨平台
│   ├── MOBILE_CROSSPLATFORM_SPEC.md       # 方案选型（Flutter/RN/KMM）
│   └── FLUTTER_SPEC.md                    # Flutter 详细规范（Android/iOS/TV/Desktop）
│
├── miniprogram/                           # 小程序
│   └── MINIPROGRAM_SPEC.md                # 微信/支付宝/抖音/Taro/uni-app
│
├── backend/                               # 后端
│   ├── JAVA_SPEC.md                       # Java/Spring Boot（MVC + DDD）
│   ├── API_DESIGN_SPEC.md                 # RESTful API 设计（见 api/）
│   └── MICROSERVICE_SPEC.md               # 微服务规范
│
├── database/                              # 数据库
│   ├── DATABASE_SPEC.md                   # 通用规范（L1/L2/L3 三级）
│   └── MIGRATION_SPEC.md                  # 数据库迁移（Flyway）
│
├── security/                              # 安全
│   ├── SECURITY_SPEC.md                   # 安全开发规范（OWASP Top 10）
│   └── AUTH_SPEC.md                       # 认证授权（JWT/OAuth/多端）
│
├── testing/                               # 测试
│   ├── TESTING_SPEC.md                    # 测试规范（单元/集成）
│   └── E2E_SPEC.md                        # E2E 测试（Playwright/Flutter）
│
├── cicd/
│   └── CICD_SPEC.md                       # CI/CD + GitHub Actions
│
├── quality/
│   └── QUALITY_GATE_SPEC.md               # 质量门禁（机器可读）
│
├── api/
│   └── API_RESPONSE_SPEC.md               # 统一响应格式
│
├── architecture/
│   └── ARCHITECTURE_DECISION.md           # ADR 架构决策记录
│
└── ai-collab/                             # AI 协作
    ├── AI_CODING_SPEC.md                  # AI 编码规范（技术无关）
    ├── PROMPT_SPEC.md                     # Prompt 工程 + Caching
    └── MULTI_AGENT_COLLAB_SPEC.md         # 多 Agent 协同规范

PROJECT_CONVENTIONS.md                     # ★ 项目约定（包名/APP名/结构）
```

## 规范加载策略（按需加载）

| 任务类型 | 加载规范 |
|---------|---------|
| Web 前端（Vue3） | `frontend/FRONTEND_SPEC.md` + `frontend/VUE3_SPEC.md` |
| Web 前端（React） | `frontend/FRONTEND_SPEC.md` + `frontend/REACT_SPEC.md` |
| 微前端 | `frontend/MICROFRONTEND_SPEC.md` |
| 移动端（Flutter） | `mobile/FLUTTER_SPEC.md` |
| 移动端选型 | `mobile/MOBILE_CROSSPLATFORM_SPEC.md` |
| 小程序（Taro/uni-app） | `miniprogram/MINIPROGRAM_SPEC.md` |
| 后端（Java） | `backend/JAVA_SPEC.md` + `api/API_RESPONSE_SPEC.md` |
| 微服务 | `backend/MICROSERVICE_SPEC.md` |
| 数据库设计 | `database/DATABASE_SPEC.md` |
| 数据库迁移 | `database/MIGRATION_SPEC.md` |
| 安全相关 | `security/SECURITY_SPEC.md` |
| 认证授权 | `security/AUTH_SPEC.md` |
| 测试编写 | `testing/TESTING_SPEC.md` |
| E2E 测试 | `testing/E2E_SPEC.md` |
| CI/CD | `cicd/CICD_SPEC.md` |
| 代码审查 | `quality/QUALITY_GATE_SPEC.md` |
| 架构决策 | `architecture/ARCHITECTURE_DECISION.md` |
| AI 编码 | `ai-collab/AI_CODING_SPEC.md` |
| 多 Agent 协同 | `ai-collab/MULTI_AGENT_COLLAB_SPEC.md` |
| 新项目初始化 | `PROJECT_CONVENTIONS.md` |

## 使用原则

1. **按需加载**：只加载当前任务相关规范，不全量加载（节省 token）
2. **独立维护**：每个文件独立版本，互不依赖
3. **技术灵活**：规范是指导，不是枷锁；有充分理由可偏离，但需记录 ADR
4. **通用优先**：先读通用规范，再读技术专项规范

## 版本管理

每个规范文件头部包含：`版本: v{x.y} | 更新: {date}`

规范变更通过 PR 提交，commit 格式：`docs(specs): update {spec-name}`
