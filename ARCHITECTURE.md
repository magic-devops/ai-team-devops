# 系统架构设计

> sop — AI 多 Agent 开发规约体系

## 设计理念

**三个核心问题**：
1. AI 如何在没有人工干预的情况下持续高质量地开发？
2. 多个 AI Agent 如何协作而不互相干扰？
3. AI 如何从错误中学习，越用越好？

**解决方案**：状态外化 + 规范驱动 + 自我进化

```
┌─────────────────────────────────────────────────────────────────┐
│                    sop 架构总览                            │
│                                                                 │
│  人工输入层    ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  (Human)      │ 需求描述  │  │ 优先级调整│  │ 问题反馈  │        │
│               └────┬─────┘  └────┬─────┘  └────┬─────┘        │
│                    │              │              │              │
│  编排层        ┌───▼──────────────▼──────────────▼───┐          │
│  (Orchestrator)│         Orchestrator Agent          │          │
│               │   任务分配 · 进度追踪 · 用户沟通       │          │
│               └───┬──────────┬──────────┬───────────┘          │
│                   │          │          │                       │
│  执行层        ┌──▼──┐   ┌──▼──┐   ┌──▼──┐                    │
│  (Workers)    │Planner│  │Coder│  │Reviewer│                   │
│               │规划者 │  │编码者│  │审查者  │                   │
│               └──┬──┘   └──┬──┘   └──┬──┘                    │
│                  │          │          │                        │
│  记忆层        ┌──▼──────────▼──────────▼───┐                  │
│  (Memory)     │         LanceDB              │                  │
│               │  需求·任务·问题·反思·规则      │                  │
│               └──────────────────────────────┘                 │
│                                                                 │
│  规范层        specs/ · custom/ · .ai-memory/rules/             │
│  (Specs)                                                        │
│                                                                 │
│  工具层        .claude/ · opencode.json · web/            │
│  (Tools)                                                        │
└─────────────────────────────────────────────────────────────────┘
```

## 核心模块

### 1. 规范体系（specs/）

```
specs/
├── PROJECT_CONVENTIONS.md   # 包名 com.magic.*，APP 默认 Superpower
├── backend/JAVA_SPEC.md     # Java/Spring Boot 规范
├── database/                # 数据库规范（含时间字段约定）
├── security/                # 安全规范（OWASP Top 10）
├── frontend/                # 前端规范（Vue3/React）
├── quality/                 # 质量门禁
└── ai-collab/               # AI 协作规范
```

**设计原则**：按需加载，不全量注入。每个规范文件独立，AI 根据任务类型选择加载。

### 2. Agent 体系（agents/）

```
Orchestrator ──► Planner ──► Worker(s) ──► Reviewer
     │                           │
     │◄──── 完成报告 ─────────────┘
     │
     ▼
  用户汇报
```

**关键设计**：
- 每个 Agent 无状态，状态全部外化到 LanceDB
- Hermes 能力：并行工具调用 + CoT 推理 + 自我反思
- 置信度驱动：< 0.70 自动触发 Reviewer

### 3. 记忆体系（memory/ + .ai-memory/）

```
工作记忆（上下文内）
    ↓ 持久化
项目记忆（LanceDB）
  ├── requirements  需求向量索引
  ├── tasks         任务状态
  ├── sprints       迭代记录
  ├── issues        问题记录
  └── agent_reflections  反思记录
    ↓ 蒸馏
长期记忆（.ai-memory/rules/）
  └── RULES.md      规则库（跨会话持久）
```

### 4. 自进化循环

```
执行任务
    ↓
<reflect> 分析结果
    ↓
识别可泛化模式（连续2次相同问题）
    ↓
提取规则 → 写入 .ai-memory/rules/
    ↓
下次执行时自动应用
```

### 5. 工具集成层

```
Claude Code  → CLAUDE.md + .claude/settings.json + .claude/commands/
opencode     → opencode.json
Cursor       → .cursorrules
Trae/Qoder   → .trae/rules.md / .qoder/context.md
Windsurf     → .windsurfrules

共享状态：memory/ + .ai-memory/（所有工具共用）
```

### 6. Web 管理后台（sop/web/）

人机协同入口：**模块化 FastAPI + Babel/React（无构建步骤）**，默认由 `sop/tools/start-manager.sh` 启动。

```
浏览器 index.html（shell）
    ↓ 加载 pages/*.js 全局组件
React 主应用（侧栏 + ALL_PAGES）
    ↓ fetch
FastAPI main:app（/api/*）
    ├─ routers/*  按域拆分（需求、任务、问题、Agent、技能、MCP、模型、编排、Docker、CLI、Vibe、技术方案、研发流…）
    └─ LanceDB / 文件索引（PROJECT_PATH 下的 .ai-memory/）
```

