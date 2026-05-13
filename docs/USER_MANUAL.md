# Web 管理后台 · 使用手册

面向**项目经理、开发、AI 辅助工作流**的操作说明。技术实现细节见 [sop/web/README.md](../sop/web/README.md)。

## 1. 启动与环境

```bash
# 推荐：先安装 Python 依赖（含 FastAPI / LanceDB / 可选 pypdf 等）
bash sop/tools/install-integrations.sh

# 启动后台（默认端口 8765）
bash sop/tools/start-manager.sh

# 管理「业务代码仓库」而非本规约仓库时，指定路径：
PROJECT_PATH=/path/to/your-app bash sop/tools/start-manager.sh

PORT=9000 PROJECT_PATH=/path/to/app bash sop/tools/start-manager.sh
```

浏览器访问：`http://localhost:8765`（若 `index.html` 内 `API` 与端口不一致，请改为当前端口）。

**环境变量**

| 变量 | 含义 |
|------|------|
| `PROJECT_PATH` | LanceDB、`.ai-memory/`、工作区浏览的根目录，默认当前工作目录 |
| `PORT` | Uvicorn 端口 |

## 2. 菜单与职责速览

| 分组 | 入口 | 用途 |
|------|------|------|
| 项目管理 | 总览 | Sprint、任务完成率、阻塞与问题告警 |
| 项目管理 | **研发全流程** | 单接口聚合状态、阶段跳转、低 Token 提示模板复制 |
| 项目管理 | 需求 / 执行计划 / 迭代 / Sprint / 问题 / 搜索 | 需求全生命周期与任务、迭代、缺陷 |
| 开发工具 | **Vibe Coding** | 会话与记忆、附件与多模态 LLM、Markdown/代码/页面预览、项目目录只读浏览 |
| 开发工具 | 规范编辑、环境管理（Docker）、CLI 工具 | 本地规范、容器与 CLI 配置；CLI 工具包含 Codex CLI |
| 知识与规范 | 技术方案、知识库、规范文档、规则库 | 方案版本、文档导入与 AI 润色、规范只读 |
| AI 能力 | Agent / 技能 / 编排 / MCP / 模型 | 多 Agent、专家组、工作流与模型选择 |
| 系统设置 | 通知、配置、系统、账号 | 运维与账号 |

## 3. 推荐工作流（省 Token）

1. 打开 **研发全流程**，查看 KPI 与**质量建议**（无需问模型）。  
2. 用阶段卡片跳转到 **需求** → **技术方案** → **执行计划**，在界面内完成结构化数据。  
3. 在 **研发全流程** 复制「低 Token 提示模板」，粘贴到 **Vibe Coding** 或外部 Agent；用 **需求 ID / 任务 ID** 代替贴全文。  
4. 需要看图或长文档时：在 Vibe 中上传附件或「文档抽取」，规范全文仍在「规范文档」页打开，不复制进提示词。

## 4. 核心页面说明

### 4.1 研发全流程

- 调用 `GET /api/dev-flow/summary` 聚合需求、任务、问题、Sprint、技术方案数量、Agent/专家组数量及仓库线索。  
- **进入枢纽**也可从「总览」页横幅进入。  
- 任意页面可通过内部事件切换到其它 Tab（与侧栏等价）。

### 4.2 Vibe Coding（AI 开发 IDE）

- **会话**：左侧列表、筛选、重命名、导出 JSON、删除；记忆区防抖保存。  
- **项目目录**：只读树，点击文件在右侧「项目文件」查看（受大小与 UTF-8 限制）。  
- **右侧视图**：原始输出、Markdown 渲染、代码块高亮、图片、PDF/文本附件、HTML 沙箱预览。  
- **直接调用 LLM**：支持图片等多模态（需 `ANTHROPIC_API_KEY`）；CLI 模式无法传图。
- **Codex CLI**：项目初始化后会生成 `AGENTS.md`、`.codex/config.toml`、`.codex/hooks.json`；首次启用 hook 时需在 Codex 中审查并信任。

### 4.3 需求与技术方案

- 需求：手动录入、文档批量导入、优先级与详情维护（以实际 `requirements` 路由为准）。  
- 技术方案：多文档、版本、落盘 `.ai-memory/tech_design/`（详见设计文档路由）。

### 4.4 环境管理（Docker）

- 环境检查、`docker ps` / `images` 等（以 `docker_env` 路由为准）；与「研发全流程」中的 Dockerfile 线索互补。

## 5. 常见问题

**Q：数据存在哪里？**  
A：默认在 `PROJECT_PATH/.ai-memory/lancedb` 与各 JSON 索引中；Vibe 会话在 `.ai-memory/vibe_sessions.json`，上传附件在 `.ai-memory/vibe_uploads/`。

**Q：PDF 知识库抽取失败？**  
A：需安装 `pypdf`（`install-integrations.sh` 或手动 `pip install pypdf`）。

**Q：静态资源打不开 API？**  
A：生产入口须保证 **`StaticFiles` 挂载在 API 路由之后**，否则 `/api/*` 会被静态文件吞掉；参考当前 `main.py` 顺序。

## 6. 相关文档

| 文档 | 内容 |
|------|------|
| [ARCHITECTURE.md](../ARCHITECTURE.md) | 体系架构与 Web 扩展 |
| [sop/QUICK_REF.md](../sop/QUICK_REF.md) | AI 速查与 Token 策略 |
| [TUTORIAL.md](../TUTORIAL.md) | 全流程教程含 Web 章节 |
| [sop/web/README.md](../sop/web/README.md) | 路由、页面模块、开发约定 |
| [sop/tools/CODEX_CLI.md](../sop/tools/CODEX_CLI.md) | Codex CLI / hooks 集成规范 |
