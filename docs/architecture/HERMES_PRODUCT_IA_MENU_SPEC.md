# Hermes 产品信息架构与菜单设计规范

> 版本: 1.1  
> 日期: 2026-05-17  
> 状态: 与 manager-web `navigation.tsx`、Manager `system/pages`、`lib/menuPrefs.ts` 对齐  
> 关联: [HERMES_PLATFORM_LATEST_ARCHITECTURE.md](HERMES_PLATFORM_LATEST_ARCHITECTURE.md) · [AI_PLATFORM_TARGET_ARCHITECTURE.md](AI_PLATFORM_TARGET_ARCHITECTURE.md) · [HERMES_PLATFORM_DEVELOPMENT_PLAN.md](HERMES_PLATFORM_DEVELOPMENT_PLAN.md)

## 1. 设计结论（菜单是否合理）

**结论：域划分与能力码建模合理，但体验层仍需持续产品化。**

| 维度 | 现状评价 | 改进方向 |
|------|----------|----------|
| 能力域（9 域） | 与 Hermes 平台分层一致，专业可扩展 | 保持，作为权限与 CLI 的一级边界 |
| 专业分组（Category） | 已覆盖生命周期、治理、数据开发等 | 默认折叠重域，减少首屏噪音 |
| 模块/子菜单 | 子路由已注册，部分页面未消费 `focused` 模式 | 子路由必须驱动页面分区，避免「假菜单」 |
| 命名 | `tasks` 与「调度」混用、`projects` 与子项「项目组合」重复 | 父模块=工作台，子项=能力切片 |
| 组织 vs 项目 | Organization 与 Projects 成员能力重叠 | 文档标明边界，菜单文案区分「组织级/项目级」 |
| Legacy | 已从侧栏隐藏，收敛到 SystemMap | 保持，仅治理入口可见 |

## 2. 信息架构模型

采用四层模型，与权限、CLI、Agent 一致：

```text
能力域 (NavGroup)     → 9 个：overview / portfolio / product / delivery / data / ai / ecosystem / governance / system
  └─ 专业分组 (Category) → 如「项目生命周期」「数据资产治理」
       └─ 模块 (NavItem parent) → 如「需求工作台」「任务中心」
            └─ 功能入口 (NavItem child) → 如「智能评审」「依赖调度」
                 └─ 动作 (Capability action) → 由 CapabilityGate / system/pages/actions 裁决
```

**原则**

1. 侧栏只展示「域 → 分组 → 模块」；子入口默认折叠，活跃或搜索时展开。
2. 每个子入口必须有独立 URL、能力码、页面模式（`focused` + `initialTab`/`initialMode`）。
3. 父模块文案表示「工作台」，子项文案表示「能力切片」，禁止父子同名。
4. AI/CLI 通过 `sop pages list|manifest|capabilities` 与前端注册表同源。

## 3. 九域菜单矩阵（产品化命名）

| 域 | 分组 | 模块（侧栏父级） | 子能力（展开） | 能力码前缀 |
|----|------|------------------|----------------|------------|
| 战略总览 | 战略指挥 | 运营驾驶舱 | 总览、蓝图、风险、技术升级、下一步 | `overview.*` |
| 组织项目 | 项目生命周期 | 项目管理 | 组合、业务线、租户、成员、接入、模板、治理 | `portfolio.projects.*` |
| 组织项目 | 组织与权限 | 组织权限 | 成员、业务线、项目成员、角色策略 | `portfolio.organization.*` |
| 产品需求 | 需求接入 | 需求工作台 | 需求池、智能评审、拆任务、批量治理 | `product.requirements.*` |
| 研发交付 | 任务执行 | 任务中心 | 执行列表、看板、Sprint、依赖、依赖调度 | `delivery.tasks.*` |
| 研发交付 | 流程编排 | 流程编排 | 模板、实例、事件、信号 | `delivery.workflows.*` |
| 数据智能 | 战略/洞察/资产/工程 | 见 Analytics 分区 | 蓝图、报告、目录、血缘、交换、问数 | `data.*` |
| AI 智能 | 指挥/知识/运行 | Copilot、知识记忆 | 会话、命令、RAG、记忆、Worker、Sync、用量 | `ai.*` |
| 平台生态 | Agent/市场/通信 | Platforms、市场、Notify | MCP、模型、连接器… | `ecosystem.*` |
| 安全治理 | 审计/模块治理 | 安全审计、模块治理 | 链、事件、动作、审批、Manifest | `governance.*` |
| 系统运维 | 运行配置 | 系统设置 | 账户、SSO、计费、Profile、观测 | `system.*` |

