# Delivery Task Plan Implementation Plan

> **For agentic workers:** Use subagent-driven-development for the backend and frontend boundaries, with test-first verification and one final independent review.

**Goal:** 将需求拆解升级为可调整、可追踪、可恢复的任务计划，并连接真实统一模型网关。

**Architecture:** authenticated delivery 预览保存独立 SQL 凭据；tasks.plan 原子创建用户确认的条目；规划元数据关联现有 Task。前端专用弹窗共享手动/模板/AI 草稿。

**Tech Stack:** FastAPI/Pydantic/SQLAlchemy，React/Ant Design/TanStack Query。

**Spec:** docs/DELIVERY_TASK_PLAN_DESIGN.md

## Global Constraints

- 不提交、推送、修改实际业务数据或上传项目设计；不新增外部依赖。
- 固定版本、幂等身份、需求基准；旧证据不冒充新范围。
- 模型失败显式反馈，模板与 AI 来源区分；仅 stub provider 验证，不触发真实收费推理。
- `.ai-memory` 失效链接保持不动；测试用显式 rootdir/confcutdir 和隔离运行目录。

## Review Focus

- 模型执行期间需求/作用域变化；失败后重试是否重复调用或创建。
- 取消选择前置项、跨项目依赖、任务 key 冲突和验收索引漂移。
- 并发编辑后草稿是否保留、采用新基准是否需要明确操作。
- 模型/来源是否来自服务端真实记录，是否有静默回退或权限扩大。
- 窄屏、键盘操作、加载/错误/空态以及没有模型配置时手动流程可用。

## Tasks

- [x] 后端：先编写 preview/plan/依赖行为测试并观察失败；实现契约、SQL 预览凭据、模板和模型生成、原子落库及依赖门禁；全量 delivery 74 项通过。
- [x] 前端：先验证草稿变换和基准重映射；专用编辑器、来源/覆盖/依赖展示、冲突恢复与任务规划展示；类型与前端 181 项通过。
- [x] 契约：OpenAPI、SDK、CLI 预览入口及请求行为测试，沿用 existing command 接口；SDK 定向5项、真实服务 SDK/CLI 同一预览重放通过。
- [x] 验收：实际隔离服务/浏览器调整模板、创建、刷新、冲突和窄屏；生产构建；一次独立审查与修复；更新 memory 与能力清单。

审查5项 Important 均完成复现与修复：旧任务空/部分规划、模型缺省key、旧需求basis、双向依赖日期、缺失前置恢复。增量完成不表示全产品完成；生产AI账户、旧业务鉴权与模型配置统一、历史可视化、CI/部署等仍按主计划推进。
