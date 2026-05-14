# sop-manager

> ai-team-devops 管理后台（SaaS 就绪） — 独立可部署 Python 包。

## 部署

```bash
# 本机（开发）
pip install -e "apps/manager[all]"
sop-manager start --reload

# Docker
docker build -f apps/manager/Dockerfile -t sop-manager .
docker run -p 8765:8765 -v $PWD:/workspace sop-manager
```

## 与 sop/web 的关系

- 本包是 `sop/web/` 的**部署/打包外壳**：通过 `sop_manager/__init__.py` 把 `sop/web/` 加入 `sys.path` 后导入 `main:app`
- 兼容期内（≥6 个月）`sop/web/` 是源码所在地，所有 routers/pages 维护在那里
- 长期会按 domain 渐进迁入 `apps/manager/sop_manager/domains/<domain>/`，旧路径加 deprecation shim

## 配置

环境变量与 `sop/web/.env.example` 完全一致。生产部署推荐：

```bash
ADMIN_MODE=saas
DB_TYPE=postgres
DATABASE_URL=postgresql+psycopg://user:pass@db:5432/sop
VECTOR_DB_TYPE=qdrant
QDRANT_URL=http://qdrant:6333
REDIS_URL=redis://redis:6379/0
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
SECRET_KEY=$(openssl rand -hex 32)
```

详见 [`../../docs/deploy/MANAGER.md`](../../docs/deploy/MANAGER.md)。