**关键约定**

| 项 | 说明 |
|----|------|
| `PROJECT_PATH` | 环境变量，指向被管理的业务仓库根；LanceDB、会话、上传、工作区浏览均相对此路径 |
| 静态资源 | `StaticFiles` 须注册在 **所有 `/api` 路由之后**，避免吞掉 API |
| 跨页导航 | 自定义事件 `app-set-tab`，便于「研发全流程」等模块跳转到既有菜单页 |
| 低 Token | `GET /api/dev-flow/summary` 一次返回聚合指标；Vibe 提供短提示模板与引用路径，避免贴全文规范 |

**Vibe Coding（IDE 化能力摘要）**

- 会话与持久记忆、附件上传、多模态 LLM（Anthropic）、专家组 system 注入  
- 会话/附件 JSON 持久化：`.ai-memory/vibe_sessions.json`、`vibe_uploads/`  
- 右侧：Markdown（marked+DOMPurify）、代码块（highlight.js）、HTML 沙箱预览、项目文件只读预览  
- 工作区 API：`/api/vibe/workspace/list|file`（路径校验，防穿越）

**研发全流程枢纽**

- `GET /api/dev-flow/summary`：需求/任务/问题/Sprint/技术方案数/Agent 与仓库线索聚合，供可视化驾驶舱与规则建议  

**Agent 编排与开发工具（`/api/orchestration`）**

- Web 侧：开发工具 **分类与搜索**、默认工具、内置覆盖/隐藏、自定义工具、**AI 安装方案**（Markdown + 白名单 `actions` 与 `argv_shell`）、**受控一键安装**、安装控制台与 JSONL 历史、本机 **环境检查**（与 `docker_env` 同源，支持缺失项 **AI 方案** 与 **定位工具**）。  
- 数据目录：`PROJECT_PATH/.sop-runtime/ai-memory/orchestration/`（Unix 上项目根 `.ai-memory` 多为符号链接；详见 [docs/ORCHESTRATION_DEV_TOOLS.md](../docs/ORCHESTRATION_DEV_TOOLS.md)）。

**人工介入点**：调整需求优先级、解除任务阻塞、关闭问题、新建 Sprint、维护技术方案版本、配置 Agent/专家组、在 Vibe 中发起实现/审查类对话

## 数据流

```
用户需求
    ↓
Orchestrator 分解为任务树（写入 LanceDB tasks）
    ↓
Worker 执行（读取规范 → 实现 → 验证 → 置信度自评）
    ↓
Reviewer 审查（置信度 < 0.85 时触发）
    ↓
完成 → 更新 LanceDB + current_state.json
    ↓
/evolve → 提取规则 → 更新 RULES.md
```

## 目录结构（仓库根）

```
./
├── LICENSE
├── README.md                  # 项目说明与快速入口
├── ARCHITECTURE.md            # 本架构说明
├── TUTORIAL.md                # 详细教程（含 Web）
├── docs/
│   ├── USER_MANUAL.md         # Web 管理后台使用手册（操作者向）
│   └── ORCHESTRATION_DEV_TOOLS.md  # 编排、开发工具、受控安装 API
├── CLAUDE.md.template
├── .claude/                   # Claude Code：settings / hooks / commands
├── sop/
│   ├── QUICK_REF.md           # ★ AI 速查卡
│   ├── README.md              # SOP 包内导航
│   ├── agents/ core/ memory/ workflow/ quality/ skills/
│   ├── specs/ custom/ templates/ knowledge/
│   ├── tools/                 # Shell/Python 脚本与集成文档
│   └── web/                   # FastAPI + 前端 SPA（main.py / routers/ / pages/）
└── ai-docs/                   # 可选参考文档
```

业务数据默认写在 **`PROJECT_PATH/.ai-memory/`**（与规约仓库可分离）。

## 技术选型

| 组件 | 技术 | 理由 |
|------|------|------|
| 向量记忆 | LanceDB | 本地运行，零配置，原生向量搜索 |
| Web 后台后端 | FastAPI | 轻量，自动生成 OpenAPI 文档 |
| Web 后台前端 | React（Babel standalone + `pages/*.js`） | 无需构建；Markdown 与代码高亮经 CDN 按需加载 |
| 规范格式 | Markdown | AI 可直接读取，人类友好 |
| 状态格式 | JSON | 通用，所有工具可读 |
| 脚本 | Bash + Python | 无额外依赖 |