## 4. 固定快捷区（Pinned）

高频路径固定在侧栏顶部（不受域折叠影响）：

| 顺序 | 模块 | 路径 | 说明 |
|------|------|------|------|
| 1 | 运营驾驶舱 | `#/dashboard` | 态势与蓝图 |
| 2 | 需求工作台 | `#/requirements` | 需求池主入口 |
| 3 | 任务中心 | `#/tasks` | 执行与调度 |
| 4 | AI 指挥台 | `#/copilot` | 全局 AI |

## 5. Organization 与 Projects 边界

| 场景 | 使用 Organization | 使用 Projects |
|------|-------------------|---------------|
| 租户级成员、角色、密码 | 是 | 租户成员（Users）仅租户范围 |
| 业务线 CRUD | 是 | 业务线（项目域下）偏项目组合视图 |
| 项目成员授权 | 组织项目成员 | 项目成员（当前项目） |
| AI 接入包、模板、治理 | 否 | 是 |

## 6. 智能 CLI 与菜单同源

| CLI 能力 | 用途 |
|----------|------|
| `sop pages list --domain delivery --json` | Agent 列出可跳转模块 |
| `sop pages manifest` | 模块分包、AI surfaces、legacy 对照 |
| `sop pages capabilities` | 角色可读能力矩阵 |
| `sop context prepare` | 写入 manifest + work snapshot + 三码 env |
| `sop work next` | 按调度/优先级推荐下一步 |
| `sop task schedule/feed/report` | 与「任务依赖调度」菜单能力一致 |

**目标**：任意 IDE/Agent 初始化后，读取 `.sop-runtime/` 与 Manager pages API，即可理解「平台有哪些菜单、当前用户能做什么、应跳转哪条路由」。

## 7. 迭代任务拆解（菜单与 IA）

| 阶段 | 任务 | 验收 |
|------|------|------|
| IA-1 | Pinned 快捷区、域色条、面包屑、子路由 `focused` | 已完成（本轮） |
| IA-2 | Requirements/Workflows/Notify 子路由驱动 UI 分区 | Requirements 已接；其余 P1 |
| IA-3 | 侧栏「最近访问」与角色化默认折叠策略 | 本地存储 + 角色模板 |
| IA-4 | SystemMap 菜单健康分：假菜单、无 capability、无 i18n | validate API 扩展 |
| IA-5 | 移动端抽屉导航与分组手势 | 响应式专项 |

## 8. 与开发计划的关系

- **P0** 能力码、三码、Agent Feed：菜单是体验壳，能力码是硬约束。  
- **P1** 质量卡点、通信连接器：对应「任务中心」「通信集成」子菜单。  
- **P2** 数据智能：Analytics 五分区菜单已拆，继续深化子工作台。  
- **P3+** 见 [HERMES_PLATFORM_DEVELOPMENT_PLAN.md](HERMES_PLATFORM_DEVELOPMENT_PLAN.md) 的 H3–H7 与 IA-2～IA-5。

## 9. 用户级菜单偏好（IA-3 已落地）

| 偏好 | 触发 | 存储 | 默认 |
|------|------|------|------|
| 收藏（最多 24 项） | 行内星标 / `toggleFavorite(key)` | `localStorage[sop-menu-prefs-v1]` | 空 |
| 最近访问（最多 8 项） | hash 变更自动 `pushRecent` | 同上 | 空 |
| 侧栏密度（compact/comfortable/cozy） | 侧栏底部 DensityMenu | 同上 | comfortable |
| 显示收藏 / 显示最近 | 侧栏底部按钮 | 同上 | 均开启 |

后续会在 Manager 提供 `/api/v1/users/me/menu-prefs` 接口实现「用户级 + 跨设备」同步；本地优先策略不变，离线/未登录仍可工作。

