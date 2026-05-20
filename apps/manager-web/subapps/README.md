# manager-web 微应用目录

`subapps/` 是 manager-web 的独立子应用工作区。主应用只负责登录态、权限、组织、服务治理、Wujie 容器和跨应用导航，业务型智能能力按子应用隔离维护。

## 目录约定

- `main-admin/`：基础管理中心，覆盖租户账号、权限策略、组织项目、服务治理、菜单契约与微应用注册。
- `ai-foundation/`：智能基础服务，覆盖开发环境、CLI 工具、知识库、记忆、技能、插件、Agent 与 MCP Hub。
- `ai-rd-center/`：智能研发中心，覆盖需求、方案、任务、AI 开发、任务调度、监控、质量评审与运维。
- `ai-data-center/`：智能数据中心，覆盖数据源、数据接入、元数据、数据开发、调度、运维、指标、标签和数据服务。
- `ai-ops-center/`：智能运营中心，覆盖商业计费、安全审计、企业 SSO、通知、报表与运营治理。
- `shared/`：子应用共享启动器和运行时外壳，承接 Wujie props、主题、登录态、水合、子应用内菜单和跨应用跳转。

每个子应用都包含自己的 `src/pages` 与 `src/appManifest.ts`：

- `src/pages`：该子应用独占页面资产，新增业务页面必须落在所属子应用目录内。
- `src/appManifest.ts`：声明子应用页面根、模块边界和责任描述，供后续治理、扫描和拆仓使用。

## 边界规则

- 子应用入口统一放在 `subapps/<app>/src/main.tsx`，不再放入主应用 `src/subapps`。
- 子应用页面统一放在 `subapps/<app>/src/pages`，不再放入主应用 `src/pages`。
- 主应用 `src/` 只保留门户、微应用注册表、权限裁决、导航契约与公共组件能力；基础管理业务页面归属 `main-admin/`。
- TypeScript 通过 `noEmit` 只做类型检查，避免在源码目录生成 `.js` 干扰 Vite 入口解析。
- 新增子应用时先扩展 `src/microApps.ts` 和 `vite.config.ts` 的多页入口，再创建 `subapps/<app>/index.html` 与 `src/main.tsx`。
