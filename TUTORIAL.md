# 详细使用教程

> sop — AI 多 Agent 开发规约体系使用指南

## 目录

1. [快速开始（5分钟）](#1-快速开始)
2. [项目初始化](#2-项目初始化)
3. [日常开发工作流](#3-日常开发工作流)
4. [多 Agent 协作](#4-多-agent-协作)
5. [Web 后台使用](#5-web-后台使用)
6. [自定义模块](#6-自定义模块)
7. [自我进化机制](#7-自我进化机制)
8. [多工具使用](#8-多工具使用)
9. [常见问题](#9-常见问题)

---

## 1. 快速开始

### 前置条件

- Git
- Python 3.10+（用于 LanceDB、Web 后台与 `install-integrations.sh` 推荐环境）
- 任意 AI 编码工具（Claude Code / opencode / Cursor / Trae 等）

### 5 分钟上手

```bash
# 1. 克隆本仓库
git clone https://github.com/your-org/ai-team-devops.git
cd ai-team-devops

# 2. 初始化你的项目
bash sop/tools/init-ai-project.sh my-app

# 3. 启动 Web 后台（可选）
bash sop/tools/start-manager.sh

# 4. 打开 AI 工具，开始开发
# Claude Code: claude
# opencode: opencode
# Cursor: 打开项目文件夹
```

初始化完成后，你的项目会有：
- `CLAUDE.md` — AI 开发规约入口
- `opencode.json` — opencode 配置
- `.cursorrules` — Cursor 规则
- `memory/current_state.json` — 项目状态
- `.ai-memory/` — AI 记忆入口（Web/向量等运行时数据默认物理目录在 `.sop-runtime/ai-memory/`；Unix 上项目根 `.ai-memory` 可为指向该目录的符号链接）

---

## 2. 项目初始化

### 2.1 运行初始化脚本

```bash
bash sop/tools/init-ai-project.sh <project-name>
```

**参数说明**：
- `project-name`：项目名称，用于生成包名 `com.magic.<project-name>`

**生成的文件**：

```
your-project/
├── CLAUDE.md                  # AI 规约入口（需要编辑）
├── opencode.json              # opencode 配置
├── .cursorrules               # Cursor 规则
├── .windsurfrules             # Windsurf 规则
├── .trae/rules.md             # Trae 规则
├── .qoder/context.md          # Qoder 规则
├── memory/
│   └── current_state.json     # 项目状态
├── .ai-memory/
│   ├── lancedb/               # 向量记忆库
│   └── rules/RULES.md         # 规则库
└── sop/custom/         # 自定义模块目录
```

### 2.2 编辑 CLAUDE.md

初始化后，编辑 `CLAUDE.md` 填写项目信息：

```markdown
# my-app

## 项目概述
- 技术栈: Spring Boot 3.x + MySQL 8 + Vue3
- 包名: com.magic.myapp

## 构建命令
cd backend && mvn test
cd frontend && npm test
```

### 2.3 健康检查

```bash
bash sop/tools/health-check.sh
```

输出示例：
```
🔍 AI 项目健康检查

【记忆系统】
  ✅ current_state.json 存在
  ✅ 规则库存在
  ✅ LanceDB 目录存在

【工具配置】
  ✅ CLAUDE.md 存在
  ✅ opencode.json 存在
  ✅ .cursorrules 存在

────────────────────────────────
  ✅ 6  ⚠️  0  ❌ 0
```

---

## 3. 日常开发工作流

### 3.1 标准开发循环

```
1. 告诉 AI 你的需求
2. AI 使用 /plan 拆解任务
3. AI 逐个执行任务（自动验证）
4. 遇到问题 AI 自动反思修复
5. 完成后 AI 输出置信度
6. 人工 Review（置信度 < 0.85 时）
7. /commit 提交代码
8. /evolve 提取规则
```

### 3.2 使用自定义命令

在 Claude Code 中，输入 `/` 查看可用命令：

| 命令 | 用途 | 示例 |
|------|------|------|
| `/plan` | 需求规划 | `/plan 实现用户注册功能` |
| `/review` | 代码审查 | `/review` |
| `/test` | 运行测试 | `/test` |
| `/commit` | 智能提交 | `/commit` |
| `/debug` | 问题诊断 | `/debug 登录接口返回 500` |
| `/standup` | 站会报告 | `/standup` |
| `/evolve` | 自我进化 | `/evolve` |

### 3.3 典型对话示例

**需求开发**：
```
你: 实现用户注册功能，需要邮箱验证

AI: <think>
分析需求：用户注册 + 邮箱验证
依赖：邮件服务、用户表、验证码存储
技术选型：Spring Boot + Redis 存验证码
</think>

我来拆解这个需求...
[执行 /plan，输出任务树]
[逐个实现，自动运行测试]
[完成后输出置信度: 0.88]
```

**遇到错误**：
```
AI: 测试失败：NullPointerException at UserService.java:45

<reflect>
失败原因：userMapper 未注入
第1次尝试：检查 @Autowired 注解 → 已有
根因：测试类缺少 @SpringBootTest
修正方案：添加 @SpringBootTest 注解
</reflect>

[修复后重新运行测试，通过]
置信度: 0.92
```

### 3.4 进度追踪

```bash
# 查看当前状态
cat memory/current_state.json

# 生成站会报告
# 在 AI 工具中输入：/standup
```

---

## 4. 多 Agent 协作

### 4.1 角色分工

```
Orchestrator（你的 AI 助手）
    ├── 接收需求，分解任务
    ├── 调度 Worker 执行
    └── 汇报进度

Planner（规划模式）
    └── 深度分析需求，输出详细方案

Worker（执行模式）
    ├── Coder：代码实现
    ├── Tester：测试编写
    └── Debugger：问题诊断

Reviewer（审查模式）
    └── 代码质量把关
```

### 4.2 并行开发

前后端可以并行开发，通过 API 契约解耦：

```bash
# 1. Planner 先输出 OpenAPI Spec
# 2. 前端基于 Mock 开发
# 3. 后端实现真实 API
# 4. 联调替换 Mock
```

### 4.3 任务分配格式

```json
{
  "task_id": "T003",
  "role": "Coder-Backend",
  "title": "实现用户登录 API",
  "specs_to_load": ["specs/backend/JAVA_SPEC.md"],
  "done_when": "单元测试通过，覆盖率 >= 80%"
}
```

---

## 5. Web 后台使用

### 5.1 启动

```bash
# 一键启动
bash sop/tools/start-manager.sh

# 指定项目路径
PROJECT_PATH=/path/to/project bash sop/tools/start-manager.sh

# 指定端口
PORT=9000 bash sop/tools/start-manager.sh
```

浏览器自动打开 `http://localhost:8765`

### 5.1.1 脚本索引与管理员

- **Shell / Python / 文档完整表**：[sop/tools/SCRIPTS.md](sop/tools/SCRIPTS.md)  
- **常用入口摘要**：[sop/tools/README.md](sop/tools/README.md)  
- **管理员密码**：`python3 sop/tools/reset-admin.py`（交互）或 `reset` / `create` 子命令，详见脚本文件头。

### 5.2 功能页面（菜单摘要）

| 页面 | 功能 |
|------|------|
| 📊 总览 | Sprint 进度、阻塞任务、问题告警、速度趋势；可一键进入「研发全流程」 |
| 🧭 研发全流程 | 聚合指标、阶段跳转、低 Token 提示模板（见 `docs/USER_MANUAL.md`） |
| 📋 需求 / 执行计划 / 迭代 / Sprint / 问题 / 搜索 | 需求全生命周期、任务与迭代、缺陷、全局搜索 |
| 📐 技术方案 | 多文档与版本、落盘 `.ai-memory/tech_design/` |
| 🗄️ 知识库 | 文档、抽取、AI 润色（依赖见 `install-integrations.sh`） |
| 🎯 Vibe Coding | 会话与记忆、附件与多模态 LLM、Markdown/代码/HTML 预览、项目目录只读浏览 |
| 🐳 环境管理 | Docker 检查与镜像相关能力 |
| 🤖 Agent / 编排 / MCP / 模型 | 多 Agent、专家组；**编排**含开发工具（分类/搜索/默认）、**本机环境**独立子页与工具联动、AI 安装方案 v2 与白名单受控执行（详见 [docs/ORCHESTRATION_DEV_TOOLS.md](docs/ORCHESTRATION_DEV_TOOLS.md)） |
| 其余 | 规范、规则、CLI、通知、系统与账号等 |

更细操作步骤见 **[docs/USER_MANUAL.md](docs/USER_MANUAL.md)**。

### 5.3 人工介入

**调整需求优先级**：
1. 进入「需求」页面
2. 点击需求右侧「调整」按钮
3. 选择新优先级，填写原因
4. 保存后 AI 下次执行时自动感知

**解除任务阻塞**：
1. 进入「任务」页面，找到阻塞任务
2. 点击「解除阻塞」
3. 填写解决方案
4. AI 自动恢复执行

**导出数据**：
- 点击顶部「⬇ 导出」按钮，下载完整 JSON 数据

### 5.4 省 Token 的推荐习惯

1. 先看 **研发全流程** 页的聚合数据与建议，再决定问 AI 什么。  
2. 向 Vibe / 外部模型描述任务时，只带 **需求 ID、任务 ID、文件相对路径**；规范与技术方案在后台页面打开。  
3. 需要 PDF/长文档内容时，用知识库 **抽取文本** 或 Vibe **文档抽取**，避免整文件进上下文。

---

## 6. 自定义模块

### 6.1 目录结构

```
sop/custom/
├── specs/       # 项目特定规范（优先级高于通用规范）
├── examples/    # 代码样例
├── design/      # 设计规范
├── interaction/ # 交互规范
└── daily/       # 日常输入
```

### 6.2 添加项目规范

```bash
# 添加 API 命名约定
cat > sop/custom/specs/api-naming.md << 'EOF'
# API 命名约定

本项目 API 路径统一使用复数名词：
- /api/v1/users（而非 /user）
- /api/v1/orders
EOF
```

AI 会自动读取 `custom/specs/` 中的规范，优先级高于通用规范。

### 6.3 添加代码样例

```bash
# 从实际代码中提取样例
cp src/main/java/com/magic/myapp/controller/UserController.java \
   sop/custom/examples/java/controller-template.java
```

AI 实现新功能时会参考这些样例，保持代码风格一致。

### 6.4 添加设计规范

```bash
# 品牌色
echo "主色: #3b82f6" > sop/custom/design/brand/colors.md

# 组件截图
cp design/mockups/dashboard.png sop/custom/design/layouts/
```

---

## 7. 自我进化机制

### 7.1 规则提取

AI 在以下情况自动提取规则：
- 同一类型错误出现 2 次以上
- 自修复成功（第 2-3 次才成功）
- 代码审查发现同类问题

### 7.2 手动触发进化

```
# 在 AI 工具中输入：
/evolve
```

AI 会：
1. 回顾本次会话的失败和修复
2. 提取可泛化规则
3. 写入 `.ai-memory/rules/`
4. 报告新增规则数量

### 7.3 查看规则库

```bash
cat .ai-memory/rules/RULES.md
```

### 7.4 规则生命周期

```
新规则（testing）→ 连续3次成功 → 活跃（active）→ 连续2次失败 → 废弃（deprecated）
```

---

## 8. 多工具使用

### 8.1 Codex CLI

```bash
# 安装
npm install -g @openai/codex
# 或: brew install --cask codex

# 启动（自动读取 AGENTS.md、.codex/config.toml、.codex/hooks.json）
codex

# 非交互执行
codex exec "按 AGENTS.md 规约检查项目健康状态"
```

首次看到 hook 审查提示时，逐项确认 `.codex/hooks.json` 与 `.codex/hooks/sop_hook.py` 的内容。默认 hook 只做启动上下文、危险命令拦截、活动日志和 Stop 状态同步。

### 8.2 Claude Code

```bash
# 安装
npm install -g @anthropic-ai/claude-code

# 启动（自动读取 CLAUDE.md 和 .claude/settings.json）
claude
```

### 8.3 opencode

```bash
# 安装
# 参考 https://github.com/sst/opencode

# 启动（自动读取 opencode.json）
opencode
```

### 8.4 Cursor

1. 打开项目文件夹
2. Cursor 自动读取 `.cursorrules`
3. 在 AI 对话中直接使用

### 8.5 同步规范到所有工具

```bash
bash sop/tools/sync-rules.sh
```

### 8.6 跨工具状态共享

所有工具共用 `memory/` 和 `.ai-memory/` 目录：
- 在 Codex CLI / Claude Code 中开始的任务，可以在 Cursor 中继续
- 规则库对所有工具可见

---

## 9. 常见问题

**Q: LanceDB 未安装怎么办？**
```bash
pip install lancedb pyarrow --break-system-packages
```

**Q: Dashboard 无法连接 API？**
确认后端已启动：`bash sop/tools/start-manager.sh`

**Q: AI 不遵守规范怎么办？**
1. 检查 `CLAUDE.md` 是否正确配置
2. 运行 `bash sop/tools/health-check.sh`
3. 确认规范文件路径正确

**Q: 如何重置项目状态？**
```bash
echo '{"project_id":"my-app","phase":"INIT","tasks":{"completed":[],"in_progress":[],"blocked":[],"pending":[]}}' \
  > memory/current_state.json
```

**Q: 如何备份 AI 记忆？**
```bash
bash sop/tools/snapshot.sh
# 快照保存到 memory/snapshots/YYYY-MM-DD.json
```

**Q: 如何在新项目中复用规则？**
```bash
# 将高置信度规则复制到新项目
cp .ai-memory/rules/coding/rule_*.md /new-project/.ai-memory/rules/coding/
```

---

## 10. Web 管理后台完整功能

### 10.0 登录与项目上下文

- 首次访问打开 **`login.html`** 完成初始化或登录；JWT 存入浏览器 **`sop-token`**。
- 多项目 / SaaS 场景：顶栏选择项目后写入 **`sop-current-project-id`**，后续 API 自动带 **`X-Project-Id`**（与 `index.html` 内 **`apiFetch`** 一致）。脚本调用请使用 **`MANAGER_SOP_TOKEN` + `PROJECT_ID`**（`sop/tools/manager_client.py`），详见 [USER_MANUAL.md §1.2](USER_MANUAL.md) 与 [sop/tools/SCRIPTS.md](../sop/tools/SCRIPTS.md)。
- **运维统一入口**：`bash sop/tools/sop-ctl.sh help`（`--json`、`wait-health`、`self-check`、`commands`、`url`/`open` 等；Bash 补全见 `sop-ctl.completion.bash`，手册 §1.3）。

### 10.1 全部页面（23个）

| 页面 | 功能 |
|------|------|
| 📊 总览 | Sprint 进度、告警、速度趋势 |
| 📈 分析 | 任务/需求/问题统计图表 |
| 📋 执行计划 | 任务 CRUD、状态管理 |
| 🔄 迭代进度 | Sprint 详情、阻塞任务 |
| 🗄️ 知识库 | 语义搜索、CRUD、索引 |
| ✏️ 规范编辑 | 规范文件在线编辑 |
| 📋 需求 | 需求看板、优先级调整 |
| ⚙️ 任务 | 任务追踪、解除阻塞 |
| 🐛 问题 | 问题管理、关闭 |
| 🏃 Sprint | 迭代管理 |
| 📖 规范 | 规范文档浏览 |
| 📐 规则库 | 规则管理、添加 |
| 📡 日志 | Agent 执行日志 |
| 🔍 搜索 | 全局搜索 |
| ⚙️ 配置 | 项目状态配置 |
| 🤖 Agent | Agent 定义、专家组 |
| ⚡ 技能 | 技能注册管理 |
| 🔌 MCP | MCP Server 管理 |
| 🖥️ 系统 | 脚本/配置/记忆管理 |
| 👤 账号 | 用户管理 |
| 🤖 模型 | 多模型配置、角色模型 |
| 🔄 编排 | 开发工具（分类/搜索/AI 受控安装）、**本机环境**（PATH 检查与定位工具）、工作流、质量配置、版本管理；参考 [docs/ORCHESTRATION_DEV_TOOLS.md](docs/ORCHESTRATION_DEV_TOOLS.md) |
| 🐳 环境 | 环境检查、Docker 管理 |
| 📦 技能仓库 | 自定义仓库、安装/卸载 |
| 🎯 Vibe Coding | 界面化 AI 开发 |

### 10.2 Vibe Coding 使用

```bash
# 启动管理后台
bash sop/tools/start-manager.sh

# 进入「🎯 Vibe Coding」页面
# 选择开发工具（claude/opencode/aider）
# 输入提示词，点击「执行」
```

### 10.3 Docker 环境管理

```bash
# 在「🐳 环境」页面
# 1. 「环境检查」查看所有工具安装状态
# 2. 「快速启动」一键启动 MySQL/Redis/PostgreSQL 等
# 3. 「构建镜像」界面化 docker build
```

### 10.4 技能仓库

```bash
# 在「📦 技能仓库」页面
# 1. 添加 Git 仓库（支持任意 Git URL）
# 2. 点击「同步」拉取技能列表
# 3. 安装/启用/禁用/卸载技能
# 4. 直接导入 JSON 格式技能
```
