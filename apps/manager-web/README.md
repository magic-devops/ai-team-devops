# `@sop/manager-web` — SOP Manager 浏览器端

Vite + React 18 + TypeScript + Tailwind + i18next + TanStack Query。通过 dev server **反代** `/api`、`/ws` 到本机 Manager（默认 **8765**，与 `start-manager.sh` 一致）。

**两套界面（重要）**

| 入口 | 说明 |
|------|------|
| **`/console.html`** | **主产品 / 完整管理台**（原 `sop/web` / DevDash）：Vibe、编排、MCP、租户、数据港、日志等。`pnpm dev` / `pnpm preview` **默认在浏览器打开此页**。 |
| **`/`**（轻量 React 壳） | 探活、部分 OpenAPI 对齐页、新能力试验；访问 **`/?shell=1`** 或侧栏 **「固定从扩展坞进入」** 后，根路径不再自动跳转到完整台。纯前端开发可在 `.env.local` 设 **`VITE_PRIMARY_UI=shell`** 关闭自动跳转（见 `.env.example`）。 |
| **`/login.html`** | 经典登录（与完整台同一套 `sop-token` / `X-Project-Id`）。 |

> 旧版 `public/index.html` 已改名为 **`console.html`**，避免与 Vite 根目录 `index.html` 在生产构建中冲突（Vite 要求勿在 `public/` 放 `index.html`）。

根路径跳转逻辑见 **`src/lib/shellEntry.ts`**（`maybeRedirectToPrimaryConsole`）。

## 快速开始

```bash
cd apps/manager-web
pnpm i           # 或 npm i
pnpm dev         # 默认打开 /console.html；/api 反代到 http://127.0.0.1:8765
pnpm build       # 产出 dist/，由 Nginx / CDN / 任意静态站托管；与 API 域名分离部署
```

## 目录

```
src/
  pages/           # 顶层路由页面
  components/      # 复用 UI 组件
  hooks/           # TanStack Query 组合 hook（按需添加）
  lib/api.ts       # 统一 API 客户端
  lib/authStorage.ts
  lib/shellEntry.ts # 根路径是否跳转完整台（VITE_PRIMARY_UI、?shell=1）
  i18n.ts          # i18next 初始化
  i18n/<lang>.json # 翻译资源
public/
  console.html     # 完整功能台（原 sop/web）
  login.html
  pages/           # Babel 模块化脚本
```

## 设计原则

- **AI 易扩展**：`pages/<X>.tsx` 一文件一页；`@ai_safe_edit` 注释指明可改点
- **类型完备**：`tsc --noEmit` 必须通过
- **路由可替换**：当前用 hash 路由（零依赖），切换到 `@tanstack/react-router` 仅改 `App.tsx`
- **国际化默认**：所有可见字符串走 `t()`；新增字段同步更新 `i18n/<lang>.json`
- **可观测**：默认接 Manager `/metrics`、`/api/v1/audit/chain/state` 等只读端点
