# `@sop/manager-web` — SOP Manager 浏览器端

Vite + React 18 + TypeScript + Tailwind + i18next + TanStack Query。通过 dev server **反代** `/api`、`/ws` 到本机 Manager（默认 **8765**，与 `start-manager.sh` 一致）。

**管理台入口**

| 入口 | 说明 |
|------|------|
| **`/`** | **默认 React 管理台**。`pnpm dev` / `pnpm preview` 在此打开；登录后在顶栏明确选择项目。 |
| **`/#/dev-flow?view=overview`** | 正式研发全流程工作台，承接需求、任务、团队、进度、质量、发布和运维协作。 |
| **`/console.html`** | 旧控制台入口。其中的研发全流程统一进入上述正式工作台。 |
| **`/login.html`** | 登录页，成功后返回请求的管理台地址。 |

> 旧版 `public/index.html` 已改名为 **`console.html`**，避免与 Vite 根目录 `index.html` 在生产构建中冲突（Vite 要求勿在 `public/` 放 `index.html`）。

根路径直接显示 React 管理台，不会自动跳转到旧控制台，也不需要设置 `VITE_PRIMARY_UI`。

## 快速开始

```bash
cd apps/manager-web
pnpm i           # 或 npm i
pnpm dev         # 默认打开 /；/api 反代到 http://127.0.0.1:8765
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
  lib/shellEntry.ts # 清理旧入口参数；根路径始终使用 React 管理台
  i18n.ts          # i18next 初始化
  i18n/<lang>.json # 翻译资源
public/
  console.html     # 旧控制台入口（原 sop/web）
  login.html
  pages/           # Babel 模块化脚本
```

## 设计原则

- **AI 易扩展**：`pages/<X>.tsx` 一文件一页；`@ai_safe_edit` 注释指明可改点
- **类型完备**：`tsc --noEmit` 必须通过
- **路由可替换**：当前用 hash 路由（零依赖），切换到 `@tanstack/react-router` 仅改 `App.tsx`
- **国际化默认**：所有可见字符串走 `t()`；新增字段同步更新 `i18n/<lang>.json`
- **可观测**：默认接 Manager `/metrics`、`/api/v1/audit/chain/state` 等只读端点

## 管理台导航（`/`）

侧栏按 **四大分组** 组织，支持 **搜索（Ctrl/Cmd+K）** 与分组折叠：

| 分组 | 页面 |
|------|------|
| 交付与执行 | 驾驶舱、项目、任务、需求、工作流 |
| 运营与治理 | 组织、数据分析、消息通道、审计 |
| AI 能力 | AI 助手、智能与知识、市场、AI 平台 |
| 系统 | 设置（登录 / 主题） |

顶栏 **项目选择器** 写入 `X-Project-Id`；多数业务 API 须已登录且已选项目。

## 任务看板与 Sprint（`/#/tasks`）

1. `pnpm dev` → `http://localhost:5173/`，按提示登录
2. 顶栏 **选择项目**
3. **任务** Tab：状态看板（拖拽改状态）、优先级（拖拽排序）、Sprint 进度

研发全流程请用 **`/#/dev-flow?view=overview`**；业务数据操作必须使用当前明确选择的项目。
详见 [`ai-sop-ops/SYNC_AND_PLATFORMS.md`](../../ai-sop-ops/SYNC_AND_PLATFORMS.md) §5。

## 安装 `sop` CLI（本 monorepo）

```bash
# 仓库根目录
bash scripts/build-sop.sh --venv .venv --verify
source .venv/bin/activate
sop --help
# 或：make build-sop
```

见 [`packages/sop-cli/README.md`](../../packages/sop-cli/README.md)。
