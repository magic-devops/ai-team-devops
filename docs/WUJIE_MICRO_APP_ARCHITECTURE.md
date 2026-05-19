# Hermes Wujie 微应用架构与专业化模块设计

## 目标

当前 Hermes Manager 已覆盖 AI 研发、数据、运营、组织权限、Agent 平台等大量能力，继续堆在单一侧栏会造成认知负担、权限边界不清和后续扩展困难。本次采用 Wujie 微前端作为主方案，主应用完成应用级信息架构、统一通信契约和同源子应用托管；四个子应用拥有独立 HTML 入口和独立 `src/main.tsx`，后续可以平滑拆为独立仓库、独立发布、独立演进。

## 应用边界

| 应用 | 责任边界 | 核心模块 |
| --- | --- | --- |
| 主应用 · 基础管理 | 登录态、租户/账号/权限/组织/项目/服务管理、能力注册表、全局配置与统一审计入口 | 运营驾驶舱、项目管理、组织权限、系统设置、页面/能力治理 |
| 智能基础服务 | AI 底座能力，可被研发、数据、运营子应用复用 | 开发环境、CLI、知识库、记忆系统、规则、技能、插件、资产市场、模型、Agent、MCP、A2A |
| 智能研发中心 | 需求到 AI 交付的一栈式研发闭环 | 需求、方案、任务、问题、迭代、AI 开发、任务下发、DAG 调度、Agent Feed、质量评审、交付审计、研发运维 |
| 智能数据中心 | 数据资产与数据工程闭环 | 数据源、数据接入、元数据、血缘、数据开发、调度中心、任务运维、指标、标签、数据服务、洞察报告 |
| 智能运营中心 | 企业运营、安全与商业化治理 | 商业计费、账单回款、企业 SSO、安全审计、消息通信、Webhook、环境运维、智能运维、自愈 Runbook |

## Wujie 集成策略

主应用负责统一登录、三码作用域、权限矩阵、主题、语言和审计上下文，并通过 Wujie props 注入给子应用：

- `token`
- `locale`
- `tenantCode`
- `businessCode`
- `projectId`
- `projectCode`
- `workspaceScope`
- `shell=hermes-manager`

主应用同时提供微应用控制面 API：

- `GET /api/v1/system/pages/micro-apps`
- `GET /api/v1/system/pages/hub` 中包含 `micro_apps`

控制面返回每个应用的运行入口、构建入口、Owner、领域、模块数、能力数、成熟度和 Agent consumption 字段，供前端治理页、CLI 和 AI Agent 消费。

子应用远程地址通过环境变量配置：

- `VITE_SUB_APP_AI_FOUNDATION_URL`
- `VITE_SUB_APP_AI_RD_CENTER_URL`
- `VITE_SUB_APP_AI_DATA_CENTER_URL`
- `VITE_SUB_APP_AI_OPS_CENTER_URL`

未配置远程地址时，主应用默认挂载本仓同源 `/subapps/*/` 独立入口；拆独立仓或独立域名后，只需替换环境变量，不需要改主应用代码。

## 物理拆分结果

当前代码已完成仓内物理隔离，不再把子应用入口或业务页面放在主应用 `src/subapps` / `src/pages`：

```text
apps/manager-web/
  src/
    microApps.ts               # 微应用注册表
    pages/MicroAppPortal.tsx   # Wujie 容器
    pages/                     # 仅保留基础管理、项目组织、共享组件和主壳页面
  subapps/
    ai-foundation/
      index.html
      src/main.tsx
      src/appManifest.ts
      src/pages/               # AI 底座、知识、技能、插件、Agent、模型网关、A2A
    ai-rd-center/
      index.html
      src/main.tsx
      src/appManifest.ts
      src/pages/               # 需求、方案、任务、AI 开发、调度、质量与交付
    ai-data-center/
      index.html
      src/main.tsx
      src/appManifest.ts
      src/pages/               # 数据源、接入、治理、开发、指标、标签、数据服务
    ai-ops-center/
      index.html
      src/main.tsx
      src/appManifest.ts
      src/pages/               # 审计、SSO、计费、通知、运行配置、智能运维
    shared/
      bootstrap.tsx
      MicroAppRuntime.tsx
```

`tsconfig.json` 使用 `noEmit`，TypeScript 只负责类型检查，避免在源码旁生成 `.js` 干扰 Vite 入口解析。子应用共享启动器暂时位于 `subapps/shared`，用于沉淀 Wujie props、主题、登录态、水合、子应用菜单和跨应用跳转；拆独立仓时可提升为 `@hermes/micro-app-runtime` 包。

主应用 `navigation.tsx` 只保留统一路由注册与懒加载引用，页面实现从各子应用目录加载。每个子应用的 `src/appManifest.ts` 是页面资产归属清单，后续治理页、扫描脚本或拆仓流程应以它为边界依据。

## 体验设计

侧栏从“所有菜单一次性展开”改为“应用视图 + 应用内专业模块”：

1. 先选择主应用或四个子应用。
2. 侧栏只展示当前应用相关模块。
3. 每个应用入口提供模块边界、Owner、远程 URL、生产路径、模块数和子能力数。
4. 子应用拥有自己的侧栏、搜索、模块入口、模块 AI 与主应用回跳。
5. 主应用仍保留收藏、最近访问、命令面板和统一模块 AI。

这种方式直接把运行入口拆开：主应用负责统一治理，四个子应用作为独立 HTML/Vite entry 参与构建，可同源部署，也可后续独立部署。

## 独立入口

- `/subapps/ai-foundation/`
- `/subapps/ai-rd-center/`
- `/subapps/ai-data-center/`
- `/subapps/ai-ops-center/`

当前四个入口均参与 Vite 多页构建，也可由 Wujie 独立访问。后续拆独立仓时建议顺序：

1. 先拆 `ai-foundation-web`：基础服务复用度最高，能沉淀统一 SDK、Wujie bridge、主题和权限组件。
2. 再拆 `ai-rd-center-web`：研发中心业务链路最长，适合独立发布节奏。
3. 再拆 `ai-data-center-web`：数据中心依赖数据开发与指标服务，独立后便于接入湖仓/元数据系统。
4. 最后拆 `ai-ops-center-web`：运营中心涉及计费、SSO、审计，需与主应用安全控制面充分联调。

每个独立仓子应用都应保留：

- 独立 `package.json`、`vite.config.ts`、`src/main.tsx`
- `window.__POWERED_BY_WUJIE__` 兼容启动
- `mount/unmount` 生命周期
- 统一 `@hermes/shared-shell` bridge 包
- 子应用内路由基座与权限守卫

## 设计原则

- 主应用不承载业务深水区，只管身份、权限、组织、服务和平台治理。
- 子应用拥有自己的领域模型、导航、页面组合和发布节奏。
- 能力码保持全局唯一，继续使用 `<domain>.<module>.<submodule>.<action>`。
- 所有敏感操作仍走主应用统一审计与权限检查。
- 子应用失败不影响主应用可用性，必须有本地兜底或错误隔离。
