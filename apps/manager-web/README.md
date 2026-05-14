# `@sop/web-next` — SOP Manager 新前端

Vite + React 18 + TypeScript + Tailwind + shadcn 风格 + i18next + TanStack Query。

## 快速开始

```bash
cd apps/web-next
pnpm i           # 或 npm i
pnpm dev         # 启动 http://localhost:5173；自动反代 /api 到 http://127.0.0.1:8000
pnpm build       # 产出 dist/，由 Manager 静态托管 / CDN 分发
```

## 目录

```
src/
  pages/           # 顶层路由页面
  components/      # 复用 UI 组件
  hooks/           # TanStack Query 组合 hook（按需添加）
  lib/api.ts       # 统一 API 客户端
  i18n.ts          # i18next 初始化
  i18n/<lang>.json # 翻译资源
```

## 设计原则

- **AI 易扩展**：`pages/<X>.tsx` 一文件一页；`@ai_safe_edit` 注释指明可改点
- **类型完备**：`tsc --noEmit` 必须通过
- **路由可替换**：当前用 hash 路由（零依赖），切换到 `@tanstack/react-router` 仅改 `App.tsx`
- **国际化默认**：所有可见字符串走 `t()`；新增字段同步更新 `i18n/<lang>.json`
- **可观测**：默认接 Manager `/metrics`、`/api/v1/audit/chain/state` 等只读端点