## 10. 键盘交互（IA-3 已落地）

| 快捷键 | 行为 |
|--------|------|
| `Cmd/Ctrl + K` | 打开全局命令面板 |
| `Cmd/Ctrl + /` | 折叠/展开侧栏 |
| `g d` | 跳转运营驾驶舱 |
| `g r` | 跳转需求工作台 |
| `g t` | 跳转任务中心 |
| `g c` | 跳转 Copilot |
| `g p` | 跳转项目管理 |
| `g a` | 跳转指标概览 |
| `g o` | 跳转组织权限 |
| `g s` | 跳转系统设置 |
| `g m` | 跳转模块治理 |

约束：处于 `<input>` / `<textarea>` / `contenteditable` 时不触发，避免输入冲突。

## 11. 视觉与权限语义（IA-3 已落地）

| 元素 | 含义 | 视觉 |
|------|------|------|
| 域色条 | 9 个能力域颜色 | `NAV_GROUP_ACCENT` + 页头左侧 4px 色条 |
| `badge: new/beta/preview/alpha` | 模块成熟度 | 右上角徽标，1-2 个迭代周期后须移除 |
| 只读锁 🔒 | 当前角色无 write 能力 | 侧栏行内 + 页头胶囊 |
| 收藏星 ★ | 用户已收藏 | 实心 amber 星标，hover 显示空心 |
| 快捷键 chip | 模块绑定快捷键 | 页头面包屑后单色 chip |

## 12. AI 编辑约定（让 AI 安全快速改菜单）

`src/navigation.tsx` 顶部已声明 `@ai_safe_edit` 与 `@schema_version`。AI 修改菜单必须满足：

1. **新增模块**：
   - 在 `navigation.tsx` 追加 NavItem，**必须** 含 `key/path/group/icon/capability`；可选 `badge/status/shortcut/pinnable/description`。
   - 在 i18n（zh/en/ja）补 `nav.<key>` 与 `page.<key>.title`。
   - 若隶属新分组，先扩 `NAV_CATEGORIES` 与 `ITEM_CATEGORY`。
   - 跑 `validateNavRegistry()`（已暴露给 SystemMap / 单测）。
2. **重命名**：禁止改 `key`（破坏收藏/最近访问/快捷键）；只改 i18n 文案即可。
3. **下线模块**：先 `status: "deprecated"`，保留 1 个迭代周期；然后置 `hidden: true`；最后从 `NAV` 移除并在 `system_pages.py` 同步移除注册。
4. **新增能力码**：能力码格式 `<domain>.<module>.<submodule>.<action>`，前后端必须同步。
5. **快捷键**：`g + 字母`，避免与浏览器/Vim 风格冲突；登记在本文档 §10。
6. **AI 自检**：每次菜单改动后，AI 必须显式调用 `validateNavRegistry` 并把 issue 一并报告。

## 13. 与命令面板 / Copilot 的协同

- 命令面板（`Cmd+K`）由 `/api/v1/copilot/commands` 驱动，返回的 `target` 为 `#/<path>` 时直接跳转，否则进入 Copilot 并写入 `sop-copilot-prefill`。
- 页头「模块 AI」按钮（Bot 图标）会带入「模块名 / 域 / 能力码 / 当前路径」给 Copilot，便于 AI 上下文化分析与改动。
- AI 想新增「快捷动作」时，请优先扩 `system/pages/actions`（后端） + Copilot 命令注册表，而不是塞按钮进侧栏。

## 14. 待迭代（IA-4 与之后）

| ID | 任务 | 验收 |
|----|------|------|
| IA-4 | SystemMap 接入 `validateNavRegistry` 与「菜单健康分」 | 错误/警告可视化，可一键生成修复任务 |
| IA-5 | 用户级菜单偏好后端同步（`/users/me/menu-prefs`） | 多设备一致 |
| IA-6 | 移动端抽屉导航 + 手势 | 响应式 |
| IA-7 | 自定义工作区（用户可隐藏域、自定义顺序） | 拖拽 + 持久化 |
| IA-8 | 角色化默认折叠模板（admin/dev/pm/auditor） | 首次登录按角色初始化 |
