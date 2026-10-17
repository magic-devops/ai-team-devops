# sop-manager

> SOP **管理面 API**（SaaS 就绪）— FastAPI 应用，Python 包名 `sop_manager`。

浏览器 UI 已拆到同仓 **`apps/manager-web`**（Vite + React + TS）；本目录**不再托管**旧版 `index.html` 静态站，根路径 `/` 返回 JSON 说明，OpenAPI 在 `/docs`。

## 本地开发（典型）

```bash
# 终端 1：API（默认 8765）
pip install -e "apps/manager[all]"
cp apps/manager/.env.example apps/manager/.env   # 首次；编辑 SECRET_KEY 等
bash ai-sop-ops/start-manager.sh

# 终端 2：前端（5173，反代 /api → 8765）
cd apps/manager-web && pnpm i && pnpm dev
```

等价：`sop-manager start --reload`（须在含 `apps/manager` 的仓库中安装 editable，或设置 `PYTHONPATH` 指向 `apps/manager`）。

## 数据库结构升级

任务自身验收条件使用 `Task.acceptance_criteria` 文本数组。已有 SQLite 数据库需先停止 Manager，在与服务相同的 `DATABASE_URL` 环境中执行：

```bash
sop-manager schema verify
sop-manager schema apply
sop-manager schema verify
```

升级保留任务原数据，自身条件初始为 `[]`；不会从需求复制条件或补造验收通过。重复执行为幂等操作，正常启动不隐式执行 ALTER。新数据库直接建立当前结构。

SQLite 升级已经实测；PostgreSQL 路径仅验证 DDL 编译，部署前需在目标库演练。现有 MySQL/OceanBase 数据库的自动升级明确拒绝，需另行验证迁移；新库仍使用当前 SQL 模型。`sop_manager.migrate` 是 LanceDB 数据导入，与结构升级不同。

## 部署

```bash
docker build -f apps/manager/Dockerfile -t sop-manager .
docker run -p 8765:8765 -e PROJECT_PATH=/workspace -v $PWD:/workspace sop-manager
```

Compose：`apps/manager/docker-compose.single.yml`（SQLite） / `docker-compose.saas.yml`（Postgres + Qdrant + …）。SaaS 示例在 compose 旁使用 **`apps/manager/.env`**（由 `.env.example` 复制）。

## 代码布局

| 路径 | 说明 |
|------|------|
| `sop_manager/main.py` | FastAPI 实例、中间件、路由聚合 |
| `sop_manager/path_config.py` | 运行时目录、`PROJECT_PATH`、多租户请求作用域 |
| `sop_manager/routers/` | HTTP 路由模块（按域拆分，目标结构见 `docs/architecture/MODULES.md`） |
| `requirements.txt` | 无 extras 时的 pip 回退清单（与历史 `pyproject` 可选依赖互补） |

## 配置

环境变量见 **`apps/manager/.env.example`**。生产务必设置强随机 `SECRET_KEY`。

详见 [`../../docs/deploy/MANAGER.md`](../../docs/deploy/MANAGER.md)（若存在）。
